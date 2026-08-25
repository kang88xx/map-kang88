"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";

interface Props {
  lines: FeatureCollection;
  visits: FeatureCollection;
  /** [minLng, minLat, maxLng, maxLat] or null when no data */
  bounds: [number, number, number, number] | null;
  /** 스타일 로드가 끝난 map 인스턴스 전달 (언마운트 시 null) */
  onMap?: (map: maplibregl.Map | null) => void;
}

const LINE_COLOR: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["get", "tn"],
  0,
  "#6366f1",
  0.5,
  "#0ea5e9",
  1,
  "#f59e0b",
];

export default function MapView({ lines, visits, bounds, onMap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const dataRef = useRef({ lines, visits });
  const onMapRef = useRef(onMap);
  useEffect(() => {
    dataRef.current = { lines, visits };
    onMapRef.current = onMap;
  });
  const [mapFailed, setMapFailed] = useState(false);
  const [retrySeq, setRetrySeq] = useState(0);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // Turbopack이 번들한 maplibre 워커가 동작하지 않으므로 dist 워커를 public/에서 로드
    maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [30, 25],
      zoom: 1.6,
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("error", (e) => console.error("[map]", e.error?.message ?? e));
    map.on("load", () => {
      map.addSource("routes", { type: "geojson", data: dataRef.current.lines });
      map.addSource("visits", { type: "geojson", data: dataRef.current.visits });
      map.addLayer({
        id: "routes-casing",
        type: "line",
        source: "routes",
        paint: { "line-color": "#ffffff", "line-width": 5, "line-opacity": 0.6 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "routes-line",
        type: "line",
        source: "routes",
        paint: { "line-color": LINE_COLOR, "line-width": 2.5, "line-opacity": 0.9 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "visits-circle",
        type: "circle",
        source: "visits",
        paint: {
          "circle-radius": 5,
          "circle-color": "#e11d48",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.9,
        },
      });
      map.on("click", "visits-circle", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const props = f.properties as { name?: string; when?: string };
        // 파일에서 온 이름은 신뢰할 수 없으므로 textContent로만 주입 (XSS 방지)
        const box = document.createElement("div");
        box.style.cssText = "font-size:12px;color:#111";
        const title = document.createElement("strong");
        title.textContent = props.name || "방문 장소";
        const when = document.createElement("div");
        when.textContent = props.when ?? "";
        box.append(title, when);
        new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat).setDOMContent(box).addTo(map);
      });
      map.on("mouseenter", "visits-circle", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "visits-circle", () => (map.getCanvas().style.cursor = ""));
      readyRef.current = true;
      setMapFailed(false);
      (window as unknown as { __map?: maplibregl.Map }).__map = map; // QA/디버깅용
      onMapRef.current?.(map);
    });
    // 12초 안에 스타일이 로드되지 않으면 실패로 보고 복구 UI를 띄운다
    const failTimer = setTimeout(() => {
      if (!readyRef.current) setMapFailed(true);
    }, 12_000);
    mapRef.current = map;
    return () => {
      clearTimeout(failTimer);
      onMapRef.current?.(null);
      const w = window as unknown as { __map?: maplibregl.Map };
      if (w.__map === map) delete w.__map;
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, [retrySeq]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      (map.getSource("routes") as maplibregl.GeoJSONSource | undefined)?.setData(lines);
      (map.getSource("visits") as maplibregl.GeoJSONSource | undefined)?.setData(visits);
    };
    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [lines, visits]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bounds) return;
    const [minLng, minLat, maxLng, maxLat] = bounds;
    const fit = () =>
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: 60, maxZoom: 14, duration: 900 },
      );
    if (readyRef.current) fit();
    else map.once("load", fit);
  }, [bounds]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {mapFailed && (
        <div className="absolute inset-x-0 top-4 z-10 mx-auto w-fit rounded-xl border border-zinc-700 bg-zinc-900/95 px-4 py-3 text-center text-sm text-zinc-200 shadow-lg">
          지도를 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.
          <button
            onClick={() => {
              setMapFailed(false);
              setRetrySeq((n) => n + 1);
            }}
            className="ml-3 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium hover:bg-indigo-500"
          >
            다시 불러오기
          </button>
        </div>
      )}
    </div>
  );
}
