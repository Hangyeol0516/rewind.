# 운영 가이드

[README](../README.md) · [사용 가이드](guide.md) · [개발 가이드](development.md)

## 실행 설정

```bash
cp .env.example .env.local
npm start
```

| 설정 | 기본값 | 설명 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 서버 바인딩 주소 |
| `PORT` | `3000` | HTTP 포트 |
| `ALLOWED_IPS` | 빈 값 | 접속을 허용할 IP, 쉼표로 구분. 빈 값이면 IP 제한 없음 |
| `REWIND_DATA_DIR` | 프로젝트의 `data/` | DB·이미지·진단 저장 위치 |

셸 환경변수가 `.env.local`보다 우선합니다. 다른 기기에서 접속하려면 `HOST=0.0.0.0`과 사용할 포트를 설정합니다. 접근 제한은 실제 TCP 접속 주소를 사용하며 전달 헤더는 신뢰하지 않습니다.

로그인 기능은 없습니다. 접근 가능한 사용자는 기록을 조회·촬영·삭제할 수 있으므로 인증과 네트워크 격리 없이 인터넷에 공개하지 마세요.

## Chromium 설치

```bash
npm ci
npm run browser:install
```

브라우저 시스템 라이브러리가 이미 설치되어 있으면 `npx playwright install chromium`으로 브라우저만 설치할 수 있습니다.

관리자 권한이 없는 Ubuntu 24.04 x86_64 환경에서는 다음 대체 방법을 제공합니다. 다른 배포판에는 적용하지 않습니다.

```bash
npm run browser:libs:local
npx playwright install chromium
```

라이브러리는 `data/browser-libs/`에 추출합니다. 서비스를 실행하는 사용자 계정으로 Chromium을 설치하세요.

## 상시 실행

Linux 사용자 systemd 서비스 예제는 [deploy/rewind.service.example](../deploy/rewind.service.example)에 있습니다. 기본 체크아웃 위치는 `~/rewind`입니다.

설치 전에 `command -v node`로 Node.js 경로를 확인하고, 예제의 `ExecStart`를 실제 절대 경로로 수정하세요. 체크아웃 위치가 다르면 `WorkingDirectory`와 스크립트 경로도 수정합니다. systemd는 대화형 셸의 PATH 설정을 자동으로 읽지 않습니다.

```bash
mkdir -p ~/.config/systemd/user
cp deploy/rewind.service.example ~/.config/systemd/user/rewind.service
# 복사한 파일의 경로를 확인·수정한 다음 실행합니다.
systemctl --user daemon-reload
systemctl --user enable --now rewind.service
systemctl --user status rewind.service
```

```bash
systemctl --user restart rewind.service
systemctl --user stop rewind.service
journalctl --user -u rewind.service -n 30
```

로그아웃 후에도 실행하려면 해당 계정의 linger 설정이 필요합니다. 시스템 관리자가 `loginctl enable-linger <사용자명>`으로 설정할 수 있습니다. 서버가 실행되는 동안에만 자동 촬영합니다.

## 업데이트와 백업

1. 서비스를 종료합니다.
2. 설정한 데이터 디렉터리 전체와 `.env.local`을 백업합니다.
3. 소스를 업데이트하고 `npm ci`를 실행합니다.
4. Playwright 버전이 바뀌면 Chromium을 다시 설치합니다.
5. 서비스를 시작하고 기존 기록과 촬영 상태를 확인합니다.

기본 저장 구조는 다음과 같습니다.

```text
data/
├── rewind.sqlite
├── captures/<capture-id>.png
├── diagnostics/
└── control.sock
```

DB는 WAL 모드를 사용하므로 실행 중 SQLite 파일 하나만 복사하지 마세요. 종료 후 데이터 디렉터리 전체를 백업합니다. 시작 시 필요한 스키마 필드를 자동 추가하므로 이전 버전으로 되돌릴 때는 백업과의 호환성도 확인하세요.

현재 저장소에는 자동 배포 설정이 없습니다. GitHub Actions는 검사만 실행합니다.

## 로컬 관리 도구

POSIX 환경에서 서버는 `data/control.sock`에 소유자만 접근 가능한 로컬 관리 소켓을 만듭니다(권한 600). 별도 TCP 포트나 IP 허용 예외는 만들지 않습니다.

`node scripts/watch-recheck.mjs <등록된-site-id>`는 같은 주소·같은 브라우저 설정으로 30분, 60분, 120분, 180분 간격의 저빈도 재점검을 최대 네 번 실행합니다. 한국 시간 다음 새벽 3시가 상한이며, 새 화면을 얻거나 등록 주소가 바뀌면 일찍 끝납니다. 차단을 해제하거나 우회하는 기능은 아닙니다.

실제 프로세스가 실행 중인 동안 앱에 다음 점검 시간이 표시됩니다. 결과는 `data/recheck-<site-id>.json`, 프로세스 ID는 실행 중의 `.lock` 파일에 저장됩니다. 이 작업은 외부 사이트가 거부하는 요청의 성공을 보장하지 않습니다. `--check-now`는 로컬 관리자가 한 번만 즉시 점검할 때 사용하는 옵션입니다.
