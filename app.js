import * as maplibregl from "./vendor/maplibre-gl.mjs";
import { layout, prepare } from "./vendor/pretext.js";
import {
  DEFAULT_VIEW,
  SEOUL_BOUNDS,
  buildCctvOpenUrl,
  buildCctvStatus,
  buildSearchUrl,
  buildShareUrl,
  buildWeatherStatus,
  normalizeQuery,
  parseSearchResult,
  parseViewState,
} from "./prototype-core.js";

const initialView = parseViewState(window.location.search);
const DEFAULT_SOURCE_WARNING = "CCTV는 공식 ITS 원본 링크를 사용합니다. 위성 레이어는 지도 정합 검증 중입니다.";
const sourceWarnings = new Map();
let activeMarker = null;
let activePopup = null;
let activePlace = null;
let alertTimer = null;

const elements = {
  areaLabel: document.querySelector("#areaLabel"),
  appAlert: document.querySelector("#appAlert"),
  cameraCloseButton: document.querySelector("#cameraCloseButton"),
  cameraFormat: document.querySelector("#cameraFormat"),
  cameraName: document.querySelector("#cameraName"),
  cameraObservedAt: document.querySelector("#cameraObservedAt"),
  cameraOpenButton: document.querySelector("#cameraOpenButton"),
  cameraPanel: document.querySelector("#cameraPanel"),
  cameraSource: document.querySelector("#cameraSource"),
  cctvLayerButton: document.querySelector("#cctvLayerButton"),
  cctvStatusDot: document.querySelector("#cctvStatusDot"),
  cctvStatusText: document.querySelector("#cctvStatusText"),
  coordinateLabel: document.querySelector("#coordinateLabel"),
  infoPanel: document.querySelector("#infoPanel"),
  mapLoading: document.querySelector("#mapLoading"),
  placeInput: document.querySelector("#placeInput"),
  searchButton: document.querySelector("#searchButton"),
  searchForm: document.querySelector("#searchForm"),
  searchResults: document.querySelector("#searchResults"),
  searchStatus: document.querySelector("#searchStatus"),
  shareButton: document.querySelector("#shareButton"),
  sheetToggle: document.querySelector("#sheetToggle"),
  sourceWarningText: document.querySelector("#sourceWarningText"),
  zoomLabel: document.querySelector("#zoomLabel"),
  weatherCloseButton: document.querySelector("#weatherCloseButton"),
  weatherImage: document.querySelector("#weatherImage"),
  weatherLayerButton: document.querySelector("#weatherLayerButton"),
  weatherObservedAt: document.querySelector("#weatherObservedAt"),
  weatherPanel: document.querySelector("#weatherPanel"),
  weatherStatusDot: document.querySelector("#weatherStatusDot"),
  weatherStatusText: document.querySelector("#weatherStatusText"),
};

const map = new maplibregl.Map({
  container: "map",
  center: [initialView.longitude, initialView.latitude],
  zoom: initialView.zoom,
  minZoom: 7,
  maxZoom: 18,
  maxBounds: [
    [SEOUL_BOUNDS.west, SEOUL_BOUNDS.south],
    [SEOUL_BOUNDS.east, SEOUL_BOUNDS.north],
  ],
  attributionControl: false,
  style: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 19,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [
      {
        id: "osm-raster",
        type: "raster",
        source: "osm",
        paint: {
          "raster-saturation": -0.25,
          "raster-contrast": 0.08,
        },
      },
    ],
  },
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");

map.on("load", () => {
  document.documentElement.dataset.appReady = "true";
  elements.mapLoading.hidden = true;
  elements.appAlert.hidden = true;
  syncMapState();
  loadCctvLayer();
  loadWeatherPreview();
});

map.on("moveend", syncMapState);
map.on("dragstart", () => {
  activePlace = null;
  elements.areaLabel.textContent = "서울";
});
map.on("error", () => {
  showTransientAlert("기본 지도 일부를 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.");
});

elements.searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await searchPlace(elements.placeInput.value);
});

elements.shareButton.addEventListener("click", async () => {
  const shareUrl = buildCurrentShareUrl().toString();
  try {
    await navigator.clipboard.writeText(shareUrl);
    elements.shareButton.textContent = "복사됨";
  } catch {
    window.prompt("이 링크를 복사하세요.", shareUrl);
  }
  window.setTimeout(() => { elements.shareButton.textContent = "링크 복사"; }, 1600);
});

elements.sheetToggle.addEventListener("click", () => {
  const expanded = elements.sheetToggle.getAttribute("aria-expanded") === "true";
  setSheetExpanded(!expanded);
});

elements.cctvLayerButton.addEventListener("click", () => {
  const visible = elements.cctvLayerButton.getAttribute("aria-pressed") === "true";
  setCctvVisibility(!visible);
});

elements.cameraCloseButton.addEventListener("click", hideCameraPanel);
elements.cameraOpenButton.addEventListener("click", () => {
  const openUrl = elements.cameraOpenButton.dataset.openUrl;
  if (openUrl) window.open(openUrl, "_blank", "noopener,noreferrer");
});

elements.weatherLayerButton.addEventListener("click", () => {
  const expanded = elements.weatherLayerButton.getAttribute("aria-expanded") === "true";
  setWeatherPanelExpanded(!expanded);
});
elements.weatherCloseButton.addEventListener("click", () => setWeatherPanelExpanded(false));


window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setSheetExpanded(false);
    setWeatherPanelExpanded(false);
    hideCameraPanel();
    hideResults();
  }
});

async function searchPlace(rawQuery) {
  const query = normalizeQuery(rawQuery);
  if (query.length < 2) {
    setSearchStatus("두 글자 이상 입력해 주세요.", "error");
    elements.placeInput.focus();
    return;
  }

  setSearching(true);
  setSearchStatus("공식 프록시로 서울 안의 장소를 찾고 있습니다.");
  hideResults();

  try {
    const response = await fetch(buildSearchUrl(query, window.location.origin), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Search failed with HTTP ${response.status}`);
    const payload = await response.json();
    const rawResults = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload) ? payload : [];
    const results = rawResults.map(parseSearchResult).filter(Boolean);
    handleSearchResults(results);
  } catch {
    setSearchStatus("검색 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", "error");
  } finally {
    setSearching(false);
  }
}

function handleSearchResults(results) {
  if (!results.length) {
    setSearchStatus("서울 안에서 일치하는 장소를 찾지 못했습니다.", "error");
    hideResults();
    return;
  }

  renderResults(results);
  selectPlace(results[0]);
  setSearchStatus(`${results.length}개 결과 · 서버 검증 검색`);
}

function renderResults(results) {
  elements.searchResults.replaceChildren();

  for (const [index, result] of results.entries()) {
    const button = document.createElement("button");
    button.className = "result-button";
    button.type = "button";
    button.setAttribute("role", "option");
    button.setAttribute("aria-label", result.displayName);

    const name = document.createElement("strong");
    name.textContent = result.shortName;
    const address = document.createElement("span");
    address.textContent = result.displayName;

    button.append(name, address);
    button.addEventListener("click", () => {
      selectPlace(result);
      setSearchStatus(`${index + 1}번째 결과로 이동했습니다.`);
      hideResults();
    });
    elements.searchResults.append(button);
  }

  elements.searchResults.hidden = false;
}

function selectPlace(result) {
  activePlace = result;
  elements.areaLabel.textContent = result.shortName;

  if (activeMarker) activeMarker.remove();
  if (activePopup) activePopup.remove();

  const markerElement = document.createElement("div");
  markerElement.className = "prototype-marker";
  markerElement.setAttribute("aria-label", `${result.shortName} 위치`);
  const markerPin = document.createElement("span");
  markerPin.className = "prototype-marker-pin";
  markerElement.append(markerPin);

  const popupContent = document.createElement("div");
  const popupName = document.createElement("strong");
  popupName.className = "popup-name";
  popupName.textContent = result.shortName;
  const popupAddress = document.createElement("p");
  popupAddress.className = "popup-address";
  popupAddress.textContent = result.displayName;
  const popupCoords = document.createElement("div");
  popupCoords.className = "popup-coords";
  popupCoords.textContent = `${result.latitude.toFixed(5)} / ${result.longitude.toFixed(5)}`;
  popupContent.append(popupName, popupAddress, popupCoords);

  activePopup = new maplibregl.Popup({ offset: 28, closeButton: true }).setDOMContent(popupContent);
  activeMarker = new maplibregl.Marker({ element: markerElement, anchor: "bottom" })
    .setLngLat([result.longitude, result.latitude])
    .setPopup(activePopup)
    .addTo(map);
  activeMarker.togglePopup();

  if (result.boundingBox) {
    map.fitBounds(result.boundingBox, { padding: 100, maxZoom: 15, duration: 850 });
  } else {
    map.flyTo({ center: [result.longitude, result.latitude], zoom: 14, duration: 850 });
  }
}

function syncMapState() {
  const center = map.getCenter();
  const zoom = map.getZoom();
  elements.zoomLabel.textContent = `z${zoom.toFixed(1)}`;
  elements.coordinateLabel.textContent = `${center.lat.toFixed(5)} / ${center.lng.toFixed(5)}`;
  if (activePlace) elements.areaLabel.textContent = activePlace.shortName;

  const shareUrl = buildShareUrl(window.location.href, {
    latitude: center.lat,
    longitude: center.lng,
    zoom,
    layer: initialView.layer ?? DEFAULT_VIEW.layer,
  });
  window.history.replaceState(null, "", `${shareUrl.pathname}${shareUrl.search}`);
}

function buildCurrentShareUrl() {
  const center = map.getCenter();
  return buildShareUrl(window.location.href, {
    latitude: center.lat,
    longitude: center.lng,
    zoom: map.getZoom(),
    layer: initialView.layer ?? DEFAULT_VIEW.layer,
  });
}

function setSearching(searching) {
  elements.searchForm.classList.toggle("is-searching", searching);
  elements.searchButton.disabled = searching;
  elements.placeInput.disabled = searching;
  elements.searchForm.setAttribute("aria-busy", String(searching));
}

function setSearchStatus(message, tone = "neutral") {
  elements.searchStatus.textContent = message;
  elements.searchStatus.dataset.tone = tone;
}

function hideResults() {
  elements.searchResults.hidden = true;
}

function setSheetExpanded(expanded) {
  elements.infoPanel.classList.toggle("is-expanded", expanded);
  elements.sheetToggle.setAttribute("aria-expanded", String(expanded));
}

function showTransientAlert(message) {
  window.clearTimeout(alertTimer);
  elements.appAlert.textContent = message;
  elements.appAlert.hidden = false;
  alertTimer = window.setTimeout(() => { elements.appAlert.hidden = true; }, 5000);
}

async function initializePretext() {
  await document.fonts.ready;
  const prepared = new Map();
  const targets = [...document.querySelectorAll("[data-pretext]")];

  const prepareTarget = (target) => {
    prepared.set(target, prepare(target.textContent, getComputedStyle(target).font));
  };
  targets.forEach(prepareTarget);

  const relayout = () => {
    for (const target of targets) {
      const handle = prepared.get(target);
      if (!handle || target.clientWidth <= 0) continue;
      const lineHeight = Number.parseFloat(getComputedStyle(target).lineHeight) || 20;
      const result = layout(handle, target.clientWidth, lineHeight);
      target.style.minHeight = `${Math.ceil(result.height)}px`;
    }
  };

  const observer = new ResizeObserver(relayout);
  targets.forEach((target) => observer.observe(target));
  relayout();
}

initializePretext();

async function loadCctvLayer() {
  try {
    const response = await fetch("/api/cctv", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`CCTV HTTP ${response.status}`);
    const payload = await response.json();
    const features = Array.isArray(payload?.cameras)
      ? payload.cameras.map((camera) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [camera.longitude, camera.latitude] },
          properties: {
            name: camera.name,
            id: camera.id,
            mediaHost: camera.mediaHost,
            format: camera.format,
            resolution: camera.resolution,
            observedAt: camera.observedAt,
          },
        }))
      : [];

    map.addSource("its-cctv", {
      type: "geojson",
      data: { type: "FeatureCollection", features },
      cluster: true,
      generateId: true,
      clusterMaxZoom: 16,
      clusterRadius: 42,
    });
    map.addLayer({
      id: "its-cctv-clusters",
      type: "circle",
      source: "its-cctv",
      minzoom: 13,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#171b19",
        "circle-stroke-color": "#c8ff5c",
        "circle-stroke-width": 2,
        "circle-radius": ["step", ["get", "point_count"], 15, 25, 20, 100, 25],
      },
    });
    map.addLayer({
      id: "its-cctv-points",
      type: "circle",
      source: "its-cctv",
      minzoom: 13,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "#c8ff5c",
        "circle-stroke-color": "#171b19",
        "circle-stroke-width": 2,
        "circle-radius": 7,
      },
    });

    map.on("click", "its-cctv-clusters", async (event) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      if (clusterId === undefined) return;
      const source = map.getSource("its-cctv");
      const zoom = await source.getClusterExpansionZoom(clusterId);
      map.easeTo({ center: feature.geometry.coordinates, zoom });
    });
    map.on("click", "its-cctv-points", (event) => {
      const properties = event.features?.[0]?.properties;
      if (properties) showCameraPanel(properties);
    });
    for (const layerId of ["its-cctv-clusters", "its-cctv-points"]) {
      map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
    }

    const status = buildCctvStatus(payload, features.length);
    elements.cctvLayerButton.disabled = false;
    setStatusDot(elements.cctvStatusDot, status);
    elements.cctvStatusText.textContent = status.text;
    setSourceWarning("cctv", status.warning);
  } catch {
    setStatusDot(elements.cctvStatusDot, { dotClass: "error", ariaLabel: "연결 실패" });
    elements.cctvStatusText.textContent = "현재 CCTV를 불러올 수 없음";
  }
}

function setCctvVisibility(visible) {
  const visibility = visible ? "visible" : "none";
  for (const layerId of ["its-cctv-clusters", "its-cctv-points"]) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
  }
  elements.cctvLayerButton.setAttribute("aria-pressed", String(visible));
  if (!visible) hideCameraPanel();
}

function showCameraPanel(camera) {
  setWeatherPanelExpanded(false);
  const openUrl = buildCctvOpenUrl(camera.id, window.location.origin);
  elements.cameraName.textContent = camera.name || "교통 CCTV";
  elements.cameraFormat.textContent = [camera.format, camera.resolution].filter(Boolean).join(" · ");
  elements.cameraObservedAt.textContent = camera.observedAt || "시각 정보 없음";
  elements.cameraSource.textContent = camera.mediaHost ? `영상 제공처: ${camera.mediaHost}` : "영상 제공처 정보 없음";
  elements.cameraOpenButton.dataset.openUrl = openUrl?.toString() ?? "";
  elements.cameraOpenButton.disabled = !openUrl;
  elements.cameraPanel.hidden = false;
}

function hideCameraPanel() {
  elements.cameraPanel.hidden = true;
  elements.cameraOpenButton.dataset.openUrl = "";
}

async function loadWeatherPreview() {
  try {
    const response = await fetch("/api/weather", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`KMA HTTP ${response.status}`);
    const payload = await response.json();
    const observedAtText = formatKmaTimestamp(payload.observedAt);
    const status = buildWeatherStatus(payload, observedAtText);
    elements.weatherObservedAt.textContent = status.observedAtText;
    elements.weatherImage.src = payload.imageUrl;
    elements.weatherLayerButton.disabled = false;
    setStatusDot(elements.weatherStatusDot, status);
    elements.weatherStatusText.textContent = status.text;
    setSourceWarning("weather", status.warning);
  } catch {
    setStatusDot(elements.weatherStatusDot, { dotClass: "error", ariaLabel: "연결 실패" });
    elements.weatherStatusText.textContent = "현재 위성영상을 불러올 수 없음";
  }
}

function setStatusDot(dot, status) {
  dot.classList.remove("connected", "stale", "error");
  if (status.dotClass) dot.classList.add(status.dotClass);
  dot.setAttribute("aria-label", status.ariaLabel);
}

function setSourceWarning(source, message) {
  if (message) {
    sourceWarnings.set(source, message);
  } else {
    sourceWarnings.delete(source);
  }
  elements.sourceWarningText.textContent = [...sourceWarnings.values()][0] ?? DEFAULT_SOURCE_WARNING;
}

function setWeatherPanelExpanded(expanded) {
  if (expanded) {
    hideCameraPanel();
  }
  elements.weatherPanel.hidden = !expanded;
  elements.weatherLayerButton.setAttribute("aria-expanded", String(expanded));
}

function formatKmaTimestamp(value) {
  if (!/^20\d{10}$/.test(value ?? "")) return "관측시각 정보 없음";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)} ${value.slice(8, 10)}:${value.slice(10, 12)} UTC`;
}
