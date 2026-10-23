// disco.ts against a fake disk. `claude plugin test` runs with no fs or
// process at all, and a hooks module may not hold on to `$` (the loader
// refuses `x = $`), so disco.ts is handed a fake `$` holding only the nouns it
// uses (fs, process, env), backed by the fake disk below. The fake follows the semantics measured on this
// Mac (2026-10-21): `mkdir` (no `-p`) of an existing folder exits 1, `rm -f`
// and `rm -rf` of a missing path exit 0, `mv -f` replaces. It is an ideal
// disk: a race it passes is only as real as the lock's own primitive, which
// is why the lock is `mkdir` (measured: one winner in 1000 rounds), not the
// old `ln` + `rm` this fake once passed while the real disk gave two.
// Nothing here touches a real folder; every path seen must sit under the folder `mktemp -d` answered.

import { describe, expect, test } from 'claude-code/testing'
import { type Disco, destrava, gravaAtomico, move, remove, trava } from '../hooks/disco'

type Ran = { exitCode: number; stdout: string; stderr: string }

function fakeDisk(env: Record<string, string>) {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  const argvs: string[][] = []
  const paths: string[] = []
  const falha = { mv: false }
  let roots = 0

  const addDir = (d: string) => {
    for (let p = d; p.length > 1; p = p.slice(0, Math.max(p.lastIndexOf('/'), 1))) dirs.add(p)
  }
  const parent = (p: string) => p.slice(0, p.lastIndexOf('/'))
  const exists = (p: string) =>
    files.has(p) || dirs.has(p) || [...files.keys()].some(f => f.startsWith(`${p}/`))
  const ok = (): Ran => ({ exitCode: 0, stdout: '', stderr: '' })
  const ko = (stderr: string): Ran => ({ exitCode: 1, stdout: '', stderr })
  const see = (...ps: string[]) => { paths.push(...ps) }

  const mvForce = (a: string, b: string): Ran => {
    see(a, b)
    if (falha.mv) return ko('mv: simulated failure')
    if (!files.has(a)) return ko(`mv: ${a}: No such file or directory`)
    files.set(b, files.get(a) as string)
    files.delete(a)
    return ok()
  }
  const rmForce = (a: string): Ran => { see(a); files.delete(a); return ok() }
  const mkdirExcl = (d: string): Ran => {
    see(d)
    if (exists(d)) return ko(`mkdir: ${d}: File exists`)
    if (!dirs.has(parent(d))) return ko(`mkdir: ${d}: No such file or directory`)
    dirs.add(d)
    return ok()
  }
  const rmTree = (d: string): Ran => {
    see(d)
    for (const f of [...files.keys()]) if (f === d || f.startsWith(`${d}/`)) files.delete(f)
    for (const x of [...dirs]) if (x === d || x.startsWith(`${d}/`)) dirs.delete(x)
    return ok()
  }

  const run = async (argv: readonly string[], init?: { env?: Record<string, string> }): Promise<Ran> => {
    argvs.push([...argv])
    await Promise.resolve() // let racing calls interleave between steps
    const [cmd, ...raw] = argv
    const rest = raw.map(String)
    const a = (i: number): string => rest[i] ?? ''
    const key = rest.join(' ')
    if (cmd === 'mktemp' && key === '-d') {
      const root = `/fake-tmp/lds-test.${++roots}`
      addDir(root)
      return { exitCode: 0, stdout: `${root}\n`, stderr: '' }
    }
    if (cmd === 'mkdir' && a(0) === '-p' && a(1) === '--') { see(a(2)); addDir(a(2)); return ok() }
    if (cmd === 'mv' && a(0) === '-f' && a(1) === '--') return mvForce(a(2), a(3))
    if (cmd === 'mkdir' && a(0) === '--') return mkdirExcl(a(1))
    if (cmd === 'rm' && a(0) === '-rf' && a(1) === '--') return rmTree(a(2))
    if (cmd === 'rm' && a(0) === '-f' && a(1) === '--') return rmForce(a(2))
    if (cmd === 'powershell') {
      const script = a(rest.length - 1)
      const env0 = init?.env ?? {}
      const e = { LDS_DE: env0.LDS_DE ?? '', LDS_PARA: env0.LDS_PARA ?? '', LDS_PASTA: env0.LDS_PASTA ?? '', LDS_P: env0.LDS_P ?? '' }
      if (script.includes('Move-Item -Force')) return mvForce(e.LDS_DE, e.LDS_PARA)
      if (script.includes('New-Item -ItemType Directory -Force')) { see(e.LDS_PASTA); addDir(e.LDS_PASTA); return ok() }
      if (script.includes('New-Item -ItemType Directory -Path')) return mkdirExcl(e.LDS_P)
      if (script.includes('Remove-Item -Recurse')) return rmTree(e.LDS_P)
      if (script.includes('Remove-Item')) return rmForce(e.LDS_P)
    }
    return { exitCode: 127, stdout: '', stderr: `fake: unknown command ${argv.join(' ')}` }
  }

  const d = {
    env: { get: async (name: string) => env[name] },
    fs: {
      write: async (path: string, text: string) => {
        await Promise.resolve()
        see(path)
        addDir(parent(path)) // $.fs.write creates the folders
        files.set(path, text)
      },
      exists: async (path: string) => { await Promise.resolve(); see(path); return exists(path) },
    },
    process: { run },
  } as unknown as Disco

  return { d, files, argvs, paths, falha }
}

// A fresh fake disk and its temp folder, made with `mktemp -d` as a real run
// would; every path the test then sees must sit under it.
async function setup(env: Record<string, string> = { HOME: '/fake-home' }) {
  const disk = fakeDisk(env)
  const { stdout } = await disk.d.process.run(['mktemp', '-d'])
  return { d: disk.d, disk, root: stdout.trim() }
}

// The sweep: every command is one of the known argv shapes and every path is
// under the temp folder; nothing names the task store.
function sweep(disk: ReturnType<typeof fakeDisk>, root: string) {
  for (const p of disk.paths) expect(p === root || p.startsWith(`${root}/`), `outside temp folder: ${p}`).toBe(true)
  for (const a of disk.argvs) {
    expect(['mktemp', 'mkdir', 'mv', 'rm', 'powershell']).toContain(a[0])
    expect(a.join(' ')).not.toMatch(/tarefas\.py|tasks\.md/)
  }
}

test('the sweep itself catches a path outside the temp folder and a task-store command', async () => {
  const { disk, root } = await setup()
  disk.paths.push('/Users/someone/.claude/lista-da-sessao/listas/x.json')
  expect(() => sweep(disk, root)).toThrow(/outside temp folder/)
  disk.paths.pop()
  disk.argvs.push(['python3', 'todo.py', 'add', 'x'])
  expect(() => sweep(disk, root)).toThrow()
})

describe('gravaAtomico', () => {
  test('creates the file and its folder, then replaces it', async () => {
    const { d, disk, root } = await setup()
    const f = `${root}/listas/l_aaaa1111.json`
    await gravaAtomico(d, f, 'one')
    expect(disk.files.get(f)).toBe('one')
    await gravaAtomico(d, f, 'two')
    expect(disk.files.get(f)).toBe('two')
    expect([...disk.files.keys()].filter(k => k.includes('.tmp-'))).toEqual([])
    sweep(disk, root)
  })

  test('a leftover .tmp-* file never shadows the real one', async () => {
    const { d, disk, root } = await setup()
    const f = `${root}/listas/l_bbbb2222.json`
    disk.files.set(`${f}.tmp-deadbeef`, '{ half written')
    await gravaAtomico(d, f, 'real')
    expect(disk.files.get(f)).toBe('real')
    expect(disk.files.get(`${f}.tmp-deadbeef`)).toBe('{ half written')
    sweep(disk, root)
  })

  test('a failed rename throws and leaves the old file intact', async () => {
    const { d, disk, root } = await setup()
    const f = `${root}/listas/l_cccc3333.json`
    await gravaAtomico(d, f, 'old')
    disk.falha.mv = true
    await expect(gravaAtomico(d, f, 'new')).rejects.toThrow(/gravar/)
    expect(disk.files.get(f)).toBe('old')
    expect([...disk.files.keys()].filter(k => k.includes('.tmp-'))).toEqual([])
    sweep(disk, root)
  })
})

describe('move', () => {
  test('moves, creating the target folder', async () => {
    const { d, disk, root } = await setup()
    disk.files.set(`${root}/listas/l_x.json`, 'x')
    await move(d, `${root}/listas/l_x.json`, `${root}/descartadas/l_x.json`)
    expect(disk.files.has(`${root}/listas/l_x.json`)).toBe(false)
    expect(disk.files.get(`${root}/descartadas/l_x.json`)).toBe('x')
    sweep(disk, root)
  })

  test('a failed move throws and leaves the source', async () => {
    const { d, disk, root } = await setup()
    disk.files.set(`${root}/a.json`, 'a')
    disk.falha.mv = true
    await expect(move(d, `${root}/a.json`, `${root}/b/a.json`)).rejects.toThrow(/mover/)
    expect(disk.files.get(`${root}/a.json`)).toBe('a')
    sweep(disk, root)
  })
})

describe('trava / destrava', () => {
  test('two locks raced on the same folder: exactly one wins', async () => {
    const { d, disk, root } = await setup()
    const t = `${root}/listas/l_y.json.puxando`
    await d.process.run(['mkdir', '-p', '--', `${root}/listas`])
    disk.files.set(`${root}/listas/l_y.json`, 'y')
    const got = await Promise.all([trava(d, t), trava(d, t)])
    expect(got.filter(Boolean).length).toBe(1)
    expect(await trava(d, t)).toBe(false)
    await destrava(d, t)
    expect(await trava(d, t)).toBe(true)
    sweep(disk, root)
  })

  test('never mkdir -p: a missing parent throws instead of winning', async () => {
    const { d, disk, root } = await setup()
    await expect(trava(d, `${root}/nope/l_y.json.puxando`)).rejects.toThrow(/trinco/)
    expect(disk.argvs.some(v => v[0] === 'mkdir' && v.includes('-p'))).toBe(false)
    sweep(disk, root)
  })

  test('destrava removes the folder and what it holds; a missing one is fine', async () => {
    const { d, disk, root } = await setup()
    const t = `${root}/listas/l_y.json.puxando`
    await d.process.run(['mkdir', '-p', '--', `${root}/listas`])
    disk.files.set(`${root}/listas/l_y.json`, 'y')
    expect(await trava(d, t)).toBe(true)
    disk.files.set(`${t}/dono`, '{}')
    await destrava(d, t)
    expect([...disk.files.keys()].filter(k => k.startsWith(t))).toEqual([])
    await destrava(d, t)
    expect(disk.files.get(`${root}/listas/l_y.json`)).toBe('y')
    sweep(disk, root)
  })
})

describe('remove', () => {
  test('removes a file, and a missing file is fine', async () => {
    const { d, disk, root } = await setup()
    disk.files.set(`${root}/a.json`, 'a')
    await remove(d, `${root}/a.json`)
    expect(disk.files.has(`${root}/a.json`)).toBe(false)
    await remove(d, `${root}/a.json`)
    sweep(disk, root)
  })
})

describe('Windows branch (argv shape only; PowerShell itself unverified)', () => {
  test('paths reach PowerShell as env, never in the script', async () => {
    const { d, disk, root } = await setup({ OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\x' })
    const f = `${root}/listas/l_w.json`
    await gravaAtomico(d, f, 'w1')
    await gravaAtomico(d, f, 'w2')
    expect(disk.files.get(f)).toBe('w2')
    disk.files.set(`${root}/listas/l_v.json`, 'v')
    const t = `${root}/listas/l_v.json.puxando`
    expect(await trava(d, t)).toBe(true)
    expect(await trava(d, t)).toBe(false)
    await move(d, `${root}/listas/l_v.json`, `${root}/descartadas/l_v.json`)
    await destrava(d, t)
    expect(await trava(d, t)).toBe(true)
    await remove(d, `${root}/descartadas/l_v.json`)
    expect(disk.files.has(`${root}/descartadas/l_v.json`)).toBe(false)
    const ps = disk.argvs.filter(v => v[0] === 'powershell')
    expect(ps.length).toBeGreaterThan(0)
    for (const v of ps) expect(v.join(' ')).not.toContain(root)
    expect(disk.argvs.some(v => ['mv', 'rm', 'mkdir'].includes(v[0] ?? ''))).toBe(false)
    sweep(disk, root)
  })
})
