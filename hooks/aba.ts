// Who I am: the terminal tab a list belongs to, and the claude process that
// owns it now (pid + start time), with a liveness check that reads a reused
// pid as dead.
//
// Mac measured on this Mac (2026-10-21). Windows branch written, NOT verified
// on a Windows machine.
//
// `ps -o lstart=` prints the start time in the CALLING process's locale
// (measured 2026-10-22: an iTerm tab with LANG=pt_BR.UTF-8 reads
// `qui 22 out 14:47:12 2026`, an Orca tab with en_US.UTF-8 reads
// `Thu Oct 22 14:47:12 2026` for the same pid). So it is always read under
// LC_ALL=C; otherwise one tab reads another tab's live owner as dead.

import type { EngineInterface } from 'claude-code'

import type { Dono } from '../types'
import { type Disco, ehWindows } from './disco'

export type Aba = Disco & Pick<EngineInterface, 'session'>

// Tab key precedence: the first variable set wins, prefixed with its source.
// Each is inherited from the terminal's shell, so every process in that
// terminal sees the same value, and a new `claude` there gets the same key.
//
// Orca (measured 2026-10-21 over the 9 running Orca claude processes, values
// compared by hash only): ORCA_TAB_ID, ORCA_PANE_KEY and ORCA_TERMINAL_HANDLE
// are all set and all differ between terminals; ORCA_PANE_KEY is
// "<ORCA_TAB_ID>:<pane uuid>" in every one of them, so the panes of a split
// tab share ORCA_TAB_ID and differ in ORCA_PANE_KEY. One pane runs one
// claude, so the per-pane ORCA_PANE_KEY is the key; ORCA_TAB_ID would merge
// two split panes into one list. Two runs in the same pane were not
// observed directly: stability rests on the value being inherited (this
// session's shell and its claude parent carry the same hash).
// Never read the ORCA_AGENT_HOOK_* variables (one is a token).
//
// tmux comes first: a tmux pane is narrower than the terminal around it, and
// panes inherit the tmux server's environment, so every pane of a server
// carries the same outer ITERM_SESSION_ID / TERM_SESSION_ID. TMUX_PANE
// (`%0`, `%1`, …) repeats across servers, so the key also carries the
// server's socket: the first field of $TMUX (`<socket>,<pid>,<session>`).
export async function chaveDaAba($: Aba): Promise<string> {
  const pane = await $.env.get('TMUX_PANE')
  if (pane) return `tmux:${((await $.env.get('TMUX')) ?? '').split(',')[0]}:${pane}`
  const orca = await $.env.get('ORCA_PANE_KEY')
  if (orca) return `orca:${orca}`
  const iterm = await $.env.get('ITERM_SESSION_ID')
  if (iterm) return `iterm:${iterm}`
  const term = await $.env.get('TERM_SESSION_ID')
  if (term) return `term:${term}`
  const wt = await $.env.get('WT_SESSION')
  if (wt) return `wt:${wt}`

  return `sessao:${await $.session.id()}`
}

const PS_WIN = (script: string) =>
  ['powershell', '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; ${script}`]

// The process start time as Windows reports it, one fixed format for both
// meuProcesso and estaVivo.
const INICIO_WIN = "(Get-CimInstance Win32_Process -Filter \"ProcessId=$([int]$env:LDS_PID)\").CreationDate.ToString('o')"

async function inicioDe($: Aba, pid: number, windows: boolean): Promise<string | undefined> {
  const ran = windows
    ? await $.process.run(PS_WIN(INICIO_WIN), { env: { LDS_PID: String(pid) } })
    : await $.process.run(['ps', '-o', 'lstart=', '-p', String(pid)], { env: { LC_ALL: 'C' } })
  const inicio = ran.stdout.trim()

  return ran.exitCode === 0 && inicio !== '' ? inicio : undefined
}

function pidDe(text: string): number | undefined {
  const pid = Number(text.trim())

  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

// `$.process.run` starts its command as a direct child of the claude process
// (measured 2026-10-21 under `claude -p --plugin-dir`: `sh -c 'echo $PPID'`
// printed the pid whose `ps -o comm=` is `claude`). The walk up is a guard in
// case a build ever puts something in between; it stops at the first
// `claude` and otherwise keeps the direct parent.
async function pidDoClaudePosix($: Aba): Promise<number> {
  const ran = await $.process.run(['sh', '-c', 'echo $PPID'])
  const primeiro = pidDe(ran.stdout)
  if (ran.exitCode !== 0 || primeiro === undefined) {
    throw new Error(`não deu pra saber o pid do claude: ${ran.stderr.trim()}`)
  }

  let pid: number | undefined = primeiro
  for (let passo = 0; pid !== undefined && pid > 1 && passo < 5; passo++) {
    const ps = await $.process.run(['ps', '-o', 'ppid=,comm=', '-p', String(pid)])
    const linha = ps.stdout.trim()
    if (ps.exitCode !== 0 || linha === '') break
    const [ppid, ...resto] = linha.split(/\s+/)
    const comm = resto.join(' ')
    if (comm === 'claude' || comm.endsWith('/claude')) return pid
    pid = pidDe(ppid ?? '')
  }

  return primeiro
}

async function pidDoClaudeWindows($: Aba): Promise<number> {
  const ran = await $.process.run(PS_WIN('(Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId'))
  const pid = pidDe(ran.stdout)
  if (ran.exitCode !== 0 || pid === undefined) {
    throw new Error(`não deu pra saber o pid do claude: ${ran.stderr.trim()}`)
  }

  return pid
}

/**
 * The claude process running this session: its pid and start time.
 *
 * @throws when the pid or the start time cannot be read.
 */
export async function meuProcesso($: Aba): Promise<Dono> {
  const windows = await ehWindows($)
  const pid = windows ? await pidDoClaudeWindows($) : await pidDoClaudePosix($)
  const inicio = await inicioDe($, pid, windows)
  if (inicio === undefined) throw new Error(`não deu pra ler o início do processo ${pid}`)

  return { pid, inicio }
}

// The C-locale format starts with an English weekday.
const INICIO_C = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /

/**
 * True only when a process with `dono.pid` runs AND started at `dono.inicio`:
 * a pid reused after a reboot or a crash reads as dead.
 *
 * On POSIX, a stored time not in the C format (written in the writer's locale,
 * by older code) cannot be compared: any process with that pid counts as
 * alive. A false "alive" only hides an orphan offer; a false "dead" destroys
 * a live list.
 */
export async function estaVivo($: Aba, dono: Dono): Promise<boolean> {
  if (pidDe(String(dono.pid)) === undefined) return false
  const windows = await ehWindows($)
  const inicio = await inicioDe($, dono.pid, windows)
  if (!windows && inicio !== undefined && !INICIO_C.test(dono.inicio.trim())) return true

  return inicio !== undefined && inicio === dono.inicio.trim()
}
