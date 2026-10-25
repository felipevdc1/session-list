// The pane's colors, one palette per tone of the terminal theme. The tone
// comes from the raw /config theme value: Claude Code's light themes all
// carry "light" in their value (light, light-daltonized, light-ansi), so that
// word decides; anything else, an absent value included, reads as dark.

export type Tom = 'escuro' | 'claro'

/** The /config theme value → tone: any value containing "light" (case-insensitive) is 'claro'; everything else, absent included, is 'escuro'. */
export function tomDoTema(tema: string | null | undefined): Tom {
  return tema != null && tema.toLowerCase().includes('light') ? 'claro' : 'escuro'
}

// `feito` is the done item's text: quieter than `texto`, still readable
// (APCA Lc 57 on the dark ground, 81 on the light; `apagado` is 35 / 71,
// too faint once struck through, measured 2026-10-22).
export type Paleta = { rosa: string; lima: string; aviso: string; texto: string; feito: string; apagado: string; fundo: string }

export const PALETAS: Record<Tom, Paleta> = {
  escuro: { rosa: '#ff2e93', lima: '#c6ff00', aviso: '#ff9f1c', texto: '#d9dce2', feito: '#a9aeb8', apagado: '#7b8290', fundo: '#15171c' },
  claro: { rosa: '#c2005f', lima: '#4d7a00', aviso: '#a85a00', texto: '#22262c', feito: '#555b65', apagado: '#6b727d', fundo: '#fafafa' },
}
