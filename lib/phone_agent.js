// Antigravity Web UI - Android Phone Agent Controller (ADB / Shizuku / Wireless Debugging)
const { exec, execSync } = require('node:child_process');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');
const SCREENSHOT_PATH = path.join(UPLOADS_DIR, 'phone_screen.png');

class PhoneAgentController {
  constructor() {
    this.cachedResolution = null;
  }

  // 1. Check ADB Connection Status
  async getStatus() {
    return new Promise((resolve) => {
      exec('adb devices', (err, stdout, stderr) => {
        if (err) {
          return resolve({
            available: true,
            connected: false,
            error: err.message,
            devices: [],
            help: '請開啟 Android「開發人員選項」->「無線偵錯」，並在下方輸入端口進行配對/連線。'
          });
        }

        const lines = stdout.split('\n').filter(l => l.trim().length > 0);
        const deviceLines = lines.slice(1).map(l => {
          const parts = l.split(/\s+/);
          return { id: parts[0], state: parts[1] || 'unknown' };
        }).filter(d => d.id && !d.id.startsWith('*'));

        const isConnected = deviceLines.some(d => d.state === 'device');
        const activeDevice = deviceLines.find(d => d.state === 'device') || deviceLines[0] || null;

        resolve({
          available: true,
          connected: isConnected,
          activeDevice: activeDevice,
          devices: deviceLines,
          help: isConnected 
            ? '✅ 已成功連線至本機 Android 系統！' 
            : '⚠️ 尚未連線。請至手機「設定 -> 開發人員選項 -> 無線偵錯」配對本機端口。'
        });
      });
    });
  }

  // 2. Wireless ADB Connect / Pair
  async connectWireless(rawTarget, host = '127.0.0.1') {
    return new Promise((resolve) => {
      let target = (rawTarget || '').trim();
      if (!target.includes(':')) {
        target = `${host}:${target}`;
      }
      exec(`adb connect ${target}`, (err, stdout, stderr) => {
        const out = (stdout || stderr || '').trim();
        const success = out.includes('connected to') && !out.includes('unable') && !out.includes('failed');
        resolve({ success, output: out, target });
      });
    });
  }

  async pairWireless(rawTarget, pairingCode, host = '127.0.0.1') {
    return new Promise((resolve) => {
      let target = (rawTarget || '').trim();
      if (!target.includes(':')) {
        target = `${host}:${target}`;
      }
      const code = (pairingCode || '').trim();
      exec(`adb pair ${target} ${code}`, (err, stdout, stderr) => {
        const out = (stdout || stderr || '').trim();
        const success = out.includes('Successfully paired');
        resolve({ success, output: out, target });
      });
    });
  }

  // 3. Take Screenshot (Screencap)
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
            return resolve({ success: false, error: '截圖檔案過小或未連線' });
          }

          const buf = await fsPromises.readFile(SCREENSHOT_PATH);
          const base64 = `data:image/png;base64,${buf.toString('base64')}`;

          let resolution = this.cachedResolution;
          if (!resolution) {
            try {
              const resOut = execSync('adb shell wm size').toString();
              const match = resOut.match(/(\d+)x(\d+)/);
              if (match) {
                resolution = { width: parseInt(match[1]), height: parseInt(match[2]) };
                this.cachedResolution = resolution;
              }
            } catch (e) {
              resolution = { width: 1080, height: 2400 };
            }
          }

          resolve({
            success: true,
            path: '/uploads/phone_screen.png',
            base64,
            sizeKb: Math.round(stat.size / 1024),
            resolution: resolution || { width: 1080, height: 2400 },
            timestamp: Date.now()
          });
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    });
  }

  // 4. Physical Tap Action
  async tap(x, y) {
    return new Promise((resolve) => {
      const rx = Math.round(x);
      const ry = Math.round(y);
      exec(`adb shell input tap ${rx} ${ry}`, (err) => {
        if (err) return resolve({ success: false, error: err.message });
        resolve({ success: true, action: 'TAP', x: rx, y: ry });
      });
    });
  }

  // 5. Swipe Gesture
  async swipe(x1, y1, x2, y2, durationMs = 300) {
    return new Promise((resolve) => {
      exec(`adb shell input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${durationMs}`, (err) => {
        if (err) return resolve({ success: false, error: err.message });
        resolve({ success: true, action: 'SWIPE', from: { x: x1, y: y1 }, to: { x: x2, y: y2 } });
      });
    });
  }

  // 6. Send Key Event (Home, Back, Recents, Power, Volume)
  async pressKey(keyName) {
    const keyMap = {
      'BACK': 4,
      'HOME': 3,
      'RECENTS': 187,
      'APP_SWITCH': 187,
      'POWER': 26,
      'VOLUME_UP': 24,
      'VOLUME_DOWN': 25,
      'ENTER': 66
    };
    const code = keyMap[keyName.toUpperCase()] || keyName;

    return new Promise((resolve) => {
      exec(`adb shell input keyevent ${code}`, (err) => {
        if (err) return resolve({ success: false, error: err.message });
        resolve({ success: true, action: 'KEYEVENT', key: keyName, code });
      });
    });
  }

  // 7. Input Text
  async typeText(text) {
    return new Promise((resolve) => {
      const escaped = text.replace(/ /g, '%s').replace(/(["'$`\\])/g, '\\$1');
      exec(`adb shell input text "${escaped}"`, (err) => {
        if (err) return resolve({ success: false, error: err.message });
        resolve({ success: true, action: 'TYPE', text });
      });
    });
  }

  // 8. Launch App
  async launchApp(packageName) {
    return new Promise((resolve) => {
      exec(`adb shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, (err) => {
        if (err) return resolve({ success: false, error: err.message });
        resolve({ success: true, action: 'LAUNCH', package: packageName });
      });
    });
  }
}

const phoneAgent = new PhoneAgentController();

module.exports = {
  phoneAgent,
  PhoneAgentController
};
