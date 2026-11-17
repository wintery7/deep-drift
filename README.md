# DEEP DRIFT

*Drift together, in silence.* — 같은 바다에서, 각자의 속도로.

해파리가 되어 심해를 유영하는 브라우저 기반 3D 멀티플레이 힐링 공간입니다.

## 실행

```bash
npm install
```

개발 (터미널 두 개):

```bash
npm run dev:server
```

```bash
npm run dev:client
```

→ http://localhost:5173 (게임 서버는 `:2567`). 탭을 두 개 열면 서로의 해파리가 보입니다.

배포 (서버가 빌드된 클라이언트까지 한 포트로 서빙):

```bash
npm run build
```

```bash
npm start
```

→ http://localhost:2567 · 포트는 `PORT`, 별도 게임 서버 주소는 빌드 시 `VITE_SERVER_URL`로 지정합니다.

## 조작

| 입력 | 기능 |
|---|---|
| W / A / S / D | 전진 / 좌 / 후진 / 우 |
| Space / Shift | 상승 / 하강 |
| 마우스 드래그 | 둘러보기 |
| Esc | 설정 · 일시정지 |

## 구조

```
shared/world.ts          클라이언트·서버 공용 월드 정의 (경계, 지형 높이, 메시지 형식)
server/src/
  index.ts               Express + Colyseus 서버
  OceanRoom.ts           방(최대 8명), 입장/퇴장/재접속, 이동 검증
  OceanState.ts          동기화 스키마 (위치·방향·외형·연결 상태)
client/src/
  game/                  상태 저장소, 입력, 런타임 값, 입장/퇴장 동작
  net/network.ts         Colyseus 연결, 재접속, 원격 스냅샷 버퍼
  audio/AudioEngine.ts   Web Audio 절차적 사운드 (환경음·물방울·고래·공간 음향)
  scene/                 심해 환경, 생명체, 해파리 셰이더, 플레이어/카메라, 원격 플레이어 보간
  ui/                    메인 메뉴, HUD, 설정
```

## 메모

- 해파리·산호·고래·사운드는 모두 코드로 생성합니다 (외부 GLB·음원 파일 없음).
- 해저 동굴(`client/src/scene/cave.ts`, `Cave.tsx`)은 바다 중심에서 등불 산호를 따라가면 나옵니다. 메시와 충돌 판정이 같은 형태 함수를 쓰며, 충돌은 클라이언트에서만 처리합니다.
- 서버는 물리 시뮬레이션을 하지 않고, 클라이언트가 보낸 위치의 형식·빈도·이동 거리·월드 범위만 검증합니다.
- 연결이 끊긴 사용자는 12초 동안 흐려진 채 남아 있다가 제거되며, 그 안에 돌아오면(새로고침 포함) 같은 자리로 복귀합니다.
- `?capture`를 붙여 개발 서버를 열면 캔버스를 이미지로 추출할 수 있습니다 (`preserveDrawingBuffer`).
