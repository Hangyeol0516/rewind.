# Rewind

웹사이트의 순간을 저장하고, 시간에 따른 변화를 비교하는 개인용 웹 아카이브입니다.

[![Checks](https://github.com/Hangyeol0516/rewind./actions/workflows/checks.yml/badge.svg)](https://github.com/Hangyeol0516/rewind./actions/workflows/checks.yml)

[사용 가이드](docs/guide.md) · [개발](docs/development.md) · [운영](docs/deployment.md) · [기여](CONTRIBUTING.md)

![Rewind의 사이트 기록 탐색 화면](docs/workspace/home-after.png)

## 주요 기능

- 실제 Chromium으로 웹사이트의 상단 화면 또는 전체 페이지 촬영
- 사이트별 타임라인과 달력, 간격·시각을 지정한 자동 촬영
- 슬라이더·나란히 보기·픽셀 차이 강조로 두 기록 비교
- 그룹·태그·즐겨찾기, 기록별 메모와 중요 표시
- PNG 다운로드와 직접 캡처한 이미지 가져오기
- SQLite와 로컬 PNG 파일로 기록 보관

## 빠른 시작

Node.js 22.13 이상이 필요합니다.

```bash
git clone https://github.com/Hangyeol0516/rewind..git rewind
cd rewind
npm ci
npm run browser:install
npm start
```

브라우저에서 **http://127.0.0.1:3000**에 접속합니다. 공개 웹사이트 주소를 추가하면 첫 촬영이 시작됩니다. 두 번째 기록부터 전후 비교를 사용할 수 있습니다.

Linux의 브라우저 시스템 의존성 설치에는 관리자 권한이 필요할 수 있습니다. 대체 설치 방법은 [운영 가이드](docs/deployment.md)를 참고하세요.

## 동작 방식

브라우저 화면은 `public/`에서 제공하고, Node.js 서버가 API·SQLite·촬영 대기열·일정 실행을 담당합니다. 촬영은 서버의 Playwright와 Chromium으로 수행합니다. 별도 프론트엔드 빌드 과정은 없습니다.

기록은 기본적으로 `data/`에 저장합니다. 서버를 종료하면 자동 촬영도 멈춥니다. 로그인이나 봇 차단 우회는 지원하지 않으며, 인증 없이 인터넷에 공개하는 용도로 설계하지 않았습니다.

## 개발

```bash
npm run dev
npm test
```

실제 촬영·UI 검사의 실행 조건과 명령은 [개발 가이드](docs/development.md)에 정리했습니다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [사용 가이드](docs/guide.md) | 촬영, 일정, 기록 정리, 비교와 기능별 제한 |
| [개발 가이드](docs/development.md) | 파일 구조, 테스트, UI 검증 |
| [운영 가이드](docs/deployment.md) | 환경변수, 상시 실행, 업데이트와 백업 |
| [기여 안내](CONTRIBUTING.md) | 변경과 오류 제보 방법 |

## 라이선스

[MIT](LICENSE)
