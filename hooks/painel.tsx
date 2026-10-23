// The pane: this tab's list beside the chat, with the lists closed tabs left
// open offered on top. It only reads the atoms of estado.ts; its buttons
// change the disk through listas.ts and then recarrega the atoms, which
// redraws the pane (a `$.state` read while drawing subscribes it).
//
// The drawing is a vertical rail: one node per row of meaning (the list's
// head, then each item in the list's order), the rail running down the marker
// column between them. Pink = what already happened (lit up to the last done
// item), lime = where the person acts (open markers, the Continue chip),
// orange = a list a closed tab left (dashed rail into its buttons).

import type { CommandRunResult, EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { PALETAS, type Paleta, tomDoTema } from './cores'
import { type Comum, garanteQuem, leIlegiveis, leMinha, leOrfas, leQuem, leTema, recarrega } from './estado'
import { descarta, puxa } from './listas'
import { type Textos, textos } from './textos'

export const PAINEL = 'lista-da-sessao'
export const COMANDO = 'lista'

const MAX_ITENS_DA_ORFA = 5
/** The marker column: the glyph and one space. */
const LARGURA_MARCA = 2
/** Rail glyphs stacked in a node's rail column; the node's height clips them. */
const ALTURA_DO_TRILHO = 200

/** What the pane's work needs of `$`: disk, process table, state and the UI. */
export type ComPainel = Comum & Pick<EngineInterface, 'ui'>

/** The texts in this tab's language; English while the mod has no identity. */
async function textosDaAba($: Comum): Promise<Textos> {
  return textos((await leQuem($))?.idioma ?? 'en')
}

async function abre($: ComPainel): Promise<void> {
  await $.ui.open({ id: PAINEL, title: (await textosDaAba($)).tituloPainel })
}

/**
 * Registers `/lista` and opens the pane; for session.start, after quemA and
 * the atoms are set (an inactive session never calls it).
 */
export async function abrePainel($: ComPainel & Pick<EngineInterface, 'command'>): Promise<void> {
  await $.command.register({ name: COMANDO, description: (await textosDaAba($)).descricaoComando })
  await abre($)
}

/** `command.run`, matcher `{ command: COMANDO }`: reopens the pane. Wire as `$ => rodaComando($)`. */
export async function rodaComando($: ComPainel): Promise<CommandRunResult> {
  const quem = await garanteQuem($)
  if (!quem) return { text: textos('en').soInterativa }
  await recarrega($)
  await abre($)

  return { text: textos(quem.idioma).painelAberto }
}

/** The Continue here button: moves the orphan `id` to this tab, then redraws. */
export async function continua($: ComPainel, id: string): Promise<void> {
  const quem = await garanteQuem($)
  if (!quem) return
  const feito = await puxa($, quem.raiz, quem.eu, id)
  await recarrega($)
  if (!feito.ok) $.ui.toast(textos(quem.idioma).recusa[feito.motivo](id))
}

/** The Discard button: moves the orphan `id` to `descartadas/`, then redraws. */
export async function descartaOrfa($: ComPainel, id: string): Promise<void> {
  const quem = await garanteQuem($)
  if (!quem) return
  const feito = await descarta($, quem.raiz, quem.eu, id)
  await recarrega($)
  if (!feito.ok) $.ui.toast(textos(quem.idioma).recusa[feito.motivo](id))
}

/** The rail below a node, down to the next one: its glyph, color and weight. */
type Trilho = { glifo: string; cor: string; negrito: boolean }

/** Segment k → k+1 of this tab's rail: lit when node k+1 is at or before the last done item. */
export function segmentoAceso(k: number, ultimoFeito: number): boolean {
  return k + 1 <= ultimoFeito
}

/**
 * The pane's drawing; wire as
 * `on('ui.render', { component: 'Pane', requestId: PAINEL }, ($, e) => desenhaPainel($, e))`.
 */
export async function desenhaPainel($: EngineInterface, e: RenderInput<'Pane'>): Promise<RenderElement> {
  const { Box, Text, Button } = $.ui.resolve(e)
  const minha = await leMinha($)
  const soltas = await leOrfas($)
  const ilegiveis = await leIlegiveis($)
  const t = textos((await leQuem($))?.idioma ?? 'en')
  const p: Paleta = PALETAS[tomDoTema(await leTema($))]
  const largura = Math.max(10, e.props.bodyColumns)
  const colunaTexto = largura - LARGURA_MARCA - 1
  const itens = minha?.itens ?? []

  // Rail option A: an absolute column over the node's marker column, from
  // the row under the marker to the node's bottom edge (its spacer rows
  // included), holding more glyphs than any node is tall; the node clips it.
  // Option B (pre-wrapped rows, one glyph each) would replace this alone.
  const trilhoDe = (trilho: Trilho) => (
    <Box position="absolute" top={1} bottom={0} left={0} width={1} overflow="hidden">
      <Text color={trilho.cor} weight={trilho.negrito ? 'bold' : 'regular'} wrap="wrap">
        {Array(ALTURA_DO_TRILHO).fill(trilho.glifo).join('\n')}
      </Text>
    </Box>
  )

  // One node: the marker column, the text column (wrapped, never cut) and,
  // when a node follows, `espaco` blank rows with the rail running through.
  const no = (marca: string, corMarca: string, texto: RenderElement, trilho: Trilho | null, espaco = 1) => (
    <Box position="relative" flexDirection="row" paddingBottom={trilho ? espaco : 0}>
      <Box width={LARGURA_MARCA} flexShrink={0}>
        <Text color={corMarca}>{marca}</Text>
      </Box>
      <Box width={colunaTexto}>{texto}</Box>
      {trilho && trilhoDe(trilho)}
    </Box>
  )

  const tracejado: Trilho = { glifo: '┊', cor: p.aviso, negrito: false }
  const aceso: Trilho = { glifo: '┃', cor: p.rosa, negrito: true }
  const fino: Trilho = { glifo: '│', cor: p.apagado, negrito: false }

  const orfa = (lista: (typeof soltas)[number]) => {
    const pendentes = lista.itens.filter(i => !i.feito)
    const resto = pendentes.length - MAX_ITENS_DA_ORFA

    return (
      <Box key={lista.id} flexDirection="column">
        {no('●', p.aviso,
          <Text color={p.texto} weight="bold" wrap="wrap">{t.ficouDeAbaFechada(lista.assunto)}</Text>, tracejado)}
        {pendentes.slice(0, MAX_ITENS_DA_ORFA).map(i =>
          no('○', p.aviso, <Text color={p.texto} wrap="wrap">{i.texto}</Text>, tracejado))}
        {resto > 0 && no('┊', p.aviso, <Text color={p.apagado} wrap="wrap">{t.eMais(resto)}</Text>, tracejado)}
        <Box flexDirection="row">
          <Box flexShrink={0} marginRight={1}>
            <Text color={p.aviso}>╰──</Text>
          </Box>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Button key={`continuar-${lista.id}`} label={t.continuarAqui} variant="primary"
              onPress={() => continua($, lista.id)}>
              <Text backgroundColor={p.lima} color={p.fundo} weight="bold">{t.continuarAqui}</Text>
            </Button>
            <Button key={`descartar-${lista.id}`} label={t.descartar}
              onPress={() => descartaOrfa($, lista.id)} />
          </Box>
        </Box>
      </Box>
    )
  }

  // This tab's list: node 0 is the head, node k (k ≥ 1) is item k-1.
  const ultimoFeito = itens.reduce((u, item, n) => (item.feito ? n + 1 : u), 0)
  const segmento = (k: number): Trilho => (segmentoAceso(k, ultimoFeito) ? aceso : fino)
  const algumAberto = itens.some(i => !i.feito)

  const lista = itens.length === 0
    ? <Text color={p.apagado} italic wrap="wrap">{t.nadaCombinado}</Text>
    : (
        <Box flexDirection="column">
          {no('●', algumAberto ? p.lima : p.rosa,
            <Text color={p.texto} weight="bold" underline wrap="wrap">{minha?.assunto || t.tituloPainel}</Text>,
            segmento(0), 2)}
          {itens.map((item, n) => {
            const k = n + 1
            const trilho = k < itens.length ? segmento(k) : null
            return item.feito
              ? no('●', p.rosa, <Text color={p.texto} wrap="wrap">{item.texto}</Text>, trilho)
              : no('○', p.lima, <Text color={p.texto} weight="bold" wrap="wrap">{item.texto}</Text>, trilho)
          })}
        </Box>
      )

  return (
    <Box flexDirection="column" width={largura} marginTop={1} gap={1}>
      {soltas.map(orfa)}
      {soltas.length > 0 && <Text color={p.apagado} wrap="truncate-end">{'─'.repeat(largura - 1)}</Text>}
      {lista}
      {ilegiveis.length > 0 && (
        <Box flexDirection="column">
          {ilegiveis.map(arquivo => <Text color={p.aviso} wrap="wrap">{t.ilegivel(arquivo)}</Text>)}
        </Box>
      )}
    </Box>
  )
}
