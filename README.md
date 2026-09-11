# Floating Box

항상 위에 떠 있는 작은 데스크톱 위젯 (Electron).

| 기능 | 내용 |
| --- | --- |
| 시계 | 현재 시각 / 날짜 |
| 작업 타이머 | 시작 · 일시정지 · 리셋. 목표 분을 넣으면 도달 시 알림. 앱을 재시작해도 이어서 계산 |
| Claude 사용량 | 세션(5시간) · 주간 종합 · 주간 모델별 한도 % 와 리셋 시각, Claude Code 토큰(현재 세션 / 오늘 / 7일) |
| 알림 허브 | 로컬 HTTP 엔드포인트로 들어오는 모든 알림 + (Linux) 데스크톱 알림 전체 가로채기. 80% / 95% 사용량 경고, 타이머 알림도 여기로 |

## 실행

```bash
npm install
npm start
```

창은 프레임 없는 투명 창이며 헤더를 잡고 드래그, 모서리로 크기 조절. `—` 는 트레이로 숨기기, 트레이 아이콘 메뉴에서 투명도 · 새로고침 · 종료.
설정과 위치는 `userData/config.json` 에 저장됩니다 (macOS `~/Library/Application Support/floatingbox`, Linux `~/.config/floatingbox`, Windows `%APPDATA%\floatingbox`).

## Claude 사용량이 어떻게 나오나

1. **플랜 한도 (세션 / 주간)** — Claude Code 가 로그인 시 저장하는 OAuth 토큰(`~/.claude/.credentials.json`, macOS 는 키체인 `Claude Code-credentials`)으로 `https://api.anthropic.com/api/oauth/usage` 를 1분마다 조회합니다. Claude Code 안에서 `/usage` 가 보여주는 것과 같은 데이터입니다. 공개 문서화된 API 는 아니므로 응답에서 `utilization` 이 있는 항목을 모두 막대로 표시하도록 관대하게 파싱합니다. 토큰이 만료되면 터미널에서 `claude` 를 한 번 실행해 갱신하면 됩니다.
2. **Claude Code 토큰** — `~/.claude/projects/**/*.jsonl` 대화 기록에서 assistant 메시지의 `usage` 를 합산합니다 (입력 + 출력 + 캐시 읽기 + 캐시 생성). 네트워크 없이도 동작합니다.

## 알림 보내기

```bash
# 아무 스크립트에서
curl -X POST http://127.0.0.1:47831/notify \
  -H 'Content-Type: application/json' \
  -d '{"title":"빌드 완료","body":"테스트 42개 통과","source":"ci","urgency":"normal","url":"https://..."}'

# 또는
node scripts/notify.js "제목" "본문" --source=deploy --urgency=critical
hooks/notify.sh "제목" "본문"
```

필드: `title`, `body`, `source`, `urgency`(`low|normal|critical`), `url`(클릭 시 열기), `actions`.
`GET /notifications`, `GET /health` 도 있습니다. 포트는 `config.json` 의 `hubPort`.

### Claude Code 알림을 박스로 받기

`hooks/claude-settings.example.json` 의 `hooks` 블록을 `~/.claude/settings.json` 에 합치고 경로만 바꾸면, 권한 요청 · 대기 알림(`Notification`)과 응답 완료(`Stop`)가 박스에 쌓입니다.

## 다른 앱 알림 가로채기 — 플랫폼별 가능 여부

| OS | 가능한 것 | 방법 |
| --- | --- | --- |
| **Linux** | **모든 데스크톱 알림을 완전히 가로채기** (팝업이 뜨지 않고 박스에만 표시) | 이 앱이 D-Bus `org.freedesktop.Notifications` 서비스를 차지해 알림 데몬(dunst, gnome-shell 등)을 대체합니다. 기본 켜짐, `captureDesktopNotifications: false` 로 끄기. GNOME 처럼 셸이 이름을 다시 가져가는 환경에서는 셸 알림 서버를 비활성화해야 합니다. |
| **macOS** | 가로채기 **불가** (읽기만 제한적으로 가능) | 서드파티 앱이 다른 앱의 알림을 받거나 억제하는 공개 API 가 없습니다. Full Disk Access 를 주면 Notification Center DB (`~/Library/Group Containers/group.com.apple.usernoted/db2/db`) 를 읽어 *표시된 후* 목록만 미러링할 수 있습니다 (미구현, 방향만 열어 둠). 현실적인 방법은 알림을 만드는 쪽(Claude Code 훅, 스크립트, Shortcuts, 웹훅)을 박스의 HTTP 엔드포인트로 돌리는 것입니다. |
| **Windows** | 읽기 가능, 표시 억제 불가 | WinRT `UserNotificationListener` 로 알림 센터 내용을 읽고 지울 수 있지만 토스트가 뜨는 것은 막지 못합니다. 네이티브 모듈이 필요해 이 저장소에는 아직 없습니다. |

## 테스트

```bash
npm test                                   # 유닛 + HTTP 허브
dbus-run-session -- node --test test/dbus.test.js   # Linux: 실제 세션 버스에서 D-Bus 가로채기 검증
```

## 구조

```
electron/main.js            창, 트레이, IPC, 사용량 폴링, 임계치 경고
electron/notifyHub.js       알림 저장소 + HTTP 서버 (127.0.0.1:47831)
electron/dbusNotifications.js  Linux 알림 데몬 구현
electron/usage.js           플랜 한도 조회 + Claude Code 트랜스크립트 합산
electron/credentials.js     Claude Code OAuth 토큰 위치
renderer/                   UI (시계, 타이머, 사용량, 알림)
scripts/notify.js, hooks/   알림 보내기 CLI, Claude Code 훅 예시
```
