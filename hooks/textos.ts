// Every text the mod shows the person or hands the model, per language.
// English is the default; `pt-BR` keeps the wording the mod had before this
// table existed. A missing translation is a type error (`Record<Idioma, Textos>`).

import type { CodigoDeErro, Motivo } from './listas'

export type Idioma = 'en' | 'pt-BR'
export const IDIOMAS: readonly Idioma[] = ['en', 'pt-BR']

/** The `idioma` option; anything else (absent, '', 'fr') reads as 'en'. */
export function idiomaDe(options: { idioma?: unknown } | undefined): Idioma {
  const dado = options?.idioma
  return IDIOMAS.find(i => i === dado) ?? 'en'
}

export type Textos = {
  // The pane and the /lista command.
  tituloPainel: string
  descricaoComando: string
  soInterativa: string
  painelAberto: string
  ficouDeAbaFechada: (assunto: string) => string
  eMais: (n: number) => string
  continuarAqui: string
  descartar: string
  nadaCombinado: string
  ilegivel: (arquivo: string) => string
  /** The pane's toasts when a button is refused; the list id goes in. */
  recusa: Record<Motivo, (id: string) => string>
  // The tool, its answers and the rule.
  motivo: Record<Motivo, string>
  erro: Record<CodigoDeErro, string>
  descricaoFerramenta: string
  paramTextos: string
  paramIds: string
  paramAssunto: string
  paramListaId: string
  regra: string
  acaoInvalida: (acoes: string) => string
  naoAchei: (ids: string) => string
  puxei: (id: string) => string
  naoPuxei: (motivo: Motivo) => string
  descartei: (id: string) => string
  naoDescartei: (motivo: Motivo) => string
  // The list as handed to the model.
  listaVazia: string
  cabecalhoLista: (assunto: string) => string
  feito: string
  orfasCabecalho: string
  ilegivelModelo: (nome: string) => string
  orfaParaModelo: (o: { id: string; itens: string[] }) => string
  abertoNestaAba: (lista: string) => string
}

const MOTIVO_EN: Record<Motivo, string> = {
  'sumiu': 'that list no longer exists (it was already adopted or discarded)',
  'outra-aba': 'another tab already adopted that list',
  'viva': 'the tab that owns that list is still open',
  'minha': 'that is already this tab\'s list',
  'ilegivel': 'that list\'s file is unreadable; I left it alone',
}

const MOTIVO_PT: Record<Motivo, string> = {
  'sumiu': 'essa lista não existe mais (já foi puxada ou descartada)',
  'outra-aba': 'outra aba já puxou essa lista',
  'viva': 'a aba dona dessa lista ainda está aberta',
  'minha': 'essa já é a lista desta aba',
  'ilegivel': 'o arquivo dessa lista está ilegível; não mexi nele',
}

const EN: Textos = {
  tituloPainel: 'Session list',
  descricaoComando: 'Shows this tab\'s session list',
  soInterativa: 'The session list only works in an interactive session.',
  painelAberto: 'Session list open.',
  ficouDeAbaFechada: assunto => (assunto === '' ? 'Left open by a closed tab' : `Left open by a closed tab: ${assunto}`),
  eMais: n => `and ${n} more`,
  continuarAqui: 'Continue here',
  descartar: 'Discard',
  nadaCombinado: 'Nothing agreed yet.',
  ilegivel: arquivo => `unreadable list: ${arquivo}`,
  recusa: {
    'sumiu': () => 'That list is no longer there.',
    'outra-aba': () => 'Another tab already adopted that list.',
    'viva': () => 'That list\'s tab is still open.',
    'minha': () => 'That list already belongs to this tab.',
    'ilegivel': id => `unreadable list: ${id}.json`,
  },
  motivo: MOTIVO_EN,
  erro: {
    'sem-lista': 'This tab has no list yet: add the first item.',
    'nada-pra-anotar': 'Nothing to add: send at least one text.',
    'assunto-vazio': 'The subject came empty.',
    'sem-home': 'could not find the user\'s home folder (HOME or USERPROFILE)',
  },
  descricaoFerramenta:
    'This terminal tab\'s session list: the parts of the work agreed with the user that are still open. '
    + 'anota (add parts: textos, optional assunto) · risca / desrisca / tira (tick / untick / remove: ids) · '
    + 'nomeia (name the list: assunto) · mostra (show) · '
    + 'puxa / descarta (adopt / discard a list a closed tab left: listaId). Every answer is the list as it now stands.',
  paramTextos: 'anota: one item per text.',
  paramIds: 'risca, desrisca, tira: the items\' ids, e.g. i1.',
  paramAssunto: 'anota (optional) or nomeia: the list\'s subject.',
  paramListaId: 'puxa, descarta: the id of the list a closed tab left, e.g. l_ab12cd34.',
  regra: 'Session list: when you and the user agree on a piece of work in parts, note the parts right away with the `lista` tool (acao anota), not at the end. Tick each part (acao risca) as soon as it is done. The user can also ask "add this to the session list". This list is NOT the user\'s task list: never copy their tasks here, and never move items to any other task list unless they ask.',
  acaoInvalida: acoes => `acao must be one of: ${acoes}.`,
  naoAchei: ids => `Not found: ${ids}.`,
  puxei: id => `Moved list ${id} to this tab.`,
  naoPuxei: m => `Did not adopt: ${MOTIVO_EN[m]}.`,
  descartei: id => `Discarded list ${id} (moved to descartadas/, can be undone by hand).`,
  naoDescartei: m => `Did not discard: ${MOTIVO_EN[m]}.`,
  listaVazia: 'This tab\'s session list: nothing noted yet.',
  cabecalhoLista: assunto => (assunto === '' ? 'This tab\'s session list' : `This tab's session list: ${assunto}`),
  feito: 'done',
  orfasCabecalho: 'Lists closed tabs left with open items:',
  ilegivelModelo: nome => `Unreadable list (left alone): ${nome}`,
  orfaParaModelo: ({ id, itens }) => {
    const coisas = itens.length === 1 ? 'open item' : 'open items'
    return [
      `Orphan list ${id}: a closed tab left ${itens.length} ${coisas}.`,
      `1. In your FIRST reply of this conversation, BEFORE anything else (before answering what the user said and before calling any tool), ask the user with exactly these words: "A tab you closed left ${itens.length} ${coisas}: ${itens.join('; ')}. Continue here?"`,
      `2. Never adopt or discard this list on your own, even if it looks like a test, old or abandoned. Only after the user answers: "yes" → call \`lista\` with acao puxa and listaId ${id}; "no" → acao descarta and listaId ${id}.`,
      '3. If the user talks about something else without answering, leave this list alone: it stays offered until they answer.',
    ].join('\n')
  },
  abertoNestaAba: lista => `What was agreed in this tab and is still open (tool \`lista\`):\n${lista}`,
}

const PT: Textos = {
  tituloPainel: 'Lista da sessão',
  descricaoComando: 'Mostra a lista da sessão desta aba',
  soInterativa: 'A lista da sessão só funciona numa sessão interativa.',
  painelAberto: 'Lista da sessão aberta.',
  ficouDeAbaFechada: assunto => (assunto === '' ? 'Ficou de uma aba fechada' : `Ficou de uma aba fechada: ${assunto}`),
  eMais: n => `e mais ${n}`,
  continuarAqui: 'Continuar aqui',
  descartar: 'Descartar',
  nadaCombinado: 'Nada combinado ainda.',
  ilegivel: arquivo => `lista ilegível: ${arquivo}`,
  recusa: {
    'sumiu': () => 'Essa lista já não está mais lá.',
    'outra-aba': () => 'Outra aba já puxou essa lista.',
    'viva': () => 'A aba dessa lista ainda está aberta.',
    'minha': () => 'Essa lista já é desta aba.',
    'ilegivel': id => `lista ilegível: ${id}.json`,
  },
  motivo: MOTIVO_PT,
  erro: {
    'sem-lista': 'Esta aba ainda não tem lista: anote o primeiro item.',
    'nada-pra-anotar': 'Nada pra anotar: mande pelo menos um texto.',
    'assunto-vazio': 'O assunto veio vazio.',
    'sem-home': 'não achei a pasta do usuário (HOME ou USERPROFILE)',
  },
  descricaoFerramenta:
    'A lista da sessão desta aba do terminal: as partes do trabalho combinado com a pessoa que ainda estão abertas. '
    + 'anota (textos, assunto opcional) · risca / desrisca / tira (ids) · nomeia (assunto) · mostra · '
    + 'puxa / descarta (listaId) uma lista que uma aba fechada deixou. Toda resposta é a lista como ficou.',
  paramTextos: 'anota: um item por texto.',
  paramIds: 'risca, desrisca, tira: ids dos itens, ex. i1.',
  paramAssunto: 'anota (opcional) ou nomeia: o assunto da lista.',
  paramListaId: 'puxa, descarta: id da lista órfã, ex. l_ab12cd34.',
  regra: 'Lista da sessão: quando você e a pessoa combinarem um trabalho em partes, anote as partes na hora com a ferramenta `lista` (acao anota), não no fim. Risque cada parte (acao risca) assim que terminar. A pessoa também pode pedir "anota isso na lista da sessão". Esta lista NÃO é a lista de tarefas da pessoa: nunca copie tarefas dela pra cá, e nunca passe itens pra outra lista de tarefas sem ela pedir.',
  acaoInvalida: acoes => `acao precisa ser uma de: ${acoes}.`,
  naoAchei: ids => `Não achei: ${ids}.`,
  puxei: id => `Puxei a lista ${id} pra esta aba.`,
  naoPuxei: m => `Não puxei: ${MOTIVO_PT[m]}.`,
  descartei: id => `Descartei a lista ${id} (foi pra descartadas/, dá pra desfazer à mão).`,
  naoDescartei: m => `Não descartei: ${MOTIVO_PT[m]}.`,
  listaVazia: 'Lista da sessão desta aba: nada anotado ainda.',
  cabecalhoLista: assunto => (assunto === '' ? 'Lista da sessão desta aba' : `Lista da sessão desta aba: ${assunto}`),
  feito: 'feito',
  orfasCabecalho: 'Listas que abas fechadas deixaram com coisas pendentes:',
  ilegivelModelo: nome => `Lista ilegível (não mexi): ${nome}`,
  orfaParaModelo: ({ id, itens }) => {
    const coisas = itens.length === 1 ? 'coisa pendente' : 'coisas pendentes'
    return [
      `Lista órfã ${id}: uma aba fechada deixou ${itens.length} ${coisas}.`,
      `1. Na sua PRIMEIRA resposta desta conversa, ANTES de qualquer outra coisa (antes de responder ao que a pessoa disse e antes de chamar qualquer ferramenta), pergunte à pessoa exatamente com estas palavras: "Uma aba que tu fechou deixou ${itens.length} ${coisas}: ${itens.join('; ')}. Continuar aqui?"`,
      `2. Nunca puxe nem descarte essa lista por conta própria, nem que ela pareça teste, velha ou abandonada. Só depois da resposta da pessoa: "sim" → chame \`lista\` com acao puxa e listaId ${id}; "não" → acao descarta e listaId ${id}.`,
      '3. Se a pessoa falar de outra coisa sem responder, não mexa nessa lista: ela continua oferecida até a pessoa responder.',
    ].join('\n')
  },
  abertoNestaAba: lista => `O que ficou combinado nesta aba e ainda está aberto (ferramenta \`lista\`):\n${lista}`,
}

export const TEXTOS: Record<Idioma, Textos> = { 'en': EN, 'pt-BR': PT }

export function textos(idioma: Idioma): Textos {
  return TEXTOS[idioma]
}
