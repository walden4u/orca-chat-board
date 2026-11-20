// The commands offered in a reply box while its field holds just "/word": Claude Code's built-in
// ones, kept here (Claude Code has no way to ask it for them), and your own, which the worker read
// from Claude's folders. The built-in ones are from Claude Code's documentation of 2026-11-20
// (code.claude.com/docs/en/commands); after an update of Claude Code this table is what goes stale.
import { locale } from './i18n.ts'
import type { SlashCommand } from '../src/protocol.ts'

/** One row of the list: a command to fill in, or the row that reads your commands again. */
export type SlashRow = { name: string; hint: string; about: string; also: string[]; refresh?: true }

// name, arguments, what it does (English, Korean), other names it answers to
const BUILT_IN: [string, string, string, string, string[]?][] = [
  ['add-dir', '<path>', 'Add a working directory', '작업 폴더 추가'],
  ['advisor', '[model|off]', 'Turn the advisor (a second model) on or off', '조언 모델 켜기·끄기'],
  ['agents', '', 'Create or manage subagents', '서브 에이전트 만들기·관리'],
  ['artifacts', '', 'List your artifacts', '아티팩트 목록'],
  ['auto-mode-setup', '', 'Set up auto mode for this environment', '자동 모드 환경 설정'],
  ['autocompact', '[auto|<tokens>]', 'Set when the conversation is compacted by itself', '자동 요약 시점 정하기'],
  ['autofix-pr', '[prompt]', "Fix the PR's CI failures and review comments in the cloud", 'PR의 CI 실패·리뷰 지적을 클라우드에서 고치기'],
  ['background', '[prompt]', 'Run this session as a background agent', '이 세션을 백그라운드 에이전트로 돌리기', ['bg']],
  ['batch', '<instruction>', 'Make a large change across the codebase in parallel', '코드 전체에 걸친 큰 변경을 병렬로 실행'],
  ['branch', '[name]', 'Branch the conversation to try another direction', '대화를 갈라 다른 방향 시도'],
  ['btw', '[question]', 'Ask a side question that is not added to the conversation', '대화에 남기지 않는 곁가지 질문'],
  ['bug', '[report]', 'Report a bug or share the conversation', '버그 신고·대화 공유', ['share']],
  ['cd', '<path>', 'Move the session to another folder', '세션의 작업 폴더 옮기기'],
  ['chrome', '', 'Claude in Chrome settings', 'Claude in Chrome 설정'],
  ['claude-api', '[topic]', 'Claude API reference', 'Claude API 참고 자료'],
  ['claude-in-chrome', '[task]', 'Do a task in your Chrome browser', 'Chrome 브라우저에서 작업 수행'],
  ['clear', '[name]', 'Start a new conversation with empty context', '컨텍스트를 비우고 새 대화 시작', ['reset', 'new']],
  ['code-review', '[level] [--fix] [target]', 'Review the diff (or a PR, branch, path) for bugs', '변경분(또는 PR·브랜치·경로)의 버그 리뷰', ['review']],
  ['color', '[color|default]', 'Set the colour of the prompt bar', '입력 줄 색 바꾸기'],
  ['compact', '[instructions]', 'Free context by summarizing the conversation', '대화를 요약해 컨텍스트 비우기'],
  ['config', '[key=value]', 'Open Settings, or set one', '설정 열기·바꾸기', ['settings']],
  ['context', '[all]', 'Show what the context is used for', '컨텍스트 사용량 보기'],
  ['copy', '[N]', 'Copy the last reply to the clipboard', '마지막 답을 클립보드에 복사'],
  ['dataviz', '[request]', 'Guidance for charts and dashboards', '차트·대시보드 디자인 안내'],
  ['debug', '[description]', 'Turn on debug logging and look into a problem', '디버그 로그를 켜고 문제 조사'],
  ['deep-research', '<question>', 'Research on the web, with a cited report', '웹 조사 후 출처 달린 보고서'],
  ['design', '[brief]', 'Draft UI mockups as a design artifact', 'UI 시안을 디자인 아티팩트로 만들기'],
  ['design-login', '', 'Authorize access to your design system', '디자인 시스템 접근 승인'],
  ['design-sync', '[hint]', "Upload the repository's design system", '저장소의 디자인 시스템 올리기'],
  ['desktop', '', 'Continue this session in the desktop app', '데스크톱 앱에서 이어 하기', ['app']],
  ['diff', '', 'Review the changes in the working tree', '작업 폴더의 변경 내용 보기'],
  ['doctor', '', 'Check your setup and propose fixes', '설치 상태 점검과 고칠 점 제안', ['checkup']],
  ['effort', '[level|auto]', 'Set the effort level', '추론 강도 정하기'],
  ['exit', '', 'Leave Claude Code', 'Claude Code 끝내기', ['quit']],
  ['export', '[filename]', 'Export the conversation as text', '대화를 텍스트로 내보내기'],
  ['fast', '[on|off]', 'Turn fast mode on or off', '빠른 모드 켜기·끄기'],
  ['feedback', '[report]', 'Send feedback about Claude Code', 'Claude Code 의견 보내기'],
  ['fewer-permission-prompts', '', 'Allow common read-only commands, for fewer prompts', '자주 쓰는 읽기 전용 명령을 허용해 권한 요청 줄이기'],
  ['focus', '', 'Turn the focus view on or off', '집중 보기 켜기·끄기'],
  ['fork', '[prompt]', 'Copy the conversation into a new background session', '대화를 새 백그라운드 세션으로 복사'],
  ['goal', '[condition|clear]', 'Set a goal Claude works toward across turns', '여러 턴에 걸쳐 이룰 목표 정하기'],
  ['help', '', 'Show help and the commands', '도움말과 명령 목록'],
  ['hooks', '', 'Show the hooks', '훅 설정 보기'],
  ['ide', '', 'Manage IDE integrations', 'IDE 연동 관리'],
  ['import', '[codex|gemini|cursor]', 'Bring your settings from another tool', '다른 도구의 설정 가져오기'],
  ['init', '', 'Write a CLAUDE.md for this project', '이 프로젝트의 CLAUDE.md 만들기'],
  ['insights', '', 'A report on your recent sessions', '최근 세션 분석 보고서'],
  ['install-github-app', '', 'Install the Claude GitHub app for a repository', '저장소에 Claude GitHub 앱 설치'],
  ['install-slack-app', '', 'Install the Claude Slack app', 'Claude Slack 앱 설치'],
  ['keybindings', '', 'Open the keyboard shortcuts file', '단축키 파일 열기'],
  ['list-agents', '', 'List the agents and sessions Claude can message', '메시지를 보낼 수 있는 에이전트·세션 목록', ['peers']],
  ['login', '', 'Sign in', '로그인'],
  ['logout', '', 'Sign out', '로그아웃'],
  ['loop', '[interval] [prompt]', 'Run a prompt again and again while the session is open', '세션이 열려 있는 동안 프롬프트를 되풀이 실행', ['proactive']],
  ['mcp', '[reconnect|enable|disable]', 'Manage MCP servers', 'MCP 서버 관리'],
  ['memory', '', 'Edit CLAUDE.md and the memory', 'CLAUDE.md와 메모리 고치기'],
  ['mobile', '', 'QR code for the mobile app', '모바일 앱 QR 코드', ['ios', 'android']],
  ['model', '[model]', 'Switch the model', '모델 바꾸기'],
  ['output-style', '[style]', 'List or switch output styles', '출력 스타일 보기·바꾸기'],
  ['passes', '', 'Share a free week of Claude Code', 'Claude Code 무료 1주 이용권 나누기'],
  ['permissions', '', 'Manage what tools may do', '도구 권한 규칙 관리', ['allowed-tools']],
  ['plan', '[description]', 'Enter plan mode', '플랜 모드로 들어가기'],
  ['plugin', '[subcommand]', 'Manage plugins', '플러그인 관리'],
  ['plugin-authoring', '', 'Reference for writing a mod', '모드 작성 참고 자료'],
  ['powerup', '', 'Short lessons on features', '기능 익히기 수업'],
  ['privacy-settings', '', 'Privacy settings', '개인정보 설정'],
  ['radio', '', 'Open Claude FM in the browser', '브라우저에서 Claude FM 열기'],
  ['rate-limit-options', '', 'Ways to go on when a usage limit is reached', '사용 한도에 걸렸을 때 계속하는 방법'],
  ['recap', '', 'A one-line summary of this session', '이 세션 한 줄 요약'],
  ['release-notes', '', 'Show the changelog', '변경 기록 보기'],
  ['reload-plugins', '[--force]', 'Load the plugins again without a restart', '재시작 없이 플러그인 다시 불러오기'],
  ['reload-skills', '', 'Read the skill and command folders again', '스킬·명령 폴더 다시 읽기'],
  ['remote-control', '', 'Make this session reachable from claude.ai', '이 세션을 claude.ai에서 원격 조작하게 하기', ['rc']],
  ['remote-env', '', 'Choose the cloud environment for cloud sessions', '클라우드 세션의 기본 환경 고르기'],
  ['rename', '[name]', 'Rename this session', '이 세션 이름 바꾸기'],
  ['restart', '', 'Restart and resume, to apply an update', '업데이트를 적용하려고 다시 시작해 이어 하기', ['update']],
  ['resume', '[session]', 'Resume a conversation', '지난 대화 이어 하기', ['continue']],
  ['rewind', '', 'Go back to an earlier point of the conversation or the code', '대화·코드를 이전 시점으로 되돌리기', ['checkpoint', 'undo']],
  ['run', '', "Start the project's app and see a change working", '프로젝트 앱을 띄워 변경이 동작하는지 보기'],
  ['run-skill-generator', '', 'Write a skill that tells /run how to start this app', '/run이 이 앱을 띄우는 법을 스킬로 만들기'],
  ['sandbox', '', 'Turn sandbox mode on or off', '샌드박스 모드 켜기·끄기'],
  ['schedule', '[description]', 'Create or manage scheduled cloud tasks', '예약 클라우드 작업 만들기·관리', ['routines']],
  ['scroll-speed', '', 'Set the mouse wheel speed', '마우스 휠 스크롤 속도 정하기'],
  ['security-review', '', "Look for security problems in the branch's changes", '브랜치 변경분의 보안 취약점 검토'],
  ['simplify', '[target]', 'Tidy up the changed code and apply the fixes', '변경한 코드를 정리하고 고치기'],
  ['skill-doctor', '', 'What each skill costs in context and how often it is used', '스킬별 컨텍스트 비용과 사용 빈도'],
  ['skills', '', 'List the skills', '스킬 목록'],
  ['slides', '[brief]', 'Make a presentation', '발표 자료 만들기'],
  ['status', '', 'Open Settings at the Status tab', '설정의 상태 탭 열기'],
  ['statusline', '', 'Set up the status line', '상태 줄 설정'],
  ['stickers', '', 'Order stickers', '스티커 신청'],
  ['stop', '', 'Stop the background session you are attached to', '붙어 있는 백그라운드 세션 멈추기'],
  ['subtask', '<task>', 'Give a task to a forked subagent', '갈라 낸 서브 에이전트에게 일 맡기기'],
  ['tasks', '', 'Show and manage background work', '백그라운드 작업 보기·관리', ['bashes']],
  ['team-onboarding', '', 'Write a guide for new team members from your usage', '사용 기록으로 팀 온보딩 안내서 만들기'],
  ['teleport', '', 'Bring a cloud session into this terminal', '클라우드 세션을 이 터미널로 가져오기', ['tp']],
  ['terminal-setup', '', 'Install the Shift+Enter key for new lines', '줄바꿈용 Shift+Enter 키 설치'],
  ['theme', '', 'Change the colour theme', '색 테마 바꾸기'],
  ['tui', '[classic|fullscreen]', 'Choose how the terminal screen is drawn', '터미널 화면 그리는 방식 고르기'],
  ['ultrareview', '[PR or branch]', 'A deep code review by many agents in the cloud', '클라우드에서 여러 에이전트가 하는 깊은 코드 리뷰'],
  ['update-config', '[request]', 'Change settings.json from a description', '말로 설명한 대로 settings.json 고치기'],
  ['upgrade', '', 'Open the page to change your plan', '요금제 변경 페이지 열기'],
  ['usage', '', 'Session cost, plan limits and activity', '세션 비용·요금제 한도·사용량 보기', ['cost', 'stats']],
  ['usage-credits', '', 'Set up usage credits', '추가 사용 크레딧 설정'],
  ['verify', '', 'Confirm a change works by building and running the app', '앱을 빌드하고 실행해 변경이 동작하는지 확인'],
  ['voice', '[hold|tap|off]', 'Turn voice dictation on or off', '음성 입력 켜기·끄기'],
  ['web-setup', '', 'Connect your GitHub account for cloud sessions', '클라우드 세션용 GitHub 계정 연결'],
  ['workflow-authoring', '', 'Reference for writing workflow scripts', '워크플로 스크립트 작성 참고 자료'],
  ['workflows', '', 'Open the workflow progress view', '워크플로 진행 화면 열기']
]

/** The built-in commands with your own: a name of yours that a built-in one has too is listed once, as yours. */
export function allCommands(own: SlashCommand[]): SlashRow[] {
  const korean = locale.toLowerCase().startsWith('ko')
  const rows: SlashRow[] = own.map((c) => ({ name: c.name, hint: c.hint ?? '', about: c.about, also: [] }))
  const taken = new Set(rows.map((r) => r.name))
  for (const [name, hint, en, ko, also] of BUILT_IN) if (!taken.has(name)) rows.push({ name, hint, about: korean ? ko : en, also: also ?? [] })
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The commands to list for what is typed after "/": the one of exactly that name first, then the
 * ones that begin with it (also by another name they answer to), then those that have it inside.
 * Nothing typed lists them all.
 */
export function matchCommands(rows: SlashRow[], word: string): SlashRow[] {
  const w = word.toLowerCase()
  if (!w) return rows
  const rank = (r: SlashRow): number => {
    const name = r.name.toLowerCase()
    if (name === w) return 0
    if (name.startsWith(w) || name.split(':').some((part) => part.startsWith(w))) return 1
    if (r.also.some((a) => a.startsWith(w))) return 2
    return name.includes(w) ? 3 : 9
  }
  return rows
    .map((r) => ({ r, n: rank(r) }))
    .filter((x) => x.n < 9)
    .sort((a, b) => a.n - b.n)
    .map((x) => x.r)
}
