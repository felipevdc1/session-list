# lista-da-sessao (Session list)

A pane beside the Claude Code chat that keeps the parts of the work you agreed on in this conversation and that are still open.
When you and Claude split a job into parts, Claude notes them in the pane right away and ticks each one off as it finishes: a done part is struck through, and a list with nothing left open ends with "All done."
There is one list per terminal tab, and it survives `/clear`, a crash, and (while it has open parts) a new session in the same tab: a new tab offers you whatever a closed tab left open.

What it is not: a task manager.
It never shows your to-do list and never copies items anywhere else; it only holds what is still open from the conversation.

## Install

At the prompt of a terminal session:

```
/plugin install lista-da-sessao --marketplace felipevdc1/session-list
```

From a shell:

```
claude plugin install lista-da-sessao --marketplace felipevdc1/session-list
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `felipevdc1/session-list`, then Add plugin.

What you see: `Add marketplace?` naming `github:felipevdc1/session-list`, answered with `y`; then the plugin's details and a scope (the user scope first, chosen with Enter); then a screen for its two options (language and lists folder).
`/lista` reopens the pane if you close it.

## Language

English by default.
To switch, open `/config`, type `Language`, and pick `en` or `pt-BR` on the row `Language · lista-da-sessao` (the row above it is Claude Code's own language).
It changes the pane and what the plugin tells Claude.

## Where your lists live

`~/.claude/lista-da-sessao/` by default, one JSON file per list under `listas/`.
The `pasta` option (Lists folder) puts them somewhere else.
A list you discard is moved to `descartadas/`, not deleted: to undo, move its file back into `listas/` by hand.
Lists with nothing left open whose Claude session has ended are deleted at the next start, the tab's own included: a new conversation in that tab starts empty, while a list with open items carries over.

## How it works

- **Which tab is which.** The tab is named by the per-tab variable its terminal sets, such as `TMUX_PANE` (with the tmux socket), `ORCA_PANE_KEY`, `TERM_SESSION_ID` or `WT_SESSION`; with none of them, the session id.
- **Who owns a list.** Each list records the `claude` process that owns it: its pid and its start time. A pid that is running but started at another time counts as dead, so a reused pid is not mistaken for the old owner.
- **Orphans.** A list whose owner is gone and that still has open items is offered to the next tab: in the pane, with Continue here and Discard, and to Claude on the first message, which asks you. Continue moves it into this tab (or appends its open items to this tab's list).
- **Two tabs, one orphan.** Adopting or discarding takes a lock first: a folder created with `mkdir`, which only one of two racing tabs can create.
- **Windows no person is at.** With `LISTA_SESSAO_SEM_ORFAS` set, a window skips the question about orphans and keeps its own list. For windows another program opens and drives.
- **Only interactive sessions.** A `claude -p` run or any other non-interactive session leaves the lists alone.
- Every change is written to disk at once, atomically (a temp file, then a rename).

## What was tested

- macOS, with live sessions in tmux and in Orca tabs.
- `/clear` keeps the list; a new tab offers a closed tab's list; adopting and discarding it, from the chat.
- `claude -p` touches nothing in the lists folder.
- Two tabs racing for the same orphan: 0 double winners in 1000 runs, twice, on a real disk. This was measured with a harness that runs the same commands the plugin runs, not the plugin's TypeScript itself.
- A hard crash (`kill -9` of the owning `claude`): the next tab offered the list with both items.
- The pane's look, live in tmux, in English and Portuguese, including the rail continuing past wrapped text.
- Light terminal themes: covered by tests only.

## Not tested

- Windows: the code path is written but has never run on Windows.
- Pressing the pane's buttons with the mouse in a real session (covered by tests only).
- The `auto` theme: it is drawn with the dark colors.

## Uninstall

```
/plugin uninstall lista-da-sessao
```

Your lists stay until you delete the folder.

## Credits

Made by [felipevdc1](https://github.com/felipevdc1) · Instagram [@o.felipecarneiro](https://instagram.com/o.felipecarneiro) — built with his Glitch.

MIT license.
