# Chat Board for Orca

A kanban of your **agent chats**: the Claude, Codex, Cursor, Gemini and other agent tabs you have open, terminal or chat, across every Orca workspace. Orca's Workspace Board groups work by workspace. Chat Board groups it by conversation, which helps when you keep many chats on different topics open in the same workspace.

![Chat Board in dark theme](assets/screenshot-dark.png)

> **This is a fork** of [SantiagoCaprile/orca-chat-board](https://github.com/SantiagoCaprile/orca-chat-board). The `workspace-sync` branch adds two things to release 1.1.1: the board works on Windows (upstream issue #1), and it can follow Orca's Workspace Board in both directions. Neither is in an upstream release yet. [Using this fork](#using-this-fork) explains how to run it.

## Install

```sh
orca plugin install SantiagoCaprile/orca-chat-board
```

Orca lists the access the plugin asks for (see [Permissions](#permissions)) and asks you to approve it. Then open **Chat Board** from the right sidebar's activity bar.

That installs the upstream release. On Windows it shows an empty board; use the fork as described below.

## Using this fork

The fork runs from a folder on your machine as an Orca *development plugin*. Orca loads the TypeScript files directly, so there is nothing to build, and it reloads the plugin whenever a file in the folder changes.

### Set it up (once)

1. Get the code and switch to the branch with both changes:

   ```sh
   git clone https://github.com/walden4u/orca-chat-board
   cd orca-chat-board
   git checkout workspace-sync
   ```

2. Load the folder into Orca:

   ```sh
   orca plugin dev load .
   ```

   The plugin runs code, so the first load stops with `approval_required`. It lists the access the plugin asks for (see [Permissions](#permissions)) and prints the same command with `--approve <fingerprint>`. Run that command to approve it.

3. If you also installed the upstream plugin from the catalog, turn it off so you do not get two Chat Board panels:

   ```sh
   orca plugin disable santiagocaprile.chat-board
   ```

4. Check that it runs. The fork shows up as `local.chat-board` with the `dev` tag:

   ```sh
   orca plugin list
   # local.chat-board 1.1.1  running  trusted-worker, dev
   ```

5. Open **Chat Board** from the right sidebar's activity bar, or run `orca plugin open local.chat-board`.

The folder now stays under **Settings → Plugins → Development folders**, and Orca loads it again each time it starts. To remove it, run `orca plugin dev unload local.chat-board`.

Do not edit the files of a plugin installed from the catalog. Orca checks their hash and disables the plugin when they change. Make changes in the development folder.

### A first look

Every agent tab you have open, in any workspace, is one card. With the default settings the board has four columns of its own (Backlog, In progress, In review, Done), and new chats land in the first one.

| You want to | Do this |
|---|---|
| Go to a chat | Click its card. Orca switches to that workspace and tab. |
| Move a chat | Drag its card to another column, or up and down within a column. |
| Rename a chat or add a note | Click ✎ on the card. Enter saves, Shift+Enter starts a new line in the note. |
| See what a chat was about | Hover its card for a moment. You get your last message and the agent's last reply. |
| Find a chat | Type in the filter box. It matches title, note, workspace and agent. |
| Update the board now | Click ⟳. |
| Clean up closed chats | They sit in **Archived**. Remove one with ✕ or all with **Clear**. |

The icon on a card is the agent's status: a spinner while it works, an hourglass when it waits for you, a check when it is done, a red cross when it was interrupted, an alert when it needs permission. A yellow card finished while you were looking at another chat. The card with a coloured ring is the chat you have open now.

### Use it together with the Workspace Board

Click **⇄** in the panel's toolbar (or turn on **Sync with the Workspace Board** in Settings). From then on the two boards show the same thing from two sides: Orca's board by workspace, this one by chat.

- **Columns are workspace statuses.** You get Todo, In progress, In review and Done, plus every custom status that a workspace is using. Turning sync on replaces the columns you had; each chat goes to the column of its workspace's status.
- **Drag a chat here, and Orca follows.** Dropping a card in another column sets that workspace's status in Orca. The other chats of the same workspace move along, because a workspace has only one status.
- **Move a workspace in Orca, and the chats follow here.** Orca does not announce the change, so the panel shows it within about 10 seconds. Click ⟳ to see it at once.
- **Orca's side wins.** At every refresh the cards are put back in the column of their workspace's status.
- **Column names are Orca's status names.** Rename a status in Orca and the column follows at the next refresh. In Orca, open the Workspace Board, then its **Board settings** menu; the **Statuses** list there renames, adds and removes statuses. While the names come from Orca, a column cannot be renamed here.
- **Columns can be reordered (‹ ›) and collapsed (⇤) here, but not added or deleted.** A status you add in Orca gets a column at once, and one you remove loses its column once no workspace uses it.
- **If the names cannot be read**, the columns keep the names they had, a new custom status shows up under its id (`status-5`), and you can rename columns here again by double-clicking the title. See [how the names are read](#how-the-status-names-are-read).
- **"Move to In progress when you start a chat" is off while synced**, since the status now belongs to the workspace.

Click ⇄ again to stop. The columns stay as they are and become ordinary columns that you can rename, add to and delete.

#### How the status names are read

Neither Orca's CLI nor its plugin API tells a plugin what a status is called. So, only while the sync is on, the worker opens Orca's own profile database read-only and takes the status list from it: `profile-state.db` in the active profile's folder under Orca's data folder (`%APPDATA%\orca` on Windows), document `ui`, field `workspaceStatuses`. It reads the id and the label of each status and nothing else, and never writes to that file.

This is not an Orca interface, so an Orca update can change it. When the read fails for any reason, the worker logs `status names not read from Orca's profile` once and the board carries on with the names it has. It has been tried on Windows with Orca 1.4.255 only.

### When something looks wrong

| What you see | What to do |
|---|---|
| The board is empty or shows an error | Run `orca plugin logs local.chat-board`. A failed CLI call is logged with the reason the CLI gave. |
| The plugin is listed but not `running` or `idle` | It is waiting for approval. Run `orca plugin dev reload .` and follow the `--approve` command it prints. |
| A column is called `status-5` | The status names could not be read from Orca. Look for `status names not read` in `orca plugin logs local.chat-board`; meanwhile, double-click the title to rename the column. |
| Double-clicking a column title does nothing | The sync is on and the name is Orca's. Rename the status in Orca. |
| A card did not move after you changed a status in Orca | Wait 10 seconds or click ⟳. |
| A card has no status icon | Orca has not reported a status for that session yet. See [Limitations](#limitations). |

## What it does

**Board**
- Every tab that runs an agent gets a card: terminal tabs, and Orca's chat tabs once they have a conversation. New chats land in the first column.
- Make your own columns: add, rename (double-click the title), reorder (‹ ›), collapse into a narrow strip (⇤) and delete.
- Drag cards between columns and within a column.
- Filter by title, note, workspace or agent.

**Live status**
- Each card shows the agent's status as an icon: working (spinner), waiting for you (hourglass), done (check), interrupted (red cross), needs permission (alert).
- **Not seen yet:** when an agent stops working while you are looking at another chat, its card turns yellow with a dot, like Orca's unread tab. Its column header gets a dot too. The mark clears when you open the chat or when the agent starts working again.
- **Open chat:** the chat you have open in Orca gets a ring in its column's colour.
- **Monitoring:** loops and watchers get Orca's pulse icon and their next run ("next 3m"). That covers `/loop` (`ScheduleWakeup`), `CronCreate` schedules and `Monitor` watches. When a loop misses its run by about one interval, the card shows "no signal".
- Each card shows the agent's logo. All 45 agents Orca knows have one, the same icons Orca uses.

**Working with chats**
- Hover a card for a moment to see your last message and the agent's last reply.
- Click a card to open its chat. Dragging moves the card instead.
- ✎ renames the chat's Orca tab and edits the card's note. Enter saves; Shift+Enter adds a new line to the note.
- When you start talking to a chat in **Backlog**, its card moves to **In progress**. You can turn this off.
- A chat you close goes to **Archived** and keeps its column and note. Remove one card with ✕, or all of them with **Clear**.

The UI follows Orca's theme (light or dark) and language (Spanish for `es-*`, English otherwise).

![Chat Board in light theme](assets/screenshot-light.png)

## Settings

Under **Settings → Plugins → Chat Board**:

| Setting | Default |
|---|---|
| Move to In progress when you start a chat | on |
| Sync with the Workspace Board | off |
| Check Orca automatically | on |
| Show agent logo | on |
| Show workspace | on |
| Show agent status icon | on |
| Show time since last change | on |
| Show notes | on |
| Show a preview on hover | on |
| Language (Auto, English, Español) | Auto |

### Check Orca automatically

Orca does not tell plugins when you switch tabs, so while the panel is on screen it asks Orca every 3 seconds. Each check starts the `orca` CLI once (close to a second of work on Windows). Turn the setting off to stop that and update by hand:

| | On | Off |
|---|---|---|
| Agent status icons | live | live |
| A chat opens or closes | at once | at once |
| Ring around the open chat | within 3 seconds | when you click a card here, or on ⟳ |
| Yellow "not seen yet" mark clears | within 3 seconds | when you click the card here, or on ⟳ |
| Changes made on Orca's Workspace Board (with the sync on) | within about 10 seconds | on ⟳ |

Opening the panel always reads the board afresh, and ⟳ works either way.

### Sync with the Workspace Board

Turn it on in Settings or with the ⇄ button in the panel. The board then follows Orca's Workspace Board in both directions:

- The columns are Orca's workspace statuses (Todo, In progress, In review, Done and your custom ones).
- Dragging a chat to another column sets its workspace's status in Orca. The other chats of that workspace move with it, because a workspace has one status.
- Moving a workspace on Orca's board moves its chats here. Orca does not announce the change, so the panel picks it up within about 10 seconds, or at once with ⟳.
- You can reorder and collapse columns here. Statuses are renamed, added and removed in Orca, and the columns follow. The names come from Orca's profile database, read-only (see [how the names are read](#how-the-status-names-are-read)); if that fails, a custom status shows up under its id (`status-5`) and you can rename the column here.
- "Move to In progress when you start a chat" does not apply while synced.

## Permissions

Orca asks you to approve these when you install the plugin. Here is what each one is used for:

| Permission | What the plugin does with it |
|---|---|
| **Runs its own code** (Node worker) | Lists your chats in every workspace, opens a chat and renames its tab. The worker only ever runs these Orca CLI commands: `orca terminal list`, `orca terminal switch`, `orca terminal rename`, `orca worktree ps` (agents and status, chat tabs included), `orca chat rename` and `orca worktree activate`; with the Workspace Board sync on, also `orca worktree list` and `orca worktree set --workspace-status`. With that sync on, the worker also reads the workspace statuses' ids and names from Orca's profile database, read-only, because no command returns them. The plugin API alone sees only the focused workspace and cannot open or rename tabs. |
| `storage:own` | Saves the board: columns, card positions, notes, agent status and monitors. All of it stays in the plugin's own folder. |
| `agent:read` | Agent status icons, the yellow "not seen yet" mark, and moving a Backlog card when you start a chat. |
| `workspace:read` | Knows which tab you are looking at, for the "not seen yet" mark and the open-chat highlight, and refreshes the board when chats open or close. |
| `settings:own` | The plugin's options in Orca's Settings. |
| Hook `agent.tool.after` (observe only) | Detects loops and watchers. Orca hands this hook every tool call an agent makes. The plugin looks only at `ScheduleWakeup`, `CronCreate`/`CronDelete`, `Monitor` and `TaskStop`, keeping their timing and description, and drops every other call without storing it. The hook never blocks or changes a call. |

The plugin makes no network requests and sends nothing anywhere. Some of what Orca's CLI returns, such as a preview of each terminal's latest output and the agent's last message, prompt or tool input, is never stored or shown by the plugin; it keeps only titles, agent type and status. The hover preview reads your last prompt and the agent's last reply from Orca when you hover a card, shows them, and keeps them for a few seconds in memory only.

## Limitations

- Orca puts plugin panels in the right sidebar only.
- Orca does not tell plugins about tab switches. While the panel is on screen, it checks which chat is open every 3 seconds.
- Monitoring is recognised from tool calls, because Orca does not expose its own monitoring state to plugins. Only Claude Code's tool names are known so far. Orca does not run this hook for agents on SSH or WSL hosts.
- Upstream is tested on macOS. This fork is used on Windows 10 with Orca 1.4.255. On Linux the worker uses the CLI launcher Orca ships (`orca-ide`), but this has not been tried yet. If the board stays empty there, please open an issue.
- Orca's chat tabs show up once they have a conversation. A click opens their workspace but not the tab itself, because Orca cannot switch to a chat tab from outside yet. Loop monitoring is not detected in chat tabs, since Orca's tool hook names no terminal for them.
- A chat shows no status icon until Orca reports one for it. Some sessions, such as ones started before Orca's status hooks were set up, never report.

## How it works

- `src/worker.ts` is a Node worker. It lists chats through the Orca CLI, tracks agent status and tool calls from Orca's events and hooks, and answers the panel.
- `src/board.ts` holds the pure board logic: merging chats, moving cards, columns and the unseen mark. A chat that comes back with a new tab id, for example after an Orca restart, is matched back to its card by pty id, or by title and workspace.
- `src/sync.ts` holds the rules of the Workspace Board sync, and `src/profile.ts` reads the status names from Orca's profile.
- `src/monitor.ts` recognises loops and watchers from tool calls and decides when one has lost its signal.
- `panel/` is the HTML panel. It uses native drag & drop, and holds the strings (`i18n.ts`), status icons (`icons.ts`) and agent logos (`logos.ts`).

## Development

```sh
orca plugin dev watch . --check   # load this folder into Orca and reload on save
orca plugin test .                # tests
npx -y -p typescript tsc -p tsconfig.ci.json --noEmit   # type-check
orca plugin shot local.chat-board --panel board --width 900 --out board.png
orca plugin logs local.chat-board # the worker's log
```

Type-check with `tsconfig.ci.json`. `tsc -p .` writes `.js` files next to the sources.

CI (GitHub Actions, Linux, macOS and Windows) type-checks against a snapshot of Orca's typings and runs the tests that need no Orca host. See [`ci/`](ci/README.md).

## Credits

The agent logos are the ones Orca ships for each agent. They belong to their respective owners.

## License

[MIT](LICENSE)
