// listas.ts against a fake host over an in-memory disk. `claude plugin test`
// gives a test no real fs or process, and a module may not hold on to `$`, so
// every function is handed a fake `$` (fs, process, env, session). The fake
// follows what this Mac did on 2026-10-21: `mkdir` (no `-p`) of an existing
// folder or under a missing parent exits 1, `rm -f` and `rm -rf` exit 0,
// `mv -f` replaces, `ps -o lstart= -p <pid>` prints the start time or exits 1
// with nothing. It is an ideal disk, so a race passing here proves only the
// logic around the lock; the lock's primitive (`mkdir`) was measured on the
// real disk (one winner in 1000 rounds; the old `ln` + `rm` gave two).
// Every disk lives under the folder `mktemp -d` answered; the sweep checks
// every path and command of every test against it.

import { describe, expect, test } from 'claude-code/testing'

import {
  type Eu, type Host, agora, anota, descarta, desrisca, ErroDaLista, limpa, minhaLista,
  nomeia, orfas, pasta, puxa, risca, tira,
} from '../hooks/listas'
import type { Lista } from '../types'

// The code an ErroDaLista carries; anything else (another error, no throw)
// comes back as text that no code equals.
async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (err) {
    return err instanceof ErroDaLista ? err.codigo : `not ErroDaLista: ${String(err)}`
  }
  return 'did not throw'
}

type Ran = { exitCode: number; stdout: string; stderr: string }

function fakeDisk(env: Record<string, string>) {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  const argvs: string[][] = []
  const paths: string[] = []
  const vivos = new Map<number, string>() // pid → start time
  const mtimes = new Map<string, number>() // folder → mtimeMs, set by mkdir
  const hook: { antes?: (argv: string[]) => void } = {}
  let roots = 0

  const addDir = (d: string) => {
    for (let p = d; p.length > 1; p = p.slice(0, Math.max(p.lastIndexOf('/'), 1))) dirs.add(p)
  }
  const parent = (p: string) => p.slice(0, p.lastIndexOf('/'))
  const exists = (p: string) =>
    files.has(p) || dirs.has(p) || [...files.keys()].some(f => f.startsWith(`${p}/`))
  const ok = (stdout = ''): Ran => ({ exitCode: 0, stdout, stderr: '' })
  const ko = (stderr: string): Ran => ({ exitCode: 1, stdout: '', stderr })
  const see = (...ps: string[]) => { paths.push(...ps) }

  const run = async (argv: readonly string[]): Promise<Ran> => {
    const v = argv.map(String)
    argvs.push(v)
    hook.antes?.(v)
    await Promise.resolve() // let racing calls interleave between steps
    const [cmd, ...rest] = v
    const a = (i: number): string => rest[i] ?? ''
    if (cmd === 'mktemp' && rest.join(' ') === '-d') {
      const root = `/fake-tmp/lds-test.${++roots}`
      addDir(root)
      return ok(`${root}\n`)
    }
    if (cmd === 'mkdir' && a(0) === '-p' && a(1) === '--') { see(a(2)); addDir(a(2)); return ok() }
    if (cmd === 'mv' && a(0) === '-f' && a(1) === '--') {
      see(a(2), a(3))
      if (!files.has(a(2))) return ko('mv: No such file or directory')
      files.set(a(3), files.get(a(2)) as string)
      files.delete(a(2))
      return ok()
    }
    if (cmd === 'mkdir' && a(0) === '--') {
      see(a(1))
      if (exists(a(1)) || !dirs.has(parent(a(1)))) return ko('mkdir: refused')
      dirs.add(a(1))
      mtimes.set(a(1), Date.now())
      return ok()
    }
    if (cmd === 'rm' && a(0) === '-rf' && a(1) === '--') {
      see(a(2))
      for (const f of [...files.keys()]) if (f === a(2) || f.startsWith(`${a(2)}/`)) files.delete(f)
      for (const d of [...dirs]) if (d === a(2) || d.startsWith(`${a(2)}/`)) dirs.delete(d)
      return ok()
    }
    if (cmd === 'rm' && a(0) === '--') {
      see(a(1))
      if (!files.has(a(1))) return ko('rm: No such file or directory')
      files.delete(a(1))
      return ok()
    }
    if (cmd === 'rm' && a(0) === '-f' && a(1) === '--') { see(a(2)); files.delete(a(2)); return ok() }
    if (cmd === 'ps' && a(0) === '-o' && a(1) === 'lstart=' && a(2) === '-p') {
      const inicio = vivos.get(Number(a(3)))
      return inicio === undefined ? { exitCode: 1, stdout: '', stderr: '' } : ok(`${inicio}  \n`)
    }
    return { exitCode: 127, stdout: '', stderr: `fake: unknown command ${v.join(' ')}` }
  }

  const $ = {
    env: { get: async (name: string) => env[name] },
    session: { id: async () => 'sess1' },
    fs: {
      read: async (path: string) => {
        await Promise.resolve()
        see(path)
        const t = files.get(path)
        if (t === undefined) throw new Error(`ENOENT: ${path}`)
        return t
      },
      write: async (path: string, text: string) => {
        await Promise.resolve()
        see(path)
        addDir(parent(path)) // $.fs.write creates the folders
        files.set(path, text)
      },
      exists: async (path: string) => { await Promise.resolve(); see(path); return exists(path) },
      stat: async (path: string) => {
        await Promise.resolve()
        see(path)
        if (!exists(path)) throw new Error(`ENOENT: ${path}`)
        return { kind: dirs.has(path) ? 'dir' : 'file', size: 1, mtimeMs: mtimes.get(path) ?? Date.now(), isLink: false }
      },
      list: async (path: string) => {
        await Promise.resolve()
        see(path)
        if (!dirs.has(path)) throw new Error(`ENOENT: ${path}`)
        const names = new Set<string>()
        for (const f of files.keys()) if (parent(f) === path) names.add(f.slice(path.length + 1))
        const sub = [...dirs].filter(d => parent(d) === path).map(d => d.slice(path.length + 1))
        return [
          ...[...names].map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
          ...sub.map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })),
        ]
      },
    },
    process: { run },
  } as unknown as Host

  return { $, files, dirs, argvs, paths, vivos, mtimes, hook }
}

type Disk = ReturnType<typeof fakeDisk>
const todas: { disk: Disk; root: string }[] = []

async function setup(env: Record<string, string> = { HOME: '/fake-home' }) {
  const disk = fakeDisk(env)
  const { stdout } = await disk.$.process.run(['mktemp', '-d'])
  const root = stdout.trim()
  todas.push({ disk, root })
  return { $: disk.$, disk, root }
}

// The sweep: every command is one of the known shapes and every path is under
// the temp folder; nothing names the task store.
function sweep(disk: Disk, root: string) {
  for (const p of disk.paths) expect(p === root || p.startsWith(`${root}/`), `outside temp folder: ${p}`).toBe(true)
  for (const a of disk.argvs) {
    expect(['mktemp', 'mkdir', 'mv', 'rm', 'ps']).toContain(a[0])
    expect(a.join(' ')).not.toMatch(/tarefas\.py|tasks\.md/)
  }
}

const INICIO = 'Wed Oct 21 09:27:20 2026'
const EU: Eu = { aba: 'iterm:A', dono: { pid: 100, inicio: INICIO } }

function vivo(disk: Disk, ...eus: Eu[]) {
  for (const e of eus) disk.vivos.set(e.dono.pid, e.dono.inicio)
}

function lista(id: string, aba: string, pid: number, itens: [string, boolean][], atualizada = '2026-10-20T10:00:00-03:00', assunto = ''): Lista {
  return {
    versao: 1, id, aba, dono: { pid, inicio: 'Mon Oct 19 08:00:00 2026' }, assunto,
    criada: '2026-10-20T09:00:00-03:00', atualizada,
    itens: itens.map(([texto, feito], n) => ({ id: `i${n + 1}`, texto, feito, feitoEm: feito ? atualizada : null })),
  }
}

function planta(disk: Disk, root: string, l: Lista) {
  disk.files.set(`${root}/listas/${l.id}.json`, JSON.stringify(l))
  disk.dirs.add(`${root}/listas`)
}

const le = (disk: Disk, root: string, id: string): Lista =>
  JSON.parse(disk.files.get(`${root}/listas/${id}.json`) ?? 'null') as Lista

const listasNoDisco = (disk: Disk, root: string) =>
  [...disk.files.keys()].filter(k => k.startsWith(`${root}/listas/`)).sort()

test('the sweep itself catches a path outside the temp folder and a task-store command', async () => {
  const { disk, root } = await setup()
  disk.paths.push('/Users/someone/.claude/lista-da-sessao/listas/x.json')
  expect(() => sweep(disk, root)).toThrow(/outside temp folder/)
  disk.paths.pop()
  disk.argvs.push(['python3', 'todo.py', 'add', 'x'])
  expect(() => sweep(disk, root)).toThrow()
  disk.argvs.pop()
})

describe('pasta', () => {
  test('the option wins, trailing separator dropped', async () => {
    const { $ } = await setup()
    expect(await pasta($, { pasta: ' /fake-tmp/x/ ' })).toBe('/fake-tmp/x')
  })
  test('default under HOME, an empty option counts as unset', async () => {
    const { $ } = await setup()
    expect(await pasta($, { pasta: '' })).toBe('/fake-home/.claude/lista-da-sessao')
    expect(await pasta($, undefined)).toBe('/fake-home/.claude/lista-da-sessao')
  })
  test('USERPROFILE when HOME is unset; neither throws', async () => {
    const win = await setup({ USERPROFILE: 'C:\\Users\\x\\' })
    expect(await pasta(win.$, {})).toBe('C:\\Users\\x/.claude/lista-da-sessao')
    const none = await setup({})
    expect(await codigoDe(pasta(none.$, {}))).toBe('sem-home')
  })
})

test('agora is ISO 8601 with a local offset', () => {
  expect(agora()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/)
})

describe('cold start', () => {
  test('no data folder: nothing mine, nothing offered; the first anota creates folder and file', async () => {
    const { $, disk, root } = await setup()
    const raiz = `${root}/dados`
    vivo(disk, EU)
    expect(await minhaLista($, raiz, EU)).toEqual({ minha: undefined, outrasDaAba: [], ilegiveis: [] })
    expect(await orfas($, raiz, EU)).toEqual({ orfas: [], ilegiveis: [] })
    expect(await limpa($, raiz, EU)).toEqual([])
    expect(disk.files.size).toBe(0)

    const l = await anota($, raiz, EU, ['parte 1', '  ', 'parte 2'], 'Organização')
    expect(l.id).toMatch(/^l_[a-z0-9]{8}$/)
    expect(l.itens.map(i => i.id)).toEqual(['i1', 'i2'])
    expect(l.aba).toBe('iterm:A')
    expect(l.dono).toEqual(EU.dono)
    expect(l.assunto).toBe('Organização')
    expect(le(disk, raiz, l.id)).toEqual(l)
    expect(listasNoDisco(disk, raiz)).toEqual([`${raiz}/listas/${l.id}.json`])
    sweep(disk, root)
  })

  test('anota with no text throws and writes nothing', async () => {
    const { $, disk, root } = await setup()
    expect(await codigoDe(anota($, root, EU, ['', ' ']))).toBe('nada-pra-anotar')
    expect(disk.files.size).toBe(0)
    sweep(disk, root)
  })

  test('risca, desrisca, tira and nomeia with no list throw plainly', async () => {
    const { $, disk, root } = await setup()
    expect(await codigoDe(risca($, root, EU, ['i1']))).toBe('sem-lista')
    expect(await codigoDe(desrisca($, root, EU, ['i1']))).toBe('sem-lista')
    expect(await codigoDe(tira($, root, EU, ['i1']))).toBe('sem-lista')
    expect(await codigoDe(nomeia($, root, EU, 'X'))).toBe('sem-lista')
    expect(disk.files.size).toBe(0)
    sweep(disk, root)
  })
})

describe('steady state', () => {
  test('anota appends with stable ids; risca, desrisca, tira, nomeia write the file', async () => {
    const { $, disk, root } = await setup()
    vivo(disk, EU)
    const first = await anota($, root, EU, ['a', 'b'])
    const second = await anota($, root, EU, ['c'])
    expect(second.id).toBe(first.id)
    expect(second.itens.map(i => [i.id, i.texto])).toEqual([['i1', 'a'], ['i2', 'b'], ['i3', 'c']])

    const r = await risca($, root, EU, ['i2', 'i9'])
    expect(r.naoAchei).toEqual(['i9'])
    const i2 = r.lista.itens.find(i => i.id === 'i2')
    expect(i2?.feito).toBe(true)
    expect(i2?.feitoEm).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(le(disk, root, first.id).itens[1]?.feito).toBe(true)

    const d = await desrisca($, root, EU, ['i2'])
    expect(d.lista.itens[1]).toEqual({ id: 'i2', texto: 'b', feito: false, feitoEm: null })

    const t = await tira($, root, EU, ['i1'])
    expect(t.lista.itens.map(i => i.id)).toEqual(['i2', 'i3'])
    expect((await anota($, root, EU, ['d'])).itens.map(i => i.id)).toEqual(['i2', 'i3', 'i4'])

    expect((await nomeia($, root, EU, '  Workshop ')).assunto).toBe('Workshop')
    expect(le(disk, root, first.id).assunto).toBe('Workshop')
    expect(await codigoDe(nomeia($, root, EU, ' '))).toBe('assunto-vazio')
    sweep(disk, root)
  })

  test('ids that all miss change nothing on disk', async () => {
    const { $, disk, root } = await setup()
    vivo(disk, EU)
    const l = await anota($, root, EU, ['a'])
    const antes = disk.files.get(`${root}/listas/${l.id}.json`)
    expect((await risca($, root, EU, ['i7'])).naoAchei).toEqual(['i7'])
    expect(disk.files.get(`${root}/listas/${l.id}.json`)).toBe(antes)
    sweep(disk, root)
  })
})

describe('identity', () => {
  test('same tab, new process: it is mine (dono updated), not an orphan', async () => {
    const { $, disk, root } = await setup()
    planta(disk, root, lista('l_old00001', EU.aba, 55, [['parte 2', false]]))
    vivo(disk, EU) // pid 55 is dead
    expect((await orfas($, root, EU)).orfas).toEqual([])
    const { minha } = await minhaLista($, root, EU)
    expect(minha?.id).toBe('l_old00001')
    expect(le(disk, root, 'l_old00001').dono).toEqual(EU.dono)
    expect((await anota($, root, EU, ['parte 3'])).id).toBe('l_old00001')
    sweep(disk, root)
  })

  test('two lists with my tab key: the newest is mine, the other is left alone and reported', async () => {
    const { $, disk, root } = await setup()
    planta(disk, root, lista('l_older001', EU.aba, 55, [['velho', false]], '2026-10-19T10:00:00-03:00'))
    planta(disk, root, lista('l_newer001', EU.aba, 56, [['novo', false]], '2026-10-20T10:00:00-03:00'))
    vivo(disk, EU)
    const antes = disk.files.get(`${root}/listas/l_older001.json`)
    const r = await minhaLista($, root, EU)
    expect(r.minha?.id).toBe('l_newer001')
    expect(r.outrasDaAba).toEqual(['l_older001'])
    expect(disk.files.get(`${root}/listas/l_older001.json`)).toBe(antes)
    // The older one, owner dead with an open item, is offered.
    expect((await orfas($, root, EU)).orfas.map(l => l.id)).toEqual(['l_older001'])
    sweep(disk, root)
  })
})

describe('files that are not lists', () => {
  test('a leftover .tmp-*, .puxando-* file or .puxando lock folder never shadows the real file', async () => {
    const { $, disk, root } = await setup()
    vivo(disk, EU)
    const l = await anota($, root, EU, ['real'])
    const real = `${root}/listas/${l.id}.json`
    disk.files.set(`${real}.tmp-deadbeef`, '{ half written')
    disk.files.set(`${real}.puxando-999`, JSON.stringify({ ...l, itens: [] }))
    disk.dirs.add(`${real}.puxando`)
    disk.files.set(`${real}.puxando/dono`, JSON.stringify({ pid: 999, inicio: 'x' }))
    const r = await minhaLista($, root, EU)
    expect(r.minha?.itens.map(i => i.texto)).toEqual(['real'])
    expect(r.ilegiveis).toEqual([])
    await anota($, root, EU, ['mais'])
    expect(le(disk, root, l.id).itens.map(i => i.texto)).toEqual(['real', 'mais'])
    expect(disk.files.get(`${real}.tmp-deadbeef`)).toBe('{ half written')
    sweep(disk, root)
  })

  test('valid JSON of the wrong shape (id not the file name) is unreadable', async () => {
    const { $, disk, root } = await setup()
    disk.files.set(`${root}/listas/l_aaaa0000.json`, JSON.stringify(lista('l_bbbb0000', 'x', 1, [['a', false]])))
    disk.dirs.add(`${root}/listas`)
    expect((await orfas($, root, EU)).ilegiveis).toEqual(['l_aaaa0000.json'])
    sweep(disk, root)
  })
})

// The status × operation grid: one disk per operation, seeded with a list of
// each status.
const OUTRA: Eu = { aba: 'iterm:D', dono: { pid: 400, inicio: 'Tue Oct 20 07:00:00 2026' } }
const ILEGIVEL = 'l_zzzzzzzz.json'
const QUEBRADO = '{ "versao": 1, broken'

async function grade() {
  const s = await setup()
  const { disk, root } = s
  planta(disk, root, { ...lista('l_mine0001', EU.aba, 100, [['minha', false]]), dono: EU.dono })
  planta(disk, root, lista('l_open0001', 'iterm:B', 200, [['feita', true], ['aberta 1', false], ['aberta 2', false]], '2026-10-20T11:00:00-03:00', 'Organização'))
  planta(disk, root, lista('l_done0001', 'iterm:C', 300, [['tudo feito', true]]))
  planta(disk, root, { ...lista('l_live0001', OUTRA.aba, 400, [['da outra aba', false]]), dono: OUTRA.dono })
  disk.files.set(`${root}/listas/${ILEGIVEL}`, QUEBRADO)
  vivo(disk, EU, OUTRA)
  const copia = new Map(disk.files)
  const mudou = () => [...new Set([...copia.keys(), ...disk.files.keys()])]
    .filter(k => copia.get(k) !== disk.files.get(k)).sort()
  return { ...s, mudou }
}

describe('status × operation grid', () => {
  test('start: mine is mine, only the dead list with open items is offered, the unreadable one is named', async () => {
    const { $, disk, root, mudou } = await grade()
    const m = await minhaLista($, root, EU)
    expect(m.minha?.id).toBe('l_mine0001')
    expect(m.ilegiveis).toEqual([ILEGIVEL])
    const o = await orfas($, root, EU)
    expect(o.orfas.map(l => l.id)).toEqual(['l_open0001'])
    expect(o.ilegiveis).toEqual([ILEGIVEL])
    expect(mudou()).toEqual([])
    sweep(disk, root)
  })

  test('anota: only my file changes', async () => {
    const { $, disk, root, mudou } = await grade()
    await anota($, root, EU, ['nova'])
    expect(mudou()).toEqual([`${root}/listas/l_mine0001.json`])
    sweep(disk, root)
  })

  test('puxa: orphans come in, mine/live/unreadable are refused and untouched', async () => {
    const { $, disk, root, mudou } = await grade()
    expect(await puxa($, root, EU, 'l_mine0001')).toEqual({ ok: false, motivo: 'minha' })
    expect(await puxa($, root, EU, 'l_live0001')).toEqual({ ok: false, motivo: 'viva' })
    expect(await puxa($, root, EU, 'l_zzzzzzzz')).toEqual({ ok: false, motivo: 'ilegivel' })
    expect(await puxa($, root, EU, 'l_nope0000')).toEqual({ ok: false, motivo: 'sumiu' })
    expect(await puxa($, root, EU, '../x')).toEqual({ ok: false, motivo: 'sumiu' })
    expect(mudou()).toEqual([])

    const r = await puxa($, root, EU, 'l_open0001')
    expect(r.ok).toBe(true)
    // Appended to mine: open items only, new ids; the orphan file is gone.
    expect(r.ok && r.lista.id).toBe('l_mine0001')
    expect(le(disk, root, 'l_mine0001').itens.map(i => [i.id, i.texto, i.feito]))
      .toEqual([['i1', 'minha', false], ['i2', 'aberta 1', false], ['i3', 'aberta 2', false]])
    expect(le(disk, root, 'l_mine0001').assunto).toBe('Organização')
    expect(await puxa($, root, EU, 'l_done0001')).toMatchObject({ ok: true })
    expect(mudou()).toEqual([
      `${root}/listas/l_done0001.json`, `${root}/listas/l_mine0001.json`, `${root}/listas/l_open0001.json`,
    ])
    expect(listasNoDisco(disk, root).some(k => k.includes('.puxando'))).toBe(false)
    expect([...disk.dirs].some(k => k.includes('.puxando'))).toBe(false)
    expect(disk.files.get(`${root}/listas/${ILEGIVEL}`)).toBe(QUEBRADO)
    sweep(disk, root)
  })

  test('descarta: orphans move to descartadas/, mine/live/unreadable are refused and untouched', async () => {
    const { $, disk, root, mudou } = await grade()
    expect(await descarta($, root, EU, 'l_mine0001')).toEqual({ ok: false, motivo: 'minha' })
    expect(await descarta($, root, EU, 'l_live0001')).toEqual({ ok: false, motivo: 'viva' })
    expect(await descarta($, root, EU, 'l_zzzzzzzz')).toEqual({ ok: false, motivo: 'ilegivel' })
    expect(mudou()).toEqual([])
    const antes = disk.files.get(`${root}/listas/l_open0001.json`)
    expect(await descarta($, root, EU, 'l_open0001')).toEqual({ ok: true })
    expect(await descarta($, root, EU, 'l_done0001')).toEqual({ ok: true })
    expect(disk.files.get(`${root}/descartadas/l_open0001.json`)).toBe(antes)
    expect(mudou()).toEqual([
      `${root}/descartadas/l_done0001.json`, `${root}/descartadas/l_open0001.json`,
      `${root}/listas/l_done0001.json`, `${root}/listas/l_open0001.json`,
    ])
    expect(await descarta($, root, EU, 'l_open0001')).toEqual({ ok: false, motivo: 'sumiu' })
    expect((await orfas($, root, EU)).orfas).toEqual([])
    sweep(disk, root)
  })

  test('limpa: removes only the dead all-done list; the unreadable file is untouched', async () => {
    const { $, disk, root, mudou } = await grade()
    // A live tab whose items are all done is not finished work to delete.
    planta(disk, root, { ...lista('l_live0002', 'iterm:E', 400, [['feito', true]]), dono: OUTRA.dono })
    const live2 = disk.files.get(`${root}/listas/l_live0002.json`)
    expect(await limpa($, root, EU)).toEqual(['l_done0001'])
    expect(mudou()).toEqual([`${root}/listas/l_done0001.json`, `${root}/listas/l_live0002.json`])
    expect(disk.files.get(`${root}/listas/l_live0002.json`)).toBe(live2)
    expect(disk.files.get(`${root}/listas/${ILEGIVEL}`)).toBe(QUEBRADO)
    sweep(disk, root)
  })
})

describe('limpa: this tab, a new claude process', () => {
  const ANTES: Eu = { aba: EU.aba, dono: { pid: 90, inicio: 'Thu Oct 22 14:00:00 2026' } }

  test('the finished list a closed conversation left in this tab is removed', async () => {
    const { $, disk, root } = await setup()
    planta(disk, root, { ...lista('l_velha001', EU.aba, 90, [['feito', true]]), dono: ANTES.dono })
    vivo(disk, EU)
    expect(await limpa($, root, EU)).toEqual(['l_velha001'])
    expect(await minhaLista($, root, EU)).toEqual({ minha: undefined, outrasDaAba: [], ilegiveis: [] })
  })

  test('a list with an open item from a closed conversation stays and is taken over', async () => {
    const { $, disk, root } = await setup()
    planta(disk, root, { ...lista('l_velha001', EU.aba, 90, [['feito', true], ['falta', false]]), dono: ANTES.dono })
    vivo(disk, EU)
    expect(await limpa($, root, EU)).toEqual([])
    expect((await minhaLista($, root, EU)).minha?.id).toBe('l_velha001')
  })

  test('the finished list of this same process (after /clear) stays', async () => {
    const { $, disk, root } = await setup()
    planta(disk, root, { ...lista('l_minha001', EU.aba, 100, [['feito', true]]), dono: EU.dono })
    vivo(disk, EU)
    expect(await limpa($, root, EU)).toEqual([])
  })

  test('a finished list in this tab whose old process still runs stays', async () => {
    const { $, disk, root } = await setup()
    planta(disk, root, { ...lista('l_velha001', EU.aba, 90, [['feito', true]]), dono: ANTES.dono })
    vivo(disk, EU, ANTES)
    expect(await limpa($, root, EU)).toEqual([])
  })
})

describe('puxa', () => {
  test('with no list here the orphan becomes mine, same id and items', async () => {
    const { $, disk, root } = await setup()
    planta(disk, root, lista('l_orfa0001', 'iterm:B', 200, [['feita', true], ['aberta', false]], undefined, 'Organização'))
    vivo(disk, EU)
    const r = await puxa($, root, EU, 'l_orfa0001')
    expect(r.ok).toBe(true)
    const l = le(disk, root, 'l_orfa0001')
    expect(l.aba).toBe(EU.aba)
    expect(l.dono).toEqual(EU.dono)
    expect(l.itens.map(i => [i.id, i.feito])).toEqual([['i1', true], ['i2', false]])
    expect(listasNoDisco(disk, root)).toEqual([`${root}/listas/l_orfa0001.json`])
    expect((await minhaLista($, root, EU)).minha?.id).toBe('l_orfa0001')
    expect((await orfas($, root, EU)).orfas).toEqual([])
    sweep(disk, root)
  })

  test('double adoption: two tabs pulling the same orphan, exactly one gets it', async () => {
    const { $, disk, root } = await setup()
    const B: Eu = { aba: 'iterm:B2', dono: { pid: 101, inicio: INICIO } }
    planta(disk, root, lista('l_orfa0002', 'iterm:Z', 900, [['a', false], ['b', false]]))
    vivo(disk, EU, B)
    const got = await Promise.all([puxa($, root, EU, 'l_orfa0002'), puxa($, root, B, 'l_orfa0002')])
    expect(got.filter(g => g.ok).length).toBe(1)
    const perdeu = got.find(g => !g.ok)
    expect(perdeu && !perdeu.ok && ['outra-aba', 'sumiu'].includes(perdeu.motivo)).toBe(true)
    const files = listasNoDisco(disk, root)
    expect(files).toEqual([`${root}/listas/l_orfa0002.json`])
    expect([EU.aba, B.aba]).toContain(le(disk, root, 'l_orfa0002').aba)
    sweep(disk, root)
  })

  test('two pulls interleaved in the middle: exactly one gets it, whoever locks first', async () => {
    const B: Eu = { aba: 'iterm:B2', dono: { pid: 101, inicio: INICIO } }
    // B starts at A's first liveness check (before A locks), then at A's lock.
    for (const quando of [(v: string[]) => v[0] === 'ps', (v: string[]) => v[0] === 'mkdir' && v[1] === '--']) {
      const { $, disk, root } = await setup()
      planta(disk, root, lista('l_orfa0003', 'iterm:Z', 900, [['a', false]]))
      vivo(disk, EU, B)
      let deB: Promise<Awaited<ReturnType<typeof puxa>>> | undefined
      disk.hook.antes = argv => {
        if (!deB && quando(argv)) deB = puxa($, root, B, 'l_orfa0003')
      }
      const deA = await puxa($, root, EU, 'l_orfa0003')
      disk.hook.antes = undefined
      const got = [deA, await (deB as Promise<Awaited<ReturnType<typeof puxa>>>)]
      expect(got.filter(g => g.ok).length).toBe(1)
      expect(got.find(g => !g.ok)).toMatchObject({ ok: false })
      expect(listasNoDisco(disk, root)).toEqual([`${root}/listas/l_orfa0003.json`])
      expect([...disk.dirs].some(d => d.includes('.puxando'))).toBe(false)
      sweep(disk, root)
    }
  })

  test('a live holder\'s lock is never broken; one with no holder only once older than a minute', async () => {
    const { $, disk, root } = await setup()
    const f = `${root}/listas/l_orfa0004.json`
    planta(disk, root, lista('l_orfa0004', 'iterm:Z', 900, [['a', false]]))
    vivo(disk, EU, OUTRA)
    disk.dirs.add(`${f}.puxando`)

    disk.files.set(`${f}.puxando/dono`, JSON.stringify(OUTRA.dono))
    // Old as it is, a lock whose holder still runs is that holder's.
    disk.mtimes.set(`${f}.puxando`, Date.now() - 600_000)
    const antes = disk.files.get(f)
    expect(await puxa($, root, EU, 'l_orfa0004')).toEqual({ ok: false, motivo: 'outra-aba' })
    expect(await descarta($, root, EU, 'l_orfa0004')).toEqual({ ok: false, motivo: 'outra-aba' })
    expect(disk.files.get(f)).toBe(antes)
    expect(disk.files.get(`${f}.puxando/dono`)).toBe(JSON.stringify(OUTRA.dono))

    // No readable holder and a fresh folder: its holder may be between the
    // mkdir and the write of `dono`, so it is left alone.
    disk.files.delete(`${f}.puxando/dono`)
    disk.mtimes.set(`${f}.puxando`, Date.now() - 5_000)
    expect(await puxa($, root, EU, 'l_orfa0004')).toEqual({ ok: false, motivo: 'outra-aba' })
    expect(disk.dirs.has(`${f}.puxando`)).toBe(true)

    // No readable holder and older than a minute: abandoned, broken and taken.
    disk.mtimes.set(`${f}.puxando`, Date.now() - 61_000)
    expect(await puxa($, root, EU, 'l_orfa0004')).toMatchObject({ ok: true })
    expect([...disk.dirs].some(d => d.includes('.puxando'))).toBe(false)
    expect(le(disk, root, 'l_orfa0004').aba).toBe(EU.aba)
    sweep(disk, root)
  })

  test('a lock whose holder is dead is broken and taken', async () => {
    const { $, disk, root } = await setup()
    const f = `${root}/listas/l_orfa0004.json`
    planta(disk, root, lista('l_orfa0004', 'iterm:Z', 900, [['a', false]]))
    vivo(disk, EU)
    disk.dirs.add(`${f}.puxando`)
    disk.mtimes.set(`${f}.puxando`, Date.now())
    disk.files.set(`${f}.puxando/dono`, JSON.stringify({ pid: 777, inicio: 'Mon Oct 19 08:00:00 2026' }))
    const r = await puxa($, root, EU, 'l_orfa0004')
    expect(r.ok).toBe(true)
    expect(le(disk, root, 'l_orfa0004').aba).toBe(EU.aba)
    expect([...disk.dirs].some(d => d.includes('.puxando'))).toBe(false)
    expect([...disk.files.keys()].some(k => k.includes('.puxando/'))).toBe(false)
    sweep(disk, root)
  })

  test('the checks run again under the lock: a list taken between the look and the lock is refused', async () => {
    const { $, disk, root } = await setup()
    const B: Eu = { aba: 'iterm:B3', dono: { pid: 102, inicio: INICIO } }
    planta(disk, root, lista('l_orfa0005', 'iterm:Z', 900, [['a', false]]))
    vivo(disk, EU, B)
    const f = `${root}/listas/l_orfa0005.json`
    // Another tab adopts it (and lets go of its lock) just before our lock.
    disk.hook.antes = argv => {
      if (argv[0] === 'mkdir' && argv[1] === '--') {
        disk.hook.antes = undefined
        const l = JSON.parse(disk.files.get(f) as string) as Lista
        disk.files.set(f, JSON.stringify({ ...l, aba: B.aba, dono: B.dono }))
      }
    }
    expect(await puxa($, root, EU, 'l_orfa0005')).toEqual({ ok: false, motivo: 'viva' })
    expect(le(disk, root, 'l_orfa0005').aba).toBe(B.aba)
    expect([...disk.dirs].some(d => d.includes('.puxando'))).toBe(false)
    expect((await minhaLista($, root, EU)).minha).toBe(undefined)
    sweep(disk, root)
  })
})

// Runs last: every disk of the suite, swept once more as a whole.
test('invariant sweep over the whole suite: nothing outside the temp folders, no task store', () => {
  expect(todas.length).toBeGreaterThan(10)
  for (const { disk, root } of todas) sweep(disk, root)
})
