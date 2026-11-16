# Chat Board (원격)

다른 컴퓨터에서 도는 Orca의 [Chat Board](https://github.com/walden4u/orca-chat-board)를 이 컴퓨터의 Orca에서 그대로 보고 쓰는 플러그인입니다.

Orca의 플러그인 패널은 원격으로 붙은 Orca(다른 PC의 앱, 웹 화면)에는 나타나지 않습니다. 그래서 보는 쪽 컴퓨터에 이 플러그인을 따로 올립니다. 이 플러그인은 아무것도 저장하지 않고, 보드의 모든 요청을 서버 컴퓨터의 Chat Board에 넘깁니다. 컬럼, 카드, 상태, 채점, 설정은 모두 서버의 것입니다.

용어: **서버**는 에이전트와 Chat Board가 도는 컴퓨터, **이 컴퓨터**는 보드를 보는 컴퓨터입니다.

## 필요한 것

- 두 컴퓨터가 같은 Tailscale에 있을 것
- 서버의 Orca에 Chat Board가 **개발 플러그인**(`orca plugin dev load`)으로 올라가 있을 것. 카탈로그로 설치한 Chat Board에는 붙지 못합니다.
- 서버의 Chat Board가 `remote.open`을 아는 판일 것(2026-11-16 이후의 `workspace-sync` 브랜치)
- 이 컴퓨터의 Orca에 자기 워크스페이스가 하나 이상 있을 것(브라우저 탭을 둘 곳)

## 설치

1. **서버를 이 컴퓨터의 Orca에 등록합니다.** 서버에서 `orca pair --address <서버의 Tailscale 주소>`를 실행해 나온 링크를, 이 컴퓨터 Orca의 설정 → 원격 Orca 서버 → 서버 추가에 붙여 넣습니다. 이름을 `L1-PC`로 저장하면 설정을 바꿀 필요가 없습니다. 확인:
   ```
   orca environment list
   ```
2. **이 폴더를 이 컴퓨터에 둡니다.** Dropbox 같은 동기화 폴더에 두면 서버에서 고친 것이 저절로 넘어옵니다.
3. **플러그인을 올립니다.** 처음에는 지문을 묻습니다.
   ```
   orca plugin dev load <이 폴더>
   orca plugin dev load <이 폴더> --approve <출력된 ap1-… 지문>
   ```
4. 오른쪽 사이드바에 Chat Board (원격) 아이콘이 생깁니다. 서버 이름이 `L1-PC`가 아니면 플러그인 설정의 "원격 Orca 서버 이름"을 고칩니다.
5. **카드를 하나 누릅니다.** 이 컴퓨터의 Orca에 "Connect to Orca" 브라우저 탭이 생깁니다. 서버에서 `orca pair --address <서버의 Tailscale 주소>`를 한 번 더 실행해, "Or open it in a browser" 아래의 주소를 그 탭의 주소창에 붙여 넣습니다. 한 번만 하면 됩니다.

권한이 바뀌는 수정(`orca-plugin.json`의 capabilities)이 넘어오면 아이콘이 사라집니다. 3번을 다시 하면 됩니다.

## 쓰는 법

- 보드는 서버의 보드 그대로입니다. 카드 이동, 메모, 보관, 채점이 서버에서 일어납니다.
- **카드를 누르면** 답장 창이 열리고, 브라우저 탭의 서버 Orca 화면이 그 대화의 탭으로 바뀝니다. 그 탭에서 터미널을 그대로 쓸 수 있습니다.
- **체크한 대화가 끝나면** 답장 창이 저절로 뜨고 브라우저 탭도 그 대화로 넘어갑니다.
- **이미지는 답장 창에 붙여 넣습니다.** 브라우저 탭의 터미널은 붙여 넣은 이미지를 받지 못합니다.
- 표시 설정(로고, 시간, 미리 보기 등)과 "답장 창과 함께 대화창 보기"는 이 컴퓨터의 설정입니다. 동기화, 목표 모드의 동작, 지난 대화 다시 열기는 서버 Chat Board의 설정을 따릅니다.

## 서버와 통신하는 두 길

| | 긴 길 | 짧은 길 |
|---|---|---|
| 방식 | 요청마다 `orca plugin dev request … --environment <서버>` 실행 | 서버 Chat Board의 Tailscale 주소(포트 4927)에 HTTP로 요청 |
| 요청 하나 | 0.8초(서버 자신)에서 2.5~3.5초(사무실 PC) | 수 밀리초 |
| 보드 변화 | 5초마다 물어봄 | 서버가 바뀔 때 알려 줌 |
| 이미지 | 21KB 조각으로 나눠 보내고, WebP로 줄임 | 원본 그대로 |

처음 한 번 긴 길로 서버에 창구를 열어 달라고 하고(`remote.open`), 받은 주소와 키로 짧은 길을 씁니다. 짧은 길이 안 닿으면 긴 길로 돌아갑니다. 어느 길인지는 로그에 나옵니다.

```
orca plugin logs local.chat-board-remote
```

- `talking to the server directly at …`: 짧은 길
- `no direct way to the server, the orca CLI is used: …`: 긴 길. 뒤에 이유가 붙습니다. 서버의 Windows 방화벽이 포트를 막았거나, 서버 Chat Board 설정에서 "다른 컴퓨터의 보드에 직접 답하기"가 꺼진 경우입니다.

키를 새로 만들려면 서버에서 실행합니다. 이 플러그인은 스스로 새 키를 받아 갑니다.

```
orca plugin dev request local.chat-board remote.renew
```

## 안 될 때

| 보드에 뜨는 말 | 볼 것 |
|---|---|
| 서버 …에 닿지 않습니다 | 서버의 Orca가 켜져 있는지, Tailscale이 연결돼 있는지 |
| '…'(이)라는 이름으로 저장된 Orca 서버가 없습니다 | 설정의 서버 이름과 `orca environment list`의 이름 |
| 서버 …에 Chat Board가 개발 플러그인으로 로드돼 있지 않습니다 | 서버에서 `orca plugin list` |
| 브라우저 탭의 Orca 웹 화면이 아직 서버와 연결되지 않았습니다 | 설치 5번 |
| 웹 화면의 목록에 이 대화의 워크스페이스가 없습니다 / 탭이 없습니다 | Orca가 업데이트되어 웹 화면의 구조가 바뀌었을 수 있습니다(`src/webtab.ts`) |

## 알아 둘 점

- 카드 클릭으로 대화를 여는 기능은 서버의 Orca 웹 화면을 브라우저 탭에서 조작하는 방식입니다(`src/webtab.ts`). 플러그인 API와 `orca` 명령으로는 원격으로 붙은 Orca의 화면을 움직일 수 없기 때문입니다. 웹 화면의 내부 구조에 기대므로 Orca 업데이트 뒤 깨질 수 있습니다.
- 패널 코드(`panel/`)는 Chat Board에서 복사한 것입니다. Chat Board의 패널을 고쳐도 여기에는 반영되지 않습니다.
- 짧은 길의 키는 서버의 대화에 글을 입력할 수 있는 열쇠입니다. Tailscale 안에서만 쓸 수 있고, 이 플러그인은 키를 메모리에만 둡니다.

## 개발

```sh
orca plugin test .                                    # 테스트
npx -y -p typescript tsc -p tsconfig.ci.json --noEmit # 타입 검사
```

| 파일 | 하는 일 |
|---|---|
| `src/worker.ts` | 패널 요청을 서버로 넘김, 보드 변화를 패널에 전달 |
| `src/direct.ts` | 짧은 길: 창구 열기, 요청, 변화 알림 수신, 긴 길로 돌아가기 |
| `src/cli.ts` | 긴 길과 이 컴퓨터 자신의 Orca에 내리는 명령 |
| `src/webtab.ts` | 브라우저 탭의 서버 Orca 화면을 대화의 탭으로 넘기기 |
| `src/unseen.ts` | 이 컴퓨터에서 아직 안 본 대화의 표시 |
| `panel/` | Chat Board의 패널(복사본) |
