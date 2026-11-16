// Reads the names of the workspace statuses from Orca's own profile database. Neither the CLI nor
// the plugin API tells them, so this looks at a file Orca owns: read-only, and anything unexpected
// (another Orca version, a locked file) means "unknown" and the board keeps the names it has.
import { readFileSync } from 'node:fs'
import { envGet, joinPath, type OrcaHost } from './cli.ts'
import type { Column } from './protocol.ts'

/** The folder Orca keeps its data in (Electron's `userData`). */
export function userDataDir(host: OrcaHost): string | null {
  const home = envGet(host, host.platform === 'win32' ? 'USERPROFILE' : 'HOME')
  if (host.platform === 'win32') {
    // Orca starts plugin workers without APPDATA.
    const appData = envGet(host, 'APPDATA') || (home ? joinPath(host, home, 'AppData', 'Roaming') : '')
    return appData ? joinPath(host, appData, 'orca') : null
  }
  if (host.platform === 'darwin') return home ? joinPath(host, home, 'Library', 'Application Support', 'orca') : null
  const config = envGet(host, 'XDG_CONFIG_HOME') || (home ? joinPath(host, home, '.config') : '')
  return config ? joinPath(host, config, 'orca') : null
}

/** The profile in use, from `orca-profile-index.json`. Profile ids become a folder name, so only plain ones pass. */
export function activeProfileOf(indexJson: string): string | null {
  try {
    const id = (JSON.parse(indexJson) as { activeProfileId?: unknown }).activeProfileId
    return typeof id === 'string' && /^[\w.-]+$/.test(id) && !/^\.+$/.test(id) ? id : null
  } catch {
    return null
  }
}

/** The statuses in the profile's `ui` document (`workspaceStatuses`), in Orca's board order. */
export function statusesOf(uiPayload: string): Column[] | null {
  let list: unknown
  try {
    list = (JSON.parse(uiPayload) as { workspaceStatuses?: unknown } | null)?.workspaceStatuses
  } catch {
    return null
  }
  if (!Array.isArray(list)) return null
  const out: Column[] = []
  for (const s of list as { id?: unknown; label?: unknown }[]) {
    if (typeof s?.id !== 'string' || !s.id || out.some((c) => c.id === s.id)) continue
    const title = typeof s.label === 'string' ? s.label.trim() : ''
    out.push({ id: s.id, title: title || s.id })
  }
  return out.length ? out : null
}

type StatusNamesReader = () => Promise<Column[]>

let reader: StatusNamesReader = readProfile

/** Tests swap the profile for a fake. */
export function setStatusNamesReader(next: StatusNamesReader | null): void {
  reader = next ?? readProfile
}

/** Orca's workspace statuses with their names. Throws with the reason when they cannot be read. */
export function readWorkspaceStatusNames(): Promise<Column[]> {
  return reader()
}

async function readProfile(): Promise<Column[]> {
  const host: OrcaHost = { platform: process.platform, env: process.env }
  const dir = userDataDir(host)
  if (!dir) throw new Error('Orca data folder not found')
  const profile = activeProfileOf(readFileSync(joinPath(host, dir, 'orca-profile-index.json'), 'utf8'))
  if (!profile) throw new Error('no active Orca profile')
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(joinPath(host, dir, 'profiles', profile, 'profile-state.db'), { readOnly: true })
  try {
    const row = db.prepare("SELECT payload FROM profile_state_documents WHERE domain = 'ui'").get()
    const statuses = typeof row?.payload === 'string' ? statusesOf(row.payload) : null
    if (!statuses) throw new Error('no workspace statuses in the Orca profile')
    return statuses
  } finally {
    db.close()
  }
}
