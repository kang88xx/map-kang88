# DESIGN

## Direction

서울 야간 상황실. 어두운 정보 패널과 실제 지도를 분리하고, 검증되지 않은 위성·CCTV 상태를 숨기지 않는다.

## Typography

- UI: `Gowun Dodum`, weight 400
- Coordinates and system labels: `IBM Plex Mono`, weights 500 and 600

## Colors

- Background: `#101312`
- Panel: `#171b19`
- Raised panel: `#1d231f`
- Border: `#2b342f`
- Text: `#e8efe9`
- Muted: `#98a69d`
- Accent: `#c8ff5c`
- Warning: `#ffb454`
- Danger: `#ff6b5f`

## Layout

- Desktop: `300px` information panel plus map.
- Mobile at `760px` and below: full-screen map plus expandable bottom sheet.
- Spacing grid: `8px`.
- Controls: minimum `44px` touch target.
- Radius: `8px` maximum for primary cards and controls.

## Product Truth

- Never label imagery or CCTV as live without source evidence.
- Always keep source attribution visible.
- Pair every status color with text.
- Search runs only on explicit submit, never while typing.
