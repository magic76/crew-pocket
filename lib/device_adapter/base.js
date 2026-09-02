// Antigravity Web UI - Abstract Device Adapter Base

const { createActionResult } = require('./types');

class DeviceAdapter {
  constructor(name = 'generic-device') {
    this.name = name;
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
      'text_input'
    ];
  }

  async getInstalledApps() {
    throw new Error('getInstalledApps() not implemented');
  }

  async getCurrentApp() {
    throw new Error('getCurrentApp() not implemented');
  }

  async getScreen() {
    throw new Error('getScreen() not implemented');
  }

  async launchApp(target) {
    throw new Error('launchApp() not implemented');
  }

  async tap(target) {
    throw new Error('tap() not implemented');
  }

  async scroll(direction, distance = 'normal') {
    throw new Error('scroll() not implemented');
  }

  async swipe(direction, distance = 'normal') {
    throw new Error('swipe() not implemented');
  }

  async inputText(text, target = null) {
    throw new Error('inputText() not implemented');
  }

  async back() {
    throw new Error('back() not implemented');
  }

  async home() {
    throw new Error('home() not implemented');
  }

  async recents() {
    throw new Error('recents() not implemented');
  }

  async notifications() {
    throw new Error('notifications() not implemented');
  }

  async quickSettings() {
    throw new Error('quickSettings() not implemented');
  }

  async openUrl(url) {
    throw new Error('openUrl() not implemented');
  }

  async waitFor(target, timeoutMs = 5000) {
    throw new Error('waitFor() not implemented');
  }

  async executeWithVerification(actionName, executeFn, verifyFn, maxRetries = 1) {
    const beforeScreen = await this.getScreen().catch(() => null);
    let attempt = 0;
    while (attempt <= maxRetries) {
      attempt++;
      const res = await executeFn();
      if (!res || !res.success) {
        if (attempt <= maxRetries) {
          await new Promise(r => setTimeout(r, 400));
          continue;
        }
        return res;
      }

      await new Promise(r => setTimeout(r, 350));
      const afterScreen = await this.getScreen().catch(() => null);

      let verified = true;
      if (typeof verifyFn === 'function') {
        verified = await verifyFn(beforeScreen, afterScreen);
      } else {
        verified = beforeScreen && afterScreen ? (
          beforeScreen.packageName !== afterScreen.packageName ||
          JSON.stringify(beforeScreen.elements) !== JSON.stringify(afterScreen.elements)
        ) : true;
      }

      return {
        ...res,
        screenChanged: verified
      };
    }
  }
}

module.exports = {
  DeviceAdapter
};
