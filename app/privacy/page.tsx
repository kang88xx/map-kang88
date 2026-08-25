import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "kang-map 개인정보 처리방침",
  description: "kang-map은 위치·사진 데이터를 수집하지 않습니다.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-zinc-200">
      <h1 className="text-2xl font-bold">kang-map 개인정보 처리방침</h1>
      <p className="mt-2 text-sm text-zinc-400">시행일: 2026년 8월 25일</p>

      <section className="mt-8 space-y-6 text-sm leading-7">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">요약: 아무것도 수집하지 않습니다</h2>
          <p className="mt-2">
            kang-map(웹·iOS·Android 앱)은 이용자의 개인정보를 수집, 저장, 전송하지 않습니다.
            계정도, 서버 데이터베이스도 없습니다.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-zinc-100">사진과 위치 정보</h2>
          <p className="mt-2">
            앱은 사진 보관함 접근 권한을 받아 사진에 기록된 위치 좌표와 촬영 시각만 읽습니다.
            이 정보는 이동 경로를 지도에 그리기 위해서만 사용되며,{" "}
            <strong className="text-zinc-100">기기 밖으로 전송되지 않고 기기 안에만 저장</strong>
            됩니다. 사진 원본(이미지 픽셀)은 읽지 않으며 업로드되지 않습니다. 웹에서 올린
            타임라인/GPX/사진 파일도 브라우저 안에서만 처리됩니다.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-zinc-100">제3자 서비스</h2>
          <p className="mt-2">
            지도 타일은 OpenFreeMap(오픈스트리트맵 데이터)에서 불러옵니다. 이 과정에서 일반적인
            웹 요청과 동일하게 이용자의 IP 주소가 타일 서버에 전달될 수 있으나, kang-map이 위치
            기록이나 개인 식별 정보를 함께 보내는 일은 없습니다. 광고·분석 SDK는 사용하지
            않습니다.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-zinc-100">데이터 삭제</h2>
          <p className="mt-2">
            모든 데이터는 이용자의 기기에 있습니다. 앱 안의 &ldquo;다시 스캔&rdquo; 또는 앱
            삭제로 즉시 제거되며, 웹은 브라우저 데이터 삭제로 제거됩니다.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-zinc-100">문의</h2>
          <p className="mt-2">kangcommon88@gmail.com</p>
        </div>
      </section>
    </main>
  );
}
