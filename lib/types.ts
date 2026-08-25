export type PointKind = "path" | "visit";

export interface TrackPoint {
  lat: number;
  lng: number;
  /** epoch milliseconds */
  t: number;
  kind: PointKind;
  name?: string;
  /** 업로드 소스 구분 — 서로 다른 파일의 기록이 시간순으로 섞여 지그재그가 되는 것을 방지 */
  src?: number;
}

export interface ParseResult {
  points: TrackPoint[];
  /** human-readable format label, e.g. "Google 타임라인 (Records)" */
  format: string;
}
