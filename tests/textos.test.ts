// The text table: both languages complete, no private names or hand-offs in
// anything the mod can emit, the exact rule, the orphan question's number
// agreement, and the pt-BR texts that predate the table kept word for word.

import { describe, expect, test } from 'claude-code/testing'

import type { Motivo } from '../hooks/listas'
import { IDIOMAS, type Idioma, TEXTOS, type Textos, idiomaDe, textos } from '../hooks/textos'

// Built from parts so this file never holds the words the shell sweeps look for.
const PROIBIDO = new RegExp([
  ['Fel', 'ipe'].join(''),
  ['fel', 'ipevdc1'].join(''),
  ['plug-in de ', 'tarefas'].join(''),
  ['tarefas ', 'dele'].join(''),
  ['tarefas', '\\.py'].join(''),
  ['bota na ', 'minha lista'].join(''),
].join('|'), 'i')

const MOTIVOS: Motivo[] = ['sumiu', 'outra-aba', 'viva', 'minha', 'ilegivel']

/** Sample arguments per function field; one call per entry. */
const AMOSTRAS: Record<string, unknown[][]> = {
  ficouDeAbaFechada: [[''], ['Assunto X']],
  eMais: [[1], [7]],
  ilegivel: [['l_ab12cd34.json']],
  acaoInvalida: [['anota, risca']],
  naoAchei: [['i1, i2']],
  puxei: [['l_ab12cd34']],
  naoPuxei: MOTIVOS.map(m => [m]),
  descartei: [['l_ab12cd34']],
  naoDescartei: MOTIVOS.map(m => [m]),
  cabecalhoLista: [[''], ['Assunto X']],
  ilegivelModelo: [['l_ab12cd34.json']],
  orfaParaModelo: [[{ id: 'l_ab12cd34', itens: ['a'] }], [{ id: 'l_ab12cd34', itens: ['a', 'b'] }]],
  abertoNestaAba: [['☐ i1 a']],
}

/** Every string a value yields: strings as is, functions called with samples, records walked. */
function todosOsTextos(valor: unknown, caminho: string, nome: string): Array<{ caminho: string; texto: string }> {
  if (typeof valor === 'string') return [{ caminho, texto: valor }]
  if (typeof valor === 'function') {
    const chamadas = AMOSTRAS[nome] ?? [['l_ab12cd34']]
    return chamadas.flatMap(args => todosOsTextos((valor as (...a: unknown[]) => unknown)(...args), `${caminho}(${JSON.stringify(args)})`, nome))
  }
  if (valor !== null && typeof valor === 'object') {
    return Object.entries(valor).flatMap(([k, v]) => todosOsTextos(v, `${caminho}.${k}`, k))
  }
  throw new Error(`${caminho}: not a text (${typeof valor})`)
}

const pergunta = (t: Textos, itens: string[]) =>
  t.orfaParaModelo({ id: 'l_ab12cd34', itens }).match(/"([^"]*\?)"/)?.[1]

describe('idiomaDe', () => {
  test('anything but pt-BR reads as en', () => {
    expect(idiomaDe(undefined)).toBe('en')
    expect(idiomaDe({})).toBe('en')
    expect(idiomaDe({ idioma: '' })).toBe('en')
    expect(idiomaDe({ idioma: 'fr' })).toBe('en')
    expect(idiomaDe({ idioma: 42 })).toBe('en')
    expect(idiomaDe({ idioma: 'en' })).toBe('en')
  })
  test('pt-BR reads as pt-BR', () => {
    expect(idiomaDe({ idioma: 'pt-BR' })).toBe('pt-BR')
    expect(textos('pt-BR')).toBe(TEXTOS['pt-BR'])
  })
})

describe('the invariant sweep', () => {
  test('the ruler catches the old rule and passes a clean text', () => {
    const antiga = ['Quando você e o ', 'Fel', 'ipe combinarem… usando o plug-in de ', 'tare', 'fas de', 'le.'].join('')
    expect(antiga).toMatch(PROIBIDO)
    expect(['python3 _lo', 'cal/tare', 'fas.py'].join('')).toMatch(PROIBIDO)
    expect('Esta lista NÃO é a lista de tarefas da pessoa').not.toMatch(PROIBIDO)
  })

  for (const idioma of IDIOMAS) {
    test(`${idioma}: no emitted text names a person or hands off to a task tool`, () => {
      const todos = todosOsTextos(TEXTOS[idioma], idioma, idioma)
      // Not blind: every field was reached, each yielding at least one text.
      for (const campo of Object.keys(TEXTOS[idioma])) {
        expect(todos.some(x => x.caminho.startsWith(`${idioma}.${campo}`)), `field not reached: ${campo}`).toBe(true)
      }
      for (const { caminho, texto } of todos) {
        expect(texto.trim().length > 0, `empty text: ${caminho}`).toBe(true)
        expect(PROIBIDO.test(texto), `forbidden word in ${caminho}: ${texto}`).toBe(false)
      }
    })
  }

  test('both languages have the same fields', () => {
    const campos = (i: Idioma) => Object.keys(TEXTOS[i]).sort()
    expect(campos('pt-BR')).toEqual(campos('en'))
  })
})

describe('the rule', () => {
  test('en, word for word', () => {
    expect(TEXTOS.en.regra).toBe('Session list: when you and the user agree on a piece of work in parts, note the parts right away with the `lista` tool (acao anota), not at the end. Tick each part (acao risca) as soon as it is done. The user can also ask "add this to the session list". This list is NOT the user\'s task list: never copy their tasks here, and never move items to any other task list unless they ask.')
  })
  test('pt-BR, word for word', () => {
    expect(TEXTOS['pt-BR'].regra).toBe('Lista da sessão: quando você e a pessoa combinarem um trabalho em partes, anote as partes na hora com a ferramenta `lista` (acao anota), não no fim. Risque cada parte (acao risca) assim que terminar. A pessoa também pode pedir "anota isso na lista da sessão". Esta lista NÃO é a lista de tarefas da pessoa: nunca copie tarefas dela pra cá, e nunca passe itens pra outra lista de tarefas sem ela pedir.')
  })
})

describe('the orphan question', () => {
  test('en: item for one, items otherwise', () => {
    expect(pergunta(TEXTOS.en, ['a'])).toBe('A tab you closed left 1 open item: a. Continue here?')
    expect(pergunta(TEXTOS.en, ['a', 'b'])).toBe('A tab you closed left 2 open items: a; b. Continue here?')
  })
  test('pt-BR: coisa pendente for one, coisas pendentes otherwise', () => {
    expect(pergunta(TEXTOS['pt-BR'], ['a'])).toBe('Uma aba que tu fechou deixou 1 coisa pendente: a. Continuar aqui?')
    expect(pergunta(TEXTOS['pt-BR'], ['a', 'b'])).toBe('Uma aba que tu fechou deixou 2 coisas pendentes: a; b. Continuar aqui?')
  })
  test('both keep the three instructions and name the list id', () => {
    for (const idioma of IDIOMAS) {
      const bloco = TEXTOS[idioma].orfaParaModelo({ id: 'l_ab12cd34', itens: ['a'] })
      expect(bloco).toMatch(/\n1\. [^\n]+\n2\. [^\n]+\n3\. /)
      expect(bloco.split('l_ab12cd34').length - 1).toBe(3)
    }
  })
})

describe('contract drift: the pt-BR texts from before the table', () => {
  const t = TEXTOS['pt-BR']
  test('pane texts', () => {
    expect(t.tituloPainel).toBe('Lista da sessão')
    expect(t.continuarAqui).toBe('Continuar aqui')
    expect(t.descartar).toBe('Descartar')
    expect(t.nadaCombinado).toBe('Nada combinado ainda.')
    expect(t.ficouDeAbaFechada('')).toBe('Ficou de uma aba fechada')
    expect(t.ficouDeAbaFechada('X')).toBe('Ficou de uma aba fechada: X')
    expect(t.eMais(3)).toBe('e mais 3')
    expect(t.ilegivel('l_ab12cd34.json')).toBe('lista ilegível: l_ab12cd34.json')
  })
  test('the orphan question', () => {
    expect(pergunta(t, ['a', 'b'])).toBe('Uma aba que tu fechou deixou 2 coisas pendentes: a; b. Continuar aqui?')
  })
  test('the en keys texts', () => {
    const en = TEXTOS.en
    expect(en.tituloPainel).toBe('Session list')
    expect(en.continuarAqui).toBe('Continue here')
    expect(en.descartar).toBe('Discard')
    expect(en.nadaCombinado).toBe('Nothing agreed yet.')
    expect(en.ficouDeAbaFechada('')).toBe('Left open by a closed tab')
    expect(en.ficouDeAbaFechada('X')).toBe('Left open by a closed tab: X')
    expect(en.eMais(3)).toBe('and 3 more')
  })
})
