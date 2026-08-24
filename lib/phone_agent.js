// Antigravity Web UI - Android Phone Agent Controller (Dual-Engine: Accessibility Service & Wireless ADB)
const { exec, execSync } = require("node:child_process");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");

const UPLOADS_DIR = path.join(__dirname, "..", "public", "uploads");
const SCREENSHOT_PATH = path.join(UPLOADS_DIR, "phone_screen.png");

class PhoneAgentController {
  constructor() {
    this.cachedResolution = { width: 1440, height: 3120 };
  }

  // Check Accessibility Service HTTP health (127.0.0.1:8766)
  async checkAccessibilityHealth() {
    return new Promise((resolve) => {
      const req = http.get("http://127.0.0.1:8766/status", { timeout: 800 }, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.active === true);
          } catch (e) {
            resolve(false);
          }
        });
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
    });
  }

  // 1. Check Dual Connection Status (Accessibility Service or ADB)
  async getStatus() {
    const hasAccessibility = await this.checkAccessibilityHealth();
    if (hasAccessibility) {
      return {
        available: true,
        connected: true,
        mode: "ACCESSIBILITY",
        activeDevice: { id: "Crew 無障礙小幫手 (免 Wi-Fi)" },
        devices: [{ id: "127.0.0.1:8766", state: "accessibility_active" }],
        help: "🟢 無障礙服務運行中！支援離線與 4G/5G 免 Wi-Fi 跨 App 操控！"
      };
    }

    return new Promise((resolve) => {
      exec("adb devices", (err, stdout) => {
        if (err) {
          return resolve({
            available: true,
            connected: false,
            mode: "NONE",
            devices: [],
            help: "請安裝「Crew Pocket 輔助小幫手 APK」或開啟「無線偵錯」連線。"
          });
        }

        const lines = stdout.split("\n").filter(l => l.trim().length > 0);
        const deviceLines = lines.slice(1).map(l => {
          const parts = l.split(/\s+/);
          return { id: parts[0], state: parts[1] || "unknown" };
        }).filter(d => d.id && !d.id.startsWith("*"));

        const isConnected = deviceLines.some(d => d.state === "device");
        const activeDevice = deviceLines.find(d => d.state === "device") || deviceLines[0] || null;

        resolve({
          available: true,
          connected: isConnected,
          mode: isConnected ? "ADB" : "NONE",
          activeDevice: activeDevice,
          devices: deviceLines,
          help: isConnected 
            ? "✅ 已透過 ADB 連線至本機 Android 系統！" 
            : "⚠️ 尚未連線。可安裝下方「無障礙小幫手 APK」或透過「無線偵錯」連線。"
        });
      });
    });
  }

  // 2. Wireless ADB Connect / Pair
  async connectWireless(rawTarget, host = "127.0.0.1") {
    return new Promise((resolve) => {
      let target = (rawTarget || "").trim();
      if (!target.includes(":")) {
        target = `${host}:${target}`;
      }
      exec(`adb connect ${target}`, (err, stdout, stderr) => {
        const out = (stdout || stderr || "").trim();
        const success = out.includes("connected to") && !out.includes("unable") && !out.includes("failed");
        resolve({ success, output: out, target });
      });
    });
  }

  async pairWireless(rawTarget, pairingCode, host = "127.0.0.1") {
    return new Promise((resolve) => {
      let target = (rawTarget || "").trim();
      if (!target.includes(":")) {
        target = `${host}:${target}`;
      }
      const code = (pairingCode || "").trim();
      exec(`adb pair ${target} ${code}`, (err, stdout, stderr) => {
        const out = (stdout || stderr || "").trim();
        const success = out.includes("Successfully paired");
        resolve({ success, output: out, target });
      });
    });
  }

  // 3. Take Screenshot (Screencap + Smart Context Compression)
  async takeScreenshot() {
    await fsPromises.mkdir(UPLOADS_DIR, { recursive: true });
    
    return new Promise((resolve) => {
      exec(`adb exec-out screencap -p > "${SCREENSHOT_PATH}"`, async (err) => {
        if (err) {
          return resolve({ success: false, error: err.message });
        }

        try {
          const stat = await fsPromises.stat(SCREENSHOT_PATH);
          if (stat.size < 1000) {
            return resolve({ success: false, error: "截圖檔案過小或未連線" });
          }

          // ⚡ Smart Token-Saving Compression Pipeline (720px WebP)
          const compScript = `python3 -c "
import os
from PIL import Image
src = 
dest = os.path.join(, phone_screen_opt.webp)
img = Image.open(src)
orig_w, orig_h = img.size
target_w = min(720, orig_w)
target_h = int(orig_h * (target_w / orig_w))
resized = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
resized.save(dest, WEBP, quality=78, method=4)
"`;
          try {
            execSync(compScript);
          } catch (e) {
            console.warn("[PhoneAgent] Image compression fallback:", e.message);
          }

          const optPath = path.join(UPLOADS_DIR, "phone_screen_opt.webp");
          const hasOpt = fs.existsSync(optPath);
          const finalPath = hasOpt ? optPath : SCREENSHOT_PATH;
          const mime = hasOpt ? "image/webp" : "image/png";
          
          const buf = await fsPromises.readFile(finalPath);
          const base64 = `data:${mime};base64,${buf.toString("base64")}`;

          let resolution = this.cachedResolution;
          if (!resolution) {
            try {
              const resOut = execSync("adb shell wm size").toString();
              const match = resOut.match(/(\d+)x(\d+)/);
              if (match) {
                resolution = { width: parseInt(match[1]), height: parseInt(match[2]) };
                this.cachedResolution = resolution;
              }
            } catch (e) {
              resolution = { width: 1440, height: 3120 };
            }
          }

          const finalStat = await fsPromises.stat(finalPath);

          resolve({
            success: true,
            path: hasOpt ? "/uploads/phone_screen_opt.webp" : "/uploads/phone_screen.png",
            base64,
            sizeKb: Math.round(finalStat.size / 1024),
            compressed: hasOpt,
            resolution: resolution || { width: 1440, height: 3120 },
            timestamp: Date.now()
          });
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    });
  }

  // 4. Physical Tap Action (Accessibility fallback to ADB)
  async tap(x, y) {
    const hasAccessibility = await this.checkAccessibilityHealth();
    if (hasAccessibility) {
      return this.sendAccessibilityRequest("/tap", { x, y });
    }

    return new Promise((resolve) => {
      const rx = Math.round(x);
      const ry = Math.round(y);
      exec(`adb shell input tap ${rx} ${ry}`, (err) => {
        if (err) return resolve({ success: false, error: err.message });
        resolve({ success: true, action: "TAP", x: rx, y: ry });
      });
    });
  }

  // 5. Swipe Gesture
  async swipe(x1, y1, x2, y2, durationMs = 300) {
    const hasAccessibility = await this.checkAccessibilityHealth();
    if (hasAccessibility) {
      return this.sendAccessibilityRequest("/swipe", { x1, y1, x2, y2, duration: durationMs });
    }

    return new Promise((resolve) => {
      exec(`adb shell input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${durationMs}`, (err) => {
        if (err) return resolve({ success: false, error: err.message });
        resolve({ success: true, action: "SWIPE", from: { x: x1, y: y1 }, to: { x: x2, y: y2 } });
      });
    });
  }

  // 6. Send Key Event (Home, Back, Recents, Notifications)
  async pressKey(keyName) {
    const hasAccessibility = await this.checkAccessibilityHealth();
    if (hasAccessibility) {
      return this.sendAccessibilityRequest("/key", { key: keyName });
    }

    const keyMap = {
      "BACK": 4,
      "HOME": 3,
      "RECENTS": 187,
      "APP_SWITCH": 187,
      "POWER": 26,
      "VOLUME_UP": 24,
      "VOLUME_DOWN": 25,
      "ENTER": 66
    };
    const code = keyMap[keyName.toUpperCase()] || keyName;

    return new Promise((resolve) => {
      exec(`adb shell input keyevent ${code}`, (err) => {
        if (err) return resolve({ success: false, error: err.message });
        resolve({ success: true, action: "KEYEVENT", key: keyName, code });
      });
    });
  }

  // 7. Helper for Accessibility HTTP POST
  async sendAccessibilityRequest(endpoint, bodyObj) {
    return new Promise((resolve) => {
      const data = JSON.stringify(bodyObj);
      const req = http.request({
        hostname: "127.0.0.1",
        port: 8766,
        path: endpoint,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data)
        },
        timeout: 1500
      }, (res) => {
        let respData = "";
        res.on("data", (chunk) => respData += chunk);
        res.on("end", () => {
          try {
            resolve(JSON.parse(respData));
          } catch (e) {
            resolve({ success: true, action: endpoint });
          }
        });
      });
      req.on("error", (e) => resolve({ success: false, error: e.message }));
      req.on("timeout", () => { req.destroy(); resolve({ success: false, error: "Timeout" }); });
      req.write(data);
      req.end();
    });
  }
}

const phoneAgent = new PhoneAgentController();

module.exports = {
  phoneAgent,
  PhoneAgentController
};
