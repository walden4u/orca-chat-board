// Reply box: a card's whole last exchange (your prompt, the agent's reply) with a field to answer
// it. Send types your text into that chat's terminal as the next prompt; nothing is sent before.
// The box lives outside the board, so the board's redraws never touch what you are typing.
import { t } from './i18n.ts'
import { loadPreview, plain } from './preview.ts'

export type ReplyTarget = {
  key: string
  title: string
  workspace: string
  /** An Orca chat tab: it can be read, but Orca has no way to send to one. */
  chatTab: boolean
  working: boolean
  /** The agent asks for permission: that is answered in the chat itself, not with a message. */
  blocked: boolean
  /**
   * The box opened by itself (a checked chat finished). It then leaves the keyboard where it is:
   * you may be typing in a terminal, and that text must not land here.
   */
  auto: boolean
  /** Checked chats that finished and wait behind this one. */
  waiting: number
}

export type ReplyHandlers = {
  onSent: (title: string) => void
  /** Show the chat itself in Orca. */
  onOpenChat: () => void
  /** Read, not answered: on to the next waiting chat. */
  onNext: () => void
  /** Closed by hand (✕, Escape, a click outside). */
  onClosed: () => void
}

/** The second click of a double-click on a card lands on the box that the first one opened. */
const DOUBLE_CLICK_MS = 500

/** What you typed and did not send, per chat, until the panel reloads. */
const drafts = new Map<string, string>()
let current: { key: string; shut: () => void; setWaiting: (n: number) => void } | null = null

/** The chat whose box is open, if any. */
export const replyKey = (): string | null => current?.key ?? null

/** Closes the box without telling anyone (the draft is kept). */
export function closeReply(): void {
  current?.shut()
}

/** The number of chats waiting behind the open box changed. */
export function setReplyWaiting(n: number): void {
  current?.setWaiting(n)
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

function section(who: string, text: string, cls: string): HTMLElement {
  const s = node('div', `preview-${cls}`)
  s.append(node('div', 'preview-who', who), node('div', 'preview-text', text))
  return s
}

export function openReply(target: ReplyTarget, handlers: ReplyHandlers): void {
  closeReply()
  const openedAt = Date.now()
  const readOnly = target.chatTab || target.blocked

  const backdrop = node('div', 'reply-backdrop')
  const dialog = node('div', 'reply')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-label', t.replyTitle(target.title))

  const head = node('div', 'reply-head')
  const shut = node('button', 'ghost', '✕')
  shut.title = t.close
  shut.setAttribute('aria-label', t.close)
  const toChat = node('button', 'ghost', '↗')
  toChat.title = t.openChat
  toChat.setAttribute('aria-label', t.openChat)
  const waiting = node('span', 'reply-waiting')
  head.append(node('span', 'reply-title', target.title))
  if (target.workspace) head.append(node('span', 'chip ws', target.workspace))
  head.append(waiting, toChat, shut)

  const body = node('div', 'reply-body')
  body.append(node('div', 'preview-text preview-empty', t.replyLoading))

  const foot = node('div', 'reply-foot')
  const hint = target.chatTab ? t.replyChatTab : target.blocked ? t.replyBlocked : target.working ? t.replyWorking : ''
  if (hint) foot.append(node('div', 'reply-hint', hint))
  const input = node('textarea', 'reply-input')
  input.rows = 3
  input.placeholder = t.replyPlaceholder
  input.setAttribute('aria-label', t.replyTitle(target.title))
  input.value = drafts.get(target.key) ?? ''
  input.disabled = readOnly
  const status = node('span', 'reply-status')
  status.setAttribute('role', 'status')
  const next = node('button', 'ghost reply-next', t.next)
  next.title = t.nextHint
  const send = node('button', 'primary', t.send)
  send.disabled = readOnly
  const row = node('div', 'reply-row')
  row.append(status, next, send)
  foot.append(input, row)

  dialog.append(head, body, foot)
  backdrop.append(dialog)

  const setWaiting = (n: number) => {
    waiting.textContent = n > 0 ? t.replyWaiting(n) : ''
    waiting.hidden = n <= 0
    next.hidden = n <= 0
  }
  setWaiting(target.waiting)

  let open = true
  let busy = false
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.isComposing && !busy) leave(handlers.onClosed)
  }
  const shutBox = () => {
    if (!open) return
    open = false
    if (input.value.trim()) drafts.set(target.key, input.value)
    else drafts.delete(target.key)
    document.removeEventListener('keydown', onKey, true)
    backdrop.remove()
    current = null
  }
  /** Closes the box, then says how it was left. */
  const leave = (then: () => void) => {
    if (busy) return
    shutBox()
    then()
  }
  current = { key: target.key, shut: shutBox, setWaiting }

  const submit = async () => {
    const text = input.value.trim()
    if (busy || !text || readOnly) return
    busy = true
    send.disabled = true
    input.readOnly = true
    send.textContent = t.sending
    status.textContent = ''
    let result: { ok: boolean; error: string | null }
    try {
      result = await orca.plugin.request('chat.send', { key: target.key, text })
    } catch (err) {
      result = { ok: false, error: (err as Error).message }
    }
    busy = false
    if (result.ok) {
      input.value = ''
      shutBox()
      handlers.onSent(target.title)
      return
    }
    send.disabled = false
    input.readOnly = false
    send.textContent = t.send
    status.textContent =
      result.error === 'closed' ? t.chatClosed : result.error === 'chat-tab' ? t.replyChatTab : t.replyFailed(result.error ?? '')
    input.focus()
  }

  shut.onclick = () => leave(handlers.onClosed)
  toChat.onclick = () => leave(handlers.onOpenChat)
  next.onclick = () => leave(handlers.onNext)
  send.onclick = () => void submit()
  // Double-click on a card: its first click opened this box, its second one arrives here.
  // Not for a box that opened by itself: a double-click meant for something else could meet it.
  backdrop.addEventListener(
    'mousedown',
    (e) => {
      if (target.auto || e.detail < 2 || Date.now() - openedAt > DOUBLE_CLICK_MS) return
      e.preventDefault()
      e.stopPropagation()
      leave(handlers.onOpenChat)
    },
    true
  )
  // A click on the dimmed board closes the box; what you typed is kept for this chat.
  backdrop.onmousedown = (e) => {
    if (e.target === backdrop) leave(handlers.onClosed)
  }
  input.onkeydown = (e) => {
    // Enter sends, Shift+Enter adds a line. While an IME composes (Korean, Japanese…), Enter
    // belongs to the IME: it confirms the word and must not send (keyCode 229 in older engines).
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return
    e.preventDefault()
    void submit()
  }
  document.addEventListener('keydown', onKey, true)

  document.body.append(backdrop)
  if (!readOnly && !target.auto) setTimeout(() => input.focus(), 0)

  void loadPreview(target.key, true).then(
    (data) => {
      if (!open) return
      body.replaceChildren()
      if (data.prompt) body.append(section(t.previewYou, plain(data.prompt), 'you'))
      if (data.message) body.append(section(t.previewAgent, plain(data.message), 'agent'))
      if (!data.prompt && !data.message) body.append(node('div', 'preview-text preview-empty', t.previewEmpty))
    },
    () => {
      if (open) body.replaceChildren(node('div', 'preview-text preview-empty', t.previewEmpty))
    }
  )
}
