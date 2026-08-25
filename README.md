# kang-map — 이동 기록 지도

지정한 기간 동안 내가 다닌 경로를 세계 지도에서 보는 웹 서비스.

## 특징

- **프라이버시 우선**: 올린 위치 기록 파일은 서버로 전송되지 않고 브라우저 안에서만 파싱됩니다.
- **지원 포맷**
  - Google 타임라인 기기 내보내기 (Android `Timeline.json` — `semanticSegments`)
  - Google 타임라인 iOS 내보내기 (최상위 배열 형식)
  - Google 테이크아웃 `Records.json` (`locations`)
  - Google 테이크아웃 Semantic Location History (`timelineObjects`)
  - GPX (`trkpt`/`rtept`/`wpt` + `time`)
  - 사진 EXIF GPS (JPEG/HEIC 등 — 촬영 위치·시각으로 과거 동선 복원)
- 기간 선택(날짜 범위 + 전체/7일/30일/90일 프리셋), 이동 거리·기록된 날·방문 장소 통계
- **경로 영상**: 선택한 기간의 경로를 시네마틱 카메라(도시 확대 ↔ 이동 시 축소, 완료 후
  전체 화면)로 재생하고, 날짜·누적 km·지구 한 바퀴 % 자막과 함께 mp4/webm으로 기기에 저장
- 시간 순서에 따라 경로 색이 변하는 그라데이션 (남색 → 하늘 → 주황)
- 날짜변경선(태평양 횡단)을 올바르게 처리하는 화면 맞춤
- 지도: [MapLibre GL](https://maplibre.org/) + [OpenFreeMap](https://openfreemap.org/) 타일 (API 키 불필요)

## 실행

```bash
npm install
npm run dev
```

## 내 데이터 내보내는 법

- **Android**: Google 지도 앱 → 프로필 → 설정 → 개인 콘텐츠 → 타임라인 데이터 내보내기
- **iOS**: Google 지도 앱 → 프로필 → 설정 → 개인 콘텐츠 → 타임라인 내보내기
- GPX 기록 앱(Strava, GPX Tracker 등)의 내보내기 파일도 지원

## 구현 메모

- `public/maplibre-gl-worker.mjs` / `maplibre-gl-shared.mjs`: Turbopack이 MapLibre의 웹 워커를
  제대로 번들하지 못해 dist 워커를 정적 파일로 서빙하고 `setWorkerUrl()`로 지정합니다.
  `postinstall` 스크립트가 패키지 버전과 자동 동기화합니다.
- 경로는 3시간 이상 공백 또는 시속 1,200km 초과(GPS 글리치) 지점에서 분할됩니다.
- 렌더링 포인트는 최대 2만 개로 다운샘플링됩니다 (대용량 Records.json 대응).
