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
}

/** What you typed and did not send, per chat, until the panel reloads. */
const drafts = new Map<string, string>()
let close: (() => void) | null = null

export function closeReply(): void {
  close?.()
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

export function openReply(target: ReplyTarget, onSent: (title: string) => void): void {
  closeReply()

  const backdrop = node('div', 'reply-backdrop')
  const dialog = node('div', 'reply')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-label', t.replyTitle(target.title))

  const head = node('div', 'reply-head')
  const shut = node('button', 'ghost', '✕')
  shut.title = t.close
  shut.setAttribute('aria-label', t.close)
  head.append(node('span', 'reply-title', target.title))
  if (target.workspace) head.append(node('span', 'chip ws', target.workspace))
  head.append(shut)

  const body = node('div', 'reply-body')
  body.append(node('div', 'preview-text preview-empty', t.replyLoading))

  const foot = node('div', 'reply-foot')
  const hint = target.chatTab ? t.replyChatTab : target.working ? t.replyWorking : ''
  if (hint) foot.append(node('div', 'reply-hint', hint))
  const input = node('textarea', 'reply-input')
  input.rows = 3
  input.placeholder = t.replyPlaceholder
  input.setAttribute('aria-label', t.replyTitle(target.title))
  input.value = drafts.get(target.key) ?? ''
  input.disabled = target.chatTab
  const status = node('span', 'reply-status')
  status.setAttribute('role', 'status')
  const send = node('button', 'primary', t.send)
  send.disabled = target.chatTab
  const row = node('div', 'reply-row')
  row.append(status, send)
  foot.append(input, row)

  dialog.append(head, body, foot)
  backdrop.append(dialog)

  let open = true
  let busy = false
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.isComposing && !busy) shutBox()
  }
  const shutBox = () => {
    if (!open) return
    open = false
    if (input.value.trim()) drafts.set(target.key, input.value)
    else drafts.delete(target.key)
    document.removeEventListener('keydown', onKey, true)
    backdrop.remove()
    close = null
  }
  close = shutBox

  const submit = async () => {
    const text = input.value.trim()
    if (busy || !text || target.chatTab) return
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
      onSent(target.title)
      return
    }
    send.disabled = false
    input.readOnly = false
    send.textContent = t.send
    status.textContent =
      result.error === 'closed' ? t.chatClosed : result.error === 'chat-tab' ? t.replyChatTab : t.replyFailed(result.error ?? '')
    input.focus()
  }

  shut.onclick = shutBox
  send.onclick = () => void submit()
  // A click on the dimmed board closes the box; what you typed is kept for this chat.
  backdrop.onmousedown = (e) => {
    if (e.target === backdrop && !busy) shutBox()
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
  if (!target.chatTab) setTimeout(() => input.focus(), 0)

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
