// The two other programs the worker starts, besides the orca CLI: Claude Code without a screen
// (the judge that reviews a chat's work) and git (what changed in the chat's folder).
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { envGet, extraEnv, findOnWindowsPath, joinPath, type OrcaHost } from './cli.ts'

/** `shell`: one command line of yours (a card's check command), run by the system's shell. */
export type Tool = 'claude' | 'git' | 'shell'

export type ToolRun = {
  /** Folder the program runs in. */
  cwd: string
  /** Written to the program's standard input, which is then closed. */
  input?: string
  timeoutMs: number
}

/** `code` 0 is success. A program that fails may still have printed its answer (Claude Code does). */
export type ToolResult = { stdout: string; stderr: string; code: number }

export type ToolRunner = (tool: Tool, args: string[], run: ToolRun) => Promise<ToolResult>

function dirname(path: string): string {
  return path.replace(/[\\/]+[^\\/]*$/, '')
}

/** First `name` in the folders of PATH (not Windows: there `findOnWindowsPath` tries the extensions). */
function findOnPath(host: OrcaHost, name: string, exists: (path: string) => boolean): string | null {
  for (const dir of (envGet(host, 'PATH') ?? '').split(':').filter(Boolean)) {
    const path = joinPath(host, dir, name)
    if (exists(path)) return path
  }
  return null
}

/**
 * Where Claude Code's program is, or null. On Windows npm installs a `.cmd` wrapper, and a program
 * started through cmd.exe gets its line breaks flattened and its quotes re-read: a prompt and a
 * JSON schema do not survive that. The wrapper only starts `claude.exe` beside it, so that is used.
 */
export function claudeProgram(host: OrcaHost, exists: (path: string) => boolean): string | null {
  if (host.platform !== 'win32') {
    const home = envGet(host, 'HOME')
    const fixed = [...(home ? [joinPath(host, home, '.local', 'bin', 'claude')] : []), '/usr/local/bin/claude', '/opt/homebrew/bin/claude']
    return findOnPath(host, 'claude', exists) ?? fixed.find(exists) ?? null
  }
  const found = findOnWindowsPath(host, 'claude', exists)
  if (!found) return null
  if (/\.exe$/i.test(found)) return found
  const exe = joinPath(host, dirname(found), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  return exists(exe) ? exe : null
}

export function gitProgram(host: OrcaHost, exists: (path: string) => boolean): string | null {
  if (host.platform !== 'win32') return findOnPath(host, 'git', exists) ?? ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'].find(exists) ?? null
  const found = findOnWindowsPath(host, 'git', exists)
  return found && /\.exe$/i.test(found) ? found : null
}

/**
 * The environment a judge runs in: the worker's own, without what marks a process as an agent in
 * one of Orca's panes or as a child of another Claude Code session. A judge is neither, and with
 * those it would report its turns to Orca as that pane's.
 */
export function judgeEnv(host: OrcaHost): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(host.env)) {
    if (/^(ORCA_|CLAUDE_CODE_|CLAUDE_PLUGIN_|CLAUDECODE$|CLAUDE_EFFORT$|CLAUDE_PID$)/i.test(name)) continue
    env[name] = value
  }
  return { ...env, ...extraEnv({ ...host, env }) }
}

function currentHost(): OrcaHost {
  return { platform: process.platform, env: process.env, execPath: process.execPath, resourcesPath: process.resourcesPath }
}

const programs: Partial<Record<Tool, string | null>> = {}

const defaultRunner: ToolRunner = (tool, args, run) => {
  const host = currentHost()
  if (tool !== 'shell' && programs[tool] === undefined) programs[tool] = tool === 'claude' ? claudeProgram(host, existsSync) : gitProgram(host, existsSync)
  const windows = host.platform === 'win32'
  const comspec = envGet(host, 'ComSpec')
  const file = tool === 'shell' ? (windows ? comspec || 'cmd.exe' : '/bin/sh') : programs[tool]
  if (!file) return Promise.reject(new Error(`${tool} was not found on this machine`))
  // A command line goes to the shell as you wrote it: cmd.exe takes it verbatim after /c.
  if (tool === 'shell') args = windows ? ['/d', '/s', '/c', `"${args[0] ?? ''}"`] : ['-c', args[0] ?? '']
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        cwd: run.cwd,
        maxBuffer: 32 * 1024 * 1024,
        timeout: run.timeoutMs,
        windowsHide: true,
        windowsVerbatimArguments: tool === 'shell' && windows,
        env: tool === 'git' ? { ...process.env } : judgeEnv(host)
      },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout, stderr, code: 0 })
        // Killed by the timeout, or never started: there is no answer to read.
        if (typeof err.code !== 'number') return reject(new Error(`${tool}: ${err.message.split('\n')[0]}`))
        resolve({ stdout, stderr, code: err.code })
      }
    )
    // Always closed: a program that waits for input it will never get would sit until the timeout.
    child.stdin?.end(run.input ?? '')
  })
}

const readIfAny = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

let runner: ToolRunner = defaultRunner
let folderExists: (path: string) => boolean = existsSync
let fileReader: (path: string) => string | null = readIfAny

/**
 * Tests swap the programs for a fake, and with them the folders that count as being on this
 * machine and the files that can be read there.
 */
export function setToolRunner(next: ToolRunner | null, exists?: (path: string) => boolean, read?: (path: string) => string | null): void {
  runner = next ?? defaultRunner
  folderExists = next && exists ? exists : existsSync
  fileReader = next && read ? read : readIfAny
}

/** A text file's contents, or null when it is not there (or cannot be read). */
export function readTextFile(path: string): string | null {
  return fileReader(path)
}

/** Whether a chat's folder is on this machine (a workspace on a remote host is not). */
export function folderIsHere(path: string): boolean {
  return folderExists(path)
}

export function runTool(tool: Tool, args: string[], run: ToolRun): Promise<ToolResult> {
  return runner(tool, args, run)
}
