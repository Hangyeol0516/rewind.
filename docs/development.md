# 개발 가이드

[README](../README.md) · [사용 가이드](guide.md) · [운영 가이드](deployment.md)

## 준비

Node.js 22.13 이상을 사용합니다.

```bash
npm ci
npm run browser:install
npm run dev
```

## 파일 구조

```text
.
├── public/                 # 빌드 없이 제공하는 HTML·CSS·JavaScript
├── server.mjs              # HTTP API, SQLite, 촬영 큐와 일정 실행
├── capture-browser.mjs     # Chromium 촬영과 진단
├── content-analysis.mjs    # 본문 변경 분석
├── lib.mjs                 # URL과 네트워크 주소 검증
├── test/                   # 단위·API·촬영 검사
├── scripts/                # 통합·UI 검사와 관리 도구
├── deploy/                 # 상시 실행 설정 예제
├── docs/                   # 사용·개발·운영 문서
└── .github/                # CI, 이슈와 PR 양식
```

`public/schedule.js`는 서버와 화면이 함께 사용합니다. 런타임 데이터는 `data/`, 검사 결과는 `test-results/`에 생성하며 Git에 포함하지 않습니다.

## 검사

| 명령 | 범위 | 실행 조건 |
| --- | --- | --- |
| `npm test` / `npm run test:unit` | 단위·API·본문 추출 | Chromium 설치 필요. 임시 데이터 사용 |
| `npm run test:capture` | 실제 촬영·403 분류·내부 주소 차단 | Chromium과 로컬 테스트 서버 사용 |
| `npm run test:e2e` | 실제 사이트 등록·촬영·삭제 | 앱 실행과 외부 네트워크 필요 |
| `npm run test:ui` | 검색·필터·비교·모바일·연결 복구 | 앱 실행 필요. 브라우저에서 API 대체 |
| `npm run test:records` | 기록 관리·픽셀 비교·PNG 내보내기 | 별도 임시 서버 사용 |
| `npm run test:page-calendar` | 일정·긴 사진·달력·시간대 | 별도 임시 서버 사용 |

`npm test`는 `test/`의 Node.js 테스트를 실행합니다. 기본 검사는 별도 테스트 서버와 임시 디렉터리를 사용합니다.

`test:e2e`는 지정한 서버에 example.com을 등록하고 마지막에 삭제합니다. 실제 작업 공간 대신 별도 서버를 사용하고, example.com이 등록되지 않은 상태에서 실행하세요.

```bash
REWIND_DATA_DIR=/tmp/rewind-review HOST=127.0.0.1 PORT=4318 npm start
```

다른 터미널에서 실행합니다.

```bash
REWIND_URL=http://127.0.0.1:4318 npm run test:ui
REWIND_URL=http://127.0.0.1:4318 npm run test:e2e
```

### 화면 검사

`test:design`, `test:usability`, `test:features`, `test:workspace`, `test:polish`는 기능·디자인별 브라우저 검사입니다. `REWIND_URL`을 지정할 수 있으며, API를 브라우저에서 대체해 운영 기록을 변경하지 않습니다. 검사별 생성 파일과 조건은 [사용 가이드](guide.md)에 있습니다.

- [디자인 검토](design-review.md)
- [사용성 검토](usability-review.md)
- [분류와 촬영 이력](organization-and-activity.md)
- [작업 화면 구조](workspace-redesign.md)
- [기록 탐색 세부 개선](design-polish.md)

## CI

[Checks](../.github/workflows/checks.yml)는 push와 Pull Request에서 Node.js 22, Chromium과 시스템 의존성을 설치하고 `npm test`를 실행합니다. 서버 배포는 수행하지 않습니다.
