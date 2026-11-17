// Hover preview: after a short pause on a card, asks the worker for your last prompt and the
// agent's last reply and shows them in a popover. Nothing is cached beyond a few seconds.
import type { ScreenMenu } from '../src/protocol.ts'
import { t } from './i18n.ts'

type Preview = {
  prompt: string | null
  message: string | null
  at: number | null
  screen: string | null
  suggestion: string | null
  menu?: ScreenMenu | null
}

const DELAY_MS = 400
/** Right after a popover was open, the next card's shows almost at once (like system tooltips). */
const WARM_DELAY_MS = 90
const WARM_WINDOW_MS = 600
const FADE_MS = 140
const MAX_WIDTH = 640
const MIN_HEIGHT = 120
/** How much of your prompt and of the agent's reply is put in the popover; the popover's height clips the rest. */
const PROMPT_CHARS = 600
const REPLY_CHARS = 6000
let lastShownAt = 0
const CACHE_MS = 5000
const cache = new Map<string, { at: number; data: Preview }>()
let timer: ReturnType<typeof setTimeout> | null = null
let pop: HTMLDivElement | null = null
let currentKey: string | null = null
/** Counts hovers, so a reply that arrives after the pointer moved on (even back to the same card) is dropped. */
let hover = 0
/** The popover is for the card the arrow keys are on, and not for the one under the pointer. */
let keyed = false
const KEYED_DELAY_MS = 150
// Where the pointer last really was. Cards scrolling or being redrawn under a pointer at rest make
// the browser report moves, enters and leaves of its own, at these same coordinates.
let seenX: number | null = null
let seenY: number | null = null
document.addEventListener('mousemove', (e) => {
  seenX = e.screenX
  seenY = e.screenY
})
const real = (e: MouseEvent) => e.screenX !== seenX || e.screenY !== seenY

/** Whether this mouse event should leave the popover alone: it is the arrow keys', and the pointer did not move. */
export function heldByKeys(e: MouseEvent): boolean {
  return keyed && !real(e)
}

/** Plain text from the agent's markdown: drops emphasis markers and code fences, keeps line breaks. */
export function plain(text: string): string {
  return text
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const head = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s)

/** Your last prompt and the agent's last reply, from Orca; `fresh` skips the few seconds of cache. */
export async function loadPreview(key: string, fresh = false): Promise<Preview> {
  const hit = cache.get(key)
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.data
  // The reply box (`fresh`) also wants the terminal's screen when Orca's record is behind it.
  const data = await orca.plugin.request('chat.preview', fresh ? { key, screen: true } : { key })
  cache.set(key, { at: Date.now(), data })
  return data
}

function place(el: HTMLElement, anchor: Element): void {
  const r = anchor.getBoundingClientRect()
  const edge = 8
  const gap = 6
  // As wide as the panel allows, and as tall as the larger side of the card (below it, or above).
  const w = Math.min(MAX_WIDTH, window.innerWidth - edge * 2)
  el.style.width = `${w}px`
  el.style.left = `${Math.max(edge, Math.min(r.left, window.innerWidth - w - edge))}px`
  el.style.maxHeight = ''
  const h = el.offsetHeight
  const roomBelow = window.innerHeight - r.bottom - gap - edge
  const roomAbove = r.top - gap - edge
  const below = h <= roomBelow || roomBelow >= roomAbove
  const room = Math.max(MIN_HEIGHT, below ? roomBelow : roomAbove)
  el.style.maxHeight = `${room}px`
  el.style.top = `${below ? r.bottom + gap : Math.max(edge, r.top - gap - Math.min(h, room))}px`
  // Longer than the room: the end fades out instead of stopping mid-line.
  el.classList.toggle('clipped', h > room)
}

function render(data: Preview): HTMLDivElement {
  const box = document.createElement('div')
  box.className = 'preview'
  box.setAttribute('role', 'tooltip')
  const section = (who: string, text: string, cls: string) => {
    const s = document.createElement('div')
    s.className = `preview-${cls}`
    const label = document.createElement('div')
    label.className = 'preview-who'
    label.textContent = who
    const body = document.createElement('div')
    body.className = 'preview-text'
    body.textContent = text
    s.append(label, body)
    return s
  }
  if (!data.prompt && !data.message) {
    const empty = document.createElement('div')
    empty.className = 'preview-text preview-empty'
    empty.textContent = t.previewEmpty
    box.append(empty)
  }
  if (data.prompt) box.append(section(t.previewYou, head(plain(data.prompt), PROMPT_CHARS), 'you'))
  // The reply from its start: that is where an agent puts what it found or did.
  if (data.message) box.append(section(t.previewAgent, head(plain(data.message), REPLY_CHARS), 'agent'))
  return box
}

export function hidePreview(): void {
  if (timer) clearTimeout(timer)
  timer = null
  currentKey = null
  keyed = false
  hover++
  document.removeEventListener('mousemove', onMove, true)
  document.documentElement.removeEventListener('mouseleave', hidePreview)
  const old = pop
  pop = null
  if (!old) return
  lastShownAt = Date.now()
  old.classList.remove('show') // fade out, then drop it
  setTimeout(() => old.remove(), FADE_MS)
}

/** Hides the popover once the pointer is no longer on that card (cards are redrawn under it). */
function onMove(e: MouseEvent): void {
  // The arrow keys' popover goes once you take the mouse, wherever that is.
  if (keyed) {
    if (real(e)) hidePreview()
    return
  }
  const over = (e.target as Element | null)?.closest?.('.card')?.getAttribute('data-key')
  if (over !== currentKey) hidePreview()
}

/** `byKeys`: for the card the arrow keys went to; it stays until you move on, take the mouse or leave the board. */
export function schedulePreview(key: string, anchor: HTMLElement, byKeys = false): void {
  hidePreview()
  currentKey = key
  keyed = byKeys
  const mine = hover
  document.addEventListener('mousemove', onMove, true)
  // The pointer can leave the panel while its card is being redrawn, and then no card hears it.
  if (!byKeys) document.documentElement.addEventListener('mouseleave', hidePreview)
  const warm = Date.now() - lastShownAt < WARM_WINDOW_MS
  timer = setTimeout(async () => {
    timer = null
    let data: Preview
    try {
      data = await loadPreview(key)
    } catch {
      return
    }
    if (hover !== mine) return
    const target = document.querySelector(`.card[data-key="${CSS.escape(key)}"]`) ?? anchor
    pop = render(data)
    document.body.append(pop)
    place(pop, target)
    const shown = pop
    requestAnimationFrame(() => shown.classList.add('show')) // fade and slide in
    lastShownAt = Date.now()
  }, warm ? WARM_DELAY_MS : byKeys ? KEYED_DELAY_MS : DELAY_MS)
}
