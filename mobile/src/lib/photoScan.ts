import * as MediaLibrary from "expo-media-library/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TrackPoint } from "./geo";

const CACHE_KEY = "kang-map-photo-points-v1";
const SCAN_META_KEY = "kang-map-scan-meta-v1";

export interface ScanProgress {
  scanned: number;
  total: number;
  found: number;
}

export async function loadCachedPoints(): Promise<TrackPoint[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const clean = parsed.filter(
      (p): p is TrackPoint =>
        typeof p === "object" && p !== null &&
        Number.isFinite((p as TrackPoint).lat) && Math.abs((p as TrackPoint).lat) <= 90 &&
        Number.isFinite((p as TrackPoint).lng) && Math.abs((p as TrackPoint).lng) <= 180 &&
        !((p as TrackPoint).lat === 0 && (p as TrackPoint).lng === 0) &&
        Number.isFinite((p as TrackPoint).t),
    );
    return clean.length > 0 ? clean : null;
  } catch {
    return null;
  }
}

export async function clearCache(): Promise<void> {
  await AsyncStorage.multiRemove([CACHE_KEY, SCAN_META_KEY]);
}

/**
 * 사진 보관함 전체에서 위치 메타데이터만 스캔한다.
 * 픽셀은 읽지 않고 좌표·촬영 시각만 수집하며, 결과는 기기 안에만 저장된다.
 */
export async function scanPhotoLibrary(
  onProgress: (p: ScanProgress) => void,
  shouldCancel: () => boolean,
): Promise<TrackPoint[]> {
  const points: TrackPoint[] = [];
  let after: string | undefined;
  let scanned = 0;
  let total = 0;

  // 총 개수 파악 (첫 페이지 응답의 totalCount)
  const firstPage = await MediaLibrary.getAssetsAsync({
    mediaType: "photo",
    first: 1,
  });
  total = firstPage.totalCount;

  while (true) {
    if (shouldCancel()) break;
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: "photo",
      sortBy: [["creationTime", true]],
      first: 100,
      after,
    });
    for (const asset of page.assets) {
      if (shouldCancel()) break;
      scanned++;
      try {
        const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: false });
        const loc = info.location;
        // iOS 네이티브 모듈이 좌표를 문자열로 넘기는 경우가 있어 반드시 숫자로 변환한다
        const lat = loc ? Number(loc.latitude) : NaN;
        const lng = loc ? Number(loc.longitude) : NaN;
        if (
          Number.isFinite(lat) && Math.abs(lat) <= 90 &&
          Number.isFinite(lng) && Math.abs(lng) <= 180 &&
          !(lat === 0 && lng === 0)
        ) {
          points.push({
            lat,
            lng,
            t: asset.creationTime || asset.modificationTime,
            photoId: asset.id,
          });
        }
      } catch {
        // 접근 불가한 사진(클라우드 전용 등)은 건너뛴다
      }
      if (scanned % 25 === 0) onProgress({ scanned, total, found: points.length });
    }
    onProgress({ scanned, total, found: points.length });
    if (!page.hasNextPage || page.assets.length === 0) break;
    after = page.endCursor;
  }

  points.sort((a, b) => a.t - b.t);
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(points));
    await AsyncStorage.setItem(
      SCAN_META_KEY,
      JSON.stringify({ scannedAt: Date.now(), scanned, found: points.length }),
    );
  } catch {
    // 캐시 실패는 치명적이지 않다 — 다음 실행 때 재스캔
  }
  return points;
}
