// Mouse clicks made for you, so that the reply box gets the keyboard.
//
// Orca gives a plugin panel the keyboard only when you click in it. When the board shows a chat's
// tab, Orca hands the keys to that terminal, and a reply box cannot ask for them back; a box that
// opens by itself while the keys are in a terminal cannot ask for them either. So the worker has
// Windows press the mouse button: where the pointer already is when that is over the box, and
// otherwise at the spot of your last click in the panel, with the pointer put back afterwards.
import { execFile } from 'node:child_process'

/**
 * `warm`: get ready. `mark`: remember where the pointer is now (you just clicked in the panel).
 * `click`: press the button in place. `click-idle`: the same, once you are not typing.
 * `move`: once you are not typing, put the pointer on the marked spot. `move-now`: the same at
 * once (you asked for it with a shortcut). `restore`: put it back.
 * `cancel`: give up a wait that is still going on.
 * `mark-chat`: remember where the pointer is now (you just clicked in the chat screen's terminal).
 * `to-chat`: click that spot at once and put the pointer back (Alt+K on the board: the keys to the
 * chat screen, which Orca does not hand them to when it is on screen already).
 */
export type KeysOp = 'warm' | 'mark' | 'click' | 'click-idle' | 'move' | 'move-now' | 'restore' | 'cancel' | 'mark-chat' | 'to-chat'

/** Does one of those; false when it did not (Orca not in front, nothing marked, not Windows, given up). */
export type Clicker = (op: KeysOp) => Promise<boolean>

// One PowerShell kept waiting, so each step takes milliseconds and not the second it takes to
// start one. It ends with the worker (its input closes). It acts only while the window in front
// belongs to Orca. One line in, one line out:
//   q  -> "<ms since your last key or mouse move> <1 when Orca is in front> <the program in front>"
//   k  -> "ok <x> <y>": where the pointer is      u -> "under <the program under the pointer>"
//   c  -> presses the left button in place, when the window under the pointer is Orca's too
//         (else "pointer-over <program>")
//   m <x> <y> -> remembers where the pointer is and puts it there
//   r  -> puts it back where `m` found it
const HELPER = `
Add-Type -Namespace W -Name M -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct Point { public int x; public int y; }
[StructLayout(LayoutKind.Sequential)] public struct LastInput { public uint size; public uint time; }
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, System.UIntPtr e);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);
[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LastInput i);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern System.IntPtr WindowFromPoint(Point p);
[DllImport("user32.dll")] public static extern System.IntPtr GetAncestor(System.IntPtr h, uint flags);
public static uint IdleMs() { LastInput i = new LastInput(); i.size = 8; GetLastInputInfo(ref i); return (uint)Environment.TickCount - i.time; }
'@
function FrontName {
  $p = 0
  [void][W.M]::GetWindowThreadProcessId([W.M]::GetForegroundWindow(), [ref]$p)
  return [string](Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName
}
function Front { return ((FrontName) -like 'Orca*') }
# The program whose window is under the pointer: with two screens, Orca can be in front while the
# pointer is over another program's window, and a click there would be that program's.
function UnderName {
  $pt = New-Object W.M+Point
  if (-not [W.M]::GetCursorPos([ref]$pt)) { return '' }
  $p = 0
  [void][W.M]::GetWindowThreadProcessId([W.M]::GetAncestor([W.M]::WindowFromPoint($pt), 2), [ref]$p)
  return [string](Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName
}
$back = $null
[Console]::Out.WriteLine('ready')
while (($l = [Console]::In.ReadLine()) -ne $null) {
  $out = 'no'
  if ($l -eq 'q') {
    $n = FrontName
    $out = ('{0} {1} {2}' -f [W.M]::IdleMs(), [int]($n -like 'Orca*'), ($n -replace ' ', '_'))
  } elseif ($l -eq 'k') {
    $p = New-Object W.M+Point
    if ([W.M]::GetCursorPos([ref]$p)) { $out = ('ok {0} {1}' -f $p.x, $p.y) }
  } elseif ($l -eq 'u') {
    $out = ('under {0}' -f ((UnderName) -replace ' ', '_'))
  } elseif ($l -eq 'c') {
    if (Front) {
      $u = UnderName
      if ($u -like 'Orca*') {
        [W.M]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
        [W.M]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
        $out = 'ok'
      } else {
        $out = ('pointer-over {0}' -f ($u -replace ' ', '_'))
      }
    }
  } elseif ($l -like 'm *') {
    $to = $l.Split(' ')
    $p = New-Object W.M+Point
    if ((Front) -and [W.M]::GetCursorPos([ref]$p)) {
      $back = $p
      if ([W.M]::SetCursorPos([int]$to[1], [int]$to[2])) { $out = 'ok' }
    }
  } elseif ($l -eq 'r') {
    if ($back -ne $null) {
      [void][W.M]::SetCursorPos($back.x, $back.y)
      $back = $null
      $out = 'ok'
    }
  }
  [Console]::Out.WriteLine($out)
}
`

/** PowerShell takes a script as base64 of UTF-16LE: no quoting to survive on the way. */
function encoded(script: string): string {
  let wide = ''
  for (const ch of script) wide += ch + '\0'
  return btoa(wide)
}

type Helper = { write(line: string): boolean; waiting: ((line: string) => void)[] }
let helper: Helper | null = null

function startHelper(): Helper | null {
  if (helper) return helper
  if (process.platform !== 'win32') return null
  const waiting: ((line: string) => void)[] = []
  const child = execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded(HELPER)],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    () => {
      // It ended: nobody is left waiting for an answer.
      for (const answer of waiting.splice(0)) answer('no')
      helper = null
    }
  )
  if (!child.stdin || !child.stdout) return null
  const stdin = child.stdin
  let pending = ''
  child.stdout.on('data', (chunk) => {
    pending += String(chunk)
    for (let at = pending.indexOf('\n'); at >= 0; at = pending.indexOf('\n')) {
      const line = pending.slice(0, at).trim()
      pending = pending.slice(at + 1)
      if (line !== 'ready') waiting.shift()?.(line)
    }
  })
  helper = { write: (line) => stdin.write(line), waiting }
  return helper
}

/** One line to the helper, its one line back ('no' when there is no helper, or it does not answer). */
function ask(command: string): Promise<string> {
  const h = startHelper()
  if (!h) return Promise.resolve('no')
  return new Promise((resolve) => {
    let done = false
    const answer = (line: string) => {
      if (done) return
      done = true
      resolve(line)
    }
    h.waiting.push(answer)
    // Its first start takes a second or two; one that says nothing for longer is not waited for.
    setTimeout(() => answer('no'), 6000)
    try {
      h.write(`${command}\n`)
    } catch {
      helper = null
      answer('no')
    }
  })
}

const STILL_MS = 1500
/** How long the box has, once you are back in Orca, to call the mouse off (see `untilStill`). */
const BACK_GRACE_MS = 400
/** A click in place is for a box that just opened: not worth making long after. */
const GIVE_UP_MS = 8000
/**
 * Bringing the pointer waits for you to come back to Orca, which may take long. A panel's request
 * must be answered within 30 s, so one wait is shorter than that and the box asks again.
 */
const GIVE_UP_MOVE_MS = 20_000
/** Whether Orca was in front when last looked, kept from one wait to the next. */
let wasFront: boolean | null = null
let waits = 0
/** Where you last clicked in the panel, in the helper's screen coordinates. The worker keeps it across its restarts. */
let spot: { x: number; y: number } | null = null
export function markedSpot(): { x: number; y: number } | null {
  return spot
}
export function setMarkedSpot(next: unknown): void {
  const s = next as { x?: unknown; y?: unknown } | null
  spot = s && typeof s.x === 'number' && typeof s.y === 'number' ? { x: s.x, y: s.y } : null
}
/** Where you last clicked in the chat screen's terminal (the browser tab), the same way. */
let chatSpot: { x: number; y: number } | null = null
export function markedChatSpot(): { x: number; y: number } | null {
  return chatSpot
}
export function setMarkedChatSpot(next: unknown): void {
  const s = next as { x?: unknown; y?: unknown } | null
  chatSpot = s && typeof s.x === 'number' && typeof s.y === 'number' ? { x: s.x, y: s.y } : null
}
/**
 * When `to-chat` last clicked. The page tells of that click as of yours, but by the time it is
 * told the pointer is back where it was: taken as yours, the spot became that place, and every
 * Alt+' after the first clicked there (b9, 2026-11-19 13:15). Told this soon after, it is ours.
 */
let toChatAt = 0
const OWN_CLICK_MS = 1500
let why = ''

/** Why the last step was not done, for the log. */
export function keysWhy(): string {
  return why
}

/**
 * Until the mouse may act: Orca in front, and either you just came back to it (nothing is being
 * typed yet) or mouse and keyboard have been still for a moment. False when given up or cancelled.
 */
async function untilStill(limitMs: number): Promise<boolean> {
  const mine = ++waits
  const until = Date.now() + limitMs
  let looks = 0
  let fronts = 0
  let stillest = 0
  let name = ''
  while (Date.now() < until) {
    if (mine !== waits) return (why = 'cancelled'), false
    const [idle, front, app] = (await ask('q')).split(' ')
    const isFront = front === '1'
    looks++
    name = app ?? ''
    if (isFront) {
      fronts++
      stillest = Math.max(stillest, Number(idle) || 0)
    }
    if (isFront && (wasFront === false || Number(idle) >= STILL_MS)) {
      // You just came back: Orca may hand the keys to the panel by itself, and the box then
      // calls this wait off. It gets a moment to say so before the pointer is touched.
      if (wasFront === false) await new Promise((r) => setTimeout(r, BACK_GRACE_MS))
      if (mine !== waits) why = 'cancelled'
      return mine === waits
    }
    wasFront = isFront
    await new Promise((r) => setTimeout(r, 250))
  }
  // What kept the mouse from acting, for the log: Orca not in front, or you never still for long enough.
  why = `given up: Orca in front at ${fronts} of ${looks} looks, "${name}" in front at the last, your longest pause with Orca in front ${stillest} ms`
  return false
}

const defaultClicker: Clicker = async (op) => {
  why = ''
  if (op === 'warm') return !!startHelper()
  if (op === 'cancel') return ++waits > 0
  const step = async (command: string) => {
    const said = await ask(command)
    if (said !== 'ok') why = `the helper said "${said}" to ${command}`
    return said === 'ok'
  }
  if (op === 'mark') {
    const [said, x, y] = (await ask('k')).split(' ')
    if (said !== 'ok') return (why = 'the helper could not tell where the pointer is'), false
    spot = { x: Number(x), y: Number(y) }
    return true
  }
  if (op === 'mark-chat') {
    // The board's own click: the spot stays as it is.
    if (Date.now() - toChatAt < OWN_CLICK_MS) return true
    const [said, x, y] = (await ask('k')).split(' ')
    if (said !== 'ok') return (why = 'the helper could not tell where the pointer is'), false
    chatSpot = { x: Number(x), y: Number(y) }
    return true
  }
  if (op === 'to-chat') {
    if (!chatSpot) return (why = 'no click in the chat screen remembered yet: click once in its terminal'), false
    toChatAt = Date.now()
    if (!(await step(`m ${chatSpot.x} ${chatSpot.y}`))) return false
    await new Promise((r) => setTimeout(r, 60))
    const clicked = await step('c')
    const said = why
    await new Promise((r) => setTimeout(r, 60))
    await step('r')
    toChatAt = Date.now()
    why = said
    return clicked
  }
  if (op === 'click') return step('c')
  if (op === 'restore') return step('r')
  if (op === 'move-now') return spot ? step(`m ${spot.x} ${spot.y}`) : ((why = 'no click in the panel remembered yet'), false)
  if (!(await untilStill(op === 'move' ? GIVE_UP_MOVE_MS : GIVE_UP_MS))) return false
  if (op !== 'move') return step('c')
  if (!spot) return (why = 'no click in the panel remembered yet'), false
  return step(`m ${spot.x} ${spot.y}`)
}

let clicker: Clicker = defaultClicker

/** Tests swap the mouse for a fake: a test must never move or press the mouse. */
export function setClicker(next: Clicker | null): void {
  clicker = next ?? defaultClicker
}

export function keys(op: KeysOp): Promise<boolean> {
  return clicker(op)
}
