import type { Register } from 'claude-code'

import { chaveDaAba, meuProcesso } from './aba'
import { recarrega, retoma, semeia } from './estado'
import { FERRAMENTA, aoChamarLista, aoComporPrompt, aoEnviarPrompt, registraFerramenta } from './ferramenta'
import { limpa, pasta } from './listas'
import { COMANDO, PAINEL, abrePainel, desenhaPainel, rodaComando } from './painel'
import { idiomaDe } from './textos'

// Wiring only. Everything stays inactive outside interactive sessions: the
// background keeper and `claude -p` inherit the tab's environment and would
// otherwise take the tab's list. Only session.start sets the identity.
export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    if (!e.isInteractive) return next(e)
    const raiz = await pasta($, options)
    const eu = { aba: await chaveDaAba($), dono: await meuProcesso($) }
    await limpa($, raiz, eu)
    // Before next(e): anything the engine raises inside it at startup finds
    // the identity set (prompt.context ran there, measured 2026-10-21).
    await semeia($, { raiz, eu, idioma: idiomaDe(options) })
    const r = await next(e)
    await registraFerramenta($)
    await abrePainel($)

    return r
  })

  // /clear starts a new session id with empty $.state and no session.start.
  // A short timer puts the identity back so the pane redraws right away;
  // the first prompt, the tool and the buttons put it back too (garanteQuem).
  on('session.end', async ($, e, next) => {
    const r = await next(e)
    if (e.reason === 'clear') $.clock.after(300, () => { void retoma($) })

    return r
  })

  // A theme change in /config redraws the pane in the matching tone.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const r = await next(e)
    await recarrega($)

    return r
  })

  on('tool.call', { tool: FERRAMENTA }, ($, e) => aoChamarLista($, e))
  on('prompt.compose', aoComporPrompt)
  on('prompt.submit', aoEnviarPrompt)
  on('ui.render', { component: 'Pane', requestId: PAINEL }, ($, e) => desenhaPainel($, e))
  on('command.run', { command: COMANDO }, $ => rodaComando($))
}
