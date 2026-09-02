// Antigravity Web UI - Android Device Adapter Implementation

const http = require('node:http');
const { DeviceAdapter } = require('./base');
const { AppRegistry } = require('./app_registry');
const { createActionResult } = require('./types');

class AndroidDeviceAdapter extends DeviceAdapter {
  constructor(port = 8766, host = '127.0.0.1') {
    super('Android Device (Crew Pocket)');
    this.port = port;
    this.host = host;
    this.appRegistry = new AppRegistry(this);
    this.cachedResolution = { width: 1440, height: 3120 };
  }

  getCapabilities() {
    return [
      'app_launch',
      'accessibility',
      'screenshot',
      'semantic_tap',
      'semantic_scroll',
      'deep_link',
      'notifications',
      'quick_settings',
      'home',
      'back',
      'recents',
      'text_input',
      'vision'
    ];
  }

  async sendRequest(endpoint, bodyObj = null, method = 'POST', timeoutMs = 8000) {
    return new Promise((resolve) => {
      const isGet = method === 'GET' || !bodyObj;
      const data = isGet ? '' : JSON.stringify(bodyObj);
      const req = http.request({
        hostname: this.host,
        port: this.port,
        path: endpoint,
        method: isGet ? 'GET' : 'POST',
        headers: isGet ? {} : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: timeoutMs
      }, (res) => {
        let respData = '';
        res.on('data', chunk => respData += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(respData));
          } catch (e) {
            resolve({ success: true, action: endpoint, raw: respData });
          }
        });
      });
      req.on('error', e => resolve({ success: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false, error: '連線逾時 (Timeout)' }); });
      if (!isGet && data) req.write(data);
      req.end();
    });
  }

  async getInstalledApps() {
    return this.appRegistry.refreshInstalledApps();
  }

  async getCurrentApp() {
    const screen = await this.getScreen();
    return {
      packageName: screen.packageName || 'unknown',
      screenWidth: screen.screenWidth || this.cachedResolution.width,
      screenHeight: screen.screenHeight || this.cachedResolution.height
    };
  }

  async getScreen() {
    const resp = await this.sendRequest('/screen_info', null, 'GET');
    if (resp && resp.screenWidth && resp.screenHeight) {
      this.cachedResolution = { width: resp.screenWidth, height: resp.screenHeight };
    }

    const rawNodes = Array.isArray(resp?.nodes) ? resp.nodes : [];
    const elements = rawNodes.map((n, idx) => ({
      id: n.id || ('node_' + idx),
      text: n.text || undefined,
      contentDescription: n.desc || undefined,
      role: this.inferRole(n),
      className: n.class || undefined,
      clickable: Boolean(n.clickable),
      scrollable: Boolean(n.scrollable),
      editable: Boolean(n.editable),
      enabled: true,
      bounds: n.bounds
    }));

    return {
      packageName: resp?.package || 'unknown',
      screenWidth: resp?.screenWidth || this.cachedResolution.width,
      screenHeight: resp?.screenHeight || this.cachedResolution.height,
      elements,
      capturedAt: Date.now()
    };
  }

  inferRole(node) {
    const cls = String(node.class || '').toLowerCase();
    if (node.editable || cls.includes('edittext')) return 'input';
    if (cls.includes('button') || (node.clickable && node.text)) return 'button';
    if (cls.includes('image') || cls.includes('icon')) return 'image';
    if (cls.includes('switch') || cls.includes('checkbox')) return 'switch';
    if (node.scrollable || cls.includes('scrollview') || cls.includes('recyclerview') || cls.includes('listview')) return 'list';
    if (node.text) return 'text';
    return 'view';
  }

  // Tier 1: App Launch with AppRegistry resolution
  async launchApp(target) {
    let appName = '';
    let pkg = '';
    let url = '';

    if (typeof target === 'string') {
      appName = target.trim();
      if (appName.startsWith('http://') || appName.startsWith('https://') || appName.startsWith('intent:')) {
        return this.openUrl(appName);
      }
    } else if (target && typeof target === 'object') {
      appName = target.app || target.name || '';
      pkg = target.package || '';
      url = target.url || '';
    }

    if (url) return this.openUrl(url);

    // Resolve via AppRegistry
    const resolved = await this.appRegistry.resolveApp(appName || pkg);
    const targetPackage = resolved ? resolved.packageName : (pkg || appName);
    const targetLabel = resolved ? resolved.displayName : appName;

    const resp = await this.sendRequest('/launch', { package: targetPackage, app: targetLabel });
    if (resp && resp.success) {
      return createActionResult('launchApp', 'os', true, '已成功開啟 ' + targetLabel, {
        data: { package: targetPackage, label: targetLabel }
      });
    }

    return createActionResult('launchApp', 'os', false, '找不到或無法啟動 App：' + appName, { retryable: true });
  }

  // Tier 1: System Keys
  async pressKey(keyName) {
    const key = String(keyName || 'HOME').toUpperCase();
    const resp = await this.sendRequest('/key', { key });
    return createActionResult('pressKey', 'os', resp?.success !== false, '已執行系統按鍵 ' + key);
  }

  async back() { return this.pressKey('BACK'); }
  async home() { return this.pressKey('HOME'); }
  async recents() { return this.pressKey('RECENTS'); }
  async notifications() { return this.pressKey('NOTIFICATIONS'); }
  async quickSettings() { return this.pressKey('QUICK_SETTINGS'); }

  async openUrl(url) {
    const resp = await this.sendRequest('/launch', { url: String(url).trim() });
    return createActionResult('openUrl', 'os', resp?.success !== false, '已開啟網址：' + url);
  }

  // Tier 2: Semantic Tap with 3-Level Fallback (Semantic Action -> Node Bounds -> Raw Tap)
  async tap(target) {
    const query = typeof target === 'string' ? { text: target } : (target || {});
    const targetText = query.text || query.contentDescription || query.label || '';
    const targetId = query.id || '';

    if (!targetText && !targetId) {
      return createActionResult('tap', 'accessibility', false, '缺少點擊目標文字或 ID', { retryable: false });
    }

    // 1. Accessibility semantic click
    const resp = await this.sendRequest('/click', { label: targetText, id: targetId });
    if (resp && resp.success) {
      return createActionResult('tap', 'accessibility', true, '已點擊「' + (targetText || targetId) + '」');
    }

    // 2. Search live screen tree for bounds fallback
    const screen = await this.getScreen().catch(() => null);
    if (screen && Array.isArray(screen.elements)) {
      const match = screen.elements.find(el => {
        if (targetId && el.id && el.id.toLowerCase().includes(targetId.toLowerCase())) return true;
        if (targetText && el.text && el.text.toLowerCase().includes(targetText.toLowerCase())) return true;
        if (targetText && el.contentDescription && el.contentDescription.toLowerCase().includes(targetText.toLowerCase())) return true;
        return false;
      });

      if (match && match.bounds) {
        const cx = Math.round((match.bounds.left + match.bounds.right) / 2);
        const cy = Math.round((match.bounds.top + match.bounds.bottom) / 2);
        await this.sendRequest('/tap', { x: cx, y: cy });
        return createActionResult('tap', 'coordinate', true, '已透過節點座標點擊「' + (targetText || targetId) + '」', {
          data: { x: cx, y: cy }
        });
      }
    }

    return createActionResult('tap', 'accessibility', false, '畫面上未找到「' + (targetText || targetId) + '」', { retryable: true });
  }

  // Tier 2: Semantic Scroll
  async scroll(direction = 'up', distance = 'normal') {
    const dir = String(direction || 'up').toLowerCase();
    const resp = await this.sendRequest('/scroll', { direction: dir, distance });
    return createActionResult('scroll', 'accessibility', resp?.success !== false, '已執行滾動：' + dir);
  }

  // Tier 2: Proportional Gesture Swipe
  async swipe(direction = 'up', distance = 'normal') {
    const w = this.cachedResolution.width || 1440;
    const h = this.cachedResolution.height || 3120;
    const dir = String(direction || 'up').toLowerCase();
    const dist = String(distance || 'normal').toLowerCase();

    let x1 = Math.round(w * 0.50), y1 = Math.round(h * 0.74);
    let x2 = Math.round(w * 0.50), y2 = Math.round(h * 0.22);
    let duration = 320;

    if (dir === 'down') {
      y1 = Math.round(h * 0.22);
      y2 = Math.round(h * 0.74);
    } else if (dir === 'left') {
      x1 = Math.round(w * 0.85);
      y1 = Math.round(h * 0.50);
      x2 = Math.round(w * 0.15);
      y2 = Math.round(h * 0.50);
    } else if (dir === 'right') {
      x1 = Math.round(w * 0.15);
      y1 = Math.round(h * 0.50);
      x2 = Math.round(w * 0.85);
      y2 = Math.round(h * 0.50);
    }

    if (dist === 'long' || dist === 'page') {
      duration = 280;
      if (dir === 'up') { y1 = Math.round(h * 0.88); y2 = Math.round(h * 0.12); }
      else if (dir === 'down') { y1 = Math.round(h * 0.12); y2 = Math.round(h * 0.88); }
      else if (dir === 'left') { x1 = Math.round(w * 0.94); x2 = Math.round(w * 0.06); }
      else if (dir === 'right') { x1 = Math.round(w * 0.06); x2 = Math.round(w * 0.94); }
    } else if (dist === 'short') {
      duration = 260;
      if (dir === 'up') { y1 = Math.round(h * 0.58); y2 = Math.round(h * 0.38); }
      else if (dir === 'down') { y1 = Math.round(h * 0.38); y2 = Math.round(h * 0.58); }
      else if (dir === 'left') { x1 = Math.round(w * 0.65); x2 = Math.round(w * 0.35); }
      else if (dir === 'right') { x1 = Math.round(w * 0.35); x2 = Math.round(w * 0.65); }
    }

    const resp = await this.sendRequest('/swipe', { x1, y1, x2, y2, duration });
    return createActionResult('swipe', 'coordinate', resp?.success !== false, '已執行滑動：' + dir + ' (' + dist + ')');
  }

  // Tier 2: Semantic Text Input
  async inputText(text, target = null) {
    if (target) {
      await this.tap(typeof target === 'string' ? { text: target } : target);
      await new Promise(r => setTimeout(r, 200));
    }
    const resp = await this.sendRequest('/type', { text: String(text || '') });
    return createActionResult('inputText', 'accessibility', resp?.success !== false, '已輸入文字');
  }

  // Tier 2: Wait For Element
  async waitFor(target, timeoutMs = 5000) {
    const start = Date.now();
    const query = typeof target === 'string' ? { text: target } : (target || {});
    const targetText = (query.text || query.contentDescription || '').toLowerCase();
    const targetId = (query.id || '').toLowerCase();

    while (Date.now() - start < timeoutMs) {
      const screen = await this.getScreen().catch(() => null);
      if (screen && Array.isArray(screen.elements)) {
        const found = screen.elements.find(el => {
          if (targetId && el.id && el.id.toLowerCase().includes(targetId)) return true;
          if (targetText && el.text && el.text.toLowerCase().includes(targetText)) return true;
          if (targetText && el.contentDescription && el.contentDescription.toLowerCase().includes(targetText)) return true;
          return false;
        });
        if (found) {
          return createActionResult('waitFor', 'accessibility', true, '目標元素已出現', { data: found });
        }
      }
      await new Promise(r => setTimeout(r, 400));
    }
    return createActionResult('waitFor', 'accessibility', false, '等待元素逾時', { retryable: true });
  }
}

module.exports = {
  AndroidDeviceAdapter
};
