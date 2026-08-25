import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { scanPhotoLibrary, type ScanProgress } from "../lib/photoScan";
import type { TrackPoint } from "../lib/geo";
import { C } from "../theme";

export function ScanScreen({ onDone }: { onDone: (points: TrackPoint[]) => void }) {
  const [progress, setProgress] = useState<ScanProgress>({ scanned: 0, total: 0, found: 0 });
  const cancelRef = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    let alive = true;
    (async () => {
      const points = await scanPhotoLibrary(
        (p) => { if (alive) setProgress(p); },
        () => cancelRef.current,
      );
      if (alive) doneRef.current(points);
    })();
    return () => {
      alive = false;
      cancelRef.current = true;
    };
  }, []);

  const pctNum = progress.total > 0 ? progress.scanned / progress.total : 0;

  return (
    <View style={s.root}>
      <Text style={s.eyebrow}>SETUP</Text>
      <Text style={s.title}>사진에서 위치 기록 찾는 중</Text>
      <Text style={s.desc}>
        사진의 위치와 촬영 시각만 사용하며, 사진 원본은 어디에도 올라가지 않아요.
      </Text>

      <View style={s.card}>
        <Text style={s.count}>
          {progress.scanned.toLocaleString()}
          <Text style={s.countSub}> / {progress.total.toLocaleString()}장 확인</Text>
        </Text>
        <View style={s.barTrack}>
          <View style={[s.barFill, { width: `${Math.round(pctNum * 100)}%` }]} />
        </View>
        <Text style={s.found}>위치 정보가 있는 사진 {progress.found.toLocaleString()}장</Text>
      </View>

      <View style={{ flex: 1 }} />
      <Pressable
        style={s.skip}
        onPress={() => { cancelRef.current = true; }}
      >
        <Text style={s.skipText}>지금까지 찾은 것으로 시작하기</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ink, padding: 24, paddingTop: 100 },
  eyebrow: { color: C.amber, fontSize: 11, letterSpacing: 2, fontWeight: "600" },
  title: { color: C.text, fontSize: 24, fontWeight: "700", marginTop: 8 },
  desc: { color: C.muted, fontSize: 13, lineHeight: 20, marginTop: 8 },
  card: { backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 20, marginTop: 24 },
  count: { color: C.text, fontSize: 24, fontVariant: ["tabular-nums"] },
  countSub: { color: C.muted, fontSize: 13 },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: C.surface2, marginTop: 14, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: C.amber, borderRadius: 3 },
  found: { color: C.muted, fontSize: 12, marginTop: 12 },
  skip: { borderColor: C.line, borderWidth: 1, borderRadius: 14, padding: 14, alignItems: "center", marginBottom: 24 },
  skipText: { color: C.muted, fontSize: 14 },
});
