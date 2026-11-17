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
  ): {
    stdin?: { end(data?: string): void; write(data: string): boolean } | null
    stdout?: { on(event: 'data', listener: (chunk: string) => void): unknown } | null
  }
}

declare function btoa(data: string): string

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

declare var Buffer: {
  from(data: string, encoding: 'base64' | 'utf8'): Uint8Array
  concat(list: Uint8Array[]): Uint8Array & { toString(encoding: 'utf8'): string }
}

declare module 'node:crypto' {
  export function randomBytes(size: number): { toString(encoding: 'hex'): string }
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean
}

declare module 'node:os' {
  export function networkInterfaces(): Record<string, { address: string; family: string; internal: boolean }[] | undefined>
}

declare module 'node:http' {
  type Incoming = {
    method?: string
    url?: string
    headers: { authorization?: string }
    on(event: 'data', listener: (chunk: Uint8Array) => void): void
    on(event: 'end' | 'close', listener: () => void): void
    destroy(): void
  }
  type Outgoing = { writeHead(status: number, headers: Record<string, string>): void; write(text: string): void; end(body?: string): void }
  type Server = {
    close(): void
    closeAllConnections(): void
    listen(port: number, host: string): void
    on(event: 'error', listener: (err: Error & { code?: string }) => void): void
    on(event: 'listening', listener: () => void): void
    address(): { port: number }
    unref(): void
  }
  export function createServer(listener: (req: Incoming, res: Outgoing) => void): Server
}

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
