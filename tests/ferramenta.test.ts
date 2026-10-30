// ferramenta.ts (and estado.ts's recarrega) against the same fake host as
// listas.test.ts, plus an in-memory `$.state`. The kit cannot drive the tool,
// prompt.compose or classic.SessionStart through this plugin until
// register.tsx wires them (Task 3.2), and gives no real fs or process, so the
// exported functions are called directly with a fake `$` and a fake `next`.
// The fake disk is a copy of listas.test.ts's (a test file cannot import
// another without re-running its tests).

import type { ConfigRow } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { type Comum, garanteQuem, ilegiveisA, leTema, minhaA, orfasA, quemA, type Quem, recarrega, semeia } from '../hooks/estado'
import {
  aoChamarLista, aoComporPrompt, aoEnviarPrompt, contextoInicial, espec, registraFerramenta, secaoRegra,
} from '../hooks/ferramenta'
import { type Eu, type Host } from '../hooks/listas'
import { type Idioma, idiomaDe, textos } from '../hooks/textos'
import type { Lista } from '../types'

// The options the mod gets, one per language (the folder is set per test by setup).
const RAIZ = '/fake-tmp/lds-test'
const OPCOES_EN = { options: { pasta: RAIZ } }
const OPCOES_PT = { options: { pasta: RAIZ, idioma: 'pt-BR' } }
const PT = textos('pt-BR')
const EN = textos('en')

// The /config theme row as the engine lists it.
const linhaTema = (value: string): ConfigRow => ({
  key: 'theme', label: 'Theme', kind: 'choice', value, options: ['dark', 'light'],
  provider: { plugin: 'engine', tier: 'core' } as ConfigRow['provider'], isLocked: false,
})

// Every text the suite gets back from the mod (results, denials, compose
// sections, context), swept at the end for words that must never ship.
const vistos: { idioma: Idioma; texto: string }[] = []
const PROIBIDO = new RegExp(
  [['Fel', 'ipe'], ['fel', 'ipevdc1'], ['plug-in de ', 'tarefas'], ['tarefas ', 'dele'], ['tarefas', '\\.py'], ['bota na ', 'minha lista']]
    .map(p => p.join('')).join('|'),
  'i',
)

type Ran = { exitCode: number; stdout: string; stderr: string }

function fakeDisk(env: Record<string, string>, config: ConfigRow[] | null) {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  const argvs: string[][] = []
  const paths: string[] = []
  const vivos = new Map<number, string>() // pid → start time
  const hook: { antes?: (argv: string[]) => void } = {}
  let roots = 0
  const state = new Map<string, unknown>()
  const versions = new Map<string, number>()

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
    // The lock: `mkdir` without -p exits 1 on an existing path or a missing
    // parent; `rm -rf` of a missing path exits 0 (both measured on this Mac).
    if (cmd === 'mkdir' && a(0) === '--') {
      see(a(1))
      if (exists(a(1)) || !dirs.has(parent(a(1)))) return ko('mkdir: refused')
      dirs.add(a(1))
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
    state: {
      get: async (ref: { plugin: string; key: string }) => {
        const k = `${ref.plugin}/${ref.key}`
        return { value: state.has(k) ? structuredClone(state.get(k)) : undefined, version: versions.get(k) ?? 0 }
      },
      set: async (ref: { plugin: string; key: string }, value: unknown, options?: { ifVersion?: number }) => {
        const k = `${ref.plugin}/${ref.key}`
        const v = versions.get(k) ?? 0
        if (options?.ifVersion !== undefined && options.ifVersion !== v) return { isSet: false, version: v }
        state.set(k, structuredClone(value))
        versions.set(k, v + 1)
        return { isSet: true, version: v + 1 }
      },
    },
    // null: a hand-built `$` with no /config at all.
    ...(config === null ? {} : { config: { list: async () => structuredClone(config) } }),
  } as unknown as Host & Comum

  return { $, files, dirs, argvs, paths, vivos, hook, state }
}

type Disk = ReturnType<typeof fakeDisk>
const todas: { disk: Disk; root: string }[] = []

const INICIO = 'Wed Oct 21 09:27:20 2026'
const EU: Eu = { aba: 'iterm:A', dono: { pid: 100, inicio: INICIO } }

// A fresh fake host on its own temp folder; interactive (quemA set) unless
// told otherwise, in the language the options give, /config theme dark.
async function setup(interativa = true, opcoes: { options: { pasta: string; idioma?: string } } = OPCOES_PT, config: ConfigRow[] | null = [linhaTema('dark')]) {
  const disk = fakeDisk({ HOME: '/fake-home' }, config)
  const { stdout } = await disk.$.process.run(['mktemp', '-d'])
  const root = stdout.trim()
  const idioma = idiomaDe(opcoes.options)
  todas.push({ disk, root })
  disk.vivos.set(EU.dono.pid, EU.dono.inicio)
  if (interativa) await disk.$.state.set(quemA.ref as never, { raiz: root, eu: EU, idioma } satisfies Quem as never)
  return { $: disk.$, disk, root, idioma }
}

function sweep(disk: Disk, root: string) {
  for (const p of disk.paths) expect(p === root || p.startsWith(`${root}/`), `outside temp folder: ${p}`).toBe(true)
  for (const a of disk.argvs) {
    expect(['mktemp', 'mkdir', 'mv', 'rm', 'ps']).toContain(a[0])
    expect(a.join(' ')).not.toMatch(/tarefas\.py|tasks\.md/)
  }
}

function lista(id: string, aba: string, pid: number, itens: [string, boolean][], assunto = ''): Lista {
  const quando = '2026-10-20T10:00:00-03:00'
  return {
    versao: 1, id, aba, dono: { pid, inicio: 'Mon Oct 19 08:00:00 2026' }, assunto, criada: quando, atualizada: quando,
    itens: itens.map(([texto, feito], n) => ({ id: `i${n + 1}`, texto, feito, feitoEm: feito ? quando : null })),
  }
}

function planta(disk: Disk, root: string, l: Lista) {
  disk.files.set(`${root}/listas/${l.id}.json`, JSON.stringify(l))
  disk.dirs.add(`${root}/listas`)
}

const minhasNoDisco = (disk: Disk, root: string): Lista[] =>
  [...disk.files.entries()]
    .filter(([k]) => /\/listas\/l_[a-z0-9]{8}\.json$/.test(k) && k.startsWith(root))
    .map(([, v]) => JSON.parse(v) as Lista)
    .filter(l => l.aba === EU.aba)

const idiomaDo = async ($: Comum): Promise<Idioma> => (await garanteQuem($))?.idioma ?? 'en'

async function chamaCru($: Comum, args: Record<string, unknown>): Promise<{ result: string } | { deny: string }> {
  const idioma = await idiomaDo($)
  const r = await aoChamarLista($, args)
  vistos.push({ idioma, texto: 'deny' in r ? r.deny : r.result })
  return r
}

async function chama($: Comum, args: Record<string, unknown>): Promise<string> {
  const r = await chamaCru($, args)
  if ('deny' in r) throw new Error(`denied: ${r.deny}`)
  return r.result
}

const atomo = (disk: Disk, key: string) => disk.state.get(`lista-da-sessao/${key}`)

describe('the tool', () => {
  test('spec: lista, never deferred, every action in the schema, in both languages', () => {
    for (const idioma of ['en', 'pt-BR'] as const) {
      const t = textos(idioma)
      const s = espec(t)
      expect(s.name).toBe('lista')
      expect(s.isDeferred).toBe(false)
      const props = (s.inputSchema as { properties: Record<string, { enum?: string[]; description?: string }> }).properties
      expect(props.acao?.enum).toEqual(['anota', 'risca', 'desrisca', 'tira', 'nomeia', 'mostra', 'puxa', 'descarta'])
      expect(s.description).toBe(t.descricaoFerramenta)
      expect([props.textos?.description, props.ids?.description, props.assunto?.description, props.listaId?.description])
        .toEqual([t.paramTextos, t.paramIds, t.paramAssunto, t.paramListaId])
      for (const texto of [s.description, ...Object.values(props).map(p => p.description ?? '')]) vistos.push({ idioma, texto })
    }
    // English explains the Portuguese action names.
    expect(espec(EN).description).toContain('risca / desrisca / tira (tick / untick / remove: ids)')
    expect(espec(EN).description).toContain('puxa / descarta (adopt / discard a list a closed tab left: listaId)')
  })

  test('registraFerramenta registers the spec in the tab\'s language, and nothing when inactive', async () => {
    for (const [opcoes, t] of [[OPCOES_EN, EN], [OPCOES_PT, PT]] as const) {
      const { $ } = await setup(true, opcoes)
      const registradas: unknown[] = []
      await registraFerramenta(Object.assign($, { tool: { register: async (s: unknown) => { registradas.push(s) } } }) as never)
      expect(registradas).toEqual([espec(t)])
    }
    const { $ } = await setup(false)
    const registradas: unknown[] = []
    await registraFerramenta(Object.assign($, { tool: { register: async (s: unknown) => { registradas.push(s) } } }) as never)
    expect(registradas).toEqual([])
  })

  test('each action changes the file and the answer shows it; the pane atoms follow', async () => {
    const { $, disk, root } = await setup()

    expect(await chama($, { acao: 'mostra' })).toBe('Lista da sessão desta aba: nada anotado ainda.')
    expect(disk.files.size).toBe(0)

    const a = await chama($, { acao: 'anota', textos: ['Organização 2/3', 'Organização 3/3'], assunto: 'Organização' })
    expect(a).toBe('Lista da sessão desta aba: Organização\n☐ i1 Organização 2/3\n☐ i2 Organização 3/3')
    expect(minhasNoDisco(disk, root)[0]?.itens.map(i => i.texto)).toEqual(['Organização 2/3', 'Organização 3/3'])
    expect((atomo(disk, 'minha') as Lista).itens.length).toBe(2)

    const r = await chama($, { acao: 'risca', ids: ['i1'] })
    expect(r).toBe('Lista da sessão desta aba: Organização\n☐ i2 Organização 3/3\n☑ i1 Organização 2/3 (feito)')
    expect(minhasNoDisco(disk, root)[0]?.itens[0]?.feito).toBe(true)
    expect((atomo(disk, 'minha') as Lista).itens[0]?.feito).toBe(true)

    const d = await chama($, { acao: 'desrisca', ids: ['i1'] })
    expect(d).toContain('☐ i1 Organização 2/3')
    expect(minhasNoDisco(disk, root)[0]?.itens[0]?.feito).toBe(false)

    const t = await chama($, { acao: 'tira', ids: ['i2', 'i9'] })
    expect(t).toBe('Não achei: i9.\n\nLista da sessão desta aba: Organização\n☐ i1 Organização 2/3')
    expect(minhasNoDisco(disk, root)[0]?.itens.map(i => i.id)).toEqual(['i1'])

    const n = await chama($, { acao: 'nomeia', assunto: 'Organização (partes)' })
    expect(n.split('\n')[0]).toBe('Lista da sessão desta aba: Organização (partes)')
    expect(minhasNoDisco(disk, root)[0]?.assunto).toBe('Organização (partes)')
    sweep(disk, root)
  })

  test('a change with no list yet answers plainly, writes nothing', async () => {
    const { $, disk, root } = await setup()
    expect(await chama($, { acao: 'risca', ids: ['i1'] }))
      .toBe('Esta aba ainda não tem lista: anote o primeiro item.\n\nLista da sessão desta aba: nada anotado ainda.')
    expect(await chama($, { acao: 'anota', textos: [' '] })).toMatch(/^Nada pra anotar/)
    expect(disk.files.size).toBe(0)
    sweep(disk, root)
  })

  test('an unknown action is refused', async () => {
    const { $ } = await setup()
    expect(await chamaCru($, { acao: 'apaga-tudo' })).toEqual({ deny: expect.stringMatching(/acao precisa ser/) })
  })

  test('puxa brings an orphan in; the answer and the atoms show it, the orphan file is gone', async () => {
    const { $, disk, root } = await setup()
    planta(disk, root, lista('l_orfa0001', 'iterm:B', 55, [['parte 2', false], ['parte 1', true]], 'Workshop'))
    await recarrega($)
    expect((atomo(disk, 'orfas') as Lista[]).map(l => l.id)).toEqual(['l_orfa0001'])
    expect(await chama($, { acao: 'mostra' })).toContain('- l_orfa0001 (Workshop): parte 2')

    const p = await chama($, { acao: 'puxa', listaId: 'l_orfa0001' })
    expect(p).toBe('Puxei a lista l_orfa0001 pra esta aba.\n\nLista da sessão desta aba: Workshop\n☐ i1 parte 2\n☑ i2 parte 1 (feito)')
    expect(atomo(disk, 'orfas')).toEqual([])
    expect((atomo(disk, 'minha') as Lista).id).toBe('l_orfa0001')
    expect(minhasNoDisco(disk, root).map(l => l.id)).toEqual(['l_orfa0001'])
    sweep(disk, root)
  })

  test('puxa on a stale id answers plainly, each reason in its own words', async () => {
    const { $, disk, root } = await setup()
    expect(await chama($, { acao: 'puxa', listaId: 'l_naoexist' }))
      .toMatch(/^Não puxei: essa lista não existe mais \(já foi puxada ou descartada\)\./)
    expect(await chama($, { acao: 'puxa', listaId: '../../etc' })).toMatch(/^Não puxei: essa lista não existe mais/)
    const viva = lista('l_viva0001', 'iterm:C', 77, [['x', false]])
    planta(disk, root, viva)
    disk.vivos.set(77, viva.dono.inicio)
    expect(await chama($, { acao: 'puxa', listaId: 'l_viva0001' })).toMatch(/^Não puxei: a aba dona dessa lista ainda está aberta\./)
    disk.files.set(`${root}/listas/l_ruim0001.json`, '{ nope')
    expect(await chama($, { acao: 'puxa', listaId: 'l_ruim0001' })).toMatch(/^Não puxei: o arquivo dessa lista está ilegível/)
    expect(await chama($, { acao: 'mostra' })).toContain('Lista ilegível (não mexi): l_ruim0001.json')
    expect(atomo(disk, 'ilegiveis')).toEqual(['l_ruim0001.json'])
    sweep(disk, root)
  })

  test('outra-aba is phrased as the plan words it', async () => {
    const { $, disk, root } = await setup()
    planta(disk, root, lista('l_orfa0002', 'iterm:B', 55, [['parte 2', false]]))
    // Another tab, still running, holds the lock on it.
    const trinco = `${root}/listas/l_orfa0002.json.puxando`
    disk.dirs.add(trinco)
    disk.files.set(`${trinco}/dono`, JSON.stringify({ pid: 66, inicio: 'Wed Oct 21 10:00:00 2026' }))
    disk.vivos.set(66, 'Wed Oct 21 10:00:00 2026')
    expect(await chama($, { acao: 'puxa', listaId: 'l_orfa0002' })).toMatch(/^Não puxei: outra aba já puxou essa lista\./)
    expect(disk.files.has(`${root}/listas/l_orfa0002.json`)).toBe(true)
    expect(disk.files.get(`${trinco}/dono`)).toContain('"pid":66')
    sweep(disk, root)
  })

  test('descarta moves the orphan to descartadas/ and says so', async () => {
    const { $, disk, root } = await setup()
    planta(disk, root, lista('l_orfa0003', 'iterm:B', 55, [['parte 2', false]]))
    const r = await chama($, { acao: 'descarta', listaId: 'l_orfa0003' })
    expect(r.split('\n')[0]).toBe('Descartei a lista l_orfa0003 (foi pra descartadas/, dá pra desfazer à mão).')
    expect(disk.files.has(`${root}/descartadas/l_orfa0003.json`)).toBe(true)
    expect(disk.files.has(`${root}/listas/l_orfa0003.json`)).toBe(false)
    expect(atomo(disk, 'orfas')).toEqual([])
    expect(await chama($, { acao: 'descarta', listaId: 'l_orfa0003' })).toMatch(/^Não descartei: essa lista não existe mais/)
    sweep(disk, root)
  })
})

describe('the tool in English', () => {
  test('each answer, refusal and error is in English', async () => {
    const { $, disk, root } = await setup(true, OPCOES_EN)
    expect(await chama($, { acao: 'mostra' })).toBe('This tab\'s session list: nothing noted yet.')
    expect(await chama($, { acao: 'risca', ids: ['i1'] }))
      .toBe('This tab has no list yet: add the first item.\n\nThis tab\'s session list: nothing noted yet.')
    expect(await chama($, { acao: 'anota', textos: [' '] })).toMatch(/^Nothing to add: send at least one text\./)
    expect(await chamaCru($, { acao: 'apaga-tudo' }))
      .toEqual({ deny: 'acao must be one of: anota, risca, desrisca, tira, nomeia, mostra, puxa, descarta.' })

    expect(await chama($, { acao: 'anota', textos: ['part 1', 'part 2'], assunto: 'Workshop' }))
      .toBe('This tab\'s session list: Workshop\n☐ i1 part 1\n☐ i2 part 2')
    expect(await chama($, { acao: 'risca', ids: ['i1'] }))
      .toBe('This tab\'s session list: Workshop\n☐ i2 part 2\n☑ i1 part 1 (done)')
    expect(await chama($, { acao: 'tira', ids: ['i9'] })).toMatch(/^Not found: i9\.\n\n/)
    expect(await chama($, { acao: 'nomeia', assunto: ' ' })).toMatch(/^The subject came empty\./)

    planta(disk, root, lista('l_orfa0011', 'iterm:B', 55, [['left over', false]], 'Old'))
    expect(await chama($, { acao: 'mostra' })).toContain('Lists closed tabs left with open items:\n- l_orfa0011 (Old): left over')
    expect(await chama($, { acao: 'puxa', listaId: 'l_naoexist' }))
      .toMatch(/^Did not adopt: that list no longer exists \(it was already adopted or discarded\)\./)
    planta(disk, root, lista('l_orfa0012', 'iterm:B', 55, [['x', false]]))
    expect((await chama($, { acao: 'descarta', listaId: 'l_orfa0012' })).split('\n')[0])
      .toBe('Discarded list l_orfa0012 (moved to descartadas/, can be undone by hand).')
    expect(await chama($, { acao: 'descarta', listaId: 'l_orfa0012' })).toMatch(/^Did not discard: that list no longer exists/)
    disk.files.set(`${root}/listas/l_ruim0002.json`, '{ nope')
    expect(await chama($, { acao: 'puxa', listaId: 'l_ruim0002' })).toMatch(/^Did not adopt: that list's file is unreadable; I left it alone\./)
    expect(await chama($, { acao: 'mostra' })).toContain('Unreadable list (left alone): l_ruim0002.json')
    disk.files.delete(`${root}/listas/l_ruim0002.json`)
    const minha = minhasNoDisco(disk, root)[0]?.id ?? ''
    expect((await chama($, { acao: 'puxa', listaId: minha })).split('\n')[0]).toBe('Did not adopt: that is already this tab\'s list.')
    expect((await chama($, { acao: 'puxa', listaId: 'l_orfa0011' })).split('\n')[0]).toBe('Moved list l_orfa0011 to this tab.')
    sweep(disk, root)
  })
})

describe('the /config theme, read by recarrega', () => {
  test('a light theme sets tema to light; a missing $.config leaves it null', async () => {
    const claro = await setup(true, OPCOES_PT, [linhaTema('light')])
    await recarrega(claro.$)
    expect(await leTema(claro.$)).toBe('light')

    const semConfig = await setup(true, OPCOES_PT, null)
    expect((semConfig.$ as { config?: unknown }).config).toBe(undefined)
    await recarrega(semConfig.$)
    expect(await leTema(semConfig.$)).toBe(null)
    expect(atomo(semConfig.disk, 'minha')).toBe(null) // the reload still ran
  })
})

// prompt.submit's next as the engine's: the prompt as it reached the bottom.
const eco = Object.assign(async (x: unknown) => structuredClone(x), { called: false }) as never
async function envia($: Comum, e: Record<string, unknown>): Promise<{ text: string; context?: string[] }> {
  const idioma = await idiomaDo($)
  const r = await (aoEnviarPrompt($ as never, e as never, eco) as Promise<{ text: string; context?: string[] }>)
  for (const texto of r.context ?? []) vistos.push({ idioma, texto })
  return r
}

const fakeNext = <T>(answer: T) => Object.assign(async () => structuredClone(answer), { called: false }) as never
const ENGINE = { sections: [{ id: 'intro', text: 'engine', scope: 'shared' }] }
async function compoe($: Comum): Promise<{ sections: { id: string; text: string }[] }> {
  const idioma = await idiomaDo($)
  const r = await (aoComporPrompt($ as never, {} as never, fakeNext(ENGINE)) as unknown as Promise<{ sections: { id: string; text: string }[] }>)
  for (const s of r.sections) vistos.push({ idioma, texto: s.text })
  return r
}

const REGRA_EN = 'Session list: when you and the user agree on a piece of work in parts, note the parts right away with the `lista` tool (acao anota), not at the end. Tick each part (acao risca) as soon as it is done. The user can also ask "add this to the session list". This list is NOT the user\'s task list: never copy their tasks here, and never move items to any other task list unless they ask.'
const REGRA_PT = 'Lista da sessão: quando você e a pessoa combinarem um trabalho em partes, anote as partes na hora com a ferramenta `lista` (acao anota), não no fim. Risque cada parte (acao risca) assim que terminar. A pessoa também pode pedir "anota isso na lista da sessão". Esta lista NÃO é a lista de tarefas da pessoa: nunca copie tarefas dela pra cá, e nunca passe itens pra outra lista de tarefas sem ela pedir.'

describe('the rule', () => {
  for (const [nome, opcoes, regra] of [['en', OPCOES_EN, REGRA_EN], ['pt-BR', OPCOES_PT, REGRA_PT]] as const) {
    test(`${nome}: is the plan wording, added last under the same id, identical across two composes`, async () => {
      const { $ } = await setup(true, opcoes)
      const one = await compoe($)
      const two = await compoe($)
      expect(one).toEqual({ sections: [...ENGINE.sections, { id: 'lista-da-sessao:regra', text: regra, scope: 'session' }] })
      expect(secaoRegra(textos(nome)).text).toBe(regra)
      expect(JSON.stringify(two)).toBe(JSON.stringify(one))
    })

    test(`${nome}: does not change between composes when the list changes`, async () => {
      const { $ } = await setup(true, opcoes)
      const antes = JSON.stringify(await compoe($))
      await chama($, { acao: 'anota', textos: ['a'] })
      expect(JSON.stringify(await compoe($))).toBe(antes)
    })
  }
})

describe('context at a conversation start', () => {
  test('words the orphan question as the plan does and names puxa/descarta with the id', () => {
    const orfa = lista('l_orfa0004', 'iterm:B', 55, [['parte 2', false], ['parte 3', false], ['parte 1', true]])
    const t = contextoInicial(null, [orfa], PT)
    expect(t).toContain('"Uma aba que tu fechou deixou 2 coisas pendentes: parte 2; parte 3. Continuar aqui?"')
    expect(t).toContain('acao puxa e listaId l_orfa0004')
    expect(t).toContain('acao descarta e listaId l_orfa0004')
    expect(t).toContain('PRIMEIRA resposta desta conversa, ANTES de qualquer outra coisa')
    expect(t).toContain('Nunca puxe nem descarte essa lista por conta própria, nem que ela pareça teste, velha ou abandonada')
    expect(t).toContain('Se a pessoa falar de outra coisa sem responder, não mexa nessa lista')
    // The question comes before this tab's own list in the block.
    const ambos = contextoInicial(lista('l_minha001', EU.aba, 100, [['minha parte', false]]), [orfa], PT) ?? ''
    expect(ambos.indexOf('Continuar aqui?')).toBeLessThan(ambos.indexOf('minha parte'))
    expect(ambos.indexOf('Continuar aqui?')).toBeGreaterThan(-1)
    expect(contextoInicial(null, [], PT)).toBe(null)
    expect(contextoInicial(lista('l_toda0001', EU.aba, 100, [['x', true]]), [], PT)).toBe(null)
    vistos.push({ idioma: 'pt-BR', texto: t ?? '' }, { idioma: 'pt-BR', texto: ambos })
  })

  test('en: the same question and instructions, in English, singular and plural', () => {
    const orfa = lista('l_orfa0014', 'iterm:B', 55, [['parte 2', false], ['parte 3', false], ['parte 1', true]])
    const t = contextoInicial(null, [orfa], EN) ?? ''
    expect(t).toContain('"A tab you closed left 2 open items: parte 2; parte 3. Continue here?"')
    expect(t).toContain('acao puxa and listaId l_orfa0014')
    expect(t).toContain('acao descarta and listaId l_orfa0014')
    expect(t).toContain('FIRST reply of this conversation, BEFORE anything else')
    expect(t).toContain('Never adopt or discard this list on your own, even if it looks like a test, old or abandoned')
    expect(t).toContain('If the user talks about something else without answering, leave this list alone')
    const um = contextoInicial(null, [lista('l_orfa0015', 'iterm:B', 55, [['so uma', false]])], EN) ?? ''
    expect(um).toContain('"A tab you closed left 1 open item: so uma. Continue here?"')
    const ambos = contextoInicial(lista('l_minha002', EU.aba, 100, [['my part', false], ['old part', true]]), [orfa], EN) ?? ''
    expect(ambos.indexOf('Continue here?')).toBeLessThan(ambos.indexOf('my part'))
    expect(ambos).toContain('What was agreed in this tab and is still open (tool `lista`):\nThis tab\'s session list\n☐ i1 my part\n☑ i2 old part (done)')
    expect(contextoInicial(null, [], EN)).toBe(null)
    vistos.push({ idioma: 'en', texto: t }, { idioma: 'en', texto: um }, { idioma: 'en', texto: ambos })
  })

  test('prompt.submit with LISTA_SESSAO_SEM_ORFAS keeps the tab\'s list and drops the orphan question', async () => {
    const { $, disk, root } = await setup()
    await chama($, { acao: 'anota', textos: ['parte 2'] })
    planta(disk, root, lista('l_orfa0009', 'iterm:B', 55, [['parte X', false]]))
    const comVariavel = {
      ...$,
      env: { get: async (nome: string) => (nome === 'LISTA_SESSAO_SEM_ORFAS' ? '1' : await $.env.get(nome)) },
    } as Comum
    const um = await envia(comVariavel, { text: 'oi' })
    expect(um.context?.length).toBe(1)
    expect(um.context?.[0]).toContain('☐ i1 parte 2')
    expect(um.context?.[0]).not.toContain('parte X')
    sweep(disk, root)
  })

  test('prompt.submit attaches the list and the orphan question once per conversation, after what came', async () => {
    const { $, disk, root } = await setup()
    await chama($, { acao: 'anota', textos: ['parte 2'] })
    planta(disk, root, lista('l_orfa0005', 'iterm:B', 55, [['parte X', false]]))
    const um = await envia($, { text: 'oi', context: ['outro'] })
    expect(um.context?.length).toBe(2)
    expect(um.context?.[0]).toBe('outro')
    expect(um.context?.[1]).toContain('deixou 1 coisa pendente: parte X. Continuar aqui?')
    expect(um.context?.[1]).toContain('☐ i1 parte 2')
    expect(um.text).toBe('oi')

    expect(await envia($, { text: 'e agora?' })).toEqual({ text: 'e agora?' }) // second prompt: nothing again
    sweep(disk, root)
  })

  test('a slash command is passed by and the next typed prompt carries it', async () => {
    const { $, disk, root } = await setup()
    planta(disk, root, lista('l_orfa0007', 'iterm:B', 55, [['parte Y', false]]))
    const cmd = { text: '/lista', command: { name: 'lista', args: '' } }
    expect(await envia($, cmd)).toEqual(cmd)
    expect((await envia($, { text: 'oi' })).context?.[0]).toContain('parte Y. Continuar aqui?')
  })

  for (const [nome, opcoes] of [['en', OPCOES_EN], ['pt-BR', OPCOES_PT]] as const) {
    test(`${nome}: cold start, a brand-new session with no list file at all`, async () => {
      const { $, disk, root } = await setup(true, opcoes)
      const t = textos(nome)
      expect(disk.files.size).toBe(0)
      expect(await envia($, { text: 'hi' })).toEqual({ text: 'hi' }) // first prompt: nothing to hand over
      expect((await compoe($)).sections.at(-1)?.text).toBe(t.regra)
      expect(await chama($, { acao: 'mostra' })).toBe(t.listaVazia)
      expect(await chama($, { acao: 'risca', ids: ['i1'] })).toBe(`${t.erro['sem-lista']}\n\n${t.listaVazia}`)
      expect(disk.files.size).toBe(0)
      sweep(disk, root)
    })
  }

  test('en: prompt.submit hands the English list and question over', async () => {
    const { $, disk, root } = await setup(true, OPCOES_EN)
    await chama($, { acao: 'anota', textos: ['part 2'] })
    planta(disk, root, lista('l_orfa0016', 'iterm:B', 55, [['part X', false]]))
    const um = await envia($, { text: 'hi' })
    expect(um.context?.[0]).toContain('left 1 open item: part X. Continue here?')
    expect(um.context?.[0]).toContain('☐ i1 part 2')
    sweep(disk, root)
  })

  test('nothing open and no orphans: no context, and not offered again later in the conversation', async () => {
    const { $ } = await setup()
    expect(await envia($, { text: 'oi' })).toEqual({ text: 'oi' })
    await chama($, { acao: 'anota', textos: ['nova'] })
    expect(await envia($, { text: 'de novo' })).toEqual({ text: 'de novo' })
  })
})

describe('not interactive (quemA null: the keeper, claude -p)', () => {
  test('tool refuses, compose and SessionStart pass through, recarrega and the disk are untouched', async () => {
    const { $, disk, root } = await setup(false)
    planta(disk, root, lista('l_orfa0006', 'iterm:B', 55, [['parte 2', false]]))
    const antes = new Map(disk.files)
    const comandos = disk.argvs.length

    expect(await chamaCru($, { acao: 'anota', textos: ['x'] }))
      .toEqual({ deny: EN.soInterativa })
    const engine = { sections: [{ id: 'intro', text: 'engine', scope: 'shared' }] }
    expect(await aoComporPrompt($ as never, {} as never, fakeNext(engine))).toEqual(engine)
    expect(await envia($, { text: 'oi' })).toEqual({ text: 'oi' })
    expect(await garanteQuem($)).toBe(null)
    await recarrega($)

    expect(disk.files).toEqual(antes)
    expect(disk.argvs.length).toBe(comandos)
    for (const k of ['minha', 'orfas', 'ilegiveis', 'entregue']) expect(atomo(disk, k)).toBe(undefined)
    sweep(disk, root)
  })
})

test('recarrega writes the union of unreadable names once, sorted', async () => {
  const { $, disk, root } = await setup()
  disk.files.set(`${root}/listas/l_zzzz0001.json`, 'x')
  disk.files.set(`${root}/listas/l_aaaa0001.json`, 'y')
  disk.dirs.add(`${root}/listas`)
  await recarrega($)
  expect(atomo(disk, 'ilegiveis')).toEqual(['l_aaaa0001.json', 'l_zzzz0001.json'])
  expect(atomo(disk, 'minha')).toBe(null)
  void minhaA; void orfasA; void ilegiveisA
})

// Sets the module's identity, so it runs after every test that needs it unset.
describe('after /clear ($.state comes back empty, same process)', () => {
  test('the tool, prompt.submit and garanteQuem put the identity back and redraw from disk', async () => {
    const { $, disk, root } = await setup(false)
    await semeia($, { raiz: root, eu: EU, idioma: 'pt-BR' })
    await chama($, { acao: 'anota', textos: ['parte 2/3', 'parte 3/3'] })

    disk.state.clear() // the new conversation's empty state
    expect(atomo(disk, 'minha')).toBe(undefined)
    expect(await garanteQuem($)).toEqual({ raiz: root, eu: EU, idioma: 'pt-BR' })
    expect((atomo(disk, 'minha') as Lista).itens.map(i => i.texto)).toEqual(['parte 2/3', 'parte 3/3'])

    // First conversation: delivered once, not on the second prompt.
    expect((await envia($, { text: 'oi' })).context?.[0]).toContain('☐ i1 parte 2/3')
    expect(await envia($, { text: 'mais' })).toEqual({ text: 'mais' })
    disk.state.clear() // /clear: the new conversation is handed the list again
    expect((await envia($, { text: 'oi' })).context?.[0]).toContain('☐ i1 parte 2/3')

    disk.state.clear()
    expect(await chama($, { acao: 'risca', ids: ['i1'] })).toContain('☑ i1 parte 2/3 (feito)')
    sweep(disk, root)
  })
})

// Runs last: every disk of the suite, swept once more as a whole.
test('invariant sweep over the whole suite: nothing outside the temp folders, no task store', () => {
  expect(todas.length).toBeGreaterThan(10)
  for (const { disk, root } of todas) sweep(disk, root)
})

// Runs last: every text the suite got back, in both languages, holds no
// name of a person and no hand-off to a private task store.
test('invariant sweep over every text the suite produced: no forbidden words, both languages seen', () => {
  // The ruler, both ways: it fires on a planted hit and stays quiet on clean text.
  expect(['Fel', 'ipe'].join('')).toMatch(PROIBIDO)
  expect(['o plug-in de ', 'tarefas dele'].join('')).toMatch(PROIBIDO)
  expect(REGRA_PT).not.toMatch(PROIBIDO)
  for (const idioma of ['en', 'pt-BR'] as const) expect(vistos.filter(v => v.idioma === idioma).length).toBeGreaterThan(10)
  for (const { idioma, texto } of vistos) expect(texto, `${idioma}: ${texto}`).not.toMatch(PROIBIDO)
})
