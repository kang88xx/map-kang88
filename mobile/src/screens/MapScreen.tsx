import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Camera, GeoJSONSource, Layer, Map as MLMap, type CameraRef } from "@maplibre/maplibre-react-native";
import { buildVisitRoute, localDay, totalDistanceKm, type TrackPoint } from "../lib/geo";
import { runPlayback, type PlaybackFrame, type PlaybackHandle } from "../lib/playback";
import type { Trip } from "../lib/trips";
import type { FeatureCollection } from "geojson";
import { C, EARTH_KM, MAP_STYLE } from "../theme";

type Preset = "all" | "30d" | "90d" | "year";

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

/** 정적 경로: 세그먼트별 시간 정규화(tn)로 남색→하늘→호박 그라데이션 */
const ROUTE_COLOR = [
  "interpolate", ["linear"], ["get", "tn"],
  0, C.routeA, 0.5, C.routeB, 1, C.amber,
] as unknown as string;

export function MapScreen({ points, trip }: { points: TrackPoint[]; trip: Trip | null }) {
  const cameraRef = useRef<CameraRef>(null);
  const [preset, setPreset] = useState<Preset>("all");
  const [frame, setFrame] = useState<PlaybackFrame | null>(null);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef<PlaybackHandle | null>(null);

  const filtered = useMemo(() => {
    if (trip) return trip.points;
    if (preset === "all") return points;
    const now = Date.now();
    const from =
      preset === "30d" ? now - 30 * 86_400_000 :
      preset === "90d" ? now - 90 * 86_400_000 :
      new Date(new Date().getFullYear(), 0, 1).getTime();
    return points.filter((p) => p.t >= from);
  }, [points, preset, trip]);

  const { segments, lines, photos, bounds, stats } = useMemo(() => {
    const segs = buildVisitRoute(filtered);
    const tMin = filtered[0]?.t ?? 0;
    const span = Math.max(1, (filtered[filtered.length - 1]?.t ?? 1) - tMin);
    const lineFeatures = segs.map((seg) => {
      let prevLng = seg[0].lng;
      const coordinates = seg.map((p) => {
        let lng = p.lng;
        while (lng - prevLng > 180) lng -= 360;
        while (lng - prevLng < -180) lng += 360;
        prevLng = lng;
        return [lng, p.lat];
      });
      return {
        type: "Feature" as const,
        properties: { tn: (seg[0].t - tMin) / span },
        geometry: { type: "LineString" as const, coordinates },
      };
    });
    const photoFeatures = filtered.slice(0, 2000).map((p) => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
    }));
    let sw: [number, number] | null = null, ne: [number, number] | null = null;
    if (filtered.length > 0) {
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      for (const p of filtered) {
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
      }
      sw = [minLng - 0.05, minLat - 0.05];
      ne = [maxLng + 0.05, maxLat + 0.05];
    }
    const km = totalDistanceKm(segs);
    const days = new Set(filtered.map((p) => localDay(p.t))).size;
    return {
      segments: segs,
      lines: { type: "FeatureCollection" as const, features: lineFeatures },
      photos: { type: "FeatureCollection" as const, features: photoFeatures },
      bounds: sw && ne ? { sw, ne } : null,
      stats: { km, days, photos: filtered.length },
    };
  }, [filtered]);

  // 기간이 바뀌면 전체 보기로 맞추고 진행 중인 재생은 중지
  useEffect(() => {
    playRef.current?.stop();
    playRef.current = null;
    setPlaying(false);
    setFrame(null);
    if (bounds) {
      const t = setTimeout(
        () => cameraRef.current?.fitBounds([...bounds.sw, ...bounds.ne] as [number, number, number, number], {
          padding: { top: 80, bottom: 220, left: 40, right: 40 },
          duration: 800,
        }),
        250,
      );
      return () => clearTimeout(t);
    }
  }, [bounds]);

  useEffect(() => () => playRef.current?.stop(), []);

  const startPlay = useCallback(() => {
    if (segments.length === 0) return;
    playRef.current?.stop();
    setPlaying(true);
    playRef.current = runPlayback(segments, {
      durationMs: 16_000,
      onFrame: (f) => {
        setFrame(f);
        cameraRef.current?.jumpTo({ center: f.camera.center, zoom: f.camera.zoom });
      },
      onDone: (b) => {
        setPlaying(false);
        cameraRef.current?.fitBounds([...b.sw, ...b.ne] as [number, number, number, number], {
          padding: { top: 80, bottom: 220, left: 40, right: 40 },
          duration: 1200,
        });
      },
    });
    if (!playRef.current) setPlaying(false);
  }, [segments]);

  const stopPlay = useCallback(() => {
    playRef.current?.stop();
    playRef.current = null;
    setPlaying(false);
    setFrame(null);
    if (bounds)
      cameraRef.current?.fitBounds([...bounds.sw, ...bounds.ne] as [number, number, number, number], {
        padding: { top: 80, bottom: 220, left: 40, right: 40 },
        duration: 600,
      });
  }, [bounds]);

  const progressFC = useMemo<FeatureCollection>(() => {
    if (!frame) return EMPTY_FC;
    return {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          properties: {},
          geometry: { type: "MultiLineString" as const, coordinates: frame.lines },
        },
      ],
    };
  }, [frame]);

  const headFC = useMemo<FeatureCollection>(() => {
    if (!frame) return EMPTY_FC;
    return {
      type: "FeatureCollection" as const,
      features: [
        { type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: frame.head } },
      ],
    };
  }, [frame]);

  const earthPct = (stats.km / EARTH_KM) * 100;

  return (
    <View style={s.root}>
      <MLMap style={s.map} mapStyle={MAP_STYLE}>
        <Camera ref={cameraRef} />
        <GeoJSONSource id="routes" data={lines}>
          <Layer
            type="line"
            id="routes-casing"
            paint={{ "line-color": "#ffffff", "line-width": 5, "line-opacity": playing ? 0.2 : 0.6 }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
          <Layer
            type="line"
            id="routes-line"
            paint={{ "line-color": ROUTE_COLOR, "line-width": 2.5, "line-opacity": playing ? 0.2 : 0.9 }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="photos" data={photos}>
          <Layer
            type="circle"
            id="photos-circle"
            paint={{
              "circle-radius": 4,
              "circle-color": C.rose,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 1.2,
              "circle-opacity": playing ? 0.25 : 0.9,
            }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="pb-progress" data={progressFC}>
          <Layer
            type="line"
            id="pb-casing"
            paint={{ "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.9 }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
          <Layer
            type="line"
            id="pb-line"
            paint={{ "line-color": C.amber, "line-width": 3.5 }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="pb-head" data={headFC}>
          <Layer
            type="circle"
            id="pb-head-dot"
            paint={{
              "circle-radius": 7,
              "circle-color": C.amber,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2.5,
            }}
          />
        </GeoJSONSource>
      </MLMap>

      {frame && (
        <View style={s.hud}>
          <Text style={s.hudDate}>{frame.date}</Text>
          <Text style={s.hudKm}>{Math.round(frame.km).toLocaleString()} km</Text>
        </View>
      )}

      <View style={s.panel}>
        {trip && <Text style={s.tripLabel}>🧳 {trip.label} 여행</Text>}
        <View style={s.row}>
          <Pressable style={s.playBtn} onPress={playing ? stopPlay : startPlay}>
            <Text style={s.playBtnText}>{playing ? "■" : "▶"}</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            {frame ? (
              <>
                <Text style={s.playState}>
                  경로 재생 중 · {Math.round(frame.progress * 100)}%
                </Text>
                <View style={s.earthTrack}>
                  <View style={[s.earthFill, { width: `${Math.min(100, (frame.km / EARTH_KM) * 100)}%` }]} />
                </View>
              </>
            ) : (
              <>
                <Text style={s.statLine}>
                  {Math.round(stats.km).toLocaleString()} km · {stats.days}일 · 사진 {stats.photos.toLocaleString()}장
                </Text>
                <Text style={s.earthLine}>
                  🌍 지구 한 바퀴({EARTH_KM.toLocaleString()} km)의 {earthPct >= 0.1 ? earthPct.toFixed(1) : "0"}%
                </Text>
              </>
            )}
          </View>
        </View>
        {!trip && (
          <View style={s.presets}>
            {(
              [
                ["all", "전체"],
                ["30d", "최근 30일"],
                ["90d", "최근 90일"],
                ["year", "올해"],
              ] as const
            ).map(([key, label]) => (
              <Pressable
                key={key}
                style={[s.preset, preset === key && s.presetOn]}
                onPress={() => setPreset(key)}
              >
                <Text style={[s.presetText, preset === key && s.presetTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ink },
  map: { flex: 1 },
  hud: {
    position: "absolute", top: 60, left: 16, right: 16,
    flexDirection: "row", justifyContent: "space-between",
  },
  hudDate: {
    color: C.text, backgroundColor: "rgba(20,31,51,0.9)", borderColor: C.line, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, fontSize: 13,
    fontVariant: ["tabular-nums"], overflow: "hidden",
  },
  hudKm: {
    color: C.amber, backgroundColor: "rgba(20,31,51,0.9)", borderColor: C.line, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, fontSize: 13,
    fontVariant: ["tabular-nums"], overflow: "hidden",
  },
  panel: {
    position: "absolute", left: 12, right: 12, bottom: 12,
    backgroundColor: "rgba(20,31,51,0.95)", borderColor: C.line, borderWidth: 1,
    borderRadius: 20, padding: 14,
  },
  tripLabel: { color: C.text, fontSize: 13, fontWeight: "600", marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  playBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: C.amber,
    alignItems: "center", justifyContent: "center",
  },
  playBtnText: { color: C.amberDark, fontSize: 17, fontWeight: "700" },
  playState: { color: C.text, fontSize: 13 },
  statLine: { color: C.text, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  earthLine: { color: C.muted, fontSize: 11, marginTop: 4 },
  earthTrack: { height: 5, borderRadius: 3, backgroundColor: C.surface2, marginTop: 8, overflow: "hidden" },
  earthFill: { height: "100%", backgroundColor: C.amber, borderRadius: 3 },
  presets: { flexDirection: "row", gap: 8, marginTop: 12 },
  preset: {
    flex: 1, borderColor: C.line, borderWidth: 1, borderRadius: 9,
    paddingVertical: 9, alignItems: "center", minHeight: 36, justifyContent: "center",
  },
  presetOn: { backgroundColor: C.surface2 },
  presetText: { color: C.muted, fontSize: 12 },
  presetTextOn: { color: C.text },
});
