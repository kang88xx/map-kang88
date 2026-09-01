const STARTUP_TIMEOUT_MS = 12000;

function showStartupError(message) {
  const alert = document.querySelector("#appAlert");
  if (!alert || document.documentElement.dataset.appReady === "true") return;
  alert.textContent = message;
  alert.hidden = false;
}

window.addEventListener("error", () => {
  showStartupError("지도 모듈을 불러오지 못했습니다. 네트워크 연결을 확인하고 새로고침해 주세요.");
});

window.addEventListener("unhandledrejection", () => {
  showStartupError("지도 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
});

window.setTimeout(() => {
  showStartupError("지도를 불러오는 데 시간이 걸리고 있습니다. 네트워크 연결을 확인해 주세요.");
}, STARTUP_TIMEOUT_MS);
