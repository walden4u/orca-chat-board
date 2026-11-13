# Changelog

## Unreleased

- **Sync with the Workspace Board** (off by default): columns become Orca's workspace statuses. Dragging a chat sets its workspace's status, and moving a workspace on Orca's board moves its chats. Turn it on in Settings or with the ⇄ button.
- **Synced column names follow Orca:** rename, add or remove a status on Orca's Workspace Board and the columns follow. Orca has no command for the status names, so the worker reads them from Orca's profile database, read-only. If that fails, the board keeps its names and lets you rename columns as before.
- **Check Orca automatically** (on by default): turn it off to stop the check that runs every 3 seconds while the panel is on screen, and update with ⟳ instead.
- **Synced boards update by themselves:** a change made on Orca's board (a workspace moved, a status renamed) was read but not drawn until something else changed.
- **Reply box:** a click on a card now shows your last message and the agent's whole last reply, and lets you answer. A double-click, or ↗, opens the chat in Orca as a click did before. Send types your text into that chat's terminal (`orca terminal send`). Orca's chat tabs can be read but not answered.
- **Checked chats open by themselves:** check a card and its reply box opens when its agent finishes; answering or pressing Next opens the next one that finished. The check mark stays on the card and unchecks with a click.
- **Reply box on a chat Orca lost track of:** when Orca's record of a chat is behind its terminal, the box shows the terminal's screen as it is now under the old exchange, with the time of the record. What you sent from the box is shown until the record catches up.
- **Status for chats Orca lost track of:** a session that stopped reporting to Orca stayed "done" on its card for hours while it worked. Its status is now read off its terminal (fresh output and a busy screen), so the card, the unseen mark and a checked chat's reply box follow it again.
- **Chats that finish close together:** the end of a turn could be read from a listing before its event arrived; the event then looked like nothing new, so the card got no unseen mark and a checked chat opened no reply box. Either way of learning it now counts.
- **Send no longer waits behind the automatic check:** on a busy machine the checks queued up in the worker and Send timed out after 30 seconds. One check runs at a time, and Send does not go through that queue.
- **Images in a reply:** paste or drop images into the reply box and Send attaches them to the prompt (Claude Code shows them as `[Image #1]`).
- **Korean UI:** the panel is in Korean when Orca is, or when you pick 한국어 under Language.
- **Filter:** text typed through an IME (Korean, Japanese, Chinese) arrived as loose letters, because the filter box was replaced on every keystroke.
- **Bigger hover preview:** as wide as the panel and as tall as the room above or below the card, with the reply shown from its start.
- **Hover preview:** a second popover could stay on screen when the board was redrawn under the pointer.
- **Windows:** the board listed nothing because Orca starts plugin workers without `APPDATA`, which `orca.exe` needs. The worker now passes it. A failing CLI call also shows the CLI's own reason.

## 1.1.1

- **Monitoring pulse for background work:** a chat whose turn ended while background commands, monitors, crons or subagents are still running now shows the monitoring pulse instead of the working spinner. This follows Orca's own rule and works for any agent.

## 1.1.0

- **Orca chat tabs:** agents opened in Orca's chat view now get cards, once they have a conversation. Clicking one opens its workspace, since Orca can't switch to a chat tab from a plugin yet. Renaming uses `orca chat rename`. The yellow "not seen yet" mark follows Orca's own unread flag.
- **Status for every chat:** terminal chats that never sent a status event take their status from Orca's own record.
- **Hover preview:** hover a card to see your last message and the agent's last reply. It is read from Orca when you hover, never stored, and fades in and out. You can turn it off in Settings with "Show a preview on hover".
- **Windows and Linux:** the worker runs the CLI launcher that Orca ships (`orca.exe`, `orca-ide`), with no shell.
- **CI:** type-check and the tests that need no Orca host run on Linux, macOS and Windows.

## 1.0.0

First release: a kanban of agent chats across workspaces, with live status icons, the "not seen yet" mark, the open-chat highlight, loop monitoring, renaming tabs, notes, auto-move to In progress, archive, settings, and English and Spanish UI.
