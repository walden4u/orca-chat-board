// A mouse click made for you, where the pointer already is.
//
// Orca gives a plugin panel the keyboard only when you click in it. When the board shows a chat's
// tab, Orca hands the keys to that terminal, and the reply box you just opened cannot ask for them
// back. So the worker has Windows press the mouse button once, in place: the pointer is still
// over the box you clicked a moment ago, and that click is one Orca honours.
import { execFile } from 'node:child_process'

/** Presses the left button where the pointer is; false when it did not (Orca not in front, no helper). */
export type Clicker = () => Promise<boolean>

// One PowerShell kept waiting, so a click takes milliseconds and not the second it takes to start
// one. It clicks only while the window in front belongs to Orca, and ends with the worker (its
// input closes).
const HELPER = `
Add-Type -Namespace W -Name M -MemberDefinition @'
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, System.UIntPtr e);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);
'@
[Console]::Out.WriteLine('ready')
while (($l = [Console]::In.ReadLine()) -ne $null) {
  $p = 0
  [void][W.M]::GetWindowThreadProcessId([W.M]::GetForegroundWindow(), [ref]$p)
  $name = (Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName
  if ($name -like 'Orca*') {
    [W.M]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [W.M]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    [Console]::Out.WriteLine('ok')
  } else {
    [Console]::Out.WriteLine('no')
  }
}
`

/** PowerShell takes a script as base64 of UTF-16LE: no quoting to survive on the way. */
function encoded(script: string): string {
  let wide = ''
  for (const ch of script) wide += ch + '\0'
  return btoa(wide)
}

type Helper = { stdin: { write(data: string): boolean } }
let helper: Helper | null = null

function startHelper(): Helper | null {
  if (helper) return helper
  if (process.platform !== 'win32') return null
  const child = execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded(HELPER)],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
    () => {
      helper = null
    }
  )
  if (!child.stdin) return null
  helper = { stdin: child.stdin }
  return helper
}

const defaultClicker: Clicker = async () => {
  const h = startHelper()
  if (!h) return false
  try {
    h.stdin.write('c\n')
    return true
  } catch {
    helper = null
    return false
  }
}

let clicker: Clicker = defaultClicker

/** Tests swap the click for a fake: a test must never press the mouse. */
export function setClicker(next: Clicker | null): void {
  clicker = next ?? defaultClicker
}

/** Starts the helper ahead of the click it will be asked for. */
export function warmClicker(): void {
  if (clicker === defaultClicker) startHelper()
}

export function clickInPlace(): Promise<boolean> {
  return clicker()
}
