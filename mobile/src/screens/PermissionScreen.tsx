import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as MediaLibrary from "expo-media-library";
import { C } from "../theme";

export function PermissionScreen({ onGranted }: { onGranted: () => void }) {
  const [busy, setBusy] = useState(false);

  const request = async () => {
    setBusy(true);
    try {
      const res = await MediaLibrary.requestPermissionsAsync();
      if (res.granted || res.accessPrivileges === "limited") {
        onGranted();
        return;
      }
      Alert.alert(
        "사진 접근이 필요해요",
        "과거 경로를 만들려면 사진의 위치 정보가 필요합니다. 설정에서 사진 접근을 허용해 주세요.",
        [
          { text: "취소", style: "cancel" },
          { text: "설정 열기", onPress: () => Linking.openSettings() },
        ],
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <View style={s.logoBox}>
        <Text style={s.logoDot}>●</Text>
        <Text style={s.logoLine}>⌒</Text>
      </View>
      <Text style={s.eyebrow}>SETUP</Text>
      <Text style={s.title}>내 이동 기록,{"\n"}이 기기에서 안전하게</Text>
      <Text style={s.desc}>
        사진의 위치 정보와 촬영 시각만 사용해 과거 경로를 복원합니다.{"\n"}
        사진 원본은 어디에도 업로드되지 않아요.
      </Text>

      <View style={s.card}>
        <Text style={s.cardIcon}>🖼️</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>사진 보관함</Text>
          <Text style={s.cardBody}>
            사진의 위치 정보만 읽어 과거 동선을 복원합니다. 모든 처리는 이 기기 안에서 이뤄져요.
          </Text>
        </View>
      </View>

      <View style={{ flex: 1 }} />
      <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={request} disabled={busy}>
        <Text style={s.btnText}>{busy ? "확인 중…" : "사진 접근 허용하고 시작"}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ink, padding: 24, paddingTop: 80 },
  logoBox: { alignItems: "center", marginBottom: 24, height: 60, justifyContent: "center" },
  logoLine: { color: C.routeB, fontSize: 48, position: "absolute" },
  logoDot: { color: C.amber, fontSize: 18, position: "absolute", top: 4, right: "38%" },
  eyebrow: { color: C.amber, fontSize: 11, letterSpacing: 2, textAlign: "center", fontWeight: "600" },
  title: { color: C.text, fontSize: 26, fontWeight: "700", textAlign: "center", marginTop: 8, lineHeight: 36 },
  desc: { color: C.muted, fontSize: 13, textAlign: "center", marginTop: 10, lineHeight: 20 },
  card: {
    flexDirection: "row", gap: 14, backgroundColor: C.surface, borderColor: C.line,
    borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 28,
  },
  cardIcon: { fontSize: 22 },
  cardTitle: { color: C.text, fontSize: 14, fontWeight: "700" },
  cardBody: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  btn: { backgroundColor: C.amber, borderRadius: 14, padding: 16, alignItems: "center", marginBottom: 24 },
  btnText: { color: C.amberDark, fontSize: 15, fontWeight: "600" },
});
