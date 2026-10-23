// The list model: one JSON file per list under `<pasta>/listas/<id>.json`
// (shape fixed in types/index.d.ts). Every function takes `$` and the data
// folder; the ones that act for this tab also take `Eu` (tab key + owner
// process), computed once by the caller with chaveDaAba and meuProcesso.
//
// Rules kept here:
// - A file that does not parse is never overwritten, moved or deleted; its
//   name comes back in `ilegiveis` so the pane can say "lista ilegível".
// - Only files named `l_<8 [a-z0-9]>.json` are lists, so a leftover `.tmp-*`
//   from a crashed write, an old `.puxando-*` claim file or a `.puxando` lock
//   folder is never read as one.
// - Every write is whole and atomic (gravaAtomico).

import type { Dono, Item, Lista } from '../types'
import { type Aba, estaVivo } from './aba'
import { destrava, gravaAtomico, move, remove, trava } from './disco'

export type Host = Aba

/** This tab and the process that owns its list now. */
export type Eu = { aba: string; dono: Dono }

const NOME = /^(l_[a-z0-9]{8})\.json$/
const ID_LISTA = /^l_[a-z0-9]{8}$/

/**
 * What went wrong, as a code; the words live in textos.ts (`erro`), in the
 * member's language:
 * - `sem-lista`: this tab has no list yet;
 * - `nada-pra-anotar`: no text left after trimming;
 * - `assunto-vazio`: the subject came blank;
 * - `sem-home`: neither the option nor HOME/USERPROFILE gives a data folder.
 */
export type CodigoDeErro = 'sem-lista' | 'nada-pra-anotar' | 'assunto-vazio' | 'sem-home'

export class ErroDaLista extends Error {
  constructor(readonly codigo: CodigoDeErro) {
    super(codigo)
  }
}

/**
 * The data folder: `options.pasta` when set, else
 * `<HOME or USERPROFILE>/.claude/lista-da-sessao`.
 *
 * @throws when neither the option nor a home folder is there.
 */
export async function pasta($: Host, options: { pasta?: unknown } | undefined): Promise<string> {
  const dada = typeof options?.pasta === 'string' ? options.pasta.trim() : ''
  if (dada !== '') return semBarraNoFim(dada)
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  if (!home) throw new ErroDaLista('sem-home')

  return `${semBarraNoFim(home)}/.claude/lista-da-sessao`
}

function semBarraNoFim(p: string): string {
  return p.length > 1 ? p.replace(/[\\/]+$/, '') : p
}

const listasDe = (raiz: string) => `${raiz}/listas`
const arquivoDe = (raiz: string, id: string) => `${listasDe(raiz)}/${id}.json`

/** Now as ISO 8601 with the local offset, e.g. `2026-10-21T09:30:00-03:00`. */
export function agora(d: Date = new Date()): string {
  const dois = (n: number) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sinal = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)

  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`
    + `T${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}`
    + `${sinal}${dois(Math.floor(abs / 60))}:${dois(abs % 60)}`
}

function novoIdDeLista(): string {
  const letras = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return `l_${Array.from(bytes, b => letras[b % letras.length]).join('')}`
}

function proximoItem(itens: Item[]): number {
  let max = 0
  for (const i of itens) {
    const n = /^i(\d+)$/.exec(i.id)
    if (n) max = Math.max(max, Number(n[1]))
  }
  return max + 1
}

function ehLista(x: unknown, id: string): x is Lista {
  if (typeof x !== 'object' || x === null) return false
  const l = x as Record<string, unknown>
  const dono = l.dono as Record<string, unknown> | null | undefined
  return l.versao === 1 && l.id === id && typeof l.aba === 'string'
    && typeof dono === 'object' && dono !== null
    && typeof dono.pid === 'number' && typeof dono.inicio === 'string'
    && typeof l.assunto === 'string' && typeof l.criada === 'string'
    && typeof l.atualizada === 'string' && Array.isArray(l.itens)
    && l.itens.every(i => typeof i === 'object' && i !== null
      && typeof (i as Item).id === 'string' && typeof (i as Item).texto === 'string'
      && typeof (i as Item).feito === 'boolean')
}

type Lido = { lista: Lista } | { ilegivel: true } | { sumiu: true }

async function leArquivo($: Host, caminho: string, id: string): Promise<Lido> {
  let texto: string
  try {
    texto = await $.fs.read(caminho)
  } catch {
    // Gone between list and read (another tab adopted it) is not unreadable.
    return (await $.fs.exists(caminho)) ? { ilegivel: true } : { sumiu: true }
  }
  try {
    const x: unknown = JSON.parse(texto)
    return ehLista(x, id) ? { lista: x } : { ilegivel: true }
  } catch {
    return { ilegivel: true }
  }
}

type Todas = { listas: Lista[]; ilegiveis: string[] }

async function leTodas($: Host, raiz: string): Promise<Todas> {
  const pastaListas = listasDe(raiz)
  if (!(await $.fs.exists(pastaListas))) return { listas: [], ilegiveis: [] }
  const listas: Lista[] = []
  const ilegiveis: string[] = []
  for (const e of await $.fs.list(pastaListas)) {
    const m = e.kind === 'file' ? NOME.exec(e.name) : null
    if (!m) continue
    const lido = await leArquivo($, `${pastaListas}/${e.name}`, m[1] as string)
    if ('lista' in lido) listas.push(lido.lista)
    else if ('ilegivel' in lido) ilegiveis.push(e.name)
  }
  ilegiveis.sort()

  return { listas, ilegiveis }
}

const maisNovaPrimeiro = (a: Lista, b: Lista) =>
  (Date.parse(b.atualizada) || 0) - (Date.parse(a.atualizada) || 0)

// The tab's list is the newest one carrying its tab key; the others with the
// same key are left alone (and may be offered as orphans).
function escolheMinha(listas: Lista[], aba: string): Lista | undefined {
  return listas.filter(l => l.aba === aba).sort(maisNovaPrimeiro)[0]
}

const abertos = (l: Lista) => l.itens.filter(i => !i.feito)

async function grava($: Host, raiz: string, lista: Lista): Promise<void> {
  await gravaAtomico($, arquivoDe(raiz, lista.id), `${JSON.stringify(lista, null, 2)}\n`)
}

export type MinhaLista = {
  /** This tab's list, or undefined while nothing has been written. */
  minha: Lista | undefined
  /** Ids of other lists with this tab's key, left untouched. */
  outrasDaAba: string[]
  ilegiveis: string[]
}

/**
 * This tab's list (newest `atualizada` among the lists with `eu.aba`), with
 * `dono` set to `eu.dono` in one atomic write when it differs. No list →
 * `minha` undefined; nothing is created.
 */
export async function minhaLista($: Host, raiz: string, eu: Eu): Promise<MinhaLista> {
  const { listas, ilegiveis } = await leTodas($, raiz)
  const minha = escolheMinha(listas, eu.aba)
  const outrasDaAba = listas.filter(l => l.aba === eu.aba && l !== minha).map(l => l.id).sort()
  if (minha && (minha.dono.pid !== eu.dono.pid || minha.dono.inicio !== eu.dono.inicio)) {
    minha.dono = { ...eu.dono }
    await grava($, raiz, minha)
  }

  return { minha, outrasDaAba, ilegiveis }
}

async function exigeMinha($: Host, raiz: string, eu: Eu): Promise<Lista> {
  const { minha } = await minhaLista($, raiz, eu)
  if (!minha) throw new ErroDaLista('sem-lista')
  return minha
}

/**
 * Adds `textos` as open items to this tab's list, creating the list (and the
 * data folder) on the first item. `assunto`, when given, names the list.
 *
 * @throws when no text is left after trimming.
 */
export async function anota($: Host, raiz: string, eu: Eu, textos: string[], assunto?: string): Promise<Lista> {
  const limpos = textos.map(t => t.trim()).filter(t => t !== '')
  if (limpos.length === 0) throw new ErroDaLista('nada-pra-anotar')
  const quando = agora()
  let lista = (await minhaLista($, raiz, eu)).minha
  if (!lista) {
    let id = novoIdDeLista()
    for (let n = 0; n < 5 && (await $.fs.exists(arquivoDe(raiz, id))); n++) id = novoIdDeLista()
    lista = { versao: 1, id, aba: eu.aba, dono: { ...eu.dono }, assunto: '', criada: quando, atualizada: quando, itens: [] }
  }
  let n = proximoItem(lista.itens)
  for (const texto of limpos) lista.itens.push({ id: `i${n++}`, texto, feito: false, feitoEm: null })
  if (assunto !== undefined && assunto.trim() !== '') lista.assunto = assunto.trim()
  lista.atualizada = quando
  await grava($, raiz, lista)

  return lista
}

export type PorIds = { lista: Lista; naoAchei: string[] }

async function mudaItens(
  $: Host, raiz: string, eu: Eu, ids: string[],
  muda: (lista: Lista, item: Item, quando: string) => void,
): Promise<PorIds> {
  const lista = await exigeMinha($, raiz, eu)
  const quando = agora()
  const naoAchei: string[] = []
  for (const id of ids) {
    const item = lista.itens.find(i => i.id === id)
    if (item) muda(lista, item, quando)
    else naoAchei.push(id)
  }
  if (naoAchei.length < ids.length) {
    lista.atualizada = quando
    await grava($, raiz, lista)
  }

  return { lista, naoAchei }
}

/** Ticks the items `ids` of this tab's list. @throws when the tab has no list. */
export function risca($: Host, raiz: string, eu: Eu, ids: string[]): Promise<PorIds> {
  return mudaItens($, raiz, eu, ids, (_l, item, quando) => {
    if (!item.feito) { item.feito = true; item.feitoEm = quando }
  })
}

/** Unticks the items `ids`. @throws when the tab has no list. */
export function desrisca($: Host, raiz: string, eu: Eu, ids: string[]): Promise<PorIds> {
  return mudaItens($, raiz, eu, ids, (_l, item) => { item.feito = false; item.feitoEm = null })
}

/** Removes the items `ids`; the others keep their ids. @throws when the tab has no list. */
export function tira($: Host, raiz: string, eu: Eu, ids: string[]): Promise<PorIds> {
  return mudaItens($, raiz, eu, ids, (lista, item) => { lista.itens = lista.itens.filter(i => i !== item) })
}

/** Names this tab's list. @throws when the tab has no list or `assunto` is blank. */
export async function nomeia($: Host, raiz: string, eu: Eu, assunto: string): Promise<Lista> {
  const nome = assunto.trim()
  if (nome === '') throw new ErroDaLista('assunto-vazio')
  const lista = await exigeMinha($, raiz, eu)
  lista.assunto = nome
  lista.atualizada = agora()
  await grava($, raiz, lista)

  return lista
}

export type Orfas = { orfas: Lista[]; ilegiveis: string[] }

/**
 * Lists that are not this tab's, whose owner process is not running, with at
 * least one open item; newest first.
 */
export async function orfas($: Host, raiz: string, eu: Eu): Promise<Orfas> {
  const { listas, ilegiveis } = await leTodas($, raiz)
  const minha = escolheMinha(listas, eu.aba)
  const achadas: Lista[] = []
  for (const l of listas) {
    if (l === minha || abertos(l).length === 0) continue
    if (!(await estaVivo($, l.dono))) achadas.push(l)
  }

  return { orfas: achadas.sort(maisNovaPrimeiro), ilegiveis }
}

/**
 * Why a puxa or descarta did nothing:
 * - `sumiu`: no such list (bad id, already adopted or discarded);
 * - `outra-aba`: another tab holds its lock ("outra aba já puxou essa lista");
 * - `viva`: its owner tab is still running;
 * - `minha`: it is already this tab's list;
 * - `ilegivel`: the file does not parse (left untouched).
 */
export type Motivo = 'sumiu' | 'outra-aba' | 'viva' | 'minha' | 'ilegivel'

export type Puxada = { ok: true; lista: Lista } | { ok: false; motivo: Motivo }

// The checks puxa and descarta share before touching the file.
async function alvo($: Host, raiz: string, eu: Eu, id: string): Promise<{ lista: Lista } | { motivo: Motivo }> {
  if (!ID_LISTA.test(id)) return { motivo: 'sumiu' }
  const lido = await leArquivo($, arquivoDe(raiz, id), id)
  if ('sumiu' in lido) return { motivo: 'sumiu' }
  if ('ilegivel' in lido) return { motivo: 'ilegivel' }
  const { listas } = await leTodas($, raiz)
  if (escolheMinha(listas, eu.aba)?.id === id) return { motivo: 'minha' }
  if (await estaVivo($, lido.lista.dono)) return { motivo: 'viva' }

  return { lista: lido.lista }
}

// The lock on one list, held by puxa and descarta: the folder
// `<id>.json.puxando`, holding a file `dono` (pid + start time of the claude
// process that holds it).
const trincoDe = (raiz: string, id: string) => `${arquivoDe(raiz, id)}.puxando`

async function donoDoTrinco($: Host, trinco: string): Promise<Dono | undefined> {
  try {
    const x = JSON.parse(await $.fs.read(`${trinco}/dono`)) as Partial<Dono> | null
    return typeof x?.pid === 'number' && typeof x.inicio === 'string' ? { pid: x.pid, inicio: x.inicio } : undefined
  } catch {
    return undefined
  }
}

/** A lock with no readable `dono` older than this is taken as abandoned. */
export const TRINCO_SEM_DONO_MS = 60_000

// Whether a lock that is there may be broken: its holder is no longer
// running, or it names no readable holder and its folder is older than
// TRINCO_SEM_DONO_MS (a crash between the mkdir and the write of `dono`).
async function trincoAbandonado($: Host, trinco: string): Promise<boolean> {
  const dono = await donoDoTrinco($, trinco)
  if (dono) return !(await estaVivo($, dono))
  try {
    return Date.now() - (await $.fs.stat(trinco)).mtimeMs > TRINCO_SEM_DONO_MS
  } catch {
    return false
  }
}

/**
 * Takes the lock of list `id` for this tab. An abandoned lock (see
 * trincoAbandonado) is broken once and taken again.
 *
 * Known gap, small: two tabs that find the same abandoned lock at the same
 * moment can both break it, and the second break removes the first one's
 * fresh lock, so both may go on.
 */
async function travaLista($: Host, raiz: string, eu: Eu, id: string): Promise<boolean> {
  const trinco = trincoDe(raiz, id)
  for (let vez = 0; vez < 2; vez++) {
    if (await trava($, trinco)) {
      await $.fs.write(`${trinco}/dono`, JSON.stringify(eu.dono))
      return true
    }
    if (vez > 0) break
    if (!(await trincoAbandonado($, trinco))) break
    await destrava($, trinco)
  }

  return false
}

/**
 * Moves the orphan `id` to this tab, under the list's lock: the checks run
 * again once the lock is held (another tab may have adopted or discarded it
 * in between). With no list here the orphan becomes this tab's list; with
 * one, its open items are appended to mine (new ids) and the orphan file is
 * removed.
 */
export async function puxa($: Host, raiz: string, eu: Eu, id: string): Promise<Puxada> {
  const antes = await alvo($, raiz, eu, id)
  if ('motivo' in antes) return { ok: false, motivo: antes.motivo }
  if (!(await travaLista($, raiz, eu, id))) return { ok: false, motivo: 'outra-aba' }
  try {
    const visto = await alvo($, raiz, eu, id)
    if ('motivo' in visto) return { ok: false, motivo: visto.motivo }
    const orfa = visto.lista
    const quando = agora()
    const { minha } = await minhaLista($, raiz, eu)
    if (!minha) {
      const lista = { ...orfa, aba: eu.aba, dono: { ...eu.dono }, atualizada: quando }
      await grava($, raiz, lista)
      return { ok: true, lista }
    }
    let n = proximoItem(minha.itens)
    for (const i of abertos(orfa)) minha.itens.push({ id: `i${n++}`, texto: i.texto, feito: false, feitoEm: null })
    if (minha.assunto === '') minha.assunto = orfa.assunto
    minha.atualizada = quando
    await grava($, raiz, minha)
    await remove($, arquivoDe(raiz, id))

    return { ok: true, lista: minha }
  } finally {
    await destrava($, trincoDe(raiz, id))
  }
}

export type Descartada = { ok: true } | { ok: false; motivo: Motivo }

/** Moves the orphan `id` to `<pasta>/descartadas/` (undoable by hand), under the list's lock. */
export async function descarta($: Host, raiz: string, eu: Eu, id: string): Promise<Descartada> {
  const antes = await alvo($, raiz, eu, id)
  if ('motivo' in antes) return { ok: false, motivo: antes.motivo }
  if (!(await travaLista($, raiz, eu, id))) return { ok: false, motivo: 'outra-aba' }
  try {
    const visto = await alvo($, raiz, eu, id)
    if ('motivo' in visto) return { ok: false, motivo: visto.motivo }
    await move($, arquivoDe(raiz, id), `${raiz}/descartadas/${id}.json`)

    return { ok: true }
  } finally {
    await destrava($, trincoDe(raiz, id))
  }
}

/**
 * Deletes the lists that are not this tab's, whose owner is not running and
 * that have no open item (finished work). Unreadable files are untouched.
 *
 * @returns the ids removed.
 */
export async function limpa($: Host, raiz: string, eu: Eu): Promise<string[]> {
  const { listas } = await leTodas($, raiz)
  const minha = escolheMinha(listas, eu.aba)
  const removidas: string[] = []
  for (const l of listas) {
    if (l === minha || abertos(l).length > 0) continue
    if (await estaVivo($, l.dono)) continue
    await remove($, arquivoDe(raiz, l.id))
    removidas.push(l.id)
  }

  return removidas.sort()
}
