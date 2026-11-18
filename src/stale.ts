// Orca drives its browser tabs through a helper (agent-browser) that keeps one session per tab:
// a background process and a few files in %USERPROFILE%\.agent-browser. The process outlives Orca,
// so after Orca starts again the session is a stale one, and Orca first has it closed. On a
// machine whose own agent-browser settings (.agent-browser\config.json) say to show a browser
// with a profile, closing it starts that browser instead, takes more than the 3 s Orca gives it,
// and fails: "Could not reset stale helper session orca-tab-…; retry after agent-browser exits".
// Then nothing can be shown in that tab, and a Chrome window opens and closes at each try
// (seen on b9-pc, 2026-11-18). Ending the session's process and removing its files lets Orca
// start a new one, as doing it by hand did.
import { execFile } from 'node:child_process'
import { readdirSync, readFileSync, unlinkSync } from 'node:fs'

/** The session named in Orca's complaint about a stale one; null for any other trouble. */
export function staleSessionOf(message: string): string | null {
  return /stale helper session (orca-tab-[0-9a-f-]+)/i.exec(message)?.[1] ?? null
}

const run = (file: string, args: string[]): Promise<string> =>
  new Promise((done) => execFile(file, args, { timeout: 10_000, windowsHide: true }, (_err, stdout) => done(String(stdout ?? ''))))

/**
 * Ends the helper process of session `name` and removes its files. The process is ended only when
 * the number in its file is an agent-browser process still (numbers are used again). Answers what
 * was done, for the log.
 */
export async function clearStaleSession(name: string, home = process.env.USERPROFILE ?? ''): Promise<string> {
  if (!/^orca-tab-[0-9a-f-]+$/i.test(name) || !home) return 'nothing (no session or no home folder)'
  const dir = `${home}\\.agent-browser`
  const did: string[] = []
  let pid = ''
  try {
    pid = readFileSync(`${dir}\\${name}.pid`, 'utf8').trim()
  } catch {
    // No process written down.
  }
  if (/^\d+$/.test(pid)) {
    const listed = await run('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
    if (/^"agent-browser/i.test(listed.trim())) {
      await run('taskkill.exe', ['/PID', pid, '/F'])
      did.push(`ended process ${pid}`)
    }
  }
  let removed = 0
  try {
    for (const file of readdirSync(dir)) {
      if (!file.startsWith(`${name}.`)) continue
      try {
        unlinkSync(`${dir}\\${file}`)
        removed++
      } catch {
        // Held open by a process still ending: the rest goes.
      }
    }
  } catch {
    // No such folder.
  }
  did.push(`removed ${removed} file(s)`)
  return did.join(', ')
}
