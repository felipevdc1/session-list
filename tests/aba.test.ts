// aba.ts against a fake host. `claude plugin test` refuses a call on `$` that
// the calling module's own source does not spell (a test hook's `$.env.get`
// is refused), so aba.ts is handed a fake `$` holding only the nouns it uses:
// env from a record, process.run answered from a table keyed by the argv
// joined with spaces, session.id fixed. The answers follow what this Mac
// printed on 2026-10-21 (`ps -o lstart=` pads with spaces, a missing pid
// exits 1 with nothing on stdout).

import { describe, expect, test } from 'claude-code/testing'

import { type Aba, chaveDaAba, estaVivo, meuProcesso } from '../hooks/aba'

type Ran = { exitCode: number; stdout: string }
type Init = { env?: Record<string, string> }

function fakeHost(
  vars: Record<string, string>,
  answer: (argv: readonly string[], init?: Init) => Ran | undefined = () => undefined,
) {
  const argvs: string[][] = []
  const envRead: string[] = []
  const $ = {
    env: {
      get: async (name: string) => { envRead.push(name); return vars[name] },
    },
    process: {
      run: async (argv: readonly string[], init?: Init) => {
        argvs.push([...argv])
        const ran = answer(argv, init) ?? { exitCode: 127, stdout: '' }
        return { stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...ran }
      },
    },
    session: { id: async () => 'abc123' },
  } as unknown as Aba

  return { $, argvs, envRead }
}

// `ps -o lstart=` prints in the caller's locale, so the fake answers it only
// when asked under LC_ALL=C (measured 2026-10-22: pt_BR vs en_US tabs differ).
function table(rows: Record<string, Ran>) {
  return (argv: readonly string[], init?: Init) => {
    if (argv.join(' ').startsWith('ps -o lstart=') && init?.env?.LC_ALL !== 'C') return undefined

    return rows[argv.join(' ')]
  }
}

const POSIX = { HOME: '/Users/x' }

describe('chaveDaAba', () => {
  const casos: [string, Record<string, string>, string][] = [
    ['a tmux pane wins over everything, keyed by its server socket', { TMUX: '/tmp/tmux-501/default,123,0', TMUX_PANE: '%1', ORCA_PANE_KEY: 't1:p1', ITERM_SESSION_ID: 'i', TERM_SESSION_ID: 'i', WT_SESSION: 'w' }, 'tmux:/tmp/tmux-501/default:%1'],
    ['the same pane number on another tmux server is another key', { TMUX: '/tmp/tmux-501/outro,456,0', TMUX_PANE: '%1' }, 'tmux:/tmp/tmux-501/outro:%1'],
    ['TMUX_PANE without TMUX still keys by pane', { TMUX_PANE: '%3' }, 'tmux::%3'],
    ['the Orca pane wins over the rest', { ORCA_PANE_KEY: 't1:p1', ORCA_TAB_ID: 't1', ITERM_SESSION_ID: 'i', TERM_SESSION_ID: 'i', WT_SESSION: 'w' }, 'orca:t1:p1'],
    ['iTerm before TERM_SESSION_ID', { ITERM_SESSION_ID: 'w0t1p0:U', TERM_SESSION_ID: 'w0t1p0:U', WT_SESSION: 'w' }, 'iterm:w0t1p0:U'],
    ['TERM_SESSION_ID before WT_SESSION', { TERM_SESSION_ID: 'T', WT_SESSION: 'w' }, 'term:T'],
    ['WT_SESSION alone', { WT_SESSION: 'W' }, 'wt:W'],
    ['ORCA_TAB_ID and ORCA_TERMINAL_HANDLE alone are not a tab key', { ORCA_TAB_ID: 't1', ORCA_TERMINAL_HANDLE: 'h' }, 'sessao:abc123'],
    ['an empty variable counts as unset', { ORCA_PANE_KEY: '', ITERM_SESSION_ID: '' }, 'sessao:abc123'],
    ['nothing set falls back to the session id', {}, 'sessao:abc123'],
  ]
  for (const [nome, vars, esperada] of casos) {
    test(nome, async () => {
      const { $, argvs, envRead } = fakeHost({ ...POSIX, ...vars })
      expect(await chaveDaAba($)).toBe(esperada)
      expect(argvs.length).toBe(0)
      expect(envRead.some(n => n.startsWith('ORCA_AGENT_HOOK'))).toBe(false)
    })
  }
})

describe('meuProcesso', () => {
  test('the direct parent of sh is claude', async () => {
    const { $ } = fakeHost(POSIX, table({
      'sh -c echo $PPID': { exitCode: 0, stdout: '4242\n' },
      'ps -o ppid=,comm= -p 4242': { exitCode: 0, stdout: ' 100 claude\n' },
      'ps -o lstart= -p 4242': { exitCode: 0, stdout: 'Wed Oct 21 09:27:20 2026    \n' },
    }))
    expect(await meuProcesso($)).toEqual({ pid: 4242, inicio: 'Wed Oct 21 09:27:20 2026' })
  })

  test('walks up past an intermediary until comm is claude', async () => {
    const { $ } = fakeHost(POSIX, table({
      'sh -c echo $PPID': { exitCode: 0, stdout: '500\n' },
      'ps -o ppid=,comm= -p 500': { exitCode: 0, stdout: '400 node\n' },
      'ps -o ppid=,comm= -p 400': { exitCode: 0, stdout: '1 /Users/x/.local/bin/claude\n' },
      'ps -o lstart= -p 400': { exitCode: 0, stdout: 'Tue Oct 20 08:00:00 2026\n' },
    }))
    expect(await meuProcesso($)).toEqual({ pid: 400, inicio: 'Tue Oct 20 08:00:00 2026' })
  })

  test('no claude above keeps the direct parent', async () => {
    const { $ } = fakeHost(POSIX, table({
      'sh -c echo $PPID': { exitCode: 0, stdout: '500\n' },
      'ps -o ppid=,comm= -p 500': { exitCode: 0, stdout: '1 node\n' },
      'ps -o lstart= -p 500': { exitCode: 0, stdout: 'Tue Oct 20 08:00:00 2026\n' },
    }))
    expect(await meuProcesso($)).toEqual({ pid: 500, inicio: 'Tue Oct 20 08:00:00 2026' })
  })

  test('asks ps under LC_ALL=C', async () => {
    const { $ } = fakeHost(POSIX, (argv, init) => {
      const k = argv.join(' ')
      if (k === 'sh -c echo $PPID') return { exitCode: 0, stdout: '4242\n' }
      if (k === 'ps -o ppid=,comm= -p 4242') return { exitCode: 0, stdout: '1 claude\n' }
      if (k === 'ps -o lstart= -p 4242') {
        return init?.env?.LC_ALL === 'C'
          ? { exitCode: 0, stdout: 'Thu Oct 22 14:47:12 2026\n' }
          : { exitCode: 0, stdout: 'qui 22 out 14:47:12 2026\n' }
      }
      return undefined
    })
    expect(await meuProcesso($)).toEqual({ pid: 4242, inicio: 'Thu Oct 22 14:47:12 2026' })
  })

  test('throws when the start time cannot be read', async () => {
    const { $ } = fakeHost(POSIX, table({
      'sh -c echo $PPID': { exitCode: 0, stdout: '4242\n' },
      'ps -o ppid=,comm= -p 4242': { exitCode: 0, stdout: '1 claude\n' },
    }))
    await expect(meuProcesso($)).rejects.toThrow('4242')
  })

  test('Windows reads the parent of powershell through Win32_Process', async () => {
    const { $, argvs } = fakeHost({ OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\x' }, (argv, init) => {
      const script = argv[argv.length - 1] ?? ''
      if (script.includes('ParentProcessId')) return { exitCode: 0, stdout: '777\r\n' }
      if (script.includes('CreationDate') && init?.env?.LDS_PID === '777') {
        return { exitCode: 0, stdout: '2026-10-21T09:00:00.0000000-03:00\r\n' }
      }
      return undefined
    })
    expect(await meuProcesso($)).toEqual({ pid: 777, inicio: '2026-10-21T09:00:00.0000000-03:00' })
    expect(argvs.map(argv => argv[0])).toEqual(['powershell', 'powershell'])
    // The pid reaches PowerShell as env, never in the script text.
    expect(argvs.some(argv => argv.join(' ').includes('777'))).toBe(false)
  })
})

describe('estaVivo', () => {
  const dono = { pid: 4242, inicio: 'Wed Oct 21 09:27:20 2026' }

  test('alive when the pid runs and started at the recorded time', async () => {
    const { $ } = fakeHost(POSIX, table({ 'ps -o lstart= -p 4242': { exitCode: 0, stdout: 'Wed Oct 21 09:27:20 2026  \n' } }))
    expect(await estaVivo($, dono)).toBe(true)
  })

  test('dead when the pid was reused (start time differs)', async () => {
    const { $ } = fakeHost(POSIX, table({ 'ps -o lstart= -p 4242': { exitCode: 0, stdout: 'Thu Oct 22 07:00:01 2026\n' } }))
    expect(await estaVivo($, dono)).toBe(false)
  })

  test('dead when no process has the pid', async () => {
    const { $ } = fakeHost(POSIX, table({ 'ps -o lstart= -p 4242': { exitCode: 1, stdout: '' } }))
    expect(await estaVivo($, dono)).toBe(false)
  })

  test('dead without asking the host when the recorded pid is not a pid', async () => {
    const { $, argvs } = fakeHost(POSIX)
    expect(await estaVivo($, { pid: 0, inicio: 'x' })).toBe(false)
    expect(await estaVivo($, { pid: Number.NaN, inicio: 'x' })).toBe(false)
    expect(argvs.length).toBe(0)
  })

  test('a start time stored in the pt_BR locale reads alive while the pid runs', async () => {
    const { $ } = fakeHost(POSIX, table({ 'ps -o lstart= -p 4242': { exitCode: 0, stdout: 'Thu Oct 22 14:47:12 2026\n' } }))
    expect(await estaVivo($, { pid: 4242, inicio: 'qui 22 out 14:47:12 2026' })).toBe(true)
  })

  test('a start time stored in the pt_BR locale reads dead when no process has the pid', async () => {
    const { $ } = fakeHost(POSIX, table({ 'ps -o lstart= -p 4242': { exitCode: 1, stdout: '' } }))
    expect(await estaVivo($, { pid: 4242, inicio: 'qui 22 out 14:47:12 2026' })).toBe(false)
  })

  test('a C-format stored time still reads a reused pid as dead', async () => {
    const { $ } = fakeHost(POSIX, table({ 'ps -o lstart= -p 4242': { exitCode: 0, stdout: 'Fri Oct 23 08:00:00 2026\n' } }))
    expect(await estaVivo($, { pid: 4242, inicio: 'Thu Oct 22 14:47:12 2026' })).toBe(false)
  })

  test('Windows compares the same CreationDate format', async () => {
    const { $ } = fakeHost({ OS: 'Windows_NT' }, (_argv, init) =>
      init?.env?.LDS_PID === '9' ? { exitCode: 0, stdout: '2026-10-21T09:00:00.0000000-03:00\r\n' } : undefined)
    expect(await estaVivo($, { pid: 9, inicio: '2026-10-21T09:00:00.0000000-03:00' })).toBe(true)
    expect(await estaVivo($, { pid: 9, inicio: '2026-10-20T09:00:00.0000000-03:00' })).toBe(false)
  })
})
