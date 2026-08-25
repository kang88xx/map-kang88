"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection } from "geojson";
import { parseFile, parsePhotosTakeoutJson } from "@/lib/parse";
import { buildSegments, buildVisitRoute, haversineKm, totalDistanceKm } from "@/lib/geo";
import { generateSample } from "@/lib/sample";
import { runPlayback, type PlaybackHandle, type PlaybackInfo } from "@/lib/playback";
import type { TrackPoint } from "@/lib/types";
import type { Map as MLMap } from "maplibre-gl";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

interface LoadedFile {
  name: string;
  format: string;
  count: number;
}

const dayStr = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const MAX_RENDER_POINTS = 20000;
const LIVE_STORAGE_KEY = "kang-map-live";
const LIVE_MIN_METERS = 15;
const LIVE_MIN_MS = 30_000;

export default function Home() {
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [livePoints, setLivePoints] = useState<TrackPoint[]>([]);
  const [tracking, setTracking] = useState(false);
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [scanning, setScanning] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  const srcSeqRef = useRef(0);
  const addPoints = useCallback((added: TrackPoint[], file: LoadedFile | null) => {
    const src = ++srcSeqRef.current;
    const tagged = added.map((p) => ({ ...p, src }));
    setPoints((prev) => {
      // 같은 파일을 두 번 올린 경우 등 완전 중복 포인트는 제거
      const seen = new Set(prev.map((p) => `${p.t}|${p.lat.toFixed(6)}|${p.lng.toFixed(6)}`));
      const fresh = tagged.filter(
        (p) => !seen.has(`${p.t}|${p.lat.toFixed(6)}|${p.lng.toFixed(6)}`),
      );
      return [...prev, ...fresh].sort((a, b) => a.t - b.t);
    });
    if (file) setFiles((prev) => [...prev, file]);
    // 새 데이터가 기존 기간 밖이면 안 보이므로, 기간을 전체 범위로 다시 초기화
    setFrom("");
    setTo("");
  }, []);

  // 실시간 기록: 이 브라우저에 저장된 기록 복원/저장 (손상된 저장값 방어)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LIVE_STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const clean = parsed.filter((p): p is TrackPoint => {
        if (typeof p !== "object" || p === null) return false;
        const q = p as TrackPoint;
        return (
          q.kind === "path" &&
          Number.isFinite(q.lat) && Math.abs(q.lat) <= 90 &&
          Number.isFinite(q.lng) && Math.abs(q.lng) <= 180 &&
          !(q.lat === 0 && q.lng === 0) &&
          Number.isFinite(q.t)
        );
      });
      if (clean.length > 0) setLivePoints(clean);
    } catch {}
  }, []);
  useEffect(() => {
    if (livePoints.length === 0) return;
    try {
      localStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify(livePoints));
    } catch {}
  }, [livePoints]);

  const acquireWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
      };
      const lock = (await nav.wakeLock?.request("screen")) ?? null;
      // 요청이 완료되기 전에 추적이 중지됐다면 바로 해제 (비동기 누수 방지)
      if (watchIdRef.current == null) {
        lock?.release().catch(() => {});
        return;
      }
      wakeLockRef.current?.release().catch(() => {}); // 이전 잠금 교체 시 누수 방지
      wakeLockRef.current = lock;
    } catch {}
  }, []);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    setTracking(false);
  }, []);

  const startTracking = useCallback(() => {
    setError(null);
    if (watchIdRef.current != null) return; // 이미 추적 중 — 중복 watch 방지
    if (!("geolocation" in navigator)) {
      setError("이 브라우저는 위치 정보를 지원하지 않습니다.");
      return;
    }
    if (!window.isSecureContext) {
      setError(
        "위치 기록은 HTTPS에서만 동작합니다. 폰에서 쓰려면 배포된 주소(https)로 접속해 주세요.",
      );
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const p: TrackPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          t: pos.timestamp,
          kind: "path",
        };
        setLivePoints((prev) => {
          const last = prev[prev.length - 1];
          if (last) {
            const meters = haversineKm(last, p) * 1000;
            if (meters < LIVE_MIN_METERS && p.t - last.t < LIVE_MIN_MS) return prev;
          }
          return [...prev, p];
        });
      },
      (err) => {
        setError(`위치 정보를 가져오지 못했습니다: ${err.message}`);
        stopTracking();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    setTracking(true);
    acquireWakeLock();
  }, [acquireWakeLock, stopTracking]);

  // 화면이 다시 보이면 wake lock 재획득, 언마운트 시 정리
  useEffect(() => {
    const onVisible = () => {
      if (tracking && document.visibilityState === "visible") acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [tracking, acquireWakeLock]);

  const clearLive = useCallback(() => {
    stopTracking();
    setLivePoints([]);
    try {
      localStorage.removeItem(LIVE_STORAGE_KEY);
    } catch {}
  }, [stopTracking]);

  /* 경로 재생 + 영상 저장 */
  const mapInstRef = useRef<MLMap | null>(null);
  const playHandleRef = useRef<PlaybackHandle | null>(null);
  const playTokenRef = useRef<object | null>(null);
  const [playMode, setPlayMode] = useState<"idle" | "play" | "record" | "saving">("idle");
  const [mapReady, setMapReady] = useState(false);
  const [playInfo, setPlayInfo] = useState<PlaybackInfo | null>(null);
  const playSegmentsRef = useRef<TrackPoint[][]>([]);

  const stopPlay = useCallback(() => {
    playTokenRef.current = null;
    playHandleRef.current?.stop();
    playHandleRef.current = null;
    setPlayMode("idle");
    setPlayInfo(null);
  }, []);
  useEffect(() => {
    stopPlayRef.current = stopPlay;
  }, [stopPlay]);

  const startPlay = useCallback(
    (record: boolean) => {
      const map = mapInstRef.current;
      if (!map || playSegmentsRef.current.length === 0) return;
      // 이전 재생의 비동기 콜백(onstop 등)이 새 재생의 UI 상태를 건드리지 않도록
      // 실행마다 토큰을 발급하고, 콜백에서 자기 토큰이 최신일 때만 반영한다
      playHandleRef.current?.stop();
      const token = {};
      playTokenRef.current = token;
      setError(null);
      setPlayMode(record ? "record" : "play");
      const handle = runPlayback(map, playSegmentsRef.current, {
        record,
        onProgress: (info) => {
          if (playTokenRef.current === token) setPlayInfo(info);
        },
        onRecordError: () => {
          if (playTokenRef.current === token)
            setError("녹화가 중단되어 영상을 저장하지 못했어요. 다시 시도해 주세요.");
        },
        onDone: (video) => {
          if (playTokenRef.current !== token) return;
          playTokenRef.current = null;
          playHandleRef.current = null;
          if (video) {
            setPlayMode("saving");
            const a = document.createElement("a");
            a.href = URL.createObjectURL(video.blob);
            a.download = `kang-map_${from || "start"}_${to || "end"}.${video.ext}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
          }
          setPlayMode("idle");
          setPlayInfo(null);
        },
      });
      if (!handle) {
        playTokenRef.current = null;
        setPlayMode("idle");
        setError("재생할 경로가 없습니다. 기간을 넓혀 보세요.");
      } else {
        playHandleRef.current = handle;
        if (record && !handle.recording) {
          // 녹화 셋업 실패: 재생은 계속하되 사용자에게 상태를 정직하게 알린다
          setPlayMode("play");
          setError("이 브라우저는 영상 녹화를 지원하지 않아 미리보기만 재생합니다.");
        }
      }
    },
    [from, to],
  );

  // 언마운트 시 위치 추적·웨이크락·재생을 정리
  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null; // 진행 중이던 wake lock 요청이 이 값을 보고 스스로 해제하게
      }
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      playTokenRef.current = null;
      playHandleRef.current?.stop();
    };
  }, []);

  const handleFiles = useCallback(
    async (list: FileList | File[]) => {
      setError(null);
      const all = Array.from(list);
      const images = all.filter(
        (f) => f.type.startsWith("image/") || /\.(jpe?g|heic|heif|png|tiff?|webp)$/i.test(f.name),
      );
      const jsons = all.filter((f) => /\.json$/i.test(f.name));
      const others = all.filter((f) => !images.includes(f) && !jsons.includes(f));

      // JSON: Google 포토 메타데이터는 한 묶음으로, 나머지는 타임라인 포맷으로
      const photoMetaPoints: TrackPoint[] = [];
      for (const file of jsons) {
        try {
          const text = await file.text();
          // 사진 메타데이터 JSON은 항상 작다 — 수백 MB짜리 Records.json을
          // 사진 파서에서 한 번 더 JSON.parse하는 낭비를 막는다
          const metaPoint = file.size < 65536 ? parsePhotosTakeoutJson(text) : null;
          if (metaPoint) {
            photoMetaPoints.push(metaPoint);
            continue;
          }
          const { points: parsed, format } = parseFile(file.name, text);
          addPoints(parsed, { name: file.name, format, count: parsed.length });
        } catch (e) {
          setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (photoMetaPoints.length > 0) {
        addPoints(photoMetaPoints, {
          name: `Google 포토 메타데이터 ${photoMetaPoints.length}개`,
          format: "Google 포토",
          count: photoMetaPoints.length,
        });
      }

      for (const file of others) {
        try {
          const text = await file.text();
          const { points: parsed, format } = parseFile(file.name, text);
          addPoints(parsed, { name: file.name, format, count: parsed.length });
        } catch (e) {
          setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (images.length > 0) {
        const exifr = (await import("exifr")).default;
        const photoPoints: TrackPoint[] = [];
        let done = 0;
        const CHUNK = 20;
        for (let i = 0; i < images.length; i += CHUNK) {
          const chunk = images.slice(i, i + CHUNK);
          await Promise.all(
            chunk.map(async (file) => {
              try {
                const meta = await exifr.parse(file, {
                  pick: [
                    "GPSLatitude",
                    "GPSLongitude",
                    "GPSLatitudeRef",
                    "GPSLongitudeRef",
                    "DateTimeOriginal",
                    "CreateDate",
                  ],
                });
                const gps = await exifr.gps(file);
                if (!gps || gps.latitude == null || gps.longitude == null) return;
                const when: Date | undefined = meta?.DateTimeOriginal ?? meta?.CreateDate;
                const t =
                  when instanceof Date && !Number.isNaN(when.getTime())
                    ? when.getTime()
                    : file.lastModified;
                photoPoints.push({
                  lat: gps.latitude,
                  lng: gps.longitude,
                  t,
                  kind: "visit",
                  name: `📷 ${file.name}`,
                });
              } catch {
                // 사진 하나가 깨져도 나머지는 계속 처리
              }
            }),
          );
          done = Math.min(i + CHUNK, images.length);
          setScanning(`사진 분석 중 ${done.toLocaleString()} / ${images.length.toLocaleString()}`);
        }
        setScanning(null);
        if (photoPoints.length > 0) {
          addPoints(photoPoints, {
            name: `사진 ${images.length.toLocaleString()}장`,
            format: "사진 EXIF",
            count: photoPoints.length,
          });
        }
        if (photoPoints.length < images.length) {
          setError(
            `사진 ${images.length.toLocaleString()}장 중 ${(images.length - photoPoints.length).toLocaleString()}장에는 위치 정보가 없어 건너뛰었습니다.` +
              (photoPoints.length === 0
                ? " (메신저로 받은 사진은 위치 정보가 제거된 경우가 많아요. 카메라로 직접 찍은 원본을 올려보세요.)"
                : ""),
          );
        }
      }
    },
    [addPoints],
  );

  const loadSample = useCallback(() => {
    setError(null);
    const sample = generateSample();
    addPoints(sample, { name: "샘플 여행 데이터", format: "데모", count: sample.length });
  }, [addPoints]);

  const stopPlayRef = useRef<() => void>(() => {});
  const reset = useCallback(() => {
    stopPlayRef.current(); // 기간이 이미 비어 있어도 진행 중인 재생·녹화를 확실히 중지
    setPoints([]);
    setFiles([]);
    setFrom("");
    setTo("");
    setError(null);
  }, []);

  // 기간이 바뀌면 진행 중이던 재생·녹화는 더 이상 유효하지 않으므로 중지
  useEffect(() => {
    stopPlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const merged = useMemo(
    () => [...points, ...livePoints].sort((a, b) => a.t - b.t),
    [points, livePoints],
  );

  // 데이터가 처음 생기면 기간을 전체 범위로 초기화
  useEffect(() => {
    if (merged.length === 0) return;
    setFrom((f) => f || dayStr(merged[0].t));
    setTo((t) => t || dayStr(merged[merged.length - 1].t));
  }, [merged]);

  const dataRange = useMemo(() => {
    if (merged.length === 0) return null;
    return { min: dayStr(merged[0].t), max: dayStr(merged[merged.length - 1].t) };
  }, [merged]);

  const setPreset = useCallback(
    (days: number | "all") => {
      if (merged.length === 0) return;
      const max = merged[merged.length - 1].t;
      setTo(dayStr(max));
      setFrom(days === "all" ? dayStr(merged[0].t) : dayStr(max - (days - 1) * 86_400_000));
    },
    [merged],
  );

  const filtered = useMemo(() => {
    if (merged.length === 0) return [];
    // DST가 있는 타임존에서도 정확하도록 로컬 자정을 Date 생성자로 계산 (+24h 고정값 금지)
    const dayStart = (s: string) => {
      const [y, m, d] = s.split("-").map(Number);
      return new Date(y, m - 1, d).getTime();
    };
    const nextDayStart = (s: string) => {
      const [y, m, d] = s.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      dt.setDate(dt.getDate() + 1);
      return dt.getTime();
    };
    let lo = from || "";
    let hi = to || "";
    if (lo && hi && lo > hi) [lo, hi] = [hi, lo]; // 시작>끝이면 뒤집어서 해석
    const t0 = lo ? dayStart(lo) : -Infinity;
    const t1 = hi ? nextDayStart(hi) : Infinity;
    return merged.filter((p) => p.t >= t0 && p.t < t1);
  }, [merged, from, to]);

  const { lines, visits, bounds, playSegments, stats } = useMemo(() => {
    const pathPoints = filtered.filter((p) => p.kind === "path");
    // 사진·방문 기록만 있는 경우: 연속 GPS용 3시간 규칙 대신 완화된 규칙으로 시간순 연결
    const usingVisitRoute = pathPoints.length < 2;
    const routeSource = usingVisitRoute ? filtered : pathPoints;
    const segmenter = usingVisitRoute ? buildVisitRoute : buildSegments;
    // 소스(파일·실시간)별로 나눠 세그먼트를 만들어야 동시대의 다른 기록이 지그재그로 섞이지
    // 않고, 결과는 시작 시각순으로 정렬해 재생이 시간을 거슬러 달리지 않게 한다
    const groups = new Map<number | undefined, TrackPoint[]>();
    for (const p of routeSource) {
      const g = groups.get(p.src);
      if (g) g.push(p);
      else groups.set(p.src, [p]);
    }
    const fullSegments = [...groups.values()]
      .flatMap(segmenter)
      .sort((a, b) => a[0].t - b[0].t);
    // 렌더·재생용 다운샘플은 세그먼트를 만든 뒤 세그먼트별로, 끝점을 보존하며 적용한다
    const totalPts = fullSegments.reduce((n, s) => n + s.length, 0);
    const stride = Math.max(1, Math.ceil(totalPts / MAX_RENDER_POINTS));
    const segments =
      stride === 1
        ? fullSegments
        : fullSegments
            .map((seg) => seg.filter((_, i) => i % stride === 0 || i === seg.length - 1))
            .filter((s) => s.length >= 2);

    const tMin = filtered[0]?.t ?? 0;
    const tMax = filtered[filtered.length - 1]?.t ?? 1;
    const span = Math.max(1, tMax - tMin);

    const lineFeatures: Feature[] = segments.map((seg) => {
      // 날짜변경선을 건너는 세그먼트가 지도를 가로지르는 선이 되지 않도록 경도 언랩
      let prevLng = seg[0].lng;
      const coordinates = seg.map((p) => {
        let lng = p.lng;
        while (lng - prevLng > 180) lng -= 360;
        while (lng - prevLng < -180) lng += 360;
        prevLng = lng;
        return [lng, p.lat];
      });
      return {
        type: "Feature",
        properties: { tn: (seg[0].t - tMin) / span },
        geometry: { type: "LineString", coordinates },
      } as Feature;
    });

    const visitPoints = filtered.filter((p) => p.kind === "visit");
    const visitFeatures: Feature[] = visitPoints.slice(0, 3000).map((p) => ({
      type: "Feature",
      properties: {
        name: p.name ?? "",
        when: new Date(p.t).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }),
      },
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    }));

    // 화면 맞춤은 글리치가 걸러진 세그먼트 + 방문 지점 기준 (이상치 하나로 지구 전체가 되지 않게)
    const boundPts: TrackPoint[] = [...segments.flat(), ...visitPoints];
    let bbox: [number, number, number, number] | null = null;
    if (boundPts.length > 0) {
      let minLat = Infinity,
        maxLat = -Infinity;
      for (const p of boundPts) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
      }
      // 경도는 원형이므로: [0,360)으로 정규화 후 가장 큰 빈 구간의 여집합을 범위로 사용
      // (태평양을 건너는 데이터가 지구 전체로 잡히는 것을 방지)
      const lngs = [...new Set(boundPts.map((p) => ((p.lng % 360) + 360) % 360))].sort(
        (a, b) => a - b,
      );
      let gapStart = 0;
      let maxGap = -Infinity;
      for (let i = 0; i < lngs.length; i++) {
        const next = i === lngs.length - 1 ? lngs[0] + 360 : lngs[i + 1];
        const gap = next - lngs[i];
        if (gap > maxGap) {
          maxGap = gap;
          gapStart = i;
        }
      }
      let minLng = lngs[(gapStart + 1) % lngs.length];
      let maxLng = lngs[gapStart];
      if (maxLng < minLng) maxLng += 360; // 구간이 360° 경계를 넘는 경우 언랩
      if (minLng > 180) {
        minLng -= 360;
        maxLng -= 360;
      }
      const pad = 0.02;
      bbox = [minLng - pad, minLat - pad, maxLng + pad, maxLat + pad];
    }

    const days = new Set(filtered.map((p) => dayStr(p.t))).size;

    return {
      lines: { type: "FeatureCollection", features: lineFeatures } as FeatureCollection,
      visits: { type: "FeatureCollection", features: visitFeatures } as FeatureCollection,
      bounds: bbox,
      playSegments: segments,
      stats: {
        points: filtered.length,
        distanceKm: totalDistanceKm(fullSegments),
        visits: visitPoints.length,
        days,
      },
    };
  }, [filtered]);

  useEffect(() => {
    playSegmentsRef.current = playSegments;
  }, [playSegments]);

  const importControls = (
    <div className="flex flex-col gap-3">
      <div
        className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center text-sm transition-colors ${
          dragOver
            ? "border-indigo-400 bg-indigo-500/10"
            : "border-zinc-700 hover:border-zinc-500"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <p className="font-medium">위치 기록 파일 올리기</p>
        <p className="mt-1 text-zinc-400">
          Google 타임라인 JSON · GPX · 사진(위치 정보)
          <br />
          클릭하거나 파일을 끌어다 놓으세요
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".json,.gpx,image/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <button
        onClick={() => dirInputRef.current?.click()}
        className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
      >
        📁 사진 폴더 통째로 분석 (PC)
      </button>
      <input
        ref={dirInputRef}
        type="file"
        multiple
        className="hidden"
        // @ts-expect-error 비표준 속성이지만 Chrome/Edge/Safari가 지원
        webkitdirectory=""
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        onClick={loadSample}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500"
      >
        샘플 데이터로 미리 보기
      </button>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col-reverse md:flex-row bg-zinc-950 text-zinc-100">
      <aside
        className={`flex w-full md:w-96 shrink-0 ${sheetOpen ? "h-[45dvh]" : "h-14"} md:h-auto flex-col gap-5 overflow-y-auto border-t md:border-t-0 md:border-r border-zinc-800 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] transition-[height] duration-200`}
      >
        <button
          onClick={() => setSheetOpen((v) => !v)}
          className="md:hidden -mt-2 flex items-center justify-center gap-2 rounded-lg py-1 text-xs text-zinc-400"
          aria-expanded={sheetOpen}
        >
          <span className="h-1 w-10 rounded-full bg-zinc-700" />
          {sheetOpen ? "접기" : "펼치기"}
        </button>
        <header>
          <h1 className="text-xl font-bold tracking-tight">
            kang-map <span className="text-indigo-400">·</span> 이동 기록 지도
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            기간을 정해 내가 다닌 경로를 세계 지도에서 확인하세요.
          </p>
        </header>

        {merged.length === 0 && importControls}

        {scanning && (
          <p className="rounded-lg border border-indigo-800 bg-indigo-950/50 p-3 text-sm text-indigo-300">
            {scanning}
          </p>
        )}

        <section
          className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
          style={{ order: merged.length > 0 ? 8 : 0 }} // 데이터가 있으면 핵심 워크플로 아래로
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">📍 실시간 기록</h2>
            {tracking && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                기록 중
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            페이지가 열려 있는 동안 현재 위치를 기록해 지도에 그립니다. 기록은 이 브라우저에만
            저장됩니다.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={tracking ? stopTracking : startTracking}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
                tracking
                  ? "bg-rose-600 hover:bg-rose-500"
                  : "border border-emerald-700 text-emerald-300 hover:bg-emerald-950/60"
              }`}
            >
              {tracking ? "기록 중지" : "기록 시작"}
            </button>
            {livePoints.length > 0 && (
              <button
                onClick={clearLive}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                기록 지우기
              </button>
            )}
          </div>
          {livePoints.length > 0 && (
            <p className="mt-2 text-xs text-zinc-400">
              저장된 포인트 {livePoints.length.toLocaleString()}개
            </p>
          )}
        </section>

        {error && (
          <p className="rounded-lg border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-300">
            {error}
          </p>
        )}

        {merged.length > 0 && (
          <>
            <section>
              <h2 className="mb-2 text-sm font-semibold text-zinc-300">기간 선택</h2>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={from}
                  min={dataRange?.min}
                  max={dataRange?.max}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm [color-scheme:dark]"
                />
                <span className="text-zinc-500">~</span>
                <input
                  type="date"
                  value={to}
                  min={dataRange?.min}
                  max={dataRange?.max}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm [color-scheme:dark]"
                />
              </div>
              <div className="mt-2 flex gap-2">
                {(
                  [
                    ["전체", "all"],
                    ["최근 7일", 7],
                    ["최근 30일", 30],
                    ["최근 90일", 90],
                  ] as const
                ).map(([label, v]) => (
                  <button
                    key={label}
                    onClick={() => setPreset(v)}
                    className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <h2 className="text-sm font-semibold text-zinc-200">🎬 경로 영상</h2>
              <p className="mt-1 text-xs text-zinc-400">
                선택한 기간의 경로를 지도 위에서 재생합니다. 도시에선 확대, 이동 중엔 축소되는
                시네마틱 카메라로 녹화돼 기기에 저장됩니다.
              </p>
              {playMode === "idle" ? (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => startPlay(false)}
                    disabled={playSegments.length === 0 || !mapReady}
                    className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ▶ 경로 재생
                  </button>
                  <button
                    onClick={() => startPlay(true)}
                    disabled={playSegments.length === 0 || !mapReady}
                    className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ⏺ 20초 영상 만들기
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <p className="mb-2 text-xs text-zinc-300" aria-live="polite">
                    {playMode === "record" ? "영상 만드는 중" : "경로 재생 중"} ·{" "}
                    {Math.round((playInfo?.progress ?? 0) * 100)}% · 약{" "}
                    {Math.max(
                      1,
                      Math.ceil((1 - (playInfo?.progress ?? 0)) * (playMode === "record" ? 20 : 16)) +
                        (playMode === "record" ? 2 : 1),
                    )}
                    초 남음
                  </p>
                  <div className="flex items-center justify-between font-mono text-xs text-zinc-300">
                    <span>{playInfo?.date ?? "…"}</span>
                    <span className="text-amber-400">
                      {Math.round(playInfo?.km ?? 0).toLocaleString()} km · 지구의{" "}
                      {(playInfo?.pct ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-sky-400 to-amber-400"
                      style={{ width: `${(playInfo?.progress ?? 0) * 100}%` }}
                    />
                  </div>
                  <button
                    onClick={stopPlay}
                    className="mt-3 w-full rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
                  >
                    {playMode === "record" ? "녹화 중지 (저장 안 함)" : "중지"}
                  </button>
                  {playMode === "record" && (
                    <p className="mt-2 text-[11px] text-zinc-500">
                      ⏺ 녹화 중 — 끝나면 영상 파일이 자동으로 다운로드됩니다
                    </p>
                  )}
                </div>
              )}
            </section>

            <section className="grid grid-cols-2 gap-2">
              {(
                [
                  [
                    stats.distanceKm >= 400
                      ? `이동 거리 · 지구의 ${((stats.distanceKm / 40075) * 100).toFixed(1)}%`
                      : "이동 거리",
                    `${Math.round(stats.distanceKm).toLocaleString()} km`,
                  ],
                  ["기록된 날", `${stats.days}일`],
                  ["위치 포인트", stats.points.toLocaleString()],
                  ["방문 장소", stats.visits.toLocaleString()],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                  <p className="text-xs text-zinc-400">{label}</p>
                  <p className="mt-0.5 text-lg font-semibold">{value}</p>
                </div>
              ))}
            </section>

            {files.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-zinc-300">불러온 파일</h2>
              <ul className="space-y-1.5">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs"
                  >
                    <span className="truncate">{f.name}</span>
                    <span className="ml-2 shrink-0 text-zinc-400">
                      {f.format} · {f.count.toLocaleString()}개
                    </span>
                  </li>
                ))}
              </ul>
              <button
                onClick={reset}
                className="mt-2 w-full rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                불러온 파일 지우기
              </button>
            </section>
            )}

            <details className="rounded-xl border border-zinc-800">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm text-zinc-300 hover:bg-zinc-900 rounded-xl">
                ➕ 다른 기록 추가
              </summary>
              <div className="p-4 pt-1">{importControls}</div>
            </details>
          </>
        )}

        <footer className="mt-auto space-y-2 pt-4 text-xs text-zinc-500" style={{ order: 10 }}>
          <p>
            🔒 올린 파일은 서버로 전송되지 않고 <strong>이 브라우저 안에서만</strong> 처리됩니다.
          </p>
          <p>
            내보내기 방법: Google 지도 앱 → 설정 → 개인 콘텐츠 → 타임라인 데이터 내보내기 (또는
            Google 테이크아웃의 위치 기록)
          </p>
        </footer>
      </aside>

      <main className="relative flex-1 min-h-0">
        <MapView
          lines={lines}
          visits={visits}
          bounds={playMode === "idle" ? bounds : null}
          onMap={(m) => {
            mapInstRef.current = m;
            setMapReady(m != null);
          }}
        />
        {merged.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded-xl bg-zinc-950/70 px-5 py-3 text-sm text-zinc-200 backdrop-blur">
              파일을 올리거나 샘플 데이터로 시작해 보세요
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
