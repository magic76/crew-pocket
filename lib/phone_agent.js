// Antigravity Web UI - Android Phone Agent Controller (Native Accessibility Service Engine)
const { execSync } = require("node:child_process");
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

  // Check Accessibility Service health (127.0.0.1:8766)
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

  // 1. Check Connection Status
  async getStatus() {
    const isRunning = await this.checkAccessibilityHealth();
    return {
      available: true,
      connected: isRunning,
      mode: "ACCESSIBILITY",
      activeDevice: isRunning ? { id: "Crew 無障礙隨身小幫手 (免 Wi-Fi)" } : null,
      devices: isRunning ? [{ id: "127.0.0.1:8766", state: "active" }] : [],
      help: isRunning 
        ? "🟢 無障礙小幫手常駐運行中！支援 4G/5G 離線免 Wi-Fi 跨 App 操控！"
        : "⚠️ 無障礙服務尚未啟用。請打開「Crew Pocket 輔助小幫手」開啟無障礙權限。"
    };
  }

  // 2. Take Screenshot (Native Accessibility Global Action + 540px WebP Extreme Compression)
  async takeScreenshot() {
    await fsPromises.mkdir(UPLOADS_DIR, { recursive: true });

    const isRunning = await this.checkAccessibilityHealth();
    if (!isRunning) {
      return { success: false, error: "無障礙服務未連線，請先開啟 App 中的無障礙權限" };
    }

    try {
      await this.sendAccessibilityRequest("/key", { key: "SCREENSHOT" });
      await new Promise(r => setTimeout(r, 650)); // Wait for Samsung gallery write

      const findScript = `python3 -c "
import os, glob
dirs = [\x27/sdcard/DCIM/Screenshots\x27, \x27/sdcard/Pictures/Screenshots\x27]
files = []
for d in dirs:
    if os.path.exists(d):
        for ext in [\x27*.png\x27, \x27*.jpg\x27, \x27*.webp\x27]:
            files.extend(glob.glob(os.path.join(d, ext)))
if files:
    files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
    print(files[0])
"`;
      const latestFile = execSync(findScript).toString().trim();
      if (latestFile && fs.existsSync(latestFile)) {
        // ⚡ Extreme Token-Saving Compression (540px WebP, ~14KB, ~516 tokens)
        const compScript = `python3 -c "
import os
from PIL import Image
src = \x27${latestFile}\x27
dest = os.path.join(\x27${UPLOADS_DIR}\x27, \x27phone_screen_opt.webp\x27)
img = Image.open(src)
orig_w, orig_h = img.size
target_w = min(540, orig_w)
target_h = int(orig_h * (target_w / orig_w))
resized = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
resized.save(dest, \x27WEBP\x27, quality=70, method=4)
"`;
        execSync(compScript);
        const optPath = path.join(UPLOADS_DIR, "phone_screen_opt.webp");
        const buf = await fsPromises.readFile(optPath);
        const base64 = `data:image/webp;base64,${buf.toString("base64")}`;
        const stat = await fsPromises.stat(optPath);

        return {
          success: true,
          path: "/uploads/phone_screen_opt.webp",
          base64,
          sizeKb: Math.round(stat.size / 1024),
          compressed: true,
          resolution: this.cachedResolution || { width: 1440, height: 3120 },
          timestamp: Date.now()
        };
      } else {
        return { success: false, error: "未找到新產生的截圖檔案" };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // 3. Physical Tap Action
  async tap(x, y) {
    return this.sendAccessibilityRequest("/tap", { x, y });
  }

  // 4. Swipe Gesture
  async swipe(x1, y1, x2, y2, durationMs = 300) {
    return this.sendAccessibilityRequest("/swipe", { x1, y1, x2, y2, duration: durationMs });
  }

  // 5. Send Physical Keys (Home, Back, Recents)
  async pressKey(keyName) {
    return this.sendAccessibilityRequest("/key", { key: keyName });
  }

  // 6. Show Floating Bubble
  async showBubble() {
    return this.sendAccessibilityRequest("/bubble", {});
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
