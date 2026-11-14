// Candidate cases for the judge experiment. Each plants one problem in a pure function of the
// plugin (or leaves it right). `kind`: bug = altered behaviour, incomplete = a required behaviour
// left out, ok = correct. `goal` names the criteria the judge is given; `breaks` the criterion hit.

export const GOALS = {
  syncColumns: `\`src/sync.ts\`의 \`syncColumns(prev, inUse, statuses)\`가 아래를 지켜야 한다.
1. \`prev\`에 있던 컬럼은 순서와 접힘 상태를 그대로 유지한다.
2. Orca의 상태 목록 \`statuses\`가 있으면(비어 있지 않으면) 컬럼 제목은 Orca의 이름을 따른다.
3. \`statuses\`가 있을 때, 그 목록에 없는 컬럼은 없앤다. 단 그 상태를 쓰는 워크스페이스가 남아 있으면(\`inUse\`) 없애지 않는다.
4. 그 뒤에 아직 컬럼이 없는 상태를 차례로 덧붙인다: 먼저 Orca 목록의 상태(목록이 없거나 비어 있으면 기본 4개), 다음에 \`inUse\`의 상태(제목은 id). 같은 id가 두 번 들어가면 안 된다.
5. \`statuses\`가 없거나 비어 있으면 어떤 컬럼도 없애지 않고 제목도 바꾸지 않는다.`,
  editSyncedColumns: `\`src/sync.ts\`의 \`editSyncedColumns(current, requested, inUse, statuses)\`가 아래를 지켜야 한다.
1. \`requested\` 가운데 \`current\`에 있는 id의 컬럼만 받아들인다(새 컬럼은 추가할 수 없다).
2. \`requested\`에 같은 id가 여러 번 있으면 첫 번째만 쓴다. 결과에 같은 id가 두 번 나오면 안 된다.
3. 아직 필요한 상태(사용 중이거나 Orca 목록에 있는 것)는 \`requested\`에서 빠져 있어도 다시 들어온다.
4. 컬럼 순서는 \`requested\`의 순서를 따른다.`,
  applyWorkspaceStatuses: `\`src/sync.ts\`의 \`applyWorkspaceStatuses(prev, statusOf, statuses)\`가 아래를 지켜야 한다.
1. 열려 있는 카드는 자기 워크스페이스 상태의 컬럼으로 옮기고 그 컬럼의 맨 끝에 놓는다. 그 컬럼에 원래 있던 카드와 order가 겹치면 안 된다.
2. 닫힌(보관된) 카드는 워크스페이스 상태 때문에 옮기지 않는다.
3. 카드의 컬럼이 더는 없으면 첫 번째 컬럼으로 보낸다.
4. 바뀐 것이 없으면 \`prev\` 객체를 그대로 돌려준다. 카드가 하나도 안 움직여도 컬럼(구성이나 제목)이 바뀌었으면 새 상태를 돌려준다.
5. \`prev\`가 동기화 상태가 아니었으면 기존 컬럼은 버리고 상태 목록으로 새로 만든다.`,
  moveWorkspaceCards: `\`src/sync.ts\`의 \`moveWorkspaceCards(prev, key, column, index)\`가 아래를 지켜야 한다.
1. 지정한 카드를 \`column\`의 \`index\` 위치로 옮긴다.
2. 같은 워크스페이스의 다른 열린 카드 가운데 다른 컬럼에 있는 것들도 그 컬럼으로 옮기되, 이미 있는 카드들 뒤에, 서로의 원래 순서를 유지해서 놓는다.
3. 닫힌 카드와 다른 워크스페이스의 카드는 움직이지 않는다.`,
  moveCard: `\`src/board.ts\`의 \`moveCard(prev, key, column, index)\`가 아래를 지켜야 한다.
1. 카드를 \`column\`의 열린 카드들 사이 \`index\` 위치에 넣는다. \`index\`가 범위를 벗어나면 0과 (그 컬럼의 다른 열린 카드 수) 사이로 맞춘다. 맨 끝에 놓는 것도 가능해야 한다.
2. 그 컬럼의 열린 카드들의 order를 0부터 차례로 다시 매긴다.
3. 닫힌 카드는 건드리지 않는다(순서에 넣지도, order를 바꾸지도 않는다).
4. 카드나 컬럼이 없으면 \`prev\`를 그대로 돌려준다.`,
  setColumns: `\`src/board.ts\`의 \`setColumns(prev, columns)\`가 아래를 지켜야 한다.
1. id와 제목의 앞뒤 공백을 없앤다. 제목이 비면 id를 제목으로 쓴다.
2. id가 비었거나 중복된 컬럼은 뺀다(첫 번째가 남는다).
3. 남는 컬럼이 없으면 \`prev\`를 그대로 돌려준다.
4. 없어진 컬럼에 있던 카드는 첫 컬럼의 맨 끝으로 보낸다. 첫 컬럼에 원래 있던 카드와 order가 겹치면 안 된다. 다른 카드는 그대로 둔다.
5. \`collapsed\`는 true일 때만 남긴다.`,
  markUnseen: `\`src/board.ts\`의 \`markUnseen(prev, keys, at)\`가 아래를 지켜야 한다.
1. 주어진 카드들의 \`unseenAt\`을 \`at\`으로 한다. \`at\`이 null이면 표시를 지운다.
2. 이미 표시가 있는 카드에 새 시각을 덮어쓰지 않는다(처음 시각이 남는다).
3. 바뀌는 것이 없으면 \`prev\` 객체를 그대로 돌려준다. 없는 카드의 key는 무시한다.`,
  cardRules: `\`src/board.ts\`의 카드 규칙 함수들이 아래를 지켜야 한다.
1. \`startInProgress(prev, key)\`: 열려 있고 \`backlog\` 컬럼에 있는 카드만 \`doing\` 컬럼의 맨 끝으로 옮긴다. 닫힌 카드, 다른 컬럼의 카드, \`doing\` 컬럼이 없는 보드에서는 \`prev\`를 그대로 돌려준다.
2. \`deleteCard(prev, key)\`: 닫힌 카드만 지운다. 열려 있는 카드나 없는 카드면 \`prev\`를 그대로 돌려준다.
3. \`adoptCard(prev, archivedKey, tabKey)\`: 보관된 카드를 새 key로 옮기고 열린 상태로 만든다(\`closed: false\`, \`closedAt: null\`, \`unseenAt: null\`). 컬럼·메모·체크는 유지한다. 보관된 카드가 아니거나 두 key가 같으면 \`prev\`를 그대로 돌려준다.
4. \`cleanTitle(title)\`: 제목 앞의 작업 표시 글자와 공백을 떼어 낸다. 떼고 나서 빈 문자열이 되면 원래 제목을 돌려준다.`,
  mergeChats: `\`src/board.ts\`의 \`mergeChats(prev, chats, now)\`가 아래를 지켜야 한다.
1. 새 대화는 첫 컬럼의 맨 끝에 카드로 생긴다.
2. 목록에서 사라진 대화의 카드는 지우지 않고 보관한다(\`closed: true\`, \`closedAt: now\`). 이미 보관된 카드의 \`closedAt\`은 바꾸지 않는다.
3. 탭 id가 바뀐 대화는 먼저 pty id로, 그것으로 못 찾으면 같은 워크스페이스·같은 제목·같은 에이전트로 기존 카드에 연결한다. 연결되면 컬럼·메모·체크가 유지된다.
4. 카드의 컬럼이 없어졌으면 첫 컬럼으로 보낸다.`,
  cronEverySec: `\`src/monitor.ts\`의 \`cronEverySec(expr)\`가 아래를 지켜야 한다.
1. \`*/N * * * *\`는 N분(초 단위로 N*60), \`* * * * *\`는 60초.
2. \`M */N * * *\`(M은 숫자)는 N시간(N*3600초), \`M * * * *\`는 1시간.
3. 나머지 필드가 모두 \`*\`가 아니거나, 필드가 5개보다 적거나, 그 밖의 모양이면 null.`,
  applyToolCall: `\`src/monitor.ts\`의 \`applyToolCall(prev, call, now)\`가 아래를 지켜야 한다.
1. \`ScheduleWakeup\`: \`stop: true\`면 감시를 지운다(null). 아니면 loop 감시를 만들고 \`delaySeconds\`를 주기로, 다음 실행을 now + 주기로 둔다.
2. \`CronCreate\`는 cron 감시를 만든다. \`CronDelete\`는 지금 감시가 cron일 때만 지우고(null), 아니면 아무 말도 하지 않는다(undefined).
3. \`Monitor\`는 monitor 감시를 만든다. \`timeout_ms\`가 있고 \`persistent\`가 true가 아니면 now + timeout + 1분에 끝나는 것으로 둔다(\`until\`). 그 밖에는 \`until\`이 null이다.
4. \`TaskStop\`, \`KillShell\`, \`KillBash\`는 지금 감시가 monitor일 때만 지운다(null). 아니면 undefined.
5. 그 밖의 도구는 undefined. \`since\`는 이전 감시의 값을 유지한다.`,
  monitorDeadline: `\`src/monitor.ts\`의 \`onRun\`, \`monitorDeadline\`, \`isStale\`, \`monitorView\`가 아래를 지켜야 한다.
1. \`onRun(prev, now)\`: 마지막 실행을 now로 하고, 주기(초)가 있으면 다음 실행을 now + 주기로 옮긴다. 시각은 모두 밀리초다.
2. \`monitorDeadline\`: 다음 실행 시각이 있으면 그 시각 + max(1분, 주기)까지 신호가 있는 것으로 본다. 없으면 마지막 실행 + 주기의 2배, 주기도 없으면 6시간.
3. 주기 없는 monitor 감시는 마지막 신호 뒤 2시간까지 신호가 있는 것으로 본다.
4. \`monitorView\`: \`until\`이 지났으면 null(끝난 것). 신호를 잃은 지 30분이 넘으면 null(잊음). 그 밖에는 stale 여부를 붙여 돌려준다.`,
  findOnWindowsPath: `\`src/cli.ts\`의 \`envGet\`과 \`findOnWindowsPath\`가 아래를 지켜야 한다.
1. \`envGet(host, name)\`: Windows에서는 변수 이름의 대소문자를 가리지 않는다(\`Path\`와 \`PATH\`는 같다). 다른 OS에서는 정확히 일치해야 한다.
2. \`findOnWindowsPath(host, name, exists)\`: PATH의 폴더를 앞에서부터 보고, 각 폴더 안에서 PATHEXT의 확장자를 순서대로 붙여, 처음 존재하는 파일을 돌려준다. 앞 폴더가 뒤 폴더보다 항상 먼저다.
3. PATH 항목이 큰따옴표로 감싸져 있어도 처리하고, 빈 항목은 건너뛴다.
4. PATHEXT가 없으면 \`.COM;.EXE;.BAT;.CMD\`를 쓴다. 찾지 못하면 null.`,
  extraEnv: `\`src/cli.ts\`의 \`quoteCmdArg\`와 \`extraEnv\`가 아래를 지켜야 한다.
1. \`quoteCmdArg(arg, batchFile)\`: 인자를 큰따옴표로 감싸고 cmd.exe의 메타문자마다 \`^\`를 붙인다. \`.cmd\`/\`.bat\` 파일용(\`batchFile\`이 true)이면 한 번 더 붙인다(배치 파일이 \`%*\`를 넘길 때 cmd가 다시 해석하기 때문). 줄바꿈은 공백으로 바꾼다.
2. \`extraEnv(host, env)\`: Windows이고, APPDATA가 없고, USERPROFILE이 있을 때만 \`APPDATA=<USERPROFILE>\\AppData\\Roaming\`을 더해 돌려준다. 그 밖에는 받은 \`env\`를 그대로 돌려준다.`
}

export const PLANTED = [
  // ---- sync.ts ----
  { id: 's1', kind: 'incomplete', file: 'src/sync.ts', goal: 'syncColumns', fn: 'syncColumns', breaks: 3,
    find: `    .filter((c) => !names || names.has(c.id) || used.includes(c.id))`,
    put: `    .filter((c) => !names || names.has(c.id))` },
  { id: 's2', kind: 'bug', file: 'src/sync.ts', goal: 'syncColumns', fn: 'syncColumns', breaks: 2,
    find: `    .map((c) => ({ ...c, title: names?.get(c.id) ?? c.title }))`,
    put: `    .map((c) => ({ ...c, title: c.title || (names?.get(c.id) ?? c.id) }))` },
  { id: 's3', kind: 'bug', file: 'src/sync.ts', goal: 'syncColumns', fn: 'syncColumns', breaks: 4,
    find: `  ;(statuses?.length ? statuses : DEFAULT_STATUSES).forEach(add)`,
    put: `  ;(statuses ?? DEFAULT_STATUSES).forEach(add)` },
  { id: 's4', kind: 'incomplete', file: 'src/sync.ts', goal: 'editSyncedColumns', fn: 'editSyncedColumns', breaks: 2,
    find: `    requested.filter((c, i, all) => known.has(c.id) && all.findIndex((x) => x.id === c.id) === i),`,
    put: `    requested.filter((c) => known.has(c.id)),` },
  { id: 's5', kind: 'bug', file: 'src/sync.ts', goal: 'applyWorkspaceStatuses', fn: 'applyWorkspaceStatuses', breaks: 1,
    find: `next.set(c.column, Math.max(next.get(c.column) ?? 0, c.order + 1))`,
    put: `next.set(c.column, Math.max(next.get(c.column) ?? 0, c.order))` },
  { id: 's6', kind: 'incomplete', file: 'src/sync.ts', goal: 'applyWorkspaceStatuses', fn: 'applyWorkspaceStatuses', breaks: 2,
    find: `    const status = card.closed ? undefined : statusOf.get(card.worktreeId)`,
    put: `    const status = statusOf.get(card.worktreeId)` },
  { id: 's7', kind: 'bug', file: 'src/sync.ts', goal: 'applyWorkspaceStatuses', fn: 'applyWorkspaceStatuses', breaks: 3,
    find: `ids.has(card.column) ? card.column : first\n`,
    put: `ids.has(card.column) ? card.column : columns[columns.length - 1]!.id\n` },
  { id: 's8', kind: 'bug', file: 'src/sync.ts', goal: 'applyWorkspaceStatuses', fn: 'applyWorkspaceStatuses', breaks: 4,
    find: `  if (!cards && sameColumns) return prev`,
    put: `  if (!cards || sameColumns) return prev` },
  { id: 's9', kind: 'incomplete', file: 'src/sync.ts', goal: 'applyWorkspaceStatuses', fn: 'applyWorkspaceStatuses', breaks: 5,
    find: `syncColumns(prev.synced ? prev.columns : [], statusOf.values(), statuses)`,
    put: `syncColumns(prev.columns, statusOf.values(), statuses)` },
  { id: 's10', kind: 'incomplete', file: 'src/sync.ts', goal: 'moveWorkspaceCards', fn: 'moveWorkspaceCards', breaks: 3,
    find: `    .filter((c) => c.key !== key && !c.closed && c.worktreeId === card.worktreeId && c.column !== column)`,
    put: `    .filter((c) => c.key !== key && c.worktreeId === card.worktreeId && c.column !== column)` },
  { id: 's11', kind: 'bug', file: 'src/sync.ts', goal: 'moveWorkspaceCards', fn: 'moveWorkspaceCards', breaks: 2,
    find: `    .sort((a, b) => a.order - b.order)\n  for (const c of others) {`,
    put: `    .sort((a, b) => b.order - a.order)\n  for (const c of others) {` },

  // ---- board.ts ----
  { id: 'b1', kind: 'bug', file: 'src/board.ts', goal: 'moveCard', fn: 'moveCard', breaks: 1,
    find: `  const at = Math.max(0, Math.min(index, siblings.length))`,
    put: `  const at = Math.max(0, Math.min(index, siblings.length - 1))` },
  { id: 'b2', kind: 'incomplete', file: 'src/board.ts', goal: 'moveCard', fn: 'moveCard', breaks: 3,
    find: `    .filter((c) => c.column === column && !c.closed && c.key !== key)`,
    put: `    .filter((c) => c.column === column && c.key !== key)` },
  { id: 'b3', kind: 'bug', file: 'src/board.ts', goal: 'setColumns', fn: 'setColumns', breaks: 4,
    find: `  let order = nextOrder({ ...prev, columns: clean }, first)`,
    put: `  let order = 0` },
  { id: 'b4', kind: 'incomplete', file: 'src/board.ts', goal: 'setColumns', fn: 'setColumns', breaks: 1,
    find: `title: String(c.title).trim() || String(c.id).trim() }`,
    put: `title: String(c.title).trim() }` },
  { id: 'b5', kind: 'incomplete', file: 'src/board.ts', goal: 'setColumns', fn: 'setColumns', breaks: 2,
    find: `    .filter((c, i, all) => c.id && all.findIndex((x) => x.id === c.id) === i)`,
    put: `    .filter((c) => c.id)` },
  { id: 'b6', kind: 'incomplete', file: 'src/board.ts', goal: 'markUnseen', fn: 'markUnseen', breaks: 2,
    find: `    if (!card || (card.unseenAt ?? null) === at || (at !== null && card.unseenAt)) continue`,
    put: `    if (!card || (card.unseenAt ?? null) === at) continue` },
  { id: 'b7', kind: 'bug', file: 'src/board.ts', goal: 'markUnseen', fn: 'markUnseen', breaks: 3,
    find: `  return cards ? { ...prev, cards } : prev\n}\n\n/** Tab ids shown`,
    put: `  return { ...prev, cards: cards ?? prev.cards }\n}\n\n/** Tab ids shown` },
  { id: 'b8', kind: 'incomplete', file: 'src/board.ts', goal: 'cardRules', fn: 'startInProgress', breaks: 1,
    find: `  if (!card || card.closed || card.column !== BACKLOG_COLUMN) return prev`,
    put: `  if (!card || card.column !== BACKLOG_COLUMN) return prev` },
  { id: 'b9', kind: 'incomplete', file: 'src/board.ts', goal: 'cardRules', fn: 'deleteCard', breaks: 2,
    find: `  if (!card || !card.closed) return prev\n`,
    put: `  if (!card) return prev\n` },
  { id: 'b10', kind: 'bug', file: 'src/board.ts', goal: 'mergeChats', fn: 'mergeChats', breaks: 3,
    find: `        orphans.find((c) => c.ptyId === t.ptyId) ??\n        orphans.find((c) => c.worktreeId === t.worktreeId && c.title === title && c.agent === (t.agentIdentity ?? null))`,
    put: `        orphans.find((c) => c.worktreeId === t.worktreeId && c.title === title && c.agent === (t.agentIdentity ?? null)) ??\n        orphans.find((c) => c.ptyId === t.ptyId)` },
  { id: 'b11', kind: 'incomplete', file: 'src/board.ts', goal: 'mergeChats', fn: 'mergeChats', breaks: 2,
    find: `    if (!liveKeys.has(card.key) && !card.closed) {`,
    put: `    if (!liveKeys.has(card.key)) {` },
  { id: 'b12', kind: 'incomplete', file: 'src/board.ts', goal: 'mergeChats', fn: 'mergeChats', breaks: 4,
    find: `      column: columnIds.has(card.column) ? card.column : firstColumn,`,
    put: `      column: card.column,` },
  { id: 'b14', kind: 'bug', file: 'src/board.ts', goal: 'cardRules', fn: 'adoptCard', breaks: 3,
    find: `  cards[tabKey] = { ...card, key: tabKey, closed: false, closedAt: null, unseenAt: null }`,
    put: `  cards[tabKey] = { ...card, key: tabKey, closed: false, unseenAt: null }` },
  { id: 'b15', kind: 'incomplete', file: 'src/board.ts', goal: 'cardRules', fn: 'cleanTitle', breaks: 4,
    find: `.trim() || title\n`,
    put: `.trim()\n` },

  // ---- monitor.ts ----
  { id: 'm1', kind: 'bug', file: 'src/monitor.ts', goal: 'cronEverySec', fn: 'cronEverySec', breaks: 3,
    find: `  const allRest = (from: number) => f.slice(from, 5).every((x) => x === '*')`,
    put: `  const allRest = (from: number) => f.slice(from + 1, 5).every((x) => x === '*')` },
  { id: 'm2', kind: 'bug', file: 'src/monitor.ts', goal: 'cronEverySec', fn: 'cronEverySec', breaks: 2,
    find: `    if (h && allRest(2)) return h * 3600`,
    put: `    if (h && allRest(2)) return h * 60` },
  { id: 'm3', kind: 'incomplete', file: 'src/monitor.ts', goal: 'applyToolCall', fn: 'applyToolCall', breaks: 1,
    find: `      if (input.stop === true) return null\n`,
    put: `` },
  { id: 'm4', kind: 'bug', file: 'src/monitor.ts', goal: 'applyToolCall', fn: 'applyToolCall', breaks: 2,
    find: `      return prev?.kind === 'cron' ? null : undefined`,
    put: `      return null` },
  { id: 'm5', kind: 'bug', file: 'src/monitor.ts', goal: 'applyToolCall', fn: 'applyToolCall', breaks: 3,
    find: `        until: timeoutMs && input.persistent !== true ? now + timeoutMs + 60_000 : null,`,
    put: `        until: timeoutMs && input.persistent === true ? now + timeoutMs + 60_000 : null,` },
  { id: 'm6', kind: 'bug', file: 'src/monitor.ts', goal: 'monitorDeadline', fn: 'monitorDeadline', breaks: 2,
    find: `    ? m.nextAt + Math.max(60_000, (m.everySec ?? 60) * 1000)`,
    put: `    ? m.nextAt + Math.min(60_000, (m.everySec ?? 60) * 1000)` },
  { id: 'm7', kind: 'bug', file: 'src/monitor.ts', goal: 'monitorDeadline', fn: 'monitorView', breaks: 4,
    find: `  if (m.until && now > m.until) return null`,
    put: `  if (m.until && now < m.until) return null` },
  { id: 'm8', kind: 'bug', file: 'src/monitor.ts', goal: 'monitorDeadline', fn: 'monitorDeadline', breaks: 2,
    find: `    : m.lastRunAt + (m.everySec ? 2 * m.everySec * 1000 : UNTIMED_GRACE_MS)`,
    put: `    : m.lastRunAt + (m.everySec ? m.everySec * 1000 : UNTIMED_GRACE_MS)` },
  { id: 'm9', kind: 'incomplete', file: 'src/monitor.ts', goal: 'applyToolCall', fn: 'applyToolCall', breaks: 4,
    find: `      if (STOP_TOOLS.has(call.tool) && prev?.kind === 'monitor') return null`,
    put: `      if (STOP_TOOLS.has(call.tool)) return null` },
  { id: 'm10', kind: 'bug', file: 'src/monitor.ts', goal: 'monitorDeadline', fn: 'onRun', breaks: 1,
    find: `nextAt: prev.everySec ? now + prev.everySec * 1000 : prev.nextAt`,
    put: `nextAt: prev.everySec ? now + prev.everySec : prev.nextAt` },

  { id: 'm11', kind: 'bug', file: 'src/monitor.ts', goal: 'monitorDeadline', fn: 'monitorView', breaks: 4,
    find: `  if (stale && now > deadline + FORGET_STALE_MS) return null`,
    put: `  if (stale && now > m.lastRunAt + FORGET_STALE_MS) return null` },
  { id: 'm12', kind: 'bug', file: 'src/monitor.ts', goal: 'monitorDeadline', fn: 'monitorView', breaks: 4,
    find: `  if (stale && now > deadline + FORGET_STALE_MS) return null`,
    put: `  if (stale) return null` },
  { id: 's12', kind: 'bug', file: 'src/sync.ts', goal: 'applyWorkspaceStatuses', fn: 'applyWorkspaceStatuses', breaks: 4,
    find: `    columns.every((c, i) => c.id === prev.columns[i]!.id && c.title === prev.columns[i]!.title)`,
    put: `    columns.every((c, i) => c.id === prev.columns[i]!.id)` },

  // ---- cli.ts ----
  { id: 'c1', kind: 'incomplete', file: 'src/cli.ts', goal: 'findOnWindowsPath', fn: 'findOnWindowsPath', breaks: 3,
    find: `.split(';').map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean)`,
    put: `.split(';').map((d) => d.trim()).filter(Boolean)` },
  { id: 'c2', kind: 'incomplete', file: 'src/cli.ts', goal: 'findOnWindowsPath', fn: 'envGet', breaks: 1,
    find: `  const key = Object.keys(host.env).find((k) => k.toUpperCase() === name.toUpperCase())`,
    put: `  const key = Object.keys(host.env).find((k) => k === name)` },
  { id: 'c3', kind: 'bug', file: 'src/cli.ts', goal: 'findOnWindowsPath', fn: 'findOnWindowsPath', breaks: 2,
    find: `  for (const dir of dirs) {\n    for (const ext of exts) {`,
    put: `  for (const ext of exts) {\n    for (const dir of dirs) {` },
  { id: 'c4', kind: 'bug', file: 'src/cli.ts', goal: 'extraEnv', fn: 'extraEnv', breaks: 2,
    find: `  if (host.platform !== 'win32' || envGet(host, 'APPDATA') || !profile) return env`,
    put: `  if (host.platform !== 'win32' || !profile) return env` },
  { id: 'c5', kind: 'incomplete', file: 'src/cli.ts', goal: 'extraEnv', fn: 'quoteCmdArg', breaks: 1,
    find: `  return batchFile ? a.replace(CMD_META, '^$1') : a`,
    put: `  return a` },
  { id: 'c6', kind: 'bug', file: 'src/cli.ts', goal: 'extraEnv', fn: 'extraEnv', breaks: 2,
    find: `joinPath(host, profile, 'AppData', 'Roaming')`,
    put: `joinPath(host, profile, 'AppData', 'Local')` },

  // ---- correct: three untouched, three rewritten without changing behaviour ----
  { id: 'ok1', kind: 'ok', file: 'src/sync.ts', goal: 'syncColumns', fn: 'syncColumns' },
  { id: 'ok2', kind: 'ok', file: 'src/board.ts', goal: 'moveCard', fn: 'moveCard' },
  { id: 'ok3', kind: 'ok', file: 'src/monitor.ts', goal: 'applyToolCall', fn: 'applyToolCall' },
  { id: 'ok4', kind: 'ok', file: 'src/board.ts', goal: 'markUnseen', fn: 'markUnseen',
    find: `  let cards: Record<string, StoredCard> | null = null
  for (const key of keys) {
    const card = prev.cards[key]
    if (!card || (card.unseenAt ?? null) === at || (at !== null && card.unseenAt)) continue
    cards ??= { ...prev.cards }
    cards[key] = { ...card, unseenAt: at }
  }
  return cards ? { ...prev, cards } : prev`,
    put: `  const changed: Record<string, StoredCard> = {}
  let any = false
  for (const key of keys) {
    const card = prev.cards[key]
    if (!card) continue
    const current = card.unseenAt ?? null
    if (current === at) continue
    // A first unseen time stays: a later stop does not move it.
    if (at !== null && current) continue
    changed[key] = { ...card, unseenAt: at }
    any = true
  }
  return any ? { ...prev, cards: { ...prev.cards, ...changed } } : prev` },
  { id: 'ok5', kind: 'ok', file: 'src/monitor.ts', goal: 'cronEverySec', fn: 'cronEverySec',
    find: `  const f = expr.trim().split(/\\s+/)
  if (f.length < 5) return null
  const step = (field: string) => (field === '*' ? 1 : /^\\*\\/(\\d+)$/.test(field) ? Number(field.slice(2)) : null)
  const allRest = (from: number) => f.slice(from, 5).every((x) => x === '*')
  const m = step(f[0])
  if (m && allRest(1)) return m * 60
  if (/^\\d+$/.test(f[0])) {
    const h = step(f[1])
    if (h && allRest(2)) return h * 3600
  }
  return null`,
    put: `  const fields = expr.trim().split(/\\s+/)
  if (fields.length < 5) return null
  const minute = fields[0]
  const hour = fields[1]
  const every = (field: string): number | null => {
    if (field === '*') return 1
    const found = /^\\*\\/(\\d+)$/.exec(field)
    return found ? Number(found[1]) : null
  }
  const starsFrom = (from: number) => fields.slice(from, 5).every((x) => x === '*')
  const minutes = every(minute)
  if (minutes && starsFrom(1)) return minutes * 60
  if (/^\\d+$/.test(minute)) {
    const hours = every(hour)
    if (hours && starsFrom(2)) return hours * 3600
  }
  return null` },
  { id: 'ok6', kind: 'ok', file: 'src/board.ts', goal: 'setColumns', fn: 'setColumns',
    find: `  const clean = columns
    .map((c) => {
      const col: Column = { id: String(c.id).trim(), title: String(c.title).trim() || String(c.id).trim() }
      if (c.collapsed === true) col.collapsed = true
      return col
    })
    .filter((c, i, all) => c.id && all.findIndex((x) => x.id === c.id) === i)`,
    put: `  const seen = new Set<string>()
  const clean: Column[] = []
  for (const c of columns) {
    const id = String(c.id).trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const col: Column = { id, title: String(c.title).trim() || id }
    if (c.collapsed === true) col.collapsed = true
    clean.push(col)
  }` }
]

/**
 * The goal's work was never started: the last request and the agent's answer are about something
 * else, which is done. Found in real use, where the judge passed a to-do app nobody had built
 * because the last exchange (another task, finished) read well. The folder is the unchanged
 * source; a judge that holds the work against the goal cannot pass these.
 */
const OTHER_TASK = {
  file: 'src/sync.ts',
  promptText: '`src/sync.ts`의 `syncColumns`가 Orca의 상태 이름을 따르는지 확인하고, 아니면 고쳐 주세요.',
  claimText: '확인했습니다. `syncColumns`는 Orca의 목록이 있으면 그 이름을 제목으로 씁니다(`names?.get(c.id) ?? c.title`). 고칠 것이 없어 그대로 두었습니다.'
}
export const UNSTARTED = [
  { id: 'u1', kind: 'unstarted', fn: '-', ...OTHER_TASK, goalText: 'phoenix로 간단한 투두앱을 만드시오.' },
  {
    id: 'u2', kind: 'unstarted', fn: '-', ...OTHER_TASK,
    goalText: '# 목표: phoenix로 간단한 투두앱\n\n- [ ] 1. 할 일 목록 화면이 뜬다\n  확인: mix phx.server 뒤 / 에서 목록이 보인다\n- [ ] 2. 할 일을 추가할 수 있다\n  확인: mix test test/todo_live_test.exs\n- [ ] 3. 완료 표시와 삭제를 할 수 있다\n  확인: mix test'
  },
  {
    // Every box ticked, nothing built: a tick is the agent's word, not evidence.
    id: 'u3', kind: 'unstarted', fn: '-', ...OTHER_TASK,
    goalText: '# 목표: 보드를 CSV로 내보내기\n\n- [x] 1. `src/export.ts`에 보드를 CSV 문자열로 바꾸는 `boardToCsv`가 있다\n  확인: src/export.ts를 읽는다\n- [x] 2. 워커에 `board.export` 요청이 있다\n  확인: src/worker.ts에서 board.export를 찾는다\n- [x] 3. `src/export.test.ts`가 있다\n  확인: 파일이 있다'
  }
]

/** The scored set: problems the plugin's own tests catch (12 bugs, 6 left out), and 6 correct cases. */
export const MAIN = ['s2', 's3', 's8', 's12', 'b1', 'm2', 'm4', 'm5', 'm6', 'm7', 'm12', 'c4', 's1', 's9', 'b9', 'm3', 'c1', 'c5', 'ok1', 'ok2', 'ok3', 'ok4', 'ok5', 'ok6']
/** Run a second time, to see whether the verdict repeats. Chosen before the first run. */
export const REPEATS = ['s2', 'm6', 's9', 'c1', 'ok1', 'ok4']
/** The side set: problems the plugin's own tests do not catch. */
export const EXTRA = ['s4', 's5', 's6', 's7', 's10', 's11', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b10', 'b11', 'b12', 'b14', 'b15', 'm1', 'm8', 'm9', 'm10', 'm11', 'c3']

/** Every case: the planted ones and the ones whose goal was never started. */
export const POOL = [...PLANTED, ...UNSTARTED]
