// What a chat's Claude Code offers after "/" besides its built-in commands: your own commands and
// skills, and those of the plugins you turned on. Claude Code has no way to ask it for that list,
// so its folders are read as it reads them. Only when asked: the first time, and when you refresh
// the list in a reply box. What was read is kept by the worker, so nothing is read while you type.
import { readdir, readFile } from 'node:fs/promises'
import { envGet, joinPath, type OrcaHost } from './cli.ts'
import type { SlashCommand } from './protocol.ts'

/** The folders and files as this module reads them; `null` for what is not there (or cannot be read). */
export type SlashDisk = {
  list: (dir: string) => Promise<string[] | null>
  read: (path: string) => Promise<string | null>
}

const realDisk: SlashDisk = {
  list: (dir) => readdir(dir).catch(() => null),
  read: (path) => readFile(path, 'utf8').catch(() => null)
}

let disk: SlashDisk = realDisk

/** Tests swap Claude's folders for made-up ones. */
export function setSlashDisk(next: SlashDisk | null): void {
  disk = next ?? realDisk
}

/** How long a description is kept: one line of the list shows less than this anyway. */
const ABOUT_CHARS = 160
/** A name that can be typed after "/" and sent to a terminal as it is. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
/** How far up from a chat's folder its project's `.claude` is looked for. */
const MAX_PARENTS = 10

/**
 * The fields at the top of a command or skill file (between two `---` lines) and the text after
 * them. Only what is needed here is understood: `key: value`, a value in quotes, and a value that
 * goes on over indented lines (plain, `>` or `|`), which becomes one line.
 */
export function frontMatter(text: string): { fields: Record<string, string>; body: string } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const fields: Record<string, string> = {}
  if (lines[0]?.trim() !== '---') return { fields, body: lines.join('\n') }
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (end < 0) return { fields, body: lines.join('\n') }
  let key = ''
  for (const line of lines.slice(1, end)) {
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (field) {
      key = field[1]!.toLowerCase()
      const value = field[2]!.trim()
      fields[key] = /^[>|][+-]?$/.test(value) ? '' : value.replace(/^(["'])(.*)\1$/, '$2')
    } else if (key && /^\s+\S/.test(line)) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim()
    }
  }
  return { fields, body: lines.slice(end + 1).join('\n') }
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, ABOUT_CHARS)

/** What a command or skill file says it is for: its description, or else its first line of text. */
function aboutOf(text: string): { about: string; hint: string; hidden: boolean; name: string } {
  const { fields, body } = frontMatter(text)
  const first = body.split('\n').find((line) => line.trim()) ?? ''
  return {
    about: oneLine(fields['description'] || first.replace(/^#+\s*/, '')),
    hint: oneLine(fields['argument-hint'] ?? '').slice(0, 60),
    // A skill only Claude may call is not in the list you pick from.
    hidden: /^false$/i.test(fields['user-invocable'] ?? ''),
    name: fields['name'] ?? ''
  }
}

type From = SlashCommand['from']

/** The command files of a folder: each `name.md` is `/name`, also one folder down (the folder only sorts them). */
async function commandsIn(host: OrcaHost, dir: string, from: From, prefix: string): Promise<SlashCommand[]> {
  const out: SlashCommand[] = []
  const add = async (folder: string, entry: string): Promise<void> => {
    const name = entry.replace(/\.md$/i, '')
    if (!NAME.test(name) || name.startsWith('_')) return
    const text = await disk.read(joinPath(host, folder, entry))
    if (text === null) return
    const { about, hint } = aboutOf(text)
    out.push({ name: prefix + name, about, from, ...(hint ? { hint } : {}) })
  }
  for (const entry of (await disk.list(dir)) ?? []) {
    if (/\.md$/i.test(entry)) await add(dir, entry)
    else if (NAME.test(entry)) {
      const inner = joinPath(host, dir, entry)
      for (const file of (await disk.list(inner)) ?? []) if (/\.md$/i.test(file)) await add(inner, file)
    }
  }
  return out
}

/** The skills of a folder: each `name/SKILL.md` is `/name` (or the name the file gives itself). */
async function skillsIn(host: OrcaHost, dir: string, from: From, prefix: string): Promise<SlashCommand[]> {
  const out: SlashCommand[] = []
  for (const entry of (await disk.list(dir)) ?? []) {
    if (!NAME.test(entry)) continue
    const text = await disk.read(joinPath(host, dir, entry, 'SKILL.md'))
    if (text === null) continue
    const { about, hint, hidden, name } = aboutOf(text)
    if (hidden) continue
    out.push({ name: prefix + (NAME.test(name) ? name : entry), about, from, ...(hint ? { hint } : {}) })
  }
  return out
}

function parse(text: string | null): Record<string, unknown> | null {
  if (text === null) return null
  try {
    const doc = JSON.parse(text.replace(/^﻿/, '')) as unknown
    return doc && typeof doc === 'object' ? (doc as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The plugins a settings file turns on (`enabledPlugins`, by `name@marketplace`). */
async function turnedOn(path: string): Promise<Set<string>> {
  const on = parse(await disk.read(path))?.['enabledPlugins']
  return new Set(on && typeof on === 'object' ? Object.entries(on as Record<string, unknown>).filter(([, v]) => v === true).map(([k]) => k) : [])
}

type Installed = { id: string; scope: string; projectPath: string; installPath: string }

/** Every plugin Claude Code has installed, for whom and where (its own record of them). */
async function installedPlugins(host: OrcaHost, claudeDir: string): Promise<Installed[]> {
  const plugins = parse(await disk.read(joinPath(host, claudeDir, 'plugins', 'installed_plugins.json')))?.['plugins']
  if (!plugins || typeof plugins !== 'object') return []
  const out: Installed[] = []
  for (const [id, installs] of Object.entries(plugins as Record<string, unknown>)) {
    for (const one of Array.isArray(installs) ? (installs as Record<string, unknown>[]) : []) {
      if (typeof one?.['installPath'] !== 'string') continue
      out.push({ id, scope: String(one['scope'] ?? 'user'), projectPath: typeof one['projectPath'] === 'string' ? one['projectPath'] : '', installPath: one['installPath'] })
    }
  }
  return out
}

/** A plugin's commands and skills, each named `plugin:name`. */
async function pluginCommands(host: OrcaHost, plugin: Installed): Promise<SlashCommand[]> {
  const manifest = parse(await disk.read(joinPath(host, plugin.installPath, '.claude-plugin', 'plugin.json')))
  const named = typeof manifest?.['name'] === 'string' ? (manifest['name'] as string) : ''
  const prefix = `${NAME.test(named) ? named : plugin.id.split('@')[0]}:`
  const out: SlashCommand[] = []
  const listed = manifest?.['commands']
  if (Array.isArray(listed)) {
    // The plugin names its command files itself: only those count.
    for (const file of listed) {
      const name = typeof file === 'string' ? (/([^\\/]+)\.md$/i.exec(file)?.[1] ?? '') : ''
      const text = NAME.test(name) ? await disk.read(joinPath(host, plugin.installPath, ...String(file).split(/[\\/]/).filter((p) => p && p !== '.' && p !== '..'))) : null
      if (text === null) continue
      const { about, hint } = aboutOf(text)
      out.push({ name: prefix + name, about, from: 'plugin', ...(hint ? { hint } : {}) })
    }
  } else out.push(...(await commandsIn(host, joinPath(host, plugin.installPath, 'commands'), 'plugin', prefix)))
  out.push(...(await skillsIn(host, joinPath(host, plugin.installPath, 'skills'), 'plugin', prefix)))
  return out
}

/** Claude Code's own folder (`~/.claude`), or null when the worker cannot tell where home is. */
export function claudeDir(host: OrcaHost): string | null {
  const set = envGet(host, 'CLAUDE_CONFIG_DIR')
  if (set) return set
  const home = envGet(host, host.platform === 'win32' ? 'USERPROFILE' : 'HOME')
  return home ? joinPath(host, home, '.claude') : null
}

const same = (host: OrcaHost, a: string, b: string): boolean => {
  const flat = (p: string) => (host.platform === 'win32' ? p.replace(/\//g, '\\').toLowerCase() : p).replace(/[\\/]+$/, '')
  return flat(a) === flat(b)
}

const parentOf = (path: string): string => path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '')

/** Later ones with a name already taken are left out: the first place a name is found wins, as the list shows one. */
export function unique(commands: SlashCommand[]): SlashCommand[] {
  const seen = new Set<string>()
  return commands.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)))
}

/** Yours in every chat: `~/.claude/commands`, `~/.claude/skills`, and the plugins turned on for you. */
export async function readUserCommands(host: OrcaHost): Promise<SlashCommand[]> {
  const dir = claudeDir(host)
  if (!dir) return []
  const out = [...(await commandsIn(host, joinPath(host, dir, 'commands'), 'user', '')), ...(await skillsIn(host, joinPath(host, dir, 'skills'), 'user', ''))]
  // The skills of your Claude account, which Claude Code keeps a copy of: `anthropic-skills:name`.
  const synced = joinPath(host, dir, 'skills', 'synced')
  for (const account of (await disk.list(synced)) ?? []) out.push(...(await skillsIn(host, joinPath(host, synced, account), 'user', 'anthropic-skills:')))
  const on = await turnedOn(joinPath(host, dir, 'settings.json'))
  for (const plugin of await installedPlugins(host, dir)) if (plugin.scope === 'user' && on.has(plugin.id)) out.push(...(await pluginCommands(host, plugin)))
  return unique(out)
}

/**
 * A chat's own: the `.claude` of its folder and of the folders above it, up to the one that holds
 * the repository (`.git`), and the plugins installed for that project and turned on there.
 */
export async function readFolderCommands(host: OrcaHost, folder: string): Promise<SlashCommand[]> {
  const home = claudeDir(host)
  const out: SlashCommand[] = []
  const above: string[] = []
  for (let dir = folder, n = 0; dir && n < MAX_PARENTS; n++) {
    above.push(dir)
    // The `.claude` of your home folder is yours in every chat: read with those, not here.
    if (!home || !same(host, joinPath(host, dir, '.claude'), home)) {
      out.push(...(await commandsIn(host, joinPath(host, dir, '.claude', 'commands'), 'project', '')))
      out.push(...(await skillsIn(host, joinPath(host, dir, '.claude', 'skills'), 'project', '')))
    }
    // A repository's top holds `.git`: a folder, or in a worktree a file.
    if ((await disk.read(joinPath(host, dir, '.git'))) !== null || (await disk.read(joinPath(host, dir, '.git', 'HEAD'))) !== null) break
    const up = parentOf(dir)
    if (up === dir || !/[\\/]/.test(up)) break
    dir = up
  }
  if (home) {
    for (const plugin of await installedPlugins(host, home)) {
      if (plugin.scope === 'user' || !plugin.projectPath || !above.some((dir) => same(host, dir, plugin.projectPath))) continue
      const on = new Set([
        ...(await turnedOn(joinPath(host, plugin.projectPath, '.claude', 'settings.json'))),
        ...(await turnedOn(joinPath(host, plugin.projectPath, '.claude', 'settings.local.json')))
      ])
      if (on.has(plugin.id)) out.push(...(await pluginCommands(host, plugin)))
    }
  }
  return unique(out)
}

/** What the worker keeps: yours in every chat, and each chat folder's own, as last read. */
export type StoredSlash = { at: number; user: SlashCommand[]; folders: Record<string, SlashCommand[]> }

/** A folder as the stored lists name it. */
export function folderKey(host: OrcaHost, folder: string): string {
  return (host.platform === 'win32' ? folder.replace(/\//g, '\\').toLowerCase() : folder).replace(/[\\/]+$/, '')
}

export function normalizeSlash(value: unknown): StoredSlash | null {
  const v = value as Partial<StoredSlash> | null
  if (!v || typeof v !== 'object' || typeof v.at !== 'number' || !Array.isArray(v.user) || !v.folders || typeof v.folders !== 'object') return null
  return v as StoredSlash
}
