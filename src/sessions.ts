// Which Claude Code session runs in which Orca tab. Neither the CLI nor the plugin API tells it, so
// this looks at a file Orca owns: the database its agent hooks report to, read-only. Anything
// unexpected (another Orca version, a locked file) means "unknown": chats are then opened again
// with Claude's own list to pick from, as before.
import { joinPath, type OrcaHost } from './cli.ts'
import { userDataDir } from './profile.ts'

/** A session id as Claude Code writes it: it is typed into a terminal, so only plain ones pass. */
const SESSION_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

/** The Claude session of each tab, from the rows of the hook database (each a JSON document). */
export function sessionsOf(rows: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    let doc: { tabId?: unknown; source?: unknown; providerSession?: { key?: unknown; id?: unknown } | null } | null
    try {
      doc = JSON.parse(row) as typeof doc
    } catch {
      continue
    }
    const id = doc?.providerSession?.id
    if (typeof doc?.tabId !== 'string' || doc.source !== 'claude' || doc.providerSession?.key !== 'session_id') continue
    if (typeof id === 'string' && SESSION_ID.test(id)) out[doc.tabId] = id
  }
  return out
}

type SessionsReader = () => Promise<Record<string, string>>

let reader: SessionsReader = readHookDatabase

/** Tests swap Orca's database for a fake. */
export function setSessionsReader(next: SessionsReader | null): void {
  reader = next ?? readHookDatabase
}

/** Tab id → Claude session id, for the tabs Orca's hooks have heard from. Throws when it cannot be read. */
export function readClaudeSessions(): Promise<Record<string, string>> {
  return reader()
}

async function readHookDatabase(): Promise<Record<string, string>> {
  const host: OrcaHost = { platform: process.platform, env: process.env }
  const dir = userDataDir(host)
  if (!dir) throw new Error('Orca data folder not found')
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(joinPath(host, dir, 'agent-hooks', 'last-status.db'), { readOnly: true })
  try {
    // Oldest first, so the latest word about a tab wins.
    const rows = db.prepare('SELECT value FROM rows ORDER BY seq').all() as { value?: unknown }[]
    return sessionsOf(rows.map((r) => (typeof r.value === 'string' ? r.value : '')))
  } finally {
    db.close()
  }
}
