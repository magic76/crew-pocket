// Antigravity Web UI - Phone Agent (Wireless ADB Screen Capture & Touch Interactive Controller)

(function() {
  let phoneModal = null;
  let phoneAgentBtn = null;
  let closePhoneAgentBtn = null;
  let phoneConnBadge = null;
  let phonePortInput = null;
  let phoneConnectBtn = null;
  let phonePairCodeInput = null;
  let phonePairBtn = null;
  let phoneRefreshStatusBtn = null;
  let phoneSnapBtn = null;
  let phoneScreenContainer = null;
  let phoneScreenImg = null;
  let phoneScreenPlaceholder = null;
  let phoneTapIndicator = null;
  let phoneActionLog = null;
  let phoneAiCmdInput = null;
  let phoneAiCmdBtn = null;

  let currentResolution = { width: 1080, height: 2400 };

  function initElements() {
    phoneModal = document.getElementById("phone-agent-modal");
    phoneAgentBtn = document.getElementById("phone-agent-btn");
    closePhoneAgentBtn = document.getElementById("close-phone-agent-btn");
    phoneConnBadge = document.getElementById("phone-conn-badge");
    phonePortInput = document.getElementById("phone-port-input");
    phoneConnectBtn = document.getElementById("phone-connect-btn");
    phonePairCodeInput = document.getElementById("phone-pair-code-input");
    phonePairBtn = document.getElementById("phone-pair-btn");
    phoneRefreshStatusBtn = document.getElementById("phone-refresh-status-btn");
    phoneSnapBtn = document.getElementById("phone-snap-btn");
    phoneScreenContainer = document.getElementById("phone-screen-container");
    phoneScreenImg = document.getElementById("phone-screen-img");
    phoneScreenPlaceholder = document.getElementById("phone-screen-placeholder");
    phoneTapIndicator = document.getElementById("phone-tap-indicator");
    phoneActionLog = document.getElementById("phone-action-log");
    phoneAiCmdInput = document.getElementById("phone-ai-cmd-input");
    phoneAiCmdBtn = document.getElementById("phone-ai-cmd-btn");
  }

  function togglePhoneModal(open) {
    if (!phoneModal) return;
    if (typeof window.haptic === "function") window.haptic("light");
    if (open) {
      phoneModal.classList.remove("opacity-0", "pointer-events-none");
      checkStatus();
    } else {
      phoneModal.classList.add("opacity-0", "pointer-events-none");
    }
  }

  async function checkStatus() {
    if (!phoneConnBadge) return;
    phoneConnBadge.textContent = "檢測中...";
    phoneConnBadge.className = "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-950/80 border border-amber-500/40 text-amber-400";

    try {
      const res = await fetch("/api/phone/status");
      const data = await res.json();

      if (data.connected) {
        phoneConnBadge.textContent = `🟢 已連線 (${data.activeDevice?.id || "本機 ADB"})`;
        phoneConnBadge.className = "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300";
        takeScreenshot();
      } else {
        phoneConnBadge.textContent = "🔴 未連線 (請輸入 Port)";
        phoneConnBadge.className = "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-950/80 border border-rose-500/40 text-rose-300";
      }
    } catch (e) {
      phoneConnBadge.textContent = "❌ 檢測失敗";
    }
  }

  async function takeScreenshot() {
    if (!phoneScreenImg) return;
    const prevBtnText = phoneSnapBtn ? phoneSnapBtn.innerHTML : "";
    if (phoneSnapBtn) phoneSnapBtn.innerHTML = "<span>⏳ 截圖中...</span>";

    try {
      const res = await fetch("/api/phone/screenshot", { method: "POST" });
      const data = await res.json();

      if (data.success && data.base64) {
        phoneScreenImg.src = `${data.base64}?t=${Date.now()}`;
        phoneScreenImg.classList.remove("hidden");
        if (phoneScreenPlaceholder) phoneScreenPlaceholder.classList.add("hidden");
        if (data.resolution) currentResolution = data.resolution;
        if (phoneActionLog) phoneActionLog.textContent = `📸 截圖成功 (${data.resolution?.width}x${data.resolution?.height}, ${data.sizeKb}KB)`;
      } else {
        if (phoneActionLog) phoneActionLog.textContent = `⚠️ 截圖失敗: ${data.error || "請先配對連線 ADB"}`;
      }
    } catch (err) {
      if (phoneActionLog) phoneActionLog.textContent = `❌ 截圖連線錯誤: ${err.message}`;
    } finally {
      if (phoneSnapBtn) phoneSnapBtn.innerHTML = prevBtnText;
    }
  }

  async function sendAction(actionObj, autoRefresh = true) {
    if (typeof window.haptic === "function") window.haptic("medium");
    try {
      const res = await fetch("/api/phone/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(actionObj)
      });
      const data = await res.json();
      if (phoneActionLog) {
        phoneActionLog.textContent = data.success 
          ? `⚡ 執行成功: ${actionObj.action} ${JSON.stringify(actionObj)}`
          : `❌ 執行失敗: ${data.error}`;
      }
      if (autoRefresh) {
        setTimeout(takeScreenshot, 500);
      }
    } catch (e) {
      if (phoneActionLog) phoneActionLog.textContent = `❌ 動作連線錯誤: ${e.message}`;
    }
  }

  function setupListeners() {
    if (phoneAgentBtn) phoneAgentBtn.addEventListener("click", () => togglePhoneModal(true));
    if (closePhoneAgentBtn) closePhoneAgentBtn.addEventListener("click", () => togglePhoneModal(false));
    if (phoneModal) phoneModal.addEventListener("click", (e) => {
      if (e.target === phoneModal) togglePhoneModal(false);
    });

    if (phoneRefreshStatusBtn) phoneRefreshStatusBtn.addEventListener("click", checkStatus);
    if (phoneSnapBtn) phoneSnapBtn.addEventListener("click", takeScreenshot);

    if (phoneConnectBtn && phonePortInput) {
      phoneConnectBtn.addEventListener("click", async () => {
        const port = phonePortInput.value.trim();
        if (!port) return alert("請輸入無線偵錯 Port");
        phoneConnectBtn.disabled = true;
        phoneConnectBtn.textContent = "連線中...";

        try {
          const res = await fetch("/api/phone/connect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ port })
          });
          const data = await res.json();
          alert(data.output || (data.success ? "連線成功！" : "連線失敗"));
          checkStatus();
        } catch (e) {
          alert("連線失敗: " + e.message);
        } finally {
          phoneConnectBtn.disabled = false;
          phoneConnectBtn.textContent = "連線";
        }
      });
    }

    if (phonePairBtn && phonePortInput && phonePairCodeInput) {
      phonePairBtn.addEventListener("click", async () => {
        const port = phonePortInput.value.trim();
        const pairingCode = phonePairCodeInput.value.trim();
        if (!port || !pairingCode) return alert("請輸入配對 Port 與 6 位數配對碼");
        phonePairBtn.disabled = true;
        phonePairBtn.textContent = "配對中...";

        try {
          const res = await fetch("/api/phone/pair", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ port, pairingCode })
          });
          const data = await res.json();
          alert(data.output || (data.success ? "配對成功！現在請輸入連線 Port 點擊連線。" : "配對失敗"));
          checkStatus();
        } catch (e) {
          alert("配對失敗: " + e.message);
        } finally {
          phonePairBtn.disabled = false;
          phonePairBtn.textContent = "執行配對";
        }
      });
    }

    if (phoneScreenContainer && phoneScreenImg) {
      phoneScreenContainer.addEventListener("click", (e) => {
        if (phoneScreenImg.classList.contains("hidden")) return;

        const rect = phoneScreenImg.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        if (clickX < 0 || clickX > rect.width || clickY < 0 || clickY > rect.height) return;

        if (phoneTapIndicator) {
          phoneTapIndicator.style.left = `${clickX}px`;
          phoneTapIndicator.style.top = `${clickY}px`;
          phoneTapIndicator.classList.remove("scale-0");
          phoneTapIndicator.classList.add("scale-100");
          setTimeout(() => {
            phoneTapIndicator.classList.remove("scale-100");
            phoneTapIndicator.classList.add("scale-0");
          }, 300);
        }

        const realX = Math.round((clickX / rect.width) * currentResolution.width);
        const realY = Math.round((clickY / rect.height) * currentResolution.height);

        sendAction({ action: "TAP", x: realX, y: realY });
      });
    }

    const keyBack = document.getElementById("phone-key-back");
    const keyHome = document.getElementById("phone-key-home");
    const keyRecents = document.getElementById("phone-key-recents");
    const swipeUp = document.getElementById("phone-swipe-up");
    const swipeDown = document.getElementById("phone-swipe-down");

    if (keyBack) keyBack.addEventListener("click", () => sendAction({ action: "KEYEVENT", key: "BACK" }));
    if (keyHome) keyHome.addEventListener("click", () => sendAction({ action: "KEYEVENT", key: "HOME" }));
    if (keyRecents) keyRecents.addEventListener("click", () => sendAction({ action: "KEYEVENT", key: "RECENTS" }));

    if (swipeUp) swipeUp.addEventListener("click", () => {
      const midX = Math.round(currentResolution.width / 2);
      const startY = Math.round(currentResolution.height * 0.75);
      const endY = Math.round(currentResolution.height * 0.25);
      sendAction({ action: "SWIPE", x1: midX, y1: startY, x2: midX, y2: endY, durationMs: 250 });
    });

    if (swipeDown) swipeDown.addEventListener("click", () => {
      const midX = Math.round(currentResolution.width / 2);
      const startY = Math.round(currentResolution.height * 0.25);
      const endY = Math.round(currentResolution.height * 0.75);
      sendAction({ action: "SWIPE", x1: midX, y1: startY, x2: midX, y2: endY, durationMs: 250 });
    });

    if (phoneAiCmdBtn && phoneAiCmdInput) {
      phoneAiCmdBtn.addEventListener("click", async () => {
        const cmdText = phoneAiCmdInput.value.trim();
        if (!cmdText) return alert("請輸入指令");

        phoneAiCmdBtn.disabled = true;
        phoneAiCmdBtn.innerHTML = "<span>🧠 AI 視覺分析中...</span>";
        if (phoneActionLog) phoneActionLog.textContent = `🤖 正在分析螢幕並尋找: "${cmdText}"...`;

        try {
          const snapRes = await fetch("/api/phone/screenshot", { method: "POST" });
          const snapData = await snapRes.json();

          if (!snapData.success || !snapData.base64) {
            throw new Error(snapData.error || "截圖失敗");
          }

          const promptInput = document.getElementById("prompt-input");
          if (promptInput) {
            promptInput.value = `【手機操控指令】請分析附圖中的手機螢幕，並執行動作：「${cmdText}」。解析度為 ${snapData.resolution?.width}x${snapData.resolution?.height}。如果找到目標，請指出 (X, Y) 座標並幫我執行點擊。`;
            if (typeof window.sendMessage === "function") {
              togglePhoneModal(false);
              window.sendMessage();
            }
          }
        } catch (err) {
          if (phoneActionLog) phoneActionLog.textContent = `❌ AI 執行錯誤: ${err.message}`;
        } finally {
          phoneAiCmdBtn.disabled = false;
          phoneAiCmdBtn.innerHTML = "<span>🚀 執行</span>";
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initElements();
      setupListeners();
    });
  } else {
    initElements();
    setupListeners();
  }
})();
