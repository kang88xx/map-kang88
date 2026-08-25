# kang-map iOS 앱스토어 출시 가이드

앱 코드·아이콘·권한 문구·EAS 설정은 모두 준비돼 있습니다. 아래 단계만 직접 진행하면 됩니다
(Apple 계정 인증이 필요해서 자동화할 수 없는 부분입니다).

## 0. 준비물 (1회)

1. **Apple Developer Program 가입** — https://developer.apple.com/programs/ (연 $99, 승인까지 최대 48시간)
2. **Expo 계정** — https://expo.dev 가입 (무료)
3. EAS CLI 설치·로그인:
   ```bash
   npm i -g eas-cli
   eas login
   ```

## 1. 프로젝트 연결 (1회)

```bash
cd mobile
eas init          # Expo 프로젝트 생성·연결 (app.json에 projectId 기록됨)
```

## 2. 실기기 테스트 (선택, TestFlight 전에 폰에서 확인)

```bash
eas build --profile preview --platform ios
```
- 처음 실행하면 Apple 계정 로그인 → 인증서/프로비저닝을 EAS가 자동 생성해 줍니다
- 끝나면 QR 코드가 나오고, 아이폰에서 스캔해 설치 (Ad Hoc — 기기 등록 필요)

## 3. 앱스토어용 빌드 + 제출

```bash
eas build --profile production --platform ios   # ~15분
eas submit --platform ios --latest              # App Store Connect로 업로드
```
- `eas submit`이 App Store Connect 앱 항목까지 자동 생성해 줍니다
- 빌드 번호는 자동 증가(`autoIncrement`)

## 4. App Store Connect에서 메타데이터 입력

https://appstoreconnect.apple.com → kang-map 앱 →

| 항목 | 권장 값 |
|---|---|
| 이름 | kang-map |
| 부제 | 사진으로 복원하는 내 이동 기록 |
| 카테고리 | 여행 (보조: 라이프스타일) |
| 설명 | 사진 보관함의 위치 정보만 읽어, 지나온 길을 세계 지도 위에 시네마틱하게 재생합니다. 사진 원본과 위치 데이터는 어디에도 업로드되지 않고 기기 안에서만 처리됩니다. 여행은 자동으로 묶여 정리되고, 지금까지의 총 이동 거리를 지구 한 바퀴(40,075km) 기준으로 보여줍니다. |
| 키워드 | 여행,지도,이동경로,타임라인,여행기록,사진지도 |
| 스크린샷 | 시뮬레이터(6.9인치·6.5인치)에서 지도 재생 장면 캡처 |

**개인정보 처리방침 URL(필수)**: 앱이 데이터를 수집하지 않으므로 간단한 페이지면 됩니다.
`https://kang-map.kang88.io/privacy` 를 만들어 두는 것을 추천 (요청하면 만들어 드립니다).

**App Privacy 설문**: "데이터를 수집하지 않음(Data Not Collected)" 선택 —
사진 위치 정보는 기기 내에서만 처리되고 전송되지 않으므로 해당됩니다.

## 5. 심사 제출

TestFlight에서 동작 확인 → "심사에 제출". 이 앱은 위치 권한·백그라운드 동작이 없어
심사 리스크가 낮습니다. 보통 1~3일.

## 참고

- 로컬 시뮬레이터 실행: `npx expo run:ios` (Xcode 필요 — MapLibre 네이티브 모듈 때문에 Expo Go로는 실행 불가)
- Android도 같은 방식: `eas build --platform android` → `eas submit --platform android` (Google Play Console $25 1회)
