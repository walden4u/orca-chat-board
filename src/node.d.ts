// The few Node APIs the worker uses, so `tsc` passes without @types/node.
declare module 'node:child_process' {
  export function execFile(
    file: string,
    args: readonly string[],
    options: {
      maxBuffer?: number
      timeout?: number
      env?: Record<string, string | undefined>
      windowsHide?: boolean
      windowsVerbatimArguments?: boolean
    },
    callback: (error: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => void
  ): unknown
}

declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function readFileSync(path: string, encoding: 'utf8'): string
}

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean })
    prepare(sql: string): { get(...params: unknown[]): Record<string, unknown> | undefined }
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
