// The values the pane reads from `$.state`, and the shape of a list file
// (`<pasta>/listas/<id>.json`), fixed by the plan's "Data shape".

export type Dono = {
  pid: number
  /** The owner process's start time, as the OS prints it. */
  inicio: string
}

export type Item = {
  id: string
  texto: string
  feito: boolean
  feitoEm: string | null
}

export type Lista = {
  versao: 1
  /** `l_` followed by 8 lowercase letters or digits. */
  id: string
  /** The tab key, e.g. `orca:…`, `iterm:…`, `sessao:<session id>`. */
  aba: string
  dono: Dono
  /** May be empty until the model names it. */
  assunto: string
  criada: string
  atualizada: string
  itens: Item[]
}

declare module 'claude-code' {
  interface PluginState {
    'lista-da-sessao': {
      /** This tab's list, or null while nothing has been written. */
      minha: Lista | null
      /** Lists left by tabs no longer running, offered here. */
      orfas: Lista[]
      /** File names that failed to parse (never touched). */
      ilegiveis: string[]
      /** Data folder, this tab and the language (the same union as textos.ts `Idioma`; this contract takes no import); null while the mod is inactive (non-interactive). */
      quem: { raiz: string; eu: { aba: string; dono: Dono }; idioma: 'en' | 'pt-BR' } | null
      /** The raw /config `theme` value (e.g. `dark`, `light-daltonized`); null when it could not be read. */
      tema: string | null
      /** True once this conversation's first prompt was looked at for the opening context; back to false on /clear (new session). */
      entregue: boolean
    }
  }
}
