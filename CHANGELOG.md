# Changelog

## Unreleased

- **Sync with the Workspace Board** (off by default): columns become Orca's workspace statuses. Dragging a chat sets its workspace's status, and moving a workspace on Orca's board moves its chats. Turn it on in Settings or with the ⇄ button.
- **Synced column names follow Orca:** rename, add or remove a status on Orca's Workspace Board and the columns follow. Orca has no command for the status names, so the worker reads them from Orca's profile database, read-only. If that fails, the board keeps its names and lets you rename columns as before.
- **Check Orca automatically** (on by default): turn it off to stop the check that runs every 3 seconds while the panel is on screen, and update with ⟳ instead.
- **Synced boards update by themselves:** a change made on Orca's board (a workspace moved, a status renamed) was read but not drawn until something else changed.
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
