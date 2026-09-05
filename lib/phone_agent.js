// Antigravity Web UI - Android Phone Agent Controller (Native Accessibility & Silent Camera Engine)
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { getDeviceAdapter } = require("./device_adapter");

const UPLOADS_DIR = path.join(__dirname, "..", "public", "uploads");

class PhoneAgentController {
  constructor() {
    this.cachedResolution = { width: 1440, height: 3120 };
    this.deviceAdapter = getDeviceAdapter();
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
        ? "🟢 無障礙小幫手常駐運行中！支援 4G/5G 離線免 Wi-Fi 跨 App 操控與背景相機！"
        : "⚠️ 無障礙服務尚未啟用。請打開「Crew Pocket 輔助小幫手」開啟無障礙與相機權限。"
    };
  }

  // 2. Take Screen Screenshot (540px WebP, ~14KB, ~516 tokens)
  async takeScreenshot() {
    await fsPromises.mkdir(UPLOADS_DIR, { recursive: true });

    const isRunning = await this.checkAccessibilityHealth();
    if (!isRunning) {
      return { success: false, error: "無障礙服務未連線，請先開啟 App 中的無障礙權限" };
    }

    try {
      // CrewHelper uses a tiny local HTTP server; allow the status request to
      // fully settle before opening the screenshot request.
      await new Promise(r => setTimeout(r, 350));
      const startedAt = Date.now() / 1000;
      // Prefer the unified endpoint. Older CrewHelper builds return only
      // {status:"OK"}, so retain a compatibility path with freshness checks.
      const helperResult = await this.sendAccessibilityRequest("/screenshot", {});
      let sourcePath = helperResult?.path;

      if (!sourcePath && helperResult?.status === "OK") {
        const screenshotDirs = ["/sdcard/DCIM/Screenshots", "/sdcard/Pictures/Screenshots"];
        const candidates = [];
        for (const dir of screenshotDirs) {
          try {
            for (const name of await fsPromises.readdir(dir)) {
              if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
              const candidate = path.join(dir, name);
              const stat = await fsPromises.stat(candidate);
              if (stat.isFile() && stat.mtimeMs / 1000 >= startedAt - 1) {
                candidates.push({ path: candidate, mtimeMs: stat.mtimeMs });
              }
            }
          } catch (_) {}
        }
        candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
        sourcePath = candidates[0]?.path;

        // Some installed APK builds acknowledge /screenshot without doing
        // the capture, while their legacy SCREENSHOT key still works.
        if (!sourcePath) {
          const legacyResult = await this.sendAccessibilityRequest("/key", { key: "SCREENSHOT" });
          if (legacyResult?.success === false) {
            return { success: false, error: legacyResult.error || "截圖觸發失敗" };
          }
          await new Promise(r => setTimeout(r, 700));
          for (const dir of screenshotDirs) {
            try {
              for (const name of await fsPromises.readdir(dir)) {
                if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
                const candidate = path.join(dir, name);
                const stat = await fsPromises.stat(candidate);
                if (stat.isFile() && stat.mtimeMs / 1000 >= startedAt - 1) {
                  candidates.push({ path: candidate, mtimeMs: stat.mtimeMs });
                }
              }
            } catch (_) {}
          }
          candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
          sourcePath = candidates[0]?.path;
        }
      }

      if (!sourcePath) {
        return { success: false, error: helperResult?.error || "截圖失敗，未找到本次新產生的檔案" };
      }

      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: `截圖檔案不存在：${sourcePath}` };
      }

      const sourceStat = await fsPromises.stat(sourcePath);
      if (sourceStat.size === 0) {
        return { success: false, error: "截圖檔案為空" };
      }

      return this.compressAndEncodeImage(sourcePath, "phone_screen_opt.webp");
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // 3. Take Real Physical Camera Photo (Silent Background Snapshot with Timestamp Guarantee)
  async takePhoto(facing = "back") {
    await fsPromises.mkdir(UPLOADS_DIR, { recursive: true });

    const isRunning = await this.checkAccessibilityHealth();
    if (!isRunning) {
      return { success: false, error: "小幫手未連線，請確認無障礙服務與相機權限已開啟" };
    }

    try {
      const resp = await this.sendAccessibilityRequest("/photo", { camera: facing });
      if (!resp || !resp.success || !resp.path) {
        return { success: false, error: resp?.error || "相機拍照失敗，請確認相機權限已授予" };
      }

      if (fs.existsSync(resp.path)) {
        let finalPhotoPath = resp.path;
        
        // Ensure timestamped filename is always created
        const d = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        const tsPath = `/sdcard/Pictures/CrewPocket/IMG_${ts}.jpg`;

        if (finalPhotoPath.includes("latest_camera_photo.jpg")) {
          try {
            await fsPromises.copyFile(finalPhotoPath, tsPath);
            finalPhotoPath = tsPath;
          } catch (e) {}
        }

        const compResult = await this.compressAndEncodeImage(finalPhotoPath, "camera_photo_opt.webp");
        return {
          ...compResult,
          originalPath: finalPhotoPath,
          timestampName: path.basename(finalPhotoPath)
        };
      } else {
        return { success: false, error: "未找到拍攝的照片檔案" };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Common Compressor for Screenshots and Camera Photos
  async compressAndEncodeImage(srcPath, outFilename) {
    const outPath = path.join(UPLOADS_DIR, outFilename);
    const tmpPath = `${outPath}.tmp-${process.pid}-${Date.now()}`;
    const compScript = `python3 -c "
import os
from PIL import Image
src = \x27${srcPath}\x27
dest = \x27${tmpPath}\x27
img = Image.open(src)
orig_w, orig_h = img.size
target_w = min(640, orig_w)
target_h = int(orig_h * (target_w / orig_w))
resized = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
resized.save(dest, \x27WEBP\x27, quality=75, method=4)
"`;
    execSync(compScript);
    await fsPromises.rename(tmpPath, outPath);
    const optPath = outPath;
    const buf = await fsPromises.readFile(optPath);
    const base64 = `data:image/webp;base64,${buf.toString("base64")}`;
    const stat = await fsPromises.stat(optPath);

    return {
      success: true,
      path: `/uploads/${outFilename}`,
      base64,
      sizeKb: Math.round(stat.size / 1024),
      compressed: true,
      resolution: this.cachedResolution || { width: 1440, height: 3120 },
      timestamp: Date.now()
    };
  }

  // ==========================================================
  // 📱 Tier 1 & 2: High-Level Semantic & Accessibility Actions
  // ==========================================================

  // Get current foreground app & structured UI accessibility node tree
  async getCurrentScreen() {
    return this.getScreenElements();
  }

  async getCurrentApp() {
    const screen = await this.getScreenElements();
    return {
      success: screen.success,
      package: screen.package || 'unknown',
      screenWidth: screen.screenWidth || this.cachedResolution.width,
      screenHeight: screen.screenHeight || this.cachedResolution.height
    };
  }

  async getScreenElements() {
    return new Promise((resolve) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: 8766,
        path: "/screen_info",
        method: "GET",
        timeout: 5000
      }, (res) => {
        let respData = "";
        res.on("data", (chunk) => respData += chunk);
        res.on("end", () => {
          try {
            const parsed = JSON.parse(respData);
            if (parsed.screenWidth && parsed.screenHeight) {
              this.cachedResolution = { width: parsed.screenWidth, height: parsed.screenHeight };
            }
            resolve(parsed);
          } catch (e) {
            resolve({ success: false, error: e.message, nodes: [] });
          }
        });
      });
      req.on("error", (e) => resolve({ success: false, error: e.message, nodes: [] }));
      req.on("timeout", () => { req.destroy(); resolve({ success: false, error: "Timeout", nodes: [] }); });
      req.end();
    });
  }

  // Alias for getScreenElements / nodes
  async getNodes() {
    return this.getScreenElements();
  }

  // Find all nodes matching text or desc
  async findText(text) {
    const screen = await this.getScreenElements();
    if (!screen.success || !Array.isArray(screen.nodes)) return { success: false, matches: [] };
    const query = String(text || '').trim().toLowerCase();
    const matches = screen.nodes.filter(n =>
      (n.text && n.text.toLowerCase().includes(query)) ||
      (n.desc && n.desc.toLowerCase().includes(query))
    );
    return { success: true, count: matches.length, matches };
  }

  // Tap by semantic text or content description
  async tapText(text) {
    return this.sendAccessibilityRequest("/click", { label: text });
  }

  // Tap by resource viewId
  async tapNode(id) {
    return this.sendAccessibilityRequest("/click", { id });
  }

  // Wait for element with text to appear on screen
  async waitForElement(text, timeoutMs = 5000) {
    const start = Date.now();
    const query = String(text || '').trim().toLowerCase();
    while (Date.now() - start < timeoutMs) {
      const screen = await this.getScreenElements();
      if (screen && Array.isArray(screen.nodes)) {
        const found = screen.nodes.find(n =>
          (n.text && n.text.toLowerCase().includes(query)) ||
          (n.desc && n.desc.toLowerCase().includes(query))
        );
        if (found) return { success: true, node: found, elapsedMs: Date.now() - start };
      }
      await new Promise(r => setTimeout(r, 400));
    }
    return { success: false, error: `等待元素逾時（未出現包含「${text}」的元素）` };
  }

  // Semantic Scroll / Swipe: translates direction + distance to screen coordinates
  async scroll(direction = "up", distance = "normal") {
    return this.sendAccessibilityRequest("/scroll", { direction, distance });
  }

  async scrollContainer(nodeId, direction = "up") {
    return this.sendAccessibilityRequest("/scroll", { id: nodeId, direction });
  }

  // High-level Swipe with automatic proportional screen coordinate calculation
  async swipe(direction = "up", distance = "normal") {
    const w = this.cachedResolution.width || 1440;
    const h = this.cachedResolution.height || 3120;
    const dir = String(direction || "up").toLowerCase();
    const dist = String(distance || "normal").toLowerCase();

    let x1 = Math.round(w * 0.50), y1 = Math.round(h * 0.74);
    let x2 = Math.round(w * 0.50), y2 = Math.round(h * 0.22);
    let duration = 320;

    if (dir === "down") {
      y1 = Math.round(h * 0.22);
      y2 = Math.round(h * 0.74);
    } else if (dir === "left") {
      x1 = Math.round(w * 0.85);
      y1 = Math.round(h * 0.50);
      x2 = Math.round(w * 0.15);
      y2 = Math.round(h * 0.50);
    } else if (dir === "right") {
      x1 = Math.round(w * 0.15);
      y1 = Math.round(h * 0.50);
      x2 = Math.round(w * 0.85);
      y2 = Math.round(h * 0.50);
    }

    if (dist === "long" || dist === "page") {
      duration = 280;
      if (dir === "up") { y1 = Math.round(h * 0.88); y2 = Math.round(h * 0.12); }
      else if (dir === "down") { y1 = Math.round(h * 0.12); y2 = Math.round(h * 0.88); }
      else if (dir === "left") { x1 = Math.round(w * 0.94); x2 = Math.round(w * 0.06); }
      else if (dir === "right") { x1 = Math.round(w * 0.06); x2 = Math.round(w * 0.94); }
    } else if (dist === "short") {
      duration = 260;
      if (dir === "up") { y1 = Math.round(h * 0.58); y2 = Math.round(h * 0.38); }
      else if (dir === "down") { y1 = Math.round(h * 0.38); y2 = Math.round(h * 0.58); }
      else if (dir === "left") { x1 = Math.round(w * 0.65); x2 = Math.round(w * 0.35); }
      else if (dir === "right") { x1 = Math.round(w * 0.35); x2 = Math.round(w * 0.65); }
    }

    return this.sendAccessibilityRequest("/swipe", { x1, y1, x2, y2, duration });
  }

  // Low-level pixel swipe (Tier 3 fallback)
  async swipeCoordinates(x1, y1, x2, y2, durationMs = 300) {
    return this.sendAccessibilityRequest("/swipe", { x1, y1, x2, y2, duration: durationMs });
  }

  // Physical Tap Action (Tier 3 fallback)
  async tap(x, y) {
    return this.sendAccessibilityRequest("/tap", { x, y });
  }

  // Type Text into focused or specified input field
  async typeText(text, target = null, x = null, y = null) {
    if (target || (x !== null && y !== null)) {
      if (x !== null && y !== null) {
        await this.tap(x, y);
      } else if (target) {
        await this.tapText(target);
      }
      await new Promise(r => setTimeout(r, 250));
    }
    return this.sendAccessibilityRequest("/type", { text });
  }

  // Physical System Keys (Home, Back, Recents, Notifications, QuickSettings, PowerDialog)
  async pressKey(keyName) {
    return this.sendAccessibilityRequest("/key", { key: keyName });
  }

  // Start a known app or package or Settings
  async launchApp(appNameOrPackage = '', target = '') {
    return this.sendAccessibilityRequest("/launch", { app: appNameOrPackage, package: appNameOrPackage, target });
  }

  // Open URL / Deep Link directly via Android Intent
  async openUrl(url) {
    return this.sendAccessibilityRequest("/launch", { url });
  }

  async findApps(query) {
    return this.sendAccessibilityRequest("/apps", { query });
  }

  // Toggle/Show/Hide Floating Bubble
  async showBubble(action = "toggle") {
    return this.sendAccessibilityRequest("/bubble", { action });
  }

  async getMediaVolume() {
    return this.sendAccessibilityRequest("/volume", {});
  }

  async setMediaVolume(percent) {
    const normalized = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    return this.sendAccessibilityRequest("/volume", { percent: normalized });
  }

  // Helper for Accessibility HTTP POST
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
        timeout: 10000
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
