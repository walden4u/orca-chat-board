// The few Node APIs the worker uses, so `tsc` passes without @types/node.
declare module 'node:child_process' {
  export function execFile(
    file: string,
    args: readonly string[],
    options: {
      cwd?: string
      maxBuffer?: number
      timeout?: number
      env?: Record<string, string | undefined>
      windowsHide?: boolean
      windowsVerbatimArguments?: boolean
    },
    callback: (error: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => void
  ): { stdin?: { end(data?: string): void } | null }
}

declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readFileSync(path: string): Uint8Array
  export function writeFileSync(path: string, data: Uint8Array): void
  export function mkdirSync(path: string, options: { recursive: true }): unknown
  export function readdirSync(path: string): string[]
  export function statSync(path: string): { mtimeMs: number }
  export function unlinkSync(path: string): void
}

declare var Buffer: { from(data: string, encoding: 'base64'): Uint8Array }

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean })
    prepare(sql: string): { get(...params: unknown[]): Record<string, unknown> | undefined; all(...params: unknown[]): Record<string, unknown>[] }
    close(): void
  }
}

declare var process: {
  readonly platform: string
  readonly env: Record<string, string | undefined>
  readonly execPath?: string
  /** Set by Electron, also when it runs as Node (the plugin worker does). */
  readonly resourcesPath?: string
}
