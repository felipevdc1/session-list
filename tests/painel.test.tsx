// The pane, drawn through the mod as a surface draws it. Nothing sits beneath
// the plugin in `claude plugin test`, so the test's own hooks stand for the
// disk, the process table and the /config rows: `fs.*` and `process.run` are
// answered from an in-memory disk under `/fake-tmp/lds-painel`, with the
// command shapes listas.test.ts's fake follows (measured on this Mac on
// 2026-10-21). The buttons' handlers therefore run the real listas.ts and
// estado.ts code.
//
// A test's `$` has no `$.state`, so the atoms are set the way a session sets
// them: `$.session.start` (interactive) runs register.tsx's session.start,
// which reads the fake disk for this tab (ITERM_SESSION_ID `A`, claude pid
// 100) under the `pasta` option, fills the atoms and opens the pane.
//
// Every mount is closed through `fecha`, which first sweeps the tree: no Text
// in lime unless it is a marker or the Continue chip (lime is never on the
// person's text).

import { type ElementQuery, type Engine, type FoundElement, expect, mock, test } from 'claude-code/testing'
import type { ConfigRow, On } from 'claude-code'

import { PALETAS, type Paleta } from '../hooks/cores'
import { textos } from '../hooks/textos'
import type { Lista } from '../types'

const PLUGIN = 'lista-da-sessao'
const RAIZ = '/fake-tmp/lds-painel'
const INICIO = 'Wed Oct 21 09:27:20 2026'
const EU = { aba: 'iterm:A', dono: { pid: 100, inicio: INICIO } }
const SURFACES = ['terminal', 'desktop'] as const
const ESCURO = PALETAS.escuro
const CLARO = PALETAS.claro

const pane = (surface: (typeof SURFACES)[number], bodyColumns = 40) => ({
  plugin: PLUGIN,
  surface,
  component: 'Pane',
  requestId: PLUGIN,
  props: {
    title: 'Lista da sessão',
    isFocused: false,
    bodyColumns,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
}) as const

function lista(id: string, aba: string, pid: number, itens: [string, boolean][], assunto = ''): Lista {
  return {
    versao: 1, id, aba, dono: { pid, inicio: INICIO }, assunto,
    criada: '2026-10-21T09:00:00-03:00', atualizada: '2026-10-21T09:00:00-03:00',
    itens: itens.map(([texto, feito], n) => ({ id: `i${n + 1}`, texto, feito, feitoEm: feito ? '2026-10-21T09:10:00-03:00' : null })),
  }
}

// The disk and process table beneath the plugin, answered by the test's hooks.
function fakeDisk(on: On) {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  const vivos = new Map<number, string>([[EU.dono.pid, INICIO]])
  const paths: string[] = []
  const argvs: string[][] = []

  const addDir = (d: string) => {
    for (let p = d; p.length > 1; p = p.slice(0, Math.max(p.lastIndexOf('/'), 1))) dirs.add(p)
  }
  const parent = (p: string) => p.slice(0, p.lastIndexOf('/'))
  const exists = (p: string) => files.has(p) || dirs.has(p)
  const ran = (exitCode = 0, stdout = '') =>
    ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  addDir(`${RAIZ}/listas`)

  on('fs.read', (_, e) => {
    paths.push(e.path)
    const t = files.get(e.path)
    if (t === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: t }
  })
  on('fs.write', (_, e) => {
    paths.push(e.path)
    addDir(parent(e.path))
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', (_, e) => { paths.push(e.path); return { value: exists(e.path) } })
  on('fs.list', (_, e) => {
    paths.push(e.path)
    if (!dirs.has(e.path)) throw new Error(`ENOENT: ${e.path}`)
    const nomes = [...files.keys()].filter(f => parent(f) === e.path).map(f => f.slice(e.path.length + 1))
    return { value: nomes.map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', (_, e) => {
    const v = e.argv.map(String)
    argvs.push(v)
    const [cmd, ...r] = v
    const a = (i: number): string => r[i] ?? ''
    if (cmd === 'mkdir' && a(0) === '-p' && a(1) === '--') { paths.push(a(2)); addDir(a(2)); return ran() }
    if (cmd === 'mv' && a(0) === '-f' && a(1) === '--') {
      paths.push(a(2), a(3))
      if (!files.has(a(2))) return ran(1)
      files.set(a(3), files.get(a(2)) as string)
      files.delete(a(2))
      return ran()
    }
    if (cmd === 'mkdir' && a(0) === '--') {
      paths.push(a(1))
      if (exists(a(1)) || !dirs.has(parent(a(1)))) return ran(1)
      dirs.add(a(1))
      return ran()
    }
    if (cmd === 'rm' && a(0) === '-rf' && a(1) === '--') {
      paths.push(a(2))
      for (const f of [...files.keys()]) if (f === a(2) || f.startsWith(`${a(2)}/`)) files.delete(f)
      for (const d of [...dirs]) if (d === a(2) || d.startsWith(`${a(2)}/`)) dirs.delete(d)
      return ran()
    }
    if (cmd === 'rm' && a(0) === '--') {
      paths.push(a(1))
      return files.delete(a(1)) ? ran() : ran(1)
    }
    if (cmd === 'rm' && a(0) === '-f' && a(1) === '--') { paths.push(a(2)); files.delete(a(2)); return ran() }
    if (cmd === 'sh' && a(0) === '-c' && a(1) === 'echo $PPID') return ran(0, `${EU.dono.pid}\n`)
    if (cmd === 'ps' && a(0) === '-o' && a(1) === 'ppid=,comm=' && a(2) === '-p') {
      return vivos.has(Number(a(3))) ? ran(0, '1 claude\n') : ran(1)
    }
    if (cmd === 'ps' && a(0) === '-o' && a(1) === 'lstart=' && a(2) === '-p') {
      const inicio = vivos.get(Number(a(3)))
      return inicio === undefined ? ran(1) : ran(0, `${inicio}\n`)
    }
    return ran(127)
  })

  const poe = (l: Lista) => files.set(`${RAIZ}/listas/${l.id}.json`, `${JSON.stringify(l, null, 2)}\n`)
  const le = (caminho: string) => JSON.parse(files.get(caminho) as string) as Lista
  const sweep = () => {
    for (const p of paths) expect(p.startsWith(`${RAIZ}/`), `outside the test folder: ${p}`).toBe(true)
    for (const v of argvs) {
      expect(['sh', 'mkdir', 'mv', 'rm', 'ps']).toContain(v[0])
      expect(v.join(' ')).not.toMatch(/tarefas\.py|tasks\.md/)
    }
  }

  return { files, poe, le, sweep }
}

// The /config theme row as the engine lists it.
const linhaTema = (value: string): ConfigRow => ({
  key: 'theme', label: 'Theme', kind: 'choice', value, options: ['dark', 'light'],
  provider: { plugin: 'engine', tier: 'core' } as ConfigRow['provider'], isLocked: false,
})

// One test's world: the fake disk, the env, the /config theme row (none when
// `tema` is null: a first render with no theme read), the engine's answers to
// the pane's opening, a toast recorder; then the session starts.
async function setup(
  $: Engine,
  on: On,
  { minha, orfas = [], ilegiveis = [], isInteractive = true, tema = 'dark' }:
    { minha?: Lista; orfas?: Lista[]; ilegiveis?: string[]; isInteractive?: boolean; tema?: string | null },
) {
  const disk = fakeDisk(on)
  mock.env(on, { HOME: '/fake-home', ITERM_SESSION_ID: 'A' })
  const toasts: string[] = []
  const abertos: { id: string; title?: string }[] = []
  const comandos: { name: string; description?: string }[] = []
  const config = { tema }
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.open', (_, e) => { abertos.push({ id: e.id, title: e.title }); return { value: { isPlaced: true } } })
  on('command.register', (_, e) => { comandos.push({ name: e.name, description: e.description }); return { value: { command: e.name } } })
  on('tool.register', (_, e) => ({ value: { tool: `mcp__${PLUGIN}__${e.name}` } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('config.list', () => {
    if (config.tema === null) throw new Error('no /config here')
    return { value: [linhaTema(config.tema)] }
  })
  on('config.set', (_, e) => {
    if (e.key === 'theme') config.tema = String(e.value)
    return { value: e.value }
  })
  if (minha) disk.poe(minha)
  for (const l of orfas) disk.poe(l)
  for (const nome of ilegiveis) disk.files.set(`${RAIZ}/listas/${nome}`, '{ quebrado')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive })

  return { disk, toasts, abertos, comandos }
}

const OPCOES_PT = { options: { pasta: RAIZ, idioma: 'pt-BR' } }
const OPCOES_EN = { options: { pasta: RAIZ } }
const PT = textos('pt-BR')
const EN = textos('en')

/** What the helpers use of a mounted drawing, whatever its surface. */
type Ui = { findAll: (q: ElementQuery) => Promise<FoundElement[]>; unmount: () => Promise<unknown> }

const LIMAS = [ESCURO.lima, CLARO.lima]
const PODE_SER_LIMA = new Set(['●', '○', PT.continuarAqui, EN.continuarAqui])

/** The lime sweep: a lime Text (color or background) is a marker or the Continue chip, never the person's text. */
async function semLimaNoTexto(ui: Ui): Promise<void> {
  for (const t of await ui.findAll({ type: 'Text' })) {
    const lima = LIMAS.includes(t.props.color as string) || LIMAS.includes(t.props.backgroundColor as string)
    if (lima) expect(PODE_SER_LIMA.has(t.text), `lime on "${t.text}"`).toBe(true)
  }
}

/** Every mount ends here: the lime sweep over the tree as last drawn, then unmount. */
async function fecha(ui: Ui): Promise<void> {
  await semLimaNoTexto(ui)
  await ui.unmount()
}

const nomeDaCor = (p: Paleta, cor: unknown) =>
  (Object.entries(p) as [keyof Paleta, string][]).find(([, hex]) => hex === cor)?.[0] ?? String(cor)

/**
 * This tab's rail as drawn, one line per node: marker + its color, the text,
 * and the rail under it (`┃` lit, `│` thin, nothing for the last node).
 * Read in document order: a node is its marker, its text, then its rail.
 */
async function trilho(ui: Ui, p: Paleta = ESCURO): Promise<string[]> {
  const textos = await ui.findAll({ type: 'Text' })
  const nos: string[] = []
  for (let n = 0; n < textos.length; n++) {
    const marca = textos[n]
    if (!marca || !['●', '○'].includes(marca.text) || ![p.rosa, p.lima].includes(marca.props.color as string)) continue
    const texto = textos[n + 1]
    const seguinte = textos[n + 2]
    const sob = seguinte && /^[┃│]/.test(seguinte.text) ? seguinte.text[0] : ''
    nos.push(`${marca.text} ${nomeDaCor(p, marca.props.color)} | ${texto?.text}${sob ? ` | ${sob}` : ''}`)
  }
  return nos
}

// --- empty -----------------------------------------------------------------

test('empty: "Nada combinado ainda." dim italic, no rail, no buttons (pt-BR)', OPCOES_PT, async ($, on) => {
  await setup($, on, {})
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const vazio = await ui.find({ type: 'Text', text: 'Nada combinado ainda.' })
    expect(vazio?.props.color, surface).toBe(ESCURO.apagado)
    expect(vazio?.props.italic, surface).toBe(true)
    expect(await ui.find({ type: 'Text', text: /Ficou de uma aba fechada/ }), surface).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: /[┃│┊●○]/ }), surface).toBe(undefined)
    expect(await ui.findAll({ type: 'Button' }), surface).toEqual([])
    await fecha(ui)
  }
})

test('empty in English: "Nothing agreed yet."', OPCOES_EN, async ($, on) => {
  await setup($, on, {})
  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: 'Nothing agreed yet.' }))?.props.italic).toBe(true)
  await fecha(ui)
})

test('the root leaves one row of air above and fills the body width', OPCOES_PT, async ($, on) => {
  await setup($, on, { minha: lista('l_minha001', EU.aba, EU.dono.pid, [['x', false]]) })
  const ui = await $.ui.mount(pane('terminal', 33))
  const raiz = (await ui.findAll({ type: 'Box' }))[0]
  expect(raiz?.props.marginTop).toBe(1)
  expect(raiz?.props.width).toBe(33)
  await fecha(ui)
})

// --- this tab's list -------------------------------------------------------

test('head bold + underlined with the subject; items in list order; done pink, open lime with bold text', OPCOES_PT, async ($, on) => {
  const minha = lista('l_minha001', EU.aba, EU.dono.pid, [
    ['Organização 1/3: modelo', true],
    ['Organização 2/3: conferência das melhorias', false],
    ['Organização 3/3: página', false],
  ], 'Organização')
  await setup($, on, { minha })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await trilho(ui), surface).toEqual([
      '● lima | Organização | ┃',
      '● rosa | Organização 1/3: modelo | │',
      '○ lima | Organização 2/3: conferência das melhorias | │',
      '○ lima | Organização 3/3: página',
    ])
    const cabeca = await ui.find({ type: 'Text', text: 'Organização' })
    expect([cabeca?.props.weight, cabeca?.props.underline, cabeca?.props.color], surface).toEqual(['bold', true, ESCURO.texto])
    const feito = await ui.find({ type: 'Text', text: 'Organização 1/3: modelo' })
    expect([feito?.props.weight, feito?.props.color, feito?.props.dimColor, feito?.props.strikethrough], surface)
      .toEqual([undefined, ESCURO.texto, undefined, undefined])
    const aberto = await ui.find({ type: 'Text', text: 'Organização 2/3: conferência das melhorias' })
    expect([aberto?.props.weight, aberto?.props.color], surface).toEqual(['bold', ESCURO.texto])
    expect(await ui.find({ type: 'Text', text: 'Nada combinado ainda.' }), surface).toBe(undefined)
    await fecha(ui)
  }
})

test('with no subject the head reads the pane title, in each language', OPCOES_EN, async ($, on) => {
  await setup($, on, { minha: lista('l_minha001', EU.aba, EU.dono.pid, [['x', false]]) })
  const ui = await $.ui.mount(pane('terminal'))
  expect(await trilho(ui)).toEqual(['● lima | Session list | │', '○ lima | x'])
  await fecha(ui)
})

test('with no subject, pt-BR: the head reads "Lista da sessão"', OPCOES_PT, async ($, on) => {
  await setup($, on, { minha: lista('l_minha001', EU.aba, EU.dono.pid, [['x', true]]) })
  const ui = await $.ui.mount(pane('terminal'))
  expect(await trilho(ui)).toEqual(['● rosa | Lista da sessão | ┃', '● rosa | x'])
  await fecha(ui)
})

// The rail's status grid: lit from the head down to the last done item.
const GRADE: { nome: string; itens: [string, boolean][]; esperado: string[] }[] = [
  {
    nome: 'none done: all thin, head lime',
    itens: [['a', false], ['b', false]],
    esperado: ['● lima | T | │', '○ lima | a | │', '○ lima | b'],
  },
  {
    nome: 'all done: all lit, head pink',
    itens: [['a', true], ['b', true], ['c', true]],
    esperado: ['● rosa | T | ┃', '● rosa | a | ┃', '● rosa | b | ┃', '● rosa | c'],
  },
  {
    nome: 'last item done: lit all the way, head lime',
    itens: [['a', false], ['b', false], ['c', true]],
    esperado: ['● lima | T | ┃', '○ lima | a | ┃', '○ lima | b | ┃', '● rosa | c'],
  },
  {
    nome: 'a done item after an open one: lit across the open one up to the later done one',
    itens: [['a', true], ['b', false], ['c', true], ['d', false]],
    esperado: ['● lima | T | ┃', '● rosa | a | ┃', '○ lima | b | ┃', '● rosa | c | │', '○ lima | d'],
  },
  {
    nome: 'single item done',
    itens: [['a', true]],
    esperado: ['● rosa | T | ┃', '● rosa | a'],
  },
  {
    nome: 'single item open',
    itens: [['a', false]],
    esperado: ['● lima | T | │', '○ lima | a'],
  },
]

for (const caso of GRADE) {
  test(`rail: ${caso.nome}`, OPCOES_PT, async ($, on) => {
    await setup($, on, { minha: lista('l_minha001', EU.aba, EU.dono.pid, caso.itens, 'T') })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      expect(await trilho(ui), surface).toEqual(caso.esperado)
      for (const aceso of await ui.findAll({ type: 'Text', text: /^┃/ })) {
        expect([aceso.props.color, aceso.props.weight], surface).toEqual([ESCURO.rosa, 'bold'])
      }
      for (const fino of await ui.findAll({ type: 'Text', text: /^│/ })) {
        expect([fino.props.color, fino.props.weight], surface).toEqual([ESCURO.apagado, 'regular'])
      }
      await fecha(ui)
    }
  })
}

test('rail option A: each node is a relative row; its rail an absolute 1-wide column under the marker, clipped', OPCOES_PT, async ($, on) => {
  await setup($, on, { minha: lista('l_minha001', EU.aba, EU.dono.pid, [['a', true], ['b', false]], 'T') })
  const ui = await $.ui.mount(pane('terminal'))
  const caixas = await ui.findAll({ type: 'Box' })
  const nos = caixas.filter(b => b.props.position === 'relative')
  // Head: two blank rows under it; an item: one; the last node: none.
  expect(nos.map(b => b.props.paddingBottom)).toEqual([2, 1, 0])
  const trilhos = caixas.filter(b => b.props.position === 'absolute')
  expect(trilhos).toHaveLength(2)
  for (const b of trilhos) {
    expect(b.props).toMatchObject({ top: 1, bottom: 0, left: 0, width: 1, overflow: 'hidden' })
  }
  // The rail holds far more glyphs than any node is tall, one per row.
  const lit = await ui.find({ type: 'Text', text: /^┃/ })
  expect(lit?.text.split('\n').every(g => g === '┃')).toBe(true)
  expect(lit?.text.split('\n').length).toBeGreaterThan(100)
  await fecha(ui)
})

test('a long item wraps inside its column, never cut, and the rail runs on beside it', OPCOES_PT, async ($, on) => {
  const longo = 'uma parte combinada com um texto bem comprido que não cabe numa linha só do painel'
  await setup($, on, { minha: lista('l_minha001', EU.aba, EU.dono.pid, [[longo, true], ['depois', false]]) })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface, 24))
    const item = await ui.find({ type: 'Text', text: longo })
    expect(item?.text, surface).toBe(longo)
    expect(item?.props.wrap, surface).toBe('wrap')
    const caixas = await ui.findAll({ type: 'Box' })
    expect(caixas[0]?.props.width, surface).toBe(24)
    // Text column = body less the marker column (2) and a right margin (1).
    expect(caixas.filter(b => b.props.width === 21).length, surface).toBeGreaterThan(0)
    expect(await trilho(ui), surface).toEqual(['● lima | Lista da sessão | ┃', `● rosa | ${longo} | │`, '○ lima | depois'])
    await fecha(ui)
  }
})

test('the narrowest body (10) still wraps the text in a column of 7', OPCOES_PT, async ($, on) => {
  await setup($, on, { minha: lista('l_minha001', EU.aba, EU.dono.pid, [['palavras que não cabem', false]]) })
  const ui = await $.ui.mount(pane('terminal', 4))
  const caixas = await ui.findAll({ type: 'Box' })
  expect(caixas[0]?.props.width).toBe(10)
  expect(caixas.filter(b => b.props.width === 7).length).toBeGreaterThan(0)
  await fecha(ui)
})

// --- the operations on the rail -------------------------------------------

test('tick lengthens the lit rail, untick of the last done item shrinks it', OPCOES_PT, async ($, on) => {
  const minha = lista('l_minha001', EU.aba, EU.dono.pid, [['a', true], ['b', false], ['c', false]], 'T')
  const { disk } = await setup($, on, { minha })
  const ui = await $.ui.mount(pane('terminal'))
  expect(await trilho(ui)).toEqual(['● lima | T | ┃', '● rosa | a | │', '○ lima | b | │', '○ lima | c'])

  await $.tool.call({ tool: `mcp__${PLUGIN}__lista`, acao: 'risca', ids: ['i3'] } as never)
  expect(await trilho(ui)).toEqual(['● lima | T | ┃', '● rosa | a | ┃', '○ lima | b | ┃', '● rosa | c'])

  await $.tool.call({ tool: `mcp__${PLUGIN}__lista`, acao: 'desrisca', ids: ['i3'] } as never)
  expect(await trilho(ui)).toEqual(['● lima | T | ┃', '● rosa | a | │', '○ lima | b | │', '○ lima | c'])

  await $.tool.call({ tool: `mcp__${PLUGIN}__lista`, acao: 'risca', ids: ['i2', 'i3'] } as never)
  expect(await trilho(ui)).toEqual(['● rosa | T | ┃', '● rosa | a | ┃', '● rosa | b | ┃', '● rosa | c'])
  disk.sweep()
  await fecha(ui)
})

// --- the colors per theme ---------------------------------------------------

/** Every color a Text carries in the tree, as names in palette `p` (a hex outside it stays a hex). */
async function cores(ui: Ui, p: Paleta): Promise<Set<string>> {
  const vistas = new Set<string>()
  for (const t of await ui.findAll({ type: 'Text' })) {
    for (const cor of [t.props.color, t.props.backgroundColor]) if (cor !== undefined) vistas.add(nomeDaCor(p, cor))
  }
  return vistas
}

const CHEIO = {
  minha: lista('l_minha001', EU.aba, EU.dono.pid, [['a', true], ['b', false]], 'T'),
  orfas: [lista('l_orfa0001', 'iterm:B', 999, [['x', false], ['y', false], ['z', false], ['w', false], ['v', false], ['u', false]], 'O')],
  ilegiveis: ['l_quebra01.json'],
}

test('dark theme: every color in the tree is from the dark palette, every role used', OPCOES_PT, async ($, on) => {
  await setup($, on, { ...CHEIO, tema: 'dark' })
  const ui = await $.ui.mount(pane('terminal'))
  expect([...await cores(ui, ESCURO)].sort()).toEqual(['apagado', 'aviso', 'fundo', 'lima', 'rosa', 'texto'])
  await fecha(ui)
})

for (const tema of ['light', 'light-daltonized', 'light-ansi']) {
  test(`${tema} theme: every hex swaps to the light palette`, OPCOES_PT, async ($, on) => {
    await setup($, on, { ...CHEIO, tema })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(pane(surface))
      expect([...await cores(ui, CLARO)].sort(), surface).toEqual(['apagado', 'aviso', 'fundo', 'lima', 'rosa', 'texto'])
      expect(await trilho(ui, CLARO), surface).toEqual(['● lima | T | ┃', '● rosa | a | │', '○ lima | b'])
      await fecha(ui)
    }
  })
}

test('cold start: no theme read yet (no /config answer) draws the dark palette', OPCOES_PT, async ($, on) => {
  await setup($, on, { ...CHEIO, tema: null })
  const ui = await $.ui.mount(pane('terminal'))
  expect([...await cores(ui, ESCURO)].sort()).toEqual(['apagado', 'aviso', 'fundo', 'lima', 'rosa', 'texto'])
  await fecha(ui)
})

test('an unknown theme value (auto, a custom name) reads as dark', OPCOES_PT, async ($, on) => {
  await setup($, on, { ...CHEIO, tema: 'auto' })
  const ui = await $.ui.mount(pane('terminal'))
  expect([...await cores(ui, ESCURO)].sort()).toEqual(['apagado', 'aviso', 'fundo', 'lima', 'rosa', 'texto'])
  await fecha(ui)
})

// Through register.tsx's own config.set hook: `$.config.set` runs the chain,
// the test's hook stands for the engine writing the row, the mod's hook then
// reloads the atoms, and the mounted pane redraws.
test('a theme change in /config redraws the mounted pane with the other palette, and back', OPCOES_PT, async ($, on) => {
  await setup($, on, { ...CHEIO, tema: 'dark' })
  const ui = await $.ui.mount(pane('terminal'))
  expect(await trilho(ui, ESCURO)).toEqual(['● lima | T | ┃', '● rosa | a | │', '○ lima | b'])

  await $.config.set({ key: 'theme', value: 'light', previous: 'dark', provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } } as never)
  expect([...await cores(ui, CLARO)].sort()).toEqual(['apagado', 'aviso', 'fundo', 'lima', 'rosa', 'texto'])
  expect(await trilho(ui, CLARO)).toEqual(['● lima | T | ┃', '● rosa | a | │', '○ lima | b'])

  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } } as never)
  expect([...await cores(ui, ESCURO)].sort()).toEqual(['apagado', 'aviso', 'fundo', 'lima', 'rosa', 'texto'])
  await fecha(ui)
})

// --- orphans ---------------------------------------------------------------

test('an orphan: orange dashed rail into the buttons, up to 5 items and the rest counted, then the separator', OPCOES_PT, async ($, on) => {
  const orfa = lista('l_orfa0001', 'iterm:B', 999, [
    ['a', false], ['b', true], ['c', false], ['d', false], ['e', false], ['f', false], ['g', false],
  ], 'Organização')
  await setup($, on, { orfas: [orfa] })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const cabeca = await ui.find({ type: 'Text', text: 'Ficou de uma aba fechada: Organização' })
    expect([cabeca?.props.weight, cabeca?.props.color], surface).toEqual(['bold', ESCURO.texto])
    const marcas = (await ui.findAll({ type: 'Text', text: /^[●○]$/ })).filter(t => t.props.color === ESCURO.aviso)
    expect(marcas.map(t => t.text), surface).toEqual(['●', '○', '○', '○', '○', '○'])
    const itens = (await ui.findAll({ type: 'Text', text: /^[a-g]$/ }))
    expect(itens.map(t => [t.text, t.props.color, t.props.weight]), surface).toEqual(
      ['a', 'c', 'd', 'e', 'f'].map(x => [x, ESCURO.texto, undefined]),
    )
    const mais = await ui.find({ type: 'Text', text: /e mais/ })
    expect([mais?.text, mais?.props.color], surface).toEqual(['e mais 1', ESCURO.apagado])
    const tracejados = await ui.findAll({ type: 'Text', text: /^┊/ })
    // The head, five items and "e mais" each carry a dashed rail; "e mais" has a dashed marker too.
    expect(tracejados.filter(t => t.text.includes('\n')).length, surface).toBe(7)
    for (const t of tracejados) expect(t.props.color, surface).toBe(ESCURO.aviso)
    expect((await ui.find({ type: 'Text', text: '╰──' }))?.props.color, surface).toBe(ESCURO.aviso)
    const separador = await ui.find({ type: 'Text', text: /^─+$/ })
    expect([separador?.text.length, separador?.props.color], surface).toEqual([39, ESCURO.apagado])

    const continuar = await ui.find({ type: 'Button', key: 'continuar-l_orfa0001' })
    expect(continuar?.props.label, surface).toBe('Continuar aqui')
    const chip = await ui.find({ type: 'Text', text: 'Continuar aqui' })
    expect([chip?.props.backgroundColor, chip?.props.color, chip?.props.weight], surface)
      .toEqual([ESCURO.lima, ESCURO.fundo, 'bold'])
    const descartar = await ui.find({ type: 'Button', key: 'descartar-l_orfa0001' })
    expect(descartar?.props.label, surface).toBe('Descartar')
    // The orphan's items are not this tab's: the list below is still empty.
    expect(await ui.find({ type: 'Text', text: 'Nada combinado ainda.' }), surface).not.toBe(undefined)
    await fecha(ui)
  }
})

test('an orphan in English: "Left open by a closed tab", "and N more", Continue here / Discard', OPCOES_EN, async ($, on) => {
  const orfa = lista('l_orfa0001', 'iterm:B', 999, [['a', false], ['b', false], ['c', false], ['d', false], ['e', false], ['f', false]])
  await setup($, on, { orfas: [orfa] })
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: 'Left open by a closed tab' })).not.toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /and \d+ more/ }))?.text).toBe('and 1 more')
  expect((await ui.find({ type: 'Button', key: 'continuar-l_orfa0001' }))?.props.label).toBe('Continue here')
  expect((await ui.find({ type: 'Text', text: 'Continue here' }))?.props.backgroundColor).toBe(ESCURO.lima)
  expect((await ui.find({ type: 'Button', key: 'descartar-l_orfa0001' }))?.props.label).toBe('Discard')
  expect(await ui.find({ type: 'Text', text: 'Nothing agreed yet.' })).not.toBe(undefined)
  await fecha(ui)
})

test('several orphans: each its own block and buttons, one separator', OPCOES_PT, async ($, on) => {
  const um = lista('l_orfa0001', 'iterm:B', 999, [['x', false]], 'Um')
  const dois = lista('l_orfa0002', 'iterm:C', 998, [['y', false]], 'Dois')
  await setup($, on, { orfas: [um, dois], minha: lista('l_minha001', EU.aba, EU.dono.pid, [['meu', false]]) })
  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.findAll({ type: 'Button' })).map(b => b.key).sort())
    .toEqual(['continuar-l_orfa0001', 'continuar-l_orfa0002', 'descartar-l_orfa0001', 'descartar-l_orfa0002'])
  expect(await ui.findAll({ type: 'Text', text: '╰──' })).toHaveLength(2)
  expect(await ui.findAll({ type: 'Text', text: /^─+$/ })).toHaveLength(1)
  expect(await trilho(ui)).toEqual(['● lima | Lista da sessão | │', '○ lima | meu'])
  await fecha(ui)
})

test('an orphan with nothing open is never offered', OPCOES_PT, async ($, on) => {
  await setup($, on, { orfas: [lista('l_orfa0001', 'iterm:B', 999, [['pronto', true]], 'Feita')] })
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /Ficou de uma aba fechada/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /^─+$/ })).toBe(undefined)
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  await fecha(ui)
})

for (const surface of SURFACES) {
  test(`${surface}: Continuar aqui moves the items into my list and the offer goes`, OPCOES_PT, async ($, on) => {
    const minha = lista('l_minha001', EU.aba, EU.dono.pid, [['meu item', false]])
    const orfa = lista('l_orfa0001', 'iterm:B', 999, [['parte 2', false], ['parte 1', true], ['parte 3', false]], 'Organização')
    const { disk, toasts } = await setup($, on, { minha, orfas: [orfa] })
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'continuar-l_orfa0001' })

    expect(await ui.find({ type: 'Text', text: /Ficou de uma aba fechada/ })).toBe(undefined)
    expect(await ui.findAll({ type: 'Button' })).toEqual([])
    expect(await ui.find({ type: 'Text', text: /^─+$/ })).toBe(undefined)
    expect(await trilho(ui)).toEqual([
      // My list had no subject: it takes the orphan's.
      '● lima | Organização | │', '○ lima | meu item | │', '○ lima | parte 2 | │', '○ lima | parte 3',
    ])
    expect(disk.files.has(`${RAIZ}/listas/l_orfa0001.json`)).toBe(false)
    expect(disk.le(`${RAIZ}/listas/l_minha001.json`).itens.map(i => i.texto)).toEqual(['meu item', 'parte 2', 'parte 3'])
    expect(toasts).toEqual([])
    disk.sweep()
    await fecha(ui)
  })

  test(`${surface}: Descartar removes the offer and the file lands in descartadas/`, OPCOES_PT, async ($, on) => {
    const orfa = lista('l_orfa0001', 'iterm:B', 999, [['parte 2', false]], 'Organização')
    const { disk, toasts } = await setup($, on, { orfas: [orfa] })
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'descartar-l_orfa0001' })

    expect(await ui.find({ type: 'Text', text: /Ficou de uma aba fechada/ })).toBe(undefined)
    expect(disk.files.has(`${RAIZ}/listas/l_orfa0001.json`)).toBe(false)
    expect(disk.le(`${RAIZ}/descartadas/l_orfa0001.json`).itens[0]?.texto).toBe('parte 2')
    expect(await ui.find({ type: 'Text', text: 'Nada combinado ainda.' })).not.toBe(undefined)
    expect(toasts).toEqual([])
    disk.sweep()
    await fecha(ui)
  })
}

test('a refused Continuar aqui says why in a toast and drops the stale offer', OPCOES_PT, async ($, on) => {
  const orfa = lista('l_orfa0001', 'iterm:B', 999, [['parte 2', false]])
  const { disk, toasts } = await setup($, on, { orfas: [orfa] })
  const ui = await $.ui.mount(pane('terminal'))
  // Another tab took it between the drawing and the press.
  disk.files.delete(`${RAIZ}/listas/l_orfa0001.json`)
  await ui.press({ key: 'continuar-l_orfa0001' })

  expect(toasts).toEqual(['Essa lista já não está mais lá.'])
  expect(await ui.find({ type: 'Text', text: /Ficou de uma aba fechada/ })).toBe(undefined)
  disk.sweep()
  await fecha(ui)
})

test('a refused Discard says why in English', OPCOES_EN, async ($, on) => {
  const orfa = lista('l_orfa0001', 'iterm:B', 999, [['parte 2', false]])
  const { disk, toasts } = await setup($, on, { orfas: [orfa] })
  const ui = await $.ui.mount(pane('terminal'))
  disk.files.delete(`${RAIZ}/listas/l_orfa0001.json`)
  await ui.press({ key: 'descartar-l_orfa0001' })

  expect(toasts).toEqual(['That list is no longer there.'])
  disk.sweep()
  await fecha(ui)
})

// --- unreadable files ------------------------------------------------------

test('an unreadable file is named in orange at the bottom, never touched', OPCOES_PT, async ($, on) => {
  const { disk } = await setup($, on, { ilegiveis: ['l_quebra01.json'], minha: lista('l_minha001', EU.aba, EU.dono.pid, [['x', false]]) })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const textos = await ui.findAll({ type: 'Text' })
    const ultimo = textos[textos.length - 1]
    expect([ultimo?.text, ultimo?.props.color], surface).toEqual(['lista ilegível: l_quebra01.json', ESCURO.aviso])
    await fecha(ui)
  }
  expect(disk.files.get(`${RAIZ}/listas/l_quebra01.json`)).toBe('{ quebrado')
})

test('an unreadable file in English', OPCOES_EN, async ($, on) => {
  await setup($, on, { ilegiveis: ['l_quebra01.json'] })
  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: /unreadable/ }))?.text).toBe('unreadable list: l_quebra01.json')
  await fecha(ui)
})

// --- opening, the command, redraws ------------------------------------------

test('session.start opens the pane under its fixed title, the subject stays inside; /lista opens it again', OPCOES_PT, async ($, on) => {
  const { abertos, comandos } = await setup($, on, { minha: lista('l_minha001', EU.aba, EU.dono.pid, [['x', false]], 'Organização') })
  expect(abertos).toEqual([{ id: PLUGIN, title: 'Lista da sessão' }])
  expect(comandos).toEqual([{ name: 'lista', description: 'Mostra a lista da sessão desta aba' }])
  const r = await $.command.run({
    command: 'lista', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 },
  } as never)

  expect(r.text).toBe('Lista da sessão aberta.')
  expect(abertos).toEqual([{ id: PLUGIN, title: 'Lista da sessão' }, { id: PLUGIN, title: 'Lista da sessão' }])
})

test('in English the pane is "Session list" and /lista answers in English', OPCOES_EN, async ($, on) => {
  const { abertos, comandos } = await setup($, on, { minha: lista('l_minha001', EU.aba, EU.dono.pid, [['x', false]], 'Organization') })
  expect(abertos).toEqual([{ id: PLUGIN, title: 'Session list' }])
  expect(comandos).toEqual([{ name: 'lista', description: 'Shows this tab\'s session list' }])
  const r = await $.command.run({
    command: 'lista', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 },
  } as never)
  expect(r.text).toBe('Session list open.')
})

// The pane reads through estado.ts's functions (leMinha, leOrfas, …): a read
// made in another file must still subscribe this drawing, so a change made
// outside the pane redraws it.
test('a change made by the model\'s tool redraws the mounted pane', OPCOES_PT, async ($, on) => {
  const { disk } = await setup($, on, {})
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ type: 'Text', text: 'Nada combinado ainda.' }), surface).not.toBe(undefined)
    await fecha(ui)
  }
  const mounted = await Promise.all(SURFACES.map(surface => $.ui.mount(pane(surface))))
  await $.tool.call({ tool: `mcp__${PLUGIN}__lista`, acao: 'anota', textos: ['parte 1', 'parte 2'], assunto: 'Organização' } as never)

  for (const ui of mounted) {
    expect(await trilho(ui), ui.surface).toEqual(['● lima | Organização | │', '○ lima | parte 1 | │', '○ lima | parte 2'])
    expect(await ui.find({ type: 'Text', text: 'Nada combinado ainda.' }), ui.surface).toBe(undefined)
    await fecha(ui)
  }
  disk.sweep()
})

test('/clear refreshes the pane from the disk', OPCOES_PT, async ($, on) => {
  const minha = lista('l_minha001', EU.aba, EU.dono.pid, [['parte 1', false]])
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('clock.after', () => ({ value: undefined })) // the timer fires at once
  const { disk } = await setup($, on, { minha })
  const ui = await $.ui.mount(pane('terminal'))
  disk.poe({ ...minha, itens: [{ id: 'i1', texto: 'parte 1', feito: true, feitoEm: '2026-10-21T09:20:00-03:00' }] })
  await $.session.end({ reason: 'clear', sessionId: 's2', resume: undefined } as never)

  expect(await trilho(ui)).toEqual(['● rosa | Lista da sessão | ┃', '● rosa | parte 1'])
  await fecha(ui)
})

test('a session that is not interactive opens nothing, touches no disk, answers no tool', OPCOES_PT, async ($, on) => {
  // A dead all-done list: an active start would delete it (limpa).
  const feita = lista('l_feita001', 'iterm:B', 999, [['pronto', true]])
  const orfa = lista('l_orfa0001', 'iterm:C', 998, [['parte 2', false]])
  const { disk, abertos, comandos } = await setup($, on, { orfas: [feita, orfa], isInteractive: false })

  expect(abertos).toEqual([])
  expect(comandos).toEqual([])
  expect(disk.files.has(`${RAIZ}/listas/l_feita001.json`)).toBe(true)
  const r = await $.tool.call({ tool: `mcp__${PLUGIN}__lista`, acao: 'mostra' } as never)
  expect(JSON.stringify(r)).toMatch(/only works in an interactive session/)
})

// The opening context rides the first prompt's context (prompt.submit): the
// prompt.context block did not reach the model at a real startup (2026-10-21).
test('after the start, the first prompt hands the model the orphan, the second does not', OPCOES_PT, async ($, on) => {
  const orfa = lista('l_orfa0001', 'iterm:B', 999, [['parte 2', false]], 'Organização')
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  await setup($, on, { orfas: [orfa] })

  const um = await $.prompt.submit({ text: 'oi' } as never)
  expect(JSON.stringify(um)).toContain('parte 2. Continuar aqui?')
  const dois = await $.prompt.submit({ text: 'e agora?' } as never)
  expect(JSON.stringify(dois)).not.toContain('Continuar aqui?')
})
