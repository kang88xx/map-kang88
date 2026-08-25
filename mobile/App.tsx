import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as MediaLibrary from "expo-media-library/legacy";
import { PermissionScreen } from "./src/screens/PermissionScreen";
import { ScanScreen } from "./src/screens/ScanScreen";
import { MapScreen } from "./src/screens/MapScreen";
import { TripsScreen } from "./src/screens/TripsScreen";
import { clearCache, loadCachedPoints } from "./src/lib/photoScan";
import { buildTrips, type Trip } from "./src/lib/trips";
import type { TrackPoint } from "./src/lib/geo";
import { C } from "./src/theme";

type Phase = "loading" | "permission" | "scan" | "main";
type Tab = "map" | "trips";

export default function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [tab, setTab] = useState<Tab>("map");
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [trip, setTrip] = useState<Trip | null>(null);

  // 시작: 캐시가 있으면 바로 지도로, 없으면 권한 → 스캔
  useEffect(() => {
    (async () => {
      const cached = await loadCachedPoints();
      if (cached) {
        setPoints(cached);
        setPhase("main");
        return;
      }
      const perm = await MediaLibrary.getPermissionsAsync();
      setPhase(perm.granted || perm.accessPrivileges === "limited" ? "scan" : "permission");
    })();
  }, []);

  const trips = useMemo(() => buildTrips(points), [points]);

  const onScanDone = useCallback((pts: TrackPoint[]) => {
    setPoints(pts);
    setPhase("main");
    setTab("map");
  }, []);

  const onRescan = useCallback(async () => {
    await clearCache();
    setTrip(null);
    setPhase("scan");
  }, []);

  const onSelectTrip = useCallback((t: Trip) => {
    setTrip(t);
    setTab("map");
  }, []);

  return (
    <SafeAreaProvider>
      <View style={s.root}>
        <StatusBar style="light" />
        {phase === "loading" && <View style={s.root} />}
        {phase === "permission" && <PermissionScreen onGranted={() => setPhase("scan")} />}
        {phase === "scan" && <ScanScreen onDone={onScanDone} />}
        {phase === "main" && (
          <SafeAreaView style={s.root} edges={["bottom"]}>
            <View style={{ flex: 1 }}>
              {tab === "map" ? (
                <MapScreen points={points} trip={trip} />
              ) : (
                <TripsScreen points={points} trips={trips} onSelectTrip={onSelectTrip} onRescan={onRescan} />
              )}
            </View>
            <View style={s.tabbar}>
              <Pressable
                style={s.tab}
                onPress={() => { setTrip(null); setTab("map"); }}
              >
                <Text style={[s.tabText, tab === "map" && s.tabOn]}>지도</Text>
              </Pressable>
              <Pressable style={s.tab} onPress={() => setTab("trips")}>
                <Text style={[s.tabText, tab === "trips" && s.tabOn]}>여행</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        )}
      </View>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ink },
  tabbar: {
    flexDirection: "row", borderTopColor: C.line, borderTopWidth: 1, backgroundColor: C.ink,
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12, minHeight: 44 },
  tabText: { color: C.muted, fontSize: 14 },
  tabOn: { color: C.amber, fontWeight: "700" },
});
