// Images attached in the reply box. The panel hands them over in pieces; on Send they are written
// to a folder of their own under the temp folder, and their paths are pasted into the chat's
// terminal, where Claude Code turns the path of an image file into an attached image.
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { envGet, joinPath, type OrcaHost } from './cli.ts'

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
/** Base64 characters of one image (about 12 MB of picture). */
const MAX_BASE64_CHARS = 16_000_000
const MAX_PENDING = 8
const PENDING_MS = 30 * 60_000
const KEEP_FILES_MS = 3 * 24 * 3600_000
const FOLDER = 'orca-chat-board'
const PREFIX = 'paste-'

type Pending = { type: string; parts: string[]; size: number; at: number }
const pending = new Map<string, Pending>()

export const isImageType = (type: unknown): type is string => typeof type === 'string' && type in EXTENSIONS

/** The temp folder; Orca starts plugin workers without TEMP, like without APPDATA. */
export function tempDir(host: OrcaHost): string | null {
  const set = envGet(host, 'TEMP') || envGet(host, 'TMP') || envGet(host, 'TMPDIR')
  if (set) return set
  if (host.platform !== 'win32') return '/tmp'
  const local = envGet(host, 'LOCALAPPDATA')
  const home = envGet(host, 'USERPROFILE')
  return local ? joinPath(host, local, 'Temp') : home ? joinPath(host, home, 'AppData', 'Local', 'Temp') : null
}

/** Pieces of one image when they are numbered (16 MB of base64 in pieces of a few kB would be fewer). */
const MAX_PIECES = 4096

/**
 * Takes a piece of an image (base64). Without `at` it is the next piece, in order. With `at`
 * (0, 1, 2…) it is that piece, whenever it arrives: pieces sent at the same time over a slow link
 * (a board shown from another machine sends each in a command of its own) come in any order.
 * Answers why not when it is refused.
 */
export function putAttachment(id: string, type: string, data: string, now: number, at?: number): 'ok' | 'type' | 'size' | 'count' {
  for (const [k, p] of pending) if (now - p.at > PENDING_MS) pending.delete(k)
  if (!isImageType(type) || !/^[\w-]{1,64}$/.test(id) || !/^[A-Za-z0-9+/=]*$/.test(data)) return 'type'
  if (at !== undefined && !(Number.isInteger(at) && at >= 0 && at < MAX_PIECES)) return 'type'
  let entry = pending.get(id)
  if (!entry) {
    if (pending.size >= MAX_PENDING) return 'count'
    entry = { type, parts: [], size: 0, at: now }
    pending.set(id, entry)
  }
  // A numbered piece sent twice replaces itself.
  const before = at === undefined ? 0 : (entry.parts[at]?.length ?? 0)
  if (entry.size - before + data.length > MAX_BASE64_CHARS) {
    pending.delete(id)
    return 'size'
  }
  if (at === undefined) entry.parts.push(data)
  else entry.parts[at] = data
  entry.size += data.length - before
  entry.at = now
  return 'ok'
}

export function dropAttachment(id: string): void {
  pending.delete(id)
}

/** Writes the image to a file and forgets it here; answers the file's path, or null when unknown. */
export function saveAttachment(id: string, host: OrcaHost, now: number): string | null {
  const entry = pending.get(id)
  const tmp = tempDir(host)
  if (!entry || !tmp) return null
  pending.delete(id)
  // A numbered piece that never came leaves a hole: the picture is not whole.
  for (let i = 0; i < entry.parts.length; i++) if (entry.parts[i] === undefined) return null
  const dir = joinPath(host, tmp, FOLDER)
  mkdirSync(dir, { recursive: true })
  sweep(host, dir, now)
  const path = joinPath(host, dir, `${PREFIX}${now}-${id.slice(0, 8)}.${EXTENSIONS[entry.type]}`)
  writeFileSync(path, Buffer.from(entry.parts.join(''), 'base64'))
  return path
}

/** Old pictures of ours go; the agent read them when they were sent. */
function sweep(host: OrcaHost, dir: string, now: number): void {
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(PREFIX)) continue
      const file = joinPath(host, dir, name)
      if (now - statSync(file).mtimeMs > KEEP_FILES_MS) unlinkSync(file)
    }
  } catch {
    // Housekeeping only.
  }
}
