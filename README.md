# 서울, 지금 · 지도 프로토타입

서울 장소를 검색하면 실제 지도 위치로 이동하고, 현재 중심점과 확대 수준을 URL로 공유하는 브라우저 프로토타입입니다.

## 실행

```bash
npm start
```

브라우저에서 `http://127.0.0.1:4173`을 엽니다. `file://` 직접 실행은 Nominatim 요청의 정상적인 referrer 식별과 모듈 로딩에 적합하지 않습니다.

## 검증

```bash
npm run check
```

## 현재 작동하는 것

- 서울 범위의 OpenStreetMap 기본 지도
- 검색 버튼 또는 Enter로 실행하는 Nominatim 장소 검색
- 검색 결과 목록, 지도 이동, 위치 마커
- 확대 13 이상에서 ITS 서울 교통 CCTV 군집 마커
- 선택한 CCTV의 공식 HTTPS HLS 원본 링크
- KMA 천리안 2A 최신 한반도 IR105 이미지와 관측시각 미리보기
- `lat`, `lng`, `z`, `layer` URL 복원과 갱신
- 현재 지도 링크 복사
- 데스크톱 정보 패널과 모바일 하단 시트

## 아직 연결하지 않은 것

- 기상위성·국토위성의 MapLibre 지도 정합 레이어
- 실제 소스의 관측시각·촬영일·공식 재생 링크
- 공개 배포를 위한 자체 검색 프록시와 장기 캐시

위 기능은 공식 API 응답과 이용 조건을 검증하기 전에는 활성화하지 않습니다.

## 공개 서비스 정책

- 지도 타일: [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)
- 장소 검색: [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
- 검색은 입력 중 자동 호출하지 않고 명시적 제출에만 반응합니다.
- 현재 구현은 한 페이지 세션 안에서 검색 요청 간격을 1.1초 이상으로 제한하고 같은 검색어를 메모리 캐시합니다. 여러 탭·여러 사용자를 합산한 앱 전체 제한은 강제하지 못합니다.
- 공개 공유 전에는 Nominatim 앞에 공용 캐시와 앱 전체 속도 제한을 적용하는 검색 프록시가 필요합니다.
- 타일·검색 공급자는 로컬 프로토타입용입니다. 트래픽이 생기면 자체 계약 공급자로 교체해야 합니다.
- MapLibre GL JS 6.6.0 실행 자산은 `vendor/`에 고정했으며 라이선스는 `vendor/MAPLIBRE_LICENSE.txt`에 보관합니다.
