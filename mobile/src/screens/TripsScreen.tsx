import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { TrackPoint } from "../lib/geo";
import { totalDistanceKm, buildVisitRoute } from "../lib/geo";
import type { Trip } from "../lib/trips";
import { C, EARTH_KM } from "../theme";

export function TripsScreen({
  points,
  trips,
  onSelectTrip,
  onRescan,
}: {
  points: TrackPoint[];
  trips: Trip[];
  onSelectTrip: (t: Trip) => void;
  onRescan: () => void;
}) {
  const totalKm = totalDistanceKm(buildVisitRoute(points));
  const earthPct = (totalKm / EARTH_KM) * 100;

  return (
    <View style={s.root}>
      <Text style={s.eyebrow}>TRIPS</Text>
      <Text style={s.title}>여행 요약</Text>
      <Text style={s.desc}>사진의 위치 기록을 여행 단위로 자동 정리했어요.</Text>

      <View style={s.total}>
        <View style={{ flex: 1 }}>
          <Text style={s.totalKm}>{Math.round(totalKm).toLocaleString()} km</Text>
          <Text style={s.totalSub}>
            🌍 지구 한 바퀴의 {earthPct >= 0.1 ? earthPct.toFixed(1) : "0"}% · 사진{" "}
            {points.length.toLocaleString()}장
          </Text>
        </View>
      </View>

      <FlatList
        data={trips}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingBottom: 24, gap: 10 }}
        ListEmptyComponent={
          <Text style={s.empty}>
            아직 여행으로 묶을 기록이 부족해요.{"\n"}위치 정보가 있는 사진이 쌓이면 여기 나타납니다.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable style={s.card} onPress={() => onSelectTrip(item)}>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>{item.label}</Text>
              <Text style={s.cardDates}>{item.days}일</Text>
            </View>
            <View style={s.cardStats}>
              <Text style={s.cardKm}>{Math.round(item.km).toLocaleString()} km</Text>
              <Text style={s.cardSub}>사진 {item.points.length.toLocaleString()}장</Text>
              <Text style={s.cardGo}>지도에서 재생 →</Text>
            </View>
          </Pressable>
        )}
      />

      <Pressable
        style={s.rescan}
        onPress={() =>
          Alert.alert("다시 스캔할까요?", "사진 보관함을 처음부터 다시 훑습니다.", [
            { text: "취소", style: "cancel" },
            { text: "다시 스캔", onPress: onRescan },
          ])
        }
      >
        <Text style={s.rescanText}>사진 보관함 다시 스캔</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ink, padding: 20, paddingTop: 64 },
  eyebrow: { color: C.amber, fontSize: 11, letterSpacing: 2, fontWeight: "600" },
  title: { color: C.text, fontSize: 24, fontWeight: "700", marginTop: 6 },
  desc: { color: C.muted, fontSize: 13, marginTop: 6, marginBottom: 16 },
  total: {
    flexDirection: "row", backgroundColor: C.surface, borderColor: C.line, borderWidth: 1,
    borderRadius: 16, padding: 16, marginBottom: 14,
  },
  totalKm: { color: C.amber, fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
  totalSub: { color: C.muted, fontSize: 12, marginTop: 4 },
  card: { backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 16 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: "700" },
  cardDates: { color: C.muted, fontSize: 12 },
  cardStats: { flexDirection: "row", alignItems: "baseline", gap: 14, marginTop: 10 },
  cardKm: { color: C.amber, fontSize: 17, fontWeight: "600", fontVariant: ["tabular-nums"] },
  cardSub: { color: C.muted, fontSize: 12 },
  cardGo: { color: C.routeB, fontSize: 12, marginLeft: "auto" },
  empty: { color: C.muted, fontSize: 13, textAlign: "center", marginTop: 40, lineHeight: 22 },
  rescan: { borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 12, alignItems: "center", marginBottom: 12 },
  rescanText: { color: C.muted, fontSize: 13 },
});
