// Chat Board panel: a kanban of agent chats with drag & drop. Data comes from the worker
// (plugin.request / board.changed); agent status updates arrive live via orca.on.
import type { BoardView, CardView, Column } from '../src/protocol.ts'
import { CSS } from './style.ts'
import { AGENT_LOGOS, AGENT_NAMES } from './logos.ts'
import { STATUS_ICON, type StatusKind } from './icons.ts'
import { locale, setLanguage, t } from './i18n.ts'
import { isStale } from '../src/monitor.ts'
import { heldByKeys, hidePreview, schedulePreview } from './preview.ts'
import { bringKeys, closeReply, focusReply, letKeysGo, openReply, replyKey, setReplyMouse, type MouseOp, setReplyChat, setReplyJudge, setReplyWaiting } from './reply.ts'

const INTERRUPTED = new Set(['interruption', 'failure', 'cancellation'])

/** What the status icon shows: the agent state, with a finished turn that was cut short as `interrupted`. */
function statusOf(c: CardView): StatusKind | null {
  if (c.closed) return 'closed'
  // Orca's monitoring mode: working overall, but the main agent's turn is over (background
  // shells, monitors or subagents keep it alive).
  const orcaMonitoring = c.state === 'working' && !!c.mainState && c.mainState !== 'working'
  // Like Orca: a running turn, a question or a permission request outrank the monitor.
  if (c.monitor && (orcaMonitoring || (c.state !== 'working' && c.state !== 'waiting' && c.state !== 'blocked'))) {
    return isStale(c.monitor, Date.now()) ? 'stale' : 'monitoring'
  }
  if (orcaMonitoring) return 'monitoring'
  if (!c.state) return null
  if (c.state === 'done' && c.outcome && INTERRUPTED.has(c.outcome)) return 'interrupted'
  return c.state
}

function statusIcon(kind: StatusKind, since: number | null): HTMLElement {
  const label = t.status[kind]
  const span = el('span', {
    class: `status ${kind}`,
    role: 'img',
    'aria-label': label,
    title: since ? t.since(label, ago(since)) : label
  })
  span.innerHTML = STATUS_ICON[kind]
  return span
}

/** One hue per column position: blue, violet, amber, green, pink, teal. */
const COLUMN_COLORS = ['#4f8ff7', '#9b6cf2', '#f0a020', '#2fb170', '#e5578f', '#1fb5b5']

let view: BoardView | null = null
let filter = ''
let editingCard: string | null = null
let renamingColumn: string | null = null
let confirmDeleteColumn: string | null = null
let confirmClearArchive = false
let confirmArchiveCard: string | null = null
let confirmArchiveTimer: ReturnType<typeof setTimeout> | null = null
/** How long "Close the tab?" waits for its second click. */
const CONFIRM_ARCHIVE_MS = 5000
/** A button is held down: a redraw now would take it away before the click lands. */
let pressing = false
let dragKey: string | null = null
/** When the last drag ended; a click right after a drop is not an "open". */
let dragEndedAt = 0
/** The archive under the board is showing; kept across reloads of the panel where the browser lets it. */
let archiveOpen = false
try {
  archiveOpen = localStorage.getItem('chat-board.archive') === 'open'
} catch {
  // No storage in this frame: it starts put away.
}
function rememberArchiveOpen(): void {
  try {
    localStorage.setItem('chat-board.archive', archiveOpen ? 'open' : 'closed')
  } catch {
    // Remembered until the panel reloads, then.
  }
}
let flash: string | null = null
let flashGood = false
let pendingRender = false
/** The filter box and its toolbar, made once and kept in the page (see render). */
let searchEl: HTMLInputElement | null = null
let toolbarEl: HTMLElement | null = null

/** What each card shows; mirrors the plugin's settings (Settings → Plugins → Chat Board). */
const show = { agent: true, workspace: true, status: true, time: true, notes: true, preview: true }
/** The "Check Orca automatically" setting: off means the board asks Orca only on ⟳, on opening and on Orca's events. */
let autoCheck = true
/** The "Show the chat in Orca with its reply box" setting. */
let followChat = false
/** A setting of its own: the box that opens after you sent or pressed Next shows its chat in Orca too. */
let followNext = false
/** A setting: the arrow keys open the reply box of the card they go to, and walk on from box to box. */
let arrowsOpenReply = false
/** A setting: a reply box the arrow keys opened shows its chat by itself once you stay on it. */
let arrowsShowChat = false
/** Setting: checked chats that wait for your answer are drawn pink, and so is the toolbar's edge. */
/** Setting: checked chats that wait for your answer are drawn pink, and so is the toolbar's edge. */
let pinkWaiting = false
/**
 * Setting: goal mode. On, a chat's box can split a goal into GOAL.md, run it and review the work,
 * and a card shows its folder's checklist. Off, none of that shows.
 */
let goalMode = false
/** An automatic check is on its way to the worker and back. */
let checking = false
/** The automatic check's two paces, and how long it stays at the fast one after you last used the panel. */
const CHECK_MS = 3000
const CHECK_IDLE_MS = 15_000
const STAY_ALERT_MS = 30_000
let alertUntil = Date.now() + STAY_ALERT_MS
let idling = false
let checkTimer: ReturnType<typeof setTimeout> | undefined
let wakeCheck: () => void = () => undefined

/** You are using the panel, or just sent something: check at the fast pace for a while. */
function stayAlert(): void {
  alertUntil = Date.now() + STAY_ALERT_MS
  wakeCheck()
}

async function loadSettings(): Promise<void> {
  try {
    const s = await orca.settings.get()
    show.agent = s.showAgent !== false
    show.workspace = s.showWorkspace !== false
    show.status = s.showStatus !== false
    show.time = s.showTime !== false
    show.notes = s.showNotes !== false
    show.preview = s.showPreview !== false
    autoCheck = s.autoCheck !== false
    followChat = s.followChat === true
    followNext = s.followNext === true
    arrowsOpenReply = s.arrowsOpenReply === true
    arrowsShowChat = s.arrowsShowChat === true
    pinkWaiting = s.pinkWaiting === true
    goalMode = s.goalMode === true
    setLanguage(s.language)
  } catch {
    // Settings unavailable (older approval): keep everything visible.
  }
}

// ---------- helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue
    if (k === 'class') node.className = String(v)
    else node.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children) if (c !== null && c !== false) node.append(c)
  return node
}

/** A duration as `45s`, `3m`, `2h` or `1d`. */
function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

/** The card's time slot for a monitor: next run, or how long it has been silent. */
function monitorTime(c: CardView, kind: StatusKind | null): { text: string; title: string } | null {
  const m = c.monitor
  if (!m || (kind !== 'monitoring' && kind !== 'stale')) return null
  const now = Date.now()
  const parts = [t.monitorKind[m.kind]]
  if (m.everySec) parts.push(t.every(span(m.everySec * 1000)))
  if (m.label) parts.push(m.label)
  parts.push(t.lastRun(span(now - m.lastRunAt)))
  const title = parts.join(' · ')
  if (kind === 'stale') return { text: t.noSignal(span(now - m.lastRunAt)), title }
  if (m.nextAt) return { text: m.nextAt > now ? t.nextRun(span(m.nextAt - now)) : t.dueNow, title }
  return { text: t.lastRun(span(now - m.lastRunAt)), title }
}

function ago(at: number | null): string {
  if (!at) return ''
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 60) return t.now
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** The agent's logo as Orca shows it; an initial for an agent Orca adds later. */
function agentBadge(agent: string): HTMLElement {
  const name = AGENT_NAMES[agent] ?? agent
  const logo = AGENT_LOGOS[agent]
  if (logo && 'svg' in logo) {
    const span = el('span', { class: 'logo', title: name, role: 'img', 'aria-label': name })
    span.innerHTML = logo.svg
    return span
  }
  if (logo) return el('img', { class: 'logo', src: logo.img, alt: name, title: name })
  return el('span', { class: 'logo initial', title: name, role: 'img', 'aria-label': name }, name.charAt(0).toUpperCase())
}

const titleOf = (c: CardView) => c.label || c.title || t.untitled

function matches(c: CardView): boolean {
  if (!filter) return true
  const q = filter.toLowerCase()
  return [c.label, c.title, c.note, c.worktreeName, c.agent ?? ''].some((s) => s.toLowerCase().includes(q))
}

async function request<T>(name: string, input: unknown): Promise<T | null> {
  try {
    return (await orca.plugin.request(name as never, input as never)) as T
  } catch (err) {
    showFlash(t.error((err as Error).message))
    return null
  }
}

/** A line under the toolbar for a few seconds: something went wrong, or (`good`) something was done. */
function showFlash(msg: string, good = false): void {
  flash = msg
  flashGood = good
  render(true)
  setTimeout(() => {
    if (flash === msg) {
      flash = null
      render()
    }
  }, 5000)
}

function setView(next: BoardView | null): void {
  if (next) view = next
  render()
  // The box that is open follows its chat: a turn that ends or starts there, a goal item ticked,
  // a review that started or came in. Without this it would go on saying "working" over an old
  // exchange until it was closed and opened again.
  const open = replyKey()
  const card = open ? view?.cards.find((c) => c.key === open) : null
  if (open && card) {
    setReplyChat(open, { working: statusOf(card) === 'working', turnAt: card.stateAt, goalFile: goalMode ? card.goalFile : null })
    if (goalMode) setReplyJudge(open, card.judge ?? null, card.drafts ?? null)
    // A turn that ended while this chat's box was open is seen once you answer from the box. The
    // box may just have been left open (walked to with the arrow keys, you looking elsewhere): on
    // 2026-11-18 such a chat ended with a question, its box was closed unanswered, and it never
    // opened again by itself. So its mark stays until you answer, see `leftUnanswered`.
    if (card.unseenAt && card.unseenAt !== readHere.get(card.key) && !endedOpen.has(card.key)) {
      endedOpen.add(card.key)
      trace(`reply ${card.key.slice(0, 8)}: its turn ended with the box open`)
    }
  }
  openNextWaiting()
}

const isEditing = () => {
  const a = document.activeElement
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && !a.classList.contains('search') && !a.closest('.reply')
}

// ---------- actions ----------

async function load(refresh: boolean): Promise<void> {
  setView(await request<BoardView>('board.get', { refresh, locale }))}

/**
 * The chat this board last showed in the browser tab here. The server's own idea of the tab on
 * screen (`active`) is its window's, not this machine's: this is what Alt+K goes by.
 */
let shownHere: string | null = null

async function focusChat(c: CardView): Promise<void> {
  if (c.closed) return
  const r = await request<{ ok: boolean; error: string | null }>('chat.focus', { key: c.key })
  if (r?.ok) shownHere = c.key
  if (r && !r.ok) showFlash(r.error === 'closed' ? t.chatClosed : (r.error ?? t.focusFailed))
  else if (r?.ok && r.error === 'chat-workspace') showFlash(t.chatTabOpened, true)
  else if (r?.ok && view) {
    for (const x of view.cards) x.active = x.key === c.key
    render()
  }
}

async function setWatch(c: CardView, watch: boolean): Promise<void> {
  if (watch) c.watch = true
  else delete c.watch
  render(true)
  setView(await request<BoardView>('card.update', { key: c.key, watch }))
}

/** Goal mode: how far the checklist in the chat's folder (GOAL.md) is ticked off. */
function goalChip(c: CardView): HTMLElement | null {
  const goal = goalMode && !c.closed ? c.goalFile : null
  if (!goal || goal.total === 0) return null
  const all = goal.done === goal.total
  return el('span', { class: `chip goal${all ? ' all' : ''}`, title: goal.title ?? t.goalFile }, t.goalProgress(goal.done, goal.total))
}

/** The check, at the same place on every open card: a click there checks or unchecks the chat. */
function watchMark(c: CardView): HTMLElement {
  const on = !!c.watch
  const hint = on ? t.watchOn : t.watchOff
  const mark = el('button', { class: `watch${on ? '' : ' off'}`, title: hint, 'aria-label': hint, 'aria-pressed': on ? 'true' : 'false' }, on ? '✓' : '')
  mark.onclick = (e) => (e.stopPropagation(), void setWatch(c, !on))
  return mark
}

// ---------- reply box and its queue ----------

/** A checked chat whose agent is not working: it finished or asked, and the next word is yours. */
function answerDue(c: CardView): boolean {
  return !!c.watch && !c.closed && (c.state === 'done' || c.state === 'waiting' || c.state === 'blocked')
}

/** A checked chat that finished and was not seen yet: its reply box is due to open. */
function isWaiting(c: CardView): boolean {
  if (!c.watch || c.closed || !c.unseenAt || c.unseenAt === readHere.get(c.key)) return false
  const later = putOff.get(c.key)
  if (later === undefined || c.unseenAt > later || Date.now() - later >= PUT_OFF_MS) return true
  return (view?.cards ?? []).some((x) => x.key !== c.key && x.watch && !x.closed && (x.unseenAt ?? 0) > later)
}

/** Checked chats that finished and were not seen yet, in the order they finished. */
function waitingCards(except?: string | null): CardView[] {
  return (view?.cards ?? [])
    .filter((c) => isWaiting(c) && c.key !== except)
    .sort((a, b) => (a.unseenAt ?? 0) - (b.unseenAt ?? 0))
}

/**
 * You left a box for the chat itself (↗): the boxes behind it wait, so they do not cover what you
 * went to do. They come back when another checked chat finishes, or after a while.
 */
let queueHeldAt = 0
const QUEUE_HOLD_MS = 120_000

/**
 * The unseen mark each chat had when its box opened here. The worker clears the mark a moment
 * later; until then a board update can still carry it, and it must not put the chat back in line.
 */
const readHere = new Map<string, number>()

/** Chats whose turn ended while their box was open, not answered from it yet. */
const endedOpen = new Set<string>()
/** When a box was left with its ended turn unanswered: the chat waits a while before it opens again. */
const putOff = new Map<string, number>()
/** That while (2 minutes at first, "too long" said on 2026-11-18). */
const PUT_OFF_MS = 60_000

/**
 * The chat of a box that opened by itself, seen here but not yet told to the server: told once you
 * are at it, by a key, the wheel, or a click of yours, closing it with the mouse too (asked for on
 * 2026-11-19). The mouse helper's clicks land on its sheet (`.reply-sheet`): they do not count.
 */
let seenLater: string | null = null
function tellSeen(): void {
  if (!seenLater || replyKey() !== seenLater) return
  const key = seenLater
  seenLater = null
  void request<BoardView>('card.seen', { key }).then((v) => setView(v))
}
document.addEventListener('keydown', (e) => e.isTrusted && tellSeen(), true)
document.addEventListener('wheel', () => tellSeen(), { capture: true, passive: true })
document.addEventListener(
  'pointerdown',
  (e) => {
    if (e.isTrusted && !(e.target as Element | null)?.closest?.('.reply-sheet')) tellSeen()
  },
  true
)

/** Seen: the box was answered, or you went to the chat itself. */
function markSeen(key: string): void {
  endedOpen.delete(key)
  putOff.delete(key)
  const c = view?.cards.find((x) => x.key === key)
  if (!c?.unseenAt || c.unseenAt === readHere.get(key)) return
  readHere.set(key, c.unseenAt)
  c.unseenAt = null
  render()
  void request<BoardView>('card.seen', { key }).then((v) => setView(v))
}

/**
 * A box left without an answer to the turn that ended while it was open (closed, or walked away
 * from): the chat stays unseen and opens again by itself, though not at once (Escape would be of
 * no use): once another checked chat finishes, or after a minute (`PUT_OFF_MS`).
 */
function leftUnanswered(key: string): void {
  if (!endedOpen.delete(key)) return
  const c = view?.cards.find((x) => x.key === key)
  if (!c?.unseenAt || c.unseenAt === readHere.get(key)) return
  putOff.set(key, Date.now())
  trace(`reply ${key.slice(0, 8)}: left unanswered, opens again later`)
}

/** One line in the plugin's log (`orca plugin logs`) about the reply boxes: what opened, how it was left. */
function trace(message: string): void {
  void orca.plugin.request('trace', { message }).catch(() => undefined)
}

function showReply(c: CardView, how: 'click' | 'auto' | 'next' | 'arrow' = 'click'): void {
  hidePreview()
  const kind = statusOf(c)
  const id = c.key.slice(0, 8)
  const next = how === 'next'
  trace(`reply open ${id} (${how}), ${waitingCards(c.key).length} waiting`)
  // This box takes the place of another one (the arrow keys, Next): that one was left as it was.
  const before = replyKey()
  if (before && before !== c.key) leftUnanswered(before)
  endedOpen.delete(c.key)
  putOff.delete(c.key)
  if (seenLater && seenLater !== c.key) seenLater = null
  if (c.unseenAt) {
    // Read here counts as seen (it leaves the queue too), at once and then in the worker.
    readHere.set(c.key, c.unseenAt)
    c.unseenAt = null
    render()
    // A box that opened by itself may have nobody before it: seen on this machine only, and on
    // the server once you are at it (a key pressed). Told at once, it took the chat from the
    // server's own board (2026-11-19: it never opened there, this machine's box went unread).
    if (how === 'auto') {
      seenLater = c.key
      void request<BoardView>('card.seen', { key: c.key, hereOnly: true }).then((v) => setView(v))
    } else void request<BoardView>('card.seen', { key: c.key }).then((v) => setView(v))
  }
  openReply(
    {
      key: c.key,
      title: titleOf(c),
      workspace: c.worktreeName,
      // With goal mode off, the box is the plain reply box: no goal, no review, none of their buttons.
      canJudge: goalMode,
      // Splitting and running a goal are prompts for Claude Code in a terminal (`/goal` is its command).
      canGoal: goalMode && c.agent === 'claude' && !c.sessionId,
      goalFile: goalMode ? c.goalFile : null,
      judge: goalMode ? (c.judge ?? null) : null,
      tally: goalMode ? (c.drafts ?? null) : null,
      turnAt: c.stateAt,
      chatTab: !!c.sessionId,
      working: kind === 'working',
      blocked: kind === 'blocked',
      auto: how === 'auto',
      fromCard: how === 'click',
      byArrows: how === 'arrow',
      stayShows: arrowsShowChat,
      watched: c.watch === true,
      waiting: waitingCards(c.key).length
    },
    {
      // You are at this box: with the setting on, Orca shows that chat's tab beside it.
      // With the setting on, the arrow keys go on from this box to the next card's.
      onArrow: arrowsOpenReply ? walk : undefined,
      onEngaged: async (how = 'open') => {
        // Asked for with Alt+Enter or the title, or by staying on the chat (a setting of its own):
        // shown whatever "show the chat beside the box" says.
        // A box you opened from its card and the one that follows a sent answer have a setting each.
        if ((!(next ? followNext : followChat) && how === 'open') || c.closed) return false
        // The chat comes up in the browser tab and the keyboard goes there with it: the mouse of
        // this machine is made ready to bring it back (see `takeBack` in reply.ts).
        void replyMouse('warm')
        const began = Date.now()
        const r = await orca.plugin.request('chat.focus', { key: c.key }).catch((err: unknown) => {
          trace(`reply show ${id} (${how}): failed: ${String((err as Error)?.message ?? err).slice(0, 120)}`)
          return null
        })
        // Seen on the server's log too: the showing happens on this machine only.
        if (r) trace(`reply show ${id} (${how}): ${r.ok ? 'ok' : (r.error ?? 'passed over')} in ${Date.now() - began} ms`)
        if (r?.ok) shownHere = c.key
        if (r?.ok && view && r.error !== 'chat-workspace') {
          for (const x of view.cards) x.active = x.key === c.key
          render()
        }
        return true
      },
      onKeys: (what) => trace(`reply keys ${id}: ${what}`),
      onSent: (title) => {
        trace(`reply left ${id}: sent`)
        markSeen(c.key)
        showFlash(t.sent(title), true)
        stayAlert()
        openNextWaiting(true)
        setTimeout(keepPicked, 0)
      },
      // Closing a box is done with that chat, not with the queue: the next one that waits opens.
      onNext: () => {
        trace(`reply left ${id}: next`)
        leftUnanswered(c.key)
        openNextWaiting(true)
      },
      onFinish: () => {
        trace(`reply left ${id}: finished, unchecked`)
        markSeen(c.key)
        void setWatch(c, false).then(() => {
          openNextWaiting(true)
          setTimeout(keepPicked, 0)
        })
      },
      onClosed: () => {
        trace(`reply left ${id}: closed`)
        leftUnanswered(c.key)
        openNextWaiting(true)
        setTimeout(keepPicked, 0)
      },
      onOpenChat: () => {
        trace(`reply left ${id}: to the chat, queue held`)
        markSeen(c.key)
        queueHeldAt = Date.now()
        void focusChat(c)
      }
    }
  )
}

/**
 * Opens the reply box of the checked chat that has waited longest. By itself (`asked` false) only
 * when nothing of yours is in the way: no box open, no edit or drag going on, the panel on screen,
 * and not right after you left a box for the chat itself.
 */
function openNextWaiting(asked = false): void {
  const open = replyKey()
  if (open) {
    setReplyWaiting(waitingCards(open).length)
    return
  }
  const queue = waitingCards()
  if (!queue.length) return
  if (!asked) {
    if (editingCard || renamingColumn || dragKey || document.visibilityState !== 'visible') return
    if (Date.now() - queueHeldAt < QUEUE_HOLD_MS && !queue.some((c) => (c.unseenAt ?? 0) > queueHeldAt)) return
  }
  queueHeldAt = 0
  showReply(queue[0]!, asked ? 'next' : 'auto')
}

function moveLocal(key: string, column: string, index: number): void {
  if (!view) return
  const card = view.cards.find((c) => c.key === key)
  if (!card) return
  const siblings = view.cards
    .filter((c) => c.column === column && !c.closed && c.key !== key)
    .sort((a, b) => a.order - b.order)
  card.column = column
  siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, card)
  siblings.forEach((c, i) => (c.order = i))
}

async function move(key: string, column: string, index: number): Promise<void> {
  moveLocal(key, column, index)
  render(true)
  setView(await request<BoardView>('board.move', { key, column, index }))
}

async function saveColumns(columns: Column[]): Promise<void> {
  if (view) view.columns = columns
  render(true)
  setView(await request<BoardView>('board.columns.set', { columns }))
}

// ---------- rendering ----------

function renderCard(c: CardView): HTMLElement {
  const kind = statusOf(c)
  const stateBadge =
    kind && show.status ? statusIcon(kind, c.closed ? c.closedAt : kind === 'monitoring' || kind === 'stale' ? (c.monitor?.lastRunAt ?? c.stateAt) : c.stateAt) : null
  const when = c.closed ? c.closedAt : (c.stateAt ?? c.lastOutputAt)
  const mon = monitorTime(c, kind)

  const card = el(
    'div',
    {
      class: `card${c.closed ? ' closed' : kind ? ` st-${kind}` : ''}${c.unseenAt && !c.closed ? ' unseen' : ''}${c.active ? ' active' : ''}${pinkWaiting && answerDue(c) ? ' answer-due' : ''}`,
      draggable: !c.closed && editingCard !== c.key ? 'true' : false,
      tabindex: '0',
      'data-key': c.key,
      title: c.closed ? '' : c.active ? t.openNow : t.openHint
    },
    el(
      'div',
      { class: 'card-top' },
      !c.closed ? watchMark(c) : null,
      c.unseenAt && !c.closed ? el('span', { class: 'unseen-dot', title: t.unseen, role: 'img', 'aria-label': t.unseen }) : null,
      el('span', { class: 'card-title' }, titleOf(c)),
      stateBadge
    ),
    el(
      'div',
      { class: 'card-meta' },
      c.agent && show.agent ? agentBadge(c.agent) : null,
      c.worktreeName && show.workspace ? el('span', { class: 'chip ws' }, c.worktreeName) : null,
      goalChip(c),
      c.label && c.title && c.label !== c.title ? el('span', {}, c.title) : null,
      show.time && mon ? el('span', { class: `time ${kind}`, title: mon.title }, mon.text) : when && show.time ? el('span', { class: 'time' }, ago(when)) : null
    ),
    c.note && show.notes && editingCard !== c.key ? el('div', { class: 'note' }, c.note) : null
  )

  const actions = el('div', { class: 'card-actions' })
  if (!c.closed) {
    const open = el('button', { class: 'ghost', title: t.openChat }, '↗')
    open.onclick = (e) => (e.stopPropagation(), void focusChat(c))
    actions.append(open)
  }
  /** The reply box: what a click on the card opens. From there, or with a double-click, the chat itself. */
  const reply = () => showReply(c)
  const edit = el('button', { class: 'ghost', title: t.editCard }, '✎')
  edit.onclick = (e) => {
    e.stopPropagation()
    // A preview on its way for this card would land on the form.
    hidePreview()
    editingCard = c.key
    render(true)
  }
  actions.append(edit)
  if (!c.closed) {
    // Archiving closes the chat's tab in Orca, so it asks first: a second click within 5 seconds.
    const ask = c.state === 'working' ? t.archiveConfirmWorking : c.agent === 'claude' && !c.sessionId ? t.archiveConfirm : t.archiveConfirmForGood
    const asking = confirmArchiveCard === c.key
    const away = el('button', { class: `ghost${asking ? ' danger' : ''}`, title: t.archiveCard, 'aria-label': t.archiveCard }, asking ? ask : '▾')
    away.onclick = async (e) => {
      e.stopPropagation()
      if (confirmArchiveCard !== c.key) {
        const other = confirmArchiveCard !== null
        confirmArchiveCard = c.key
        // One timer for the question: an earlier one would take this question away too soon.
        if (confirmArchiveTimer) clearTimeout(confirmArchiveTimer)
        confirmArchiveTimer = setTimeout(() => {
          confirmArchiveTimer = null
          confirmArchiveCard = null
          render()
        }, CONFIRM_ARCHIVE_MS)
        // The button under the pointer becomes the question itself; the board is not redrawn for it.
        away.textContent = ask
        away.classList.add('danger')
        if (other) render()
        return
      }
      if (confirmArchiveTimer) clearTimeout(confirmArchiveTimer)
      confirmArchiveTimer = null
      confirmArchiveCard = null
      away.setAttribute('disabled', '')
      const r = await request<{ ok: boolean; error: string | null }>('chat.archive', { key: c.key })
      if (r?.ok) {
        if (replyKey() === c.key) closeReply()
        showFlash(t.archiveDone, true)
        setView(await request<BoardView>('board.get', {}))
      } else if (r) showFlash(r.error === 'chat-tab' ? t.archiveChatTab : t.archiveFailed(r.error ?? ''))
    }
    actions.append(away)
  }
  if (c.closed && c.agent === 'claude' && !c.sessionId) {
    // Always in sight, not among the hover buttons: it is what an archived chat is there for.
    const again = el('button', { class: 'ghost reopen', title: t.reopen }, `↻ ${t.reopenShort}`)
    again.onclick = async (e) => {
      e.stopPropagation()
      again.setAttribute('disabled', '')
      const r = await request<{ ok: boolean; error: string | null }>('chat.reopen', { key: c.key })
      if (r?.ok) showFlash(t.reopened, true)
      else if (r) showFlash(t.reopenFailed(r.error ?? ''))
    }
    card.querySelector('.card-meta')?.append(again)
  }
  if (c.closed) {
    const del = el('button', { class: 'ghost danger', title: t.deleteCard }, '✕')
    del.onclick = async (e) => {
      e.stopPropagation()
      setView(await request<BoardView>('card.delete', { key: c.key }))
    }
    actions.append(del)
  }
  // A press on one of these buttons with the pointer slipping a little is still a click, not the
  // start of dragging the card (which would swallow the click).
  actions.draggable = true
  actions.ondragstart = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }
  if (editingCard !== c.key) card.append(actions)

  if (editingCard === c.key) card.append(renderEditor(c))

  // A short click opens the reply box, a double-click the chat; drags, buttons and the editor's
  // fields keep their own clicks. The second click of a double-click lands on the box (reply.ts).
  card.onclick = (e) => {
    if (c.closed || editingCard === c.key || Date.now() - dragEndedAt < 300) return
    if ((e.target as Element).closest('button, input, textarea, a, .card-actions')) return
    reply()
  }
  card.onkeydown = (e) => {
    if (e.target === card && e.key === 'Enter' && !c.closed) reply()
  }
  card.onmouseenter = (e) => {
    if (heldByKeys(e)) return
    if (show.preview && !c.closed && !dragKey && editingCard !== c.key) schedulePreview(c.key, card)
  }
  card.onmouseleave = (e) => {
    if (!heldByKeys(e)) hidePreview()
  }
  card.ondragstart = (e) => {
    hidePreview()
    dragKey = c.key
    e.dataTransfer?.setData('text/plain', c.key)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    requestAnimationFrame(() => card.classList.add('dragging'))
  }
  card.ondragend = () => {
    dragKey = null
    dragEndedAt = Date.now()
    card.classList.remove('dragging')
    clearDropMarks()
  }
  return card
}

function renderEditor(c: CardView): HTMLElement {
  // Open chats: this field is the Orca tab's name. Closed chats have no tab: it names the card.
  const current = c.label || c.title
  const nameLabel = c.closed ? t.cardName : t.tabName
  const label = el('input', { placeholder: c.closed ? t.name : t.tabNameHint, 'aria-label': nameLabel, title: nameLabel })
  label.value = current
  const note = el('textarea', { rows: '3', placeholder: t.noteHint, 'aria-label': t.note })
  note.value = c.note
  const save = async () => {
    editingCard = null
    const patch: { key: string; note: string; label?: string } = { key: c.key, note: note.value }
    if (label.value.trim() !== current) patch.label = label.value
    if (patch.label !== undefined) {
      const card = view?.cards.find((x) => x.key === c.key)
      if (card) card.label = patch.label.trim() // show the new name while the tab is renamed
    }
    render(true)
    setView(await request<BoardView>('card.update', patch))
  }
  const cancel = () => {
    editingCard = null
    render(true)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cancel()
    // Enter saves right away in both fields; Shift+Enter adds a line break to the note.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      void save()
    }
  }
  label.onkeydown = onKey
  note.onkeydown = onKey
  const ok = el('button', { class: 'primary' }, t.save)
  ok.onclick = () => void save()
  const no = el('button', { class: 'ghost' }, t.cancel)
  no.onclick = cancel
  setTimeout(() => label.focus())
  return el('div', { class: 'edit' }, label, note, el('div', { class: 'edit-actions' }, no, ok))
}

function clearDropMarks(): void {
  document.querySelectorAll('.drop-line').forEach((n) => n.remove())
  document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'))
}

/** Index among the column's open cards (the dragged one excluded) for a pointer at `y`. */
function dropIndex(body: HTMLElement, y: number): { index: number; before: Element | null } {
  const cards = Array.from(body.querySelectorAll<HTMLElement>('.card:not(.dragging)'))
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect()
    if (y < r.top + r.height / 2) return { index: i, before: cards[i] }
  }
  return { index: cards.length, before: null }
}

function setCollapsed(col: Column, columns: Column[], collapsed: boolean): void {
  void saveColumns(columns.map((c) => (c.id === col.id ? { ...c, collapsed } : c)))
}

/** Drop handlers shared by open and collapsed columns; `body` is null when collapsed (drop at the end). */
function wireDrop(column: HTMLElement, body: HTMLElement | null, col: Column): void {
  column.ondragover = (e) => {
    if (!dragKey) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    clearDropMarks()
    column.classList.add('drop-target')
    if (!body) return
    const { before } = dropIndex(body, e.clientY)
    const line = el('div', { class: 'drop-line' })
    if (before) body.insertBefore(line, before)
    else body.append(line)
  }
  column.ondragleave = (e) => {
    if (!column.contains(e.relatedTarget as Node | null)) clearDropMarks()
  }
  column.ondrop = (e) => {
    e.preventDefault()
    const key = dragKey ?? e.dataTransfer?.getData('text/plain')
    clearDropMarks()
    if (!key) return
    const all = (view?.cards ?? [])
      .filter((c) => c.column === col.id && !c.closed && c.key !== key)
      .sort((a, b) => a.order - b.order)
    let realIndex = all.length
    if (body) {
      // While filtering, hidden cards sit between visible ones: drop before the visible neighbour.
      const { index, before } = dropIndex(body, e.clientY)
      realIndex = index
      if (filter) {
        const beforeKey = before?.getAttribute('data-key')
        realIndex = beforeKey ? all.findIndex((c) => c.key === beforeKey) : all.length
      }
    }
    dragKey = null
    void move(key, col.id, realIndex)
  }
}

function renderCollapsed(col: Column, i: number, columns: Column[], cards: CardView[]): HTMLElement {
  const count = cards.length
  const unseen = cards.filter((c) => c.unseenAt).length
  const label = t.expand(col.title, count)
  const strip = el(
    'section',
    {
      class: 'column collapsed',
      role: 'button',
      tabindex: '0',
      title: label,
      'aria-label': label,
      style: `--col: ${COLUMN_COLORS[i % COLUMN_COLORS.length]}`
    },
    el('span', { class: 'count' }, String(count)),
    unseen ? el('span', { class: 'unseen-dot', title: t.columnUnseen(unseen) }) : null,
    el('span', { class: 'strip-title' }, col.title)
  )
  strip.onclick = () => setCollapsed(col, columns, false)
  strip.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setCollapsed(col, columns, false)
    }
  }
  wireDrop(strip, null, col)
  return strip
}

function renderColumn(col: Column, i: number, columns: Column[], cards: CardView[]): HTMLElement {
  if (col.collapsed) return renderCollapsed(col, i, columns, cards)
  const head = el('div', { class: 'column-head' })
  if (renamingColumn === col.id) {
    const input = el('input', { 'aria-label': t.columnName })
    input.value = col.title
    const commit = () => {
      renamingColumn = null
      const title = input.value.trim()
      if (title && title !== col.title) void saveColumns(columns.map((c) => (c.id === col.id ? { ...c, title } : c)))
      else render(true)
    }
    input.onkeydown = (e) => {
      if (e.key === 'Enter') commit()
      if (e.key === 'Escape') {
        renamingColumn = null
        render(true)
      }
    }
    input.onblur = commit
    setTimeout(() => (input.focus(), input.select()))
    head.append(input)
  } else {
    // Orca's own status names: they are renamed on Orca's Workspace Board.
    const locked = view?.orcaNames === true
    const title = el('span', { class: 'column-title', title: locked ? t.renameInOrca : t.renameHint }, col.title)
    if (!locked) {
      title.ondblclick = () => {
        renamingColumn = col.id
        render(true)
      }
    }
    const collapse = el('button', { class: 'ghost', title: t.collapse, 'aria-label': t.collapse }, '⇤')
    collapse.onclick = () => setCollapsed(col, columns, true)
    const unseen = cards.filter((c) => c.unseenAt).length
    head.append(title)
    if (unseen) head.append(el('span', { class: 'unseen-dot', title: t.columnUnseen(unseen) }))
    head.append(el('span', { class: 'count' }, String(cards.length)), collapse)
    const swap = (to: number) => {
      const next = [...columns]
      ;[next[i], next[to]] = [next[to], next[i]]
      void saveColumns(next)
    }
    if (i > 0) {
      const left = el('button', { class: 'ghost', title: t.moveLeft }, '‹')
      left.onclick = () => swap(i - 1)
      head.append(left)
    }
    if (i < columns.length - 1) {
      const right = el('button', { class: 'ghost', title: t.moveRight }, '›')
      right.onclick = () => swap(i + 1)
      head.append(right)
    }
    // Synced columns are Orca's workspace statuses: they are added and removed in Orca.
    if (columns.length > 1 && !view?.synced) {
      const confirming = confirmDeleteColumn === col.id
      const del = el(
        'button',
        { class: `ghost${confirming ? ' danger' : ''}`, title: t.deleteColumn },
        confirming ? t.confirmDelete : '✕'
      )
      del.onclick = () => {
        if (confirming) {
          confirmDeleteColumn = null
          void saveColumns(columns.filter((c) => c.id !== col.id))
        } else {
          confirmDeleteColumn = col.id
          render(true)
          setTimeout(() => {
            if (confirmDeleteColumn === col.id) {
              confirmDeleteColumn = null
              render()
            }
          }, 3000)
        }
      }
      head.append(del)
    }
  }

  const body = el('div', { class: 'column-body' })
  for (const c of cards) body.append(renderCard(c))
  if (cards.length === 0) body.append(el('div', { class: 'empty' }, filter ? t.noMatches : t.dropHere))

  const column = el(
    'section',
    { class: 'column', 'aria-label': col.title, style: `--col: ${COLUMN_COLORS[i % COLUMN_COLORS.length]}` },
    head,
    body
  )
  wireDrop(column, body, col)
  return column
}

function render(force = false): void {
  if (!force && ((isEditing() && !dragKey) || pressing)) {
    pendingRender = true
    return
  }
  pendingRender = false
  const root = document.getElementById('app')!

  // The filter box survives every redraw. A new input in its place would end the IME composition
  // in progress, and Korean, Japanese or Chinese text then arrives as loose letters.
  const search = (searchEl ??= el('input', { class: 'search', type: 'search' }))
  search.placeholder = t.filter
  search.setAttribute('aria-label', t.filterLabel)
  if (search.value !== filter) search.value = filter
  search.oninput = () => {
    filter = search.value
    render(true)
  }
  const refresh = el('button', { class: 'ghost', title: t.refresh }, '⟳')
  refresh.onclick = () => void load(true)
  const addCol = el('button', { class: 'ghost', title: t.addColumn }, t.addColumnButton)
  addCol.onclick = () => {
    if (!view) return
    const id = `col-${Date.now().toString(36)}`
    renamingColumn = id
    void saveColumns([...view.columns, { id, title: t.newColumn }])
  }

  const sync = el(
    'button',
    { class: `ghost${view?.synced ? ' on' : ''}`, title: view?.synced ? t.syncOn : t.syncOff, 'aria-pressed': String(!!view?.synced) },
    '⇄'
  )
  sync.onclick = async () => {
    if (view) setView(await request<BoardView>('sync.set', { on: !view.synced }))
  }

  const toolbar = (toolbarEl ??= el('div', { class: 'toolbar' }, search))
  while (toolbar.lastChild && toolbar.lastChild !== search) toolbar.lastChild.remove()
  toolbar.classList.toggle('answer-due', pinkWaiting && (view?.cards ?? []).some(answerDue))
  // The archive is put away until you ask for it: this button shows how many chats it holds and
  // opens it under the board (and puts it away again).
  const archivedCount = (view?.cards ?? []).filter((c) => c.closed).length
  const archive = el(
    'button',
    { class: `ghost${archiveOpen ? ' on' : ''}`, title: archiveOpen ? t.archiveHide : t.archiveShow, 'aria-pressed': String(archiveOpen) },
    t.archiveButton(archivedCount)
  )
  archive.onclick = () => {
    archiveOpen = !archiveOpen
    rememberArchiveOpen()
    render(true)
  }
  toolbar.append(...(view?.synced ? [] : [addCol]), ...(archivedCount ? [archive] : []), sync, refresh)
  const children: Node[] = []
  const error = flash ?? (view?.error ? t.listFailed(view.error) : null)
  if (error) children.push(el('div', { class: flash && flashGood ? 'error notice' : 'error', role: 'status' }, error))

  if (!view) {
    children.push(el('div', { class: 'empty' }, t.loading))
  } else {
    const open = view.cards.filter((c) => !c.closed && matches(c))
    const board = el('div', { class: 'board' })
    view.columns.forEach((col, i) => {
      const cards = open.filter((c) => c.column === col.id).sort((a, b) => a.order - b.order)
      board.append(renderColumn(col, i, view!.columns, cards))
    })
    children.push(board)

    const closed = view.cards
      .filter((c) => c.closed && matches(c))
      .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
    if (closed.length && (archiveOpen || closed.some((c) => c.key === editingCard))) {
      const list = el('div', { class: 'list' })
      for (const c of closed) list.append(renderCard(c))
      const clear = el(
        'button',
        { class: `ghost${confirmClearArchive ? ' danger' : ''}`, title: t.clearArchiveHint },
        confirmClearArchive ? t.confirmClear(closed.length) : t.clearArchive
      )
      clear.onclick = async (e) => {
        e.preventDefault() // a button inside <summary> would otherwise toggle the section
        if (confirmClearArchive) {
          confirmClearArchive = false
          setView(await request<BoardView>('archive.clear', {}))
        } else {
          confirmClearArchive = true
          render(true)
          setTimeout(() => {
            if (confirmClearArchive) {
              confirmClearArchive = false
              render()
            }
          }, 3000)
        }
      }
      const summary = el('summary', { title: t.archiveHide }, el('span', { class: 'archive-title' }, t.archived(closed.length)), clear)
      // Its title line puts it away, like the toolbar button.
      summary.onclick = (e) => {
        e.preventDefault()
        if ((e.target as Element).closest('button')) return
        archiveOpen = false
        rememberArchiveOpen()
        render(true)
      }
      const details = el('details', { class: 'archive' }, summary, list)
      details.open = true
      children.push(details)
    }
  }

  // Everything under the toolbar is rebuilt; the toolbar itself stays where it is.
  if (toolbar.parentNode !== root) root.replaceChildren(toolbar)
  while (root.lastChild && root.lastChild !== toolbar) root.lastChild.remove()
  root.append(...children)
  keepPicked()
}

/** A step of the mouse, made by this machine's own worker (never the server's: that mouse is someone else's). */
const replyMouse = (op: MouseOp): Promise<boolean> =>
  orca.plugin
    .request('keys.click' as never, { op } as never)
    .then((r) => (r as { ok?: boolean } | null)?.ok === true)
    .catch(() => false)
setReplyMouse(replyMouse)

// ---------- arrow keys ----------

/** The card the arrow keys are on. Redrawing replaces every card, so the keys go back to it by name. */
let pickedKey: string | null = null

/** After a redraw, or when a reply box closes: the keys return to the picked card, unless they are somewhere of their own. */
function keepPicked(): void {
  if (!pickedKey || replyKey()) return
  const at = document.activeElement
  if (at && at !== document.body && !at.classList.contains('card')) return
  const card = [...document.querySelectorAll<HTMLElement>('.board .card')].find((c) => c.dataset.key === pickedKey)
  if (!card) pickedKey = null
  else if (at !== card) card.focus({ preventScroll: true })
}

/**
 * Arrow keys walk the board's cards (up and down in a column, left and right between columns that
 * have cards); Enter on a card opens its reply box, as the card itself already does. The first
 * arrow goes to the first chat that waits for your answer, or the first card.
 */
function onArrow(e: KeyboardEvent): void {
  // Escape puts away the preview the arrow keys brought up (a reply box has its own Escape).
  if (e.key === 'Escape' && !replyKey() && !editingCard) hidePreview()
  const step = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key]
  if (!step || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.isComposing || replyKey() || editingCard) return
  const at = document.activeElement as HTMLElement | null
  if (at && at !== document.body && !at.classList.contains('card')) return
  e.preventDefault()
  walk(step[0], step[1])
}

/**
 * The card one step from the one the keys are on; the first card to go to when they are on none;
 * the card itself at an edge. `openOnly` steps over cards whose chat is closed (they have no reply box).
 */
function cardAt(dx: number, dy: number, openOnly: boolean): HTMLElement | null {
  const at = document.activeElement
  const columns = [...document.querySelectorAll('.board .column')]
    .map((col) => [...col.querySelectorAll<HTMLElement>('.card')])
    .filter((cards) => cards.length)
  if (!columns.length) return null
  const on = (c: HTMLElement) => c === at || c.dataset.key === pickedKey
  let x = columns.findIndex((cards) => cards.some(on))
  if (x < 0) return document.querySelector<HTMLElement>('.board .card.answer-due') ?? columns[0][0]
  let y = columns[x].findIndex(on)
  const from = columns[x][y]
  for (;;) {
    const nx = Math.min(columns.length - 1, Math.max(0, x + dx))
    const ny = Math.min(columns[nx].length - 1, Math.max(0, y + dy))
    const target = columns[nx][ny]
    const closed = view?.cards.find((c) => c.key === target.dataset.key)?.closed === true
    if (!openOnly || !closed) return target
    // Nothing but closed chats that way: the keys stay where they are.
    if (nx === x && ny === y) return from
    x = nx
    y = ny
  }
}

/**
 * With the reply boxes following the arrow keys, the keys go round the checked chats that are open:
 * right and down to the next one in the board's order (column by column, top to bottom), left and
 * up to the one before, and from the last on to the first. They are the chats you answer; the
 * others are a click away. Null when none is checked: then the keys walk all the cards.
 */
function nextChecked(dir: 1 | -1): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>('.board .column .card')]
  const checked = all.filter((el) => {
    const c = view?.cards.find((x) => x.key === el.dataset.key)
    return !!c?.watch && !c.closed
  })
  if (!checked.length) return null
  const at = document.activeElement
  const here = all.findIndex((c) => c === at || c.dataset.key === pickedKey)
  // The keys are on no card yet: the first chat that waits for your answer, or the first one.
  if (here < 0) return checked.find((c) => c.classList.contains('answer-due')) ?? checked[0]
  const i = checked.indexOf(all[here])
  if (i >= 0) return checked[(i + dir + checked.length) % checked.length]
  // On a card that is not checked: the nearest checked one that way, round the end too.
  const ahead = dir > 0 ? checked.find((c) => all.indexOf(c) > here) : [...checked].reverse().find((c) => all.indexOf(c) < here)
  return ahead ?? (dir > 0 ? checked[0] : checked[checked.length - 1])
}

/**
 * From a reply box, where only left and right walk (up and down pick from a list on the chat's
 * screen): the open chat before or after this one in the board's order, column by column, top to
 * bottom, and round the end. With the four keys of the board a column could be walked down; with two
 * the order has to reach every card.
 */
function nextInOrder(dir: 1 | -1): HTMLElement | null {
  const open = [...document.querySelectorAll<HTMLElement>('.board .column .card')].filter(
    (el) => view?.cards.find((c) => c.key === el.dataset.key)?.closed !== true
  )
  if (!open.length) return null
  const here = open.findIndex((c) => c.dataset.key === pickedKey)
  if (here < 0) return open.find((c) => c.classList.contains('answer-due')) ?? open[0]
  return open[(here + dir + open.length) % open.length]
}

/** One step of the arrow keys, from the board or (with the setting on) from an open reply box. */
function walk(dx: number, dy: number): void {
  const box = replyKey()
  // A box that opened by itself, or from a click: the keys go on from its card.
  if (box) pickedKey = box
  const dir = dx + dy > 0 ? 1 : -1
  const target = !arrowsOpenReply ? cardAt(dx, dy, false) : (nextChecked(dir) ?? (box ? nextInOrder(dir) : cardAt(dx, dy, true)))
  if (!target || (box && target.dataset.key === box)) return
  pickedKey = target.dataset.key ?? null
  if (!box) target.focus()
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  const picked = view?.cards.find((c) => c.key === pickedKey)
  if (arrowsOpenReply && picked && !picked.closed) return showReply(picked, 'arrow')
  // The card the keys are on shows what a hover would: your last prompt and the agent's reply.
  // (Showing its terminal instead would hand Orca's keyboard to that terminal at every step.)
  if (picked && show.preview && !picked.closed) schedulePreview(picked.key, target, true)
  else hidePreview()
}

// ---------- boot ----------

function boot(): void {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.append(style)
  const app = document.createElement('div')
  app.id = 'app'
  app.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0'
  document.body.append(app)
  document.addEventListener('focusout', () => setTimeout(() => pendingRender && render(), 0))
  document.addEventListener('keydown', onArrow)
  // A card you clicked or tabbed to is where the arrow keys go on from.
  document.addEventListener('focusin', (e) => {
    const card = (e.target as Element).closest?.('.board .card') as HTMLElement | null
    if (card?.dataset.key && e.target === card) pickedKey = card.dataset.key
    // The keys went somewhere of their own (a field, a button): the arrow keys' preview goes.
    else if (!card) hidePreview()
  })
  window.addEventListener('blur', () => hidePreview())
  // While a button of the board is held down, redraws wait: the click belongs to the button that
  // was pressed, and a new one in its place would never get it.
  document.addEventListener('pointerdown', (e) => {
    pressing = !!(e.target as Element | null)?.closest?.('#app button')
  })
  const released = () => {
    if (!pressing) return
    pressing = false
    setTimeout(() => pendingRender && render(), 0)
  }
  document.addEventListener('pointerup', released)
  document.addEventListener('pointercancel', released)
  document.addEventListener('dragend', released)

  orca.plugin.on('board.changed', (next) => setView(next as BoardView))
  // Your shortcut for the board: the keys come back from a terminal, to the open reply box, or
  // else to the card they were on (or the first chat that waits for your answer).
  // The same shortcut pressed here, on the board or in a reply box, hands the keys to the chat's
  // terminal (asked for on 2026-11-18: one key there and back). Orca's own shortcut does not fire
  // while the keys are in this panel (seen on b9), so the panel takes the key itself.
  let handedAt = 0
  let handing = false
  document.addEventListener(
    'keydown',
    (e) => {
      // Alt+' (Alt+K until 2026-11-18, changed at your word).
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey || e.code !== 'Quote') return
      e.preventDefault()
      e.stopImmediatePropagation()
      // Pressed again while the chat is still being shown (a second or two here): once is enough.
      if (e.repeat || handing) return
      const key = replyKey() ?? pickedKey
      const c = key ? view?.cards.find((x) => x.key === key) : undefined
      if (!c || c.closed) return trace(`keys to the terminal by the shortcut: ${c ? 'its chat is closed' : 'no chat picked'}`)
      handedAt = Date.now()
      handing = true
      // The box stays as it is, but no longer reaches for the keys once its chat has them.
      letKeysGo()
      // Leaving: the field lets go, and the input method with it (the box stays as it is).
      ;(document.activeElement as HTMLElement | null)?.blur()
      // Orca shows the chat screen but leaves the keys here when that browser tab is on screen
      // already (b9, 2026-11-18): a click is made for you where you last clicked in its terminal.
      // The chat on screen there already (asked for by this board last): no showing it again,
      // which takes 1.5 s or more, only the click (2026-11-18: "can it be quicker?").
      const there = shownHere === c.key
      const began = Date.now()
      void (there ? Promise.resolve() : focusChat(c))
        .then(() => replyMouse('to-chat'))
        .then((clicked) =>
          trace(
            `keys to the terminal by the shortcut: ${c.key.slice(0, 8)}, ${there ? 'on screen already, ' : ''}${clicked ? 'clicked into the chat screen' : 'no click made'} in ${Date.now() - began} ms`
          )
        )
        .finally(() => {
          handing = false
          handedAt = Date.now()
        })
    },
    true
  )
  // The browser tab with the chat screen went out of sight: Alt+K shows the chat again before clicking.
  orca.plugin.on('chat.hidden', () => {
    shownHere = null
  })
  orca.plugin.on('keys.bring', () => {
    // Should Orca's shortcut fire too for the key just taken here, the keys are not pulled back.
    if (Date.now() - handedAt < 800) return
    void bringKeys(() => {
      if (focusReply()) {
        // Seen on b9 (2026-11-18): with the Korean input method on, the field had the keys and
        // every key came as 'Process', yet nothing was typed in it: the input method stayed with
        // the chat screen's page. Out of the field and back in, so that it moves here too.
        setTimeout(() => {
          ;(document.activeElement as HTMLElement | null)?.blur()
          setTimeout(() => focusReply(), 30)
        }, 30)
        return
      }
      const cards = [...document.querySelectorAll<HTMLElement>('.board .card')]
      const card = cards.find((c) => c.dataset.key === pickedKey) ?? cards.find((c) => c.classList.contains('answer-due')) ?? cards[0]
      if (!card) return
      pickedKey = card.dataset.key ?? null
      card.focus()
    }).then((what) => {
      trace(`keys by the shortcut: ${what}`)
    })
  })
  orca.on('agent.status.changed', ({ terminalId, state, receivedAt, mainAgent }) => {
    const card = view?.cards.find((c) => c.handle && c.handle === terminalId)
    const outcome = mainAgent?.outcome ?? null
    const main = mainAgent?.state ?? null
    if (!card || (card.state === state && card.outcome === outcome && card.mainState === main)) return
    if (card.state !== state) card.stateAt = mainAgent?.stateStartedAt ?? receivedAt
    card.state = state
    card.outcome = outcome
    card.mainState = main
    render()
    wakeCheck()
  })
  // Orca has no event for switching tabs: while the panel is on screen, ask every few seconds which
  // chat is open (open-chat highlight) and whether an unseen chat was opened. Redraw only on change.
  // While synced the same check brings what changed on Orca's board: a card's column, a status's name.
  const liveKey = (v: BoardView | null) =>
    JSON.stringify([
      // The state too: for a chat Orca lost track of, it comes from this check and not from an event.
      (v?.cards ?? []).map((c) => `${c.key}:${c.active ? 1 : 0}:${c.unseenAt ? 1 : 0}:${c.column}:${c.state}:${c.stateAt}:${c.goalFile ? `${c.goalFile.done}/${c.goalFile.total}` : ''}`).sort(),
      (v?.columns ?? []).map((c) => [c.id, c.title]),
      v?.orcaNames === true
    ])
  // Each check starts the orca CLI (a second or more of work), so it runs at two paces: every few
  // seconds while an agent is working or you are using the panel, and seldom while nothing moves.
  // It can also be turned off; ⟳ then does it on demand.
  // One check at a time: when a check takes longer than the pace (a busy machine), asking again
  // would only queue up in the worker and hold back everything else, Send included.
  const check = async () => {
    if (!autoCheck || checking || document.visibilityState !== 'visible' || !view) return
    checking = true
    try {
      const v = await orca.plugin.request('seen.check', {})
      if (liveKey(v as BoardView) !== liveKey(view)) setView(v as BoardView)
    } catch {
      // The next check tries again.
    } finally {
      checking = false
    }
  }
  const isAlert = () => Date.now() < alertUntil || (view?.cards ?? []).some((c) => !c.closed && c.state === 'working')
  const schedule = () => {
    idling = !isAlert()
    checkTimer = setTimeout(() => void check().then(schedule), idling ? CHECK_IDLE_MS : CHECK_MS)
  }
  // Something started moving while the check was at its slow pace: check now, then keep the fast one.
  wakeCheck = () => {
    if (!idling || !isAlert()) return
    clearTimeout(checkTimer)
    idling = false
    void check().then(schedule)
  }
  schedule()
  let moved = 0
  document.addEventListener('pointermove', () => {
    if (Date.now() - moved < 1000) return
    moved = Date.now()
    stayAlert()
  })
  // A checked chat may have finished while the panel was out of sight.
  document.addEventListener('visibilitychange', () => openNextWaiting())
  // Relative times ("5m") tick locally; this never calls Orca.
  setInterval(() => {
    render()
    openNextWaiting() // boxes held back when you left for a chat come back after a while
  }, 30_000)

  orca.settings.onDidChange(() => void loadSettings().then(() => render(true)))

  void loadSettings().then(() => {
    render(true)
    void load(true)
  })
}

boot()
