// The model's side of the list: the tool `lista`, the fixed rule in the
// system prompt, and the list (plus orphans) handed over as context when a
// conversation starts or is cleared (prompt.submit's context). Everything here is inactive
// until session.start set this tab's identity, which it does only in
// interactive sessions (not the keeper, not a `claude -p`).

import type { Args, EngineInterface, Frozen, Next, PromptComposeResult, PromptSubmitResult, ToolSpec } from 'claude-code'
import type { Lista } from '../types'
import { type Comum, garanteQuem, leEntregue, leIlegiveis, leMinha, leOrfas, marcaEntregue, recarrega } from './estado'
import { anota, descarta, desrisca, ErroDaLista, nomeia, puxa, risca, tira } from './listas'
import { type Textos, textos } from './textos'

/** The tool's full name, the matcher for `tool.call`. */
export const FERRAMENTA = 'mcp__lista-da-sessao__lista'

const ACOES = ['anota', 'risca', 'desrisca', 'tira', 'nomeia', 'mostra', 'puxa', 'descarta'] as const
type Acao = (typeof ACOES)[number]

/** The tool's spec in one language; the action names stay Portuguese in both. */
export function espec(t: Textos): ToolSpec {
  return {
    name: 'lista',
    description: t.descricaoFerramenta,
    inputSchema: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: [...ACOES] },
        textos: { type: 'array', items: { type: 'string' }, description: t.paramTextos },
        ids: { type: 'array', items: { type: 'string' }, description: t.paramIds },
        assunto: { type: 'string', description: t.paramAssunto },
        listaId: { type: 'string', description: t.paramListaId },
      },
      required: ['acao'],
    },
    isDeferred: false,
  }
}

/** Registers the tool in this tab's language; call it from session.start in interactive sessions only. */
export async function registraFerramenta($: Comum & Pick<EngineInterface, 'tool'>): Promise<void> {
  const quem = await garanteQuem($)
  if (!quem) return
  await $.tool.register(espec(textos(quem.idioma)))
}

/** The rule as the system prompt's last section, in one language; the id is the same in both. */
export function secaoRegra(t: Textos) {
  return { id: 'lista-da-sessao:regra', text: t.regra, scope: 'session' } as const
}

/** `prompt.compose`: the rule as the last section, the same text every request. */
export async function aoComporPrompt($: EngineInterface, e: Frozen<Args<'prompt.compose'>>, next: Next<'prompt.compose'>): Promise<PromptComposeResult> {
  const composto = await next(e)
  const quem = await garanteQuem($)
  if (!quem) return composto

  return { ...composto, sections: [...composto.sections, secaoRegra(textos(quem.idioma))] }
}

const abertos = (l: Lista) => l.itens.filter(i => !i.feito)

function descreveMinha(minha: Lista | null, t: Textos): string {
  if (!minha || minha.itens.length === 0) return t.listaVazia
  const ordem = [...abertos(minha), ...minha.itens.filter(i => i.feito)]

  return [t.cabecalhoLista(minha.assunto), ...ordem.map(i => `${i.feito ? '☑' : '☐'} ${i.id} ${i.texto}${i.feito ? ` (${t.feito})` : ''}`)].join('\n')
}

function descreveOrfas(orfas: Lista[], t: Textos): string[] {
  if (orfas.length === 0) return []
  return [
    t.orfasCabecalho,
    ...orfas.map(o => `- ${o.id}${o.assunto === '' ? '' : ` (${o.assunto})`}: ${abertos(o).map(i => i.texto).join('; ')}`),
  ]
}

async function descreveEstado($: Comum, t: Textos): Promise<string> {
  const ilegiveis = await leIlegiveis($)
  return [
    descreveMinha(await leMinha($), t),
    ...descreveOrfas(await leOrfas($), t),
    ...ilegiveis.map(n => t.ilegivelModelo(n)),
  ].join('\n')
}

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])
const texto = (x: unknown): string => (typeof x === 'string' ? x : '')

/**
 * Runs one action for this tab and answers the list as it now stands.
 * Wire: `on('tool.call', { tool: FERRAMENTA }, ($, e) => aoChamarLista($, e))`.
 */
export async function aoChamarLista($: Comum, e: Record<string, unknown>): Promise<{ result: string } | { deny: string }> {
  const quem = await garanteQuem($)
  // Outside an interactive session there is no language either: English.
  if (!quem) return { deny: textos('en').soInterativa }
  const t = textos(quem.idioma)
  const acao = e.acao as Acao
  if (!ACOES.includes(acao)) return { deny: t.acaoInvalida(ACOES.join(', ')) }
  const { raiz, eu } = quem

  let aviso = ''
  try {
    switch (acao) {
      case 'anota': await anota($, raiz, eu, strings(e.textos), texto(e.assunto) || undefined); break
      case 'nomeia': await nomeia($, raiz, eu, texto(e.assunto)); break
      case 'risca': case 'desrisca': case 'tira': {
        const ids = strings(e.ids)
        const { naoAchei } = acao === 'risca' ? await risca($, raiz, eu, ids)
          : acao === 'desrisca' ? await desrisca($, raiz, eu, ids) : await tira($, raiz, eu, ids)
        if (naoAchei.length > 0) aviso = t.naoAchei(naoAchei.join(', '))
        break
      }
      case 'puxa': {
        const r = await puxa($, raiz, eu, texto(e.listaId))
        aviso = r.ok ? t.puxei(texto(e.listaId)) : t.naoPuxei(r.motivo)
        break
      }
      case 'descarta': {
        const r = await descarta($, raiz, eu, texto(e.listaId))
        aviso = r.ok ? t.descartei(texto(e.listaId)) : t.naoDescartei(r.motivo)
        break
      }
      case 'mostra': break
    }
  } catch (err) {
    aviso = err instanceof ErroDaLista ? t.erro[err.codigo] : err instanceof Error ? err.message : String(err)
  }
  await recarrega($)
  const estado = await descreveEstado($, t)

  return { result: aviso === '' ? estado : `${aviso}\n\n${estado}` }
}

/**
 * The context for the model at a conversation's start: this tab's list and,
 * per orphan, the question to put to the person. null when there is nothing.
 */
export function contextoInicial(minha: Lista | null, orfas: Lista[], t: Textos): string | null {
  const partes: string[] = orfas.map(o => t.orfaParaModelo({ id: o.id, itens: abertos(o).map(i => i.texto) }))
  if (minha && abertos(minha).length > 0) partes.push(t.abertoNestaAba(descreveMinha(minha, t)))

  return partes.length === 0 ? null : partes.join('\n\n')
}

/**
 * `prompt.submit`: on the conversation's first prompt (again after /clear,
 * whose new session starts with `entregue` false), attaches this tab's list
 * and the orphan questions as context beside the prompt, on the way down.
 * A slash command's submission is passed by; the next typed prompt carries it.
 */
export async function aoEnviarPrompt($: EngineInterface, e: Frozen<Args<'prompt.submit'>>, next: Next<'prompt.submit'>): Promise<PromptSubmitResult> {
  const quem = await garanteQuem($)
  if (e.command || !quem || (await leEntregue($))) return next(e)
  await marcaEntregue($)
  await recarrega($)
  // a window driven by another program has no person to answer the orphan question
  const orfas = (await $.env.get('LISTA_SESSAO_SEM_ORFAS')) ? [] : await leOrfas($)
  const texto = contextoInicial(await leMinha($), orfas, textos(quem.idioma))
  if (texto === null) return next(e)

  return next({ ...e, context: [...(e.context ?? []), texto] })
}
