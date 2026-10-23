// The shared state seam between the model's tool and the pane: the pane only
// reads these atoms; the tool writes them through recarrega after a change.

import { atom, type EngineInterface, read, type StateDollar, update } from 'claude-code'
import type { Lista } from '../types'
import { type Eu, type Host, minhaLista, orfas } from './listas'
import type { Idioma } from './textos'

/**
 * Data folder, this tab and the language; set at session.start in interactive
 * sessions only. null = mod inactive. The language is fixed for the module's
 * life: an `idioma` change in /config reloads the module (session.start again).
 */
export type Quem = { raiz: string; eu: Eu; idioma: Idioma }

export const minhaA = atom({ plugin: 'lista-da-sessao', key: 'minha' } as const, null as Lista | null)
export const orfasA = atom({ plugin: 'lista-da-sessao', key: 'orfas' } as const, [] as Lista[])
export const ilegiveisA = atom({ plugin: 'lista-da-sessao', key: 'ilegiveis' } as const, [] as string[])
export const quemA = atom({ plugin: 'lista-da-sessao', key: 'quem' } as const, null as Quem | null)
export const entregueA = atom({ plugin: 'lista-da-sessao', key: 'entregue' } as const, false)
export const temaA = atom({ plugin: 'lista-da-sessao', key: 'tema' } as const, null as string | null)

/** What recarrega needs of `$`: the disk, the process table, the state and the /config rows. */
export type Comum = Host & StateDollar & Pick<EngineInterface, 'config'>

// The module scan refuses read/update of an atom imported from another file,
// so every other file goes through these (function declarations: the scan
// follows `$` past an import only into one).
export function leMinha($: StateDollar): Promise<Lista | null> {
  return read($, minhaA)
}
export function leOrfas($: StateDollar): Promise<Lista[]> {
  return read($, orfasA)
}
export function leIlegiveis($: StateDollar): Promise<string[]> {
  return read($, ilegiveisA)
}
export function leQuem($: StateDollar): Promise<Quem | null> {
  return read($, quemA)
}
/** The raw /config `theme` value ('dark', 'light-daltonized', …); null when unread. */
export function leTema($: StateDollar): Promise<string | null> {
  return read($, temaA)
}
export function leEntregue($: StateDollar): Promise<boolean> {
  return read($, entregueA)
}
export async function marcaEntregue($: StateDollar): Promise<void> {
  await update($, entregueA, () => true)
}
export async function poeQuem($: StateDollar, quem: Quem | null): Promise<void> {
  await update($, quemA, () => quem)
}

// $.state is per session, and /clear starts a new session id in the same
// process: the atoms come back empty. This tab's identity is kept here too,
// in the module, which lives as long as the process (a hot reload drops it,
// and runs session.start again, which sets it again). Only session.start in
// an interactive session sets it, so outside one it stays null.
let identidade: Quem | null = null

/** session.start (interactive only): keeps the identity in the module and the state, then reads the disk. */
export async function semeia($: Comum, quem: Quem): Promise<void> {
  identidade = quem
  await poeQuem($, quem)
  await recarrega($)
}

/**
 * The identity for this conversation. After /clear quemA reads null while the
 * module still holds it: it is written again and the atoms are read from disk.
 * null = inactive (never set in this process).
 */
export async function garanteQuem($: Comum): Promise<Quem | null> {
  const quem = await leQuem($)
  if (quem || !identidade) return quem
  await semeia($, identidade)

  return identidade
}

/** After /clear: the identity back if the state lost it, and the atoms read from disk either way. */
export async function retoma($: Comum): Promise<void> {
  if (await garanteQuem($)) await recarrega($)
}

// The /config theme row's value, or null. Everything sits inside the try, the
// `$.config` access included: a test's hand-built `$` has no `config`, and a
// failed read must never stop the reload.
async function temaAtual($: Comum): Promise<string | null> {
  try {
    const linha = (await $.config.list()).find(row => row.key === 'theme')
    return typeof linha?.value === 'string' ? linha.value : null
  } catch {
    return null
  }
}

/** Reads the disk for this tab and the /config theme, and writes the pane atoms; no-op while quemA is null. */
export async function recarrega($: Comum): Promise<void> {
  const quem = await read($, quemA)
  if (!quem) return
  const daAba = await minhaLista($, quem.raiz, quem.eu)
  const soltas = await orfas($, quem.raiz, quem.eu)
  await update($, minhaA, () => daAba.minha ?? null)
  await update($, orfasA, () => soltas.orfas)
  await update($, ilegiveisA, () => [...new Set([...daAba.ilegiveis, ...soltas.ilegiveis])].sort())
  const tema = await temaAtual($)
  await update($, temaA, () => tema)
}
