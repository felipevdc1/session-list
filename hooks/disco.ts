// Host-command helpers for the list files: atomic write, move, remove, and
// the folder lock two tabs race for (trava / destrava). `$.fs` has no rename or delete, so
// those go through `$.process.run`, always as argv arrays: a file name never
// becomes part of a shell string. On Windows the paths reach PowerShell as
// environment variables, never interpolated into the script text.
//
// Mac/Linux measured on this Mac (2026-10-21). Windows branch written, NOT
// verified on a Windows machine.

import type { EngineInterface } from 'claude-code'

export type Disco = Pick<EngineInterface, 'fs' | 'process' | 'env'>

type Ran = { exitCode: number; stdout: string; stderr: string }

// The one platform check. Windows when the OS says so, or when HOME is unset
// (a plain Windows console sets USERPROFILE, not HOME).
export async function ehWindows($: Disco): Promise<boolean> {
  if ((await $.env.get('OS')) === 'Windows_NT') return true
  return (await $.env.get('HOME')) === undefined
}

function pastaDe(caminho: string): string {
  const corte = Math.max(caminho.lastIndexOf('/'), caminho.lastIndexOf('\\'))
  return corte > 0 ? caminho.slice(0, corte) : caminho
}

// No pid is reachable from a hooks module's environment without a process
// call, so the temp suffix is 8 random hex digits: unique per write, which is
// all `<file>.tmp-<pid>` was for.
function sufixo(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function powershell($: Disco, script: string, env: Record<string, string>): Promise<Ran> {
  return $.process.run(
    ['powershell', '-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference = 'Stop'; ${script}`],
    { env },
  )
}

function falhou(o_que: string, ran: Ran): Error {
  return new Error(`${o_que} falhou (código ${ran.exitCode}): ${ran.stderr.trim()}`)
}

/**
 * Writes `texto` to `caminho` atomically: a temp file beside it, then a rename
 * over it. Parent folders are created by `$.fs.write`.
 *
 * Resolves once `caminho` holds `texto`. Throws when the write or the rename
 * fails; then `caminho` still holds what it held before (or is still absent)
 * and the temp file is removed (best effort).
 */
export async function gravaAtomico($: Disco, caminho: string, texto: string): Promise<void> {
  const tmp = `${caminho}.tmp-${sufixo()}`
  await $.fs.write(tmp, texto)
  const ran = (await ehWindows($))
    ? await powershell($,
      'Move-Item -Force -LiteralPath $env:LDS_DE -Destination $env:LDS_PARA',
      { LDS_DE: tmp, LDS_PARA: caminho })
    : await $.process.run(['mv', '-f', '--', tmp, caminho])
  if (ran.exitCode !== 0) {
    await remove($, tmp).catch(() => undefined)
    throw falhou(`gravar ${caminho}`, ran)
  }
}

/**
 * Moves `de` to `para`, replacing `para`; the parent folder of `para` is
 * created first. Not a claim: callers hold the list's lock (trava) around it.
 *
 * @throws when the move fails, leaving `de` where it was.
 */
export async function move($: Disco, de: string, para: string): Promise<void> {
  const windows = await ehWindows($)
  const mk = windows
    ? await powershell($,
      'New-Item -ItemType Directory -Force -Path $env:LDS_PASTA | Out-Null',
      { LDS_PASTA: pastaDe(para) })
    : await $.process.run(['mkdir', '-p', '--', pastaDe(para)])
  if (mk.exitCode !== 0) throw falhou(`criar a pasta de ${para}`, mk)
  const mv = windows
    ? await powershell($,
      'Move-Item -Force -LiteralPath $env:LDS_DE -Destination $env:LDS_PARA',
      { LDS_DE: de, LDS_PARA: para })
    : await $.process.run(['mv', '-f', '--', de, para])
  if (mv.exitCode !== 0) throw falhou(`mover ${de}`, mv)
}

/**
 * Takes the lock `trinco` by creating that folder, never with `-p`: of two
 * calls racing for the same folder exactly one creates it. Its parent must
 * exist.
 *
 * Measured on this Mac (2026-10-21, two processes, 1000 rounds): `mkdir`
 * gave exactly one winner every round. The old claim, `ln de para` then
 * `rm de`, gave two winners 10 times in 1000 (and 14 in 400): both `rm`s
 * exited 0. Windows: `New-Item -ItemType Directory` without `-Force` fails
 * when the folder exists (written, NOT verified on a Windows machine).
 *
 * @returns true when this call created the folder; false when it exists.
 * @throws on any other failure (a missing parent, permissions).
 */
export async function trava($: Disco, trinco: string): Promise<boolean> {
  const ran = (await ehWindows($))
    ? await powershell($, 'New-Item -ItemType Directory -Path $env:LDS_P | Out-Null', { LDS_P: trinco })
    : await $.process.run(['mkdir', '--', trinco])
  if (ran.exitCode === 0) return true
  if (await $.fs.exists(trinco)) return false
  throw falhou(`criar o trinco ${trinco}`, ran)
}

/**
 * Removes the lock folder `trinco` and what it holds; a missing one is fine.
 *
 * @throws when it exists and could not be removed.
 */
export async function destrava($: Disco, trinco: string): Promise<void> {
  const ran = (await ehWindows($))
    ? await powershell($,
      'if (Test-Path -LiteralPath $env:LDS_P) { Remove-Item -Recurse -Force -LiteralPath $env:LDS_P }',
      { LDS_P: trinco })
    : await $.process.run(['rm', '-rf', '--', trinco])
  if (ran.exitCode !== 0) throw falhou(`apagar o trinco ${trinco}`, ran)
}

/**
 * Removes the file at `caminho`; a missing file is fine.
 *
 * @throws when the file exists and could not be removed.
 */
export async function remove($: Disco, caminho: string): Promise<void> {
  const ran = (await ehWindows($))
    ? await powershell($,
      'if (Test-Path -LiteralPath $env:LDS_P) { Remove-Item -Force -LiteralPath $env:LDS_P }',
      { LDS_P: caminho })
    : await $.process.run(['rm', '-f', '--', caminho])
  if (ran.exitCode !== 0) throw falhou(`apagar ${caminho}`, ran)
}
