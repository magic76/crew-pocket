// Antigravity Web UI - App Registry (Discovery, Fuzzy Matching & Aliases)

class AppRegistry {
  constructor(deviceClient) {
    this.deviceClient = deviceClient;
    this.cachedApps = [];
    this.lastFetchedAt = 0;
    this.ttlMs = 60000; // 1 min cache

    this.builtInAliases = {
      'binance': ['幣安', 'binance', 'com.binance.dev'],
      'chrome': ['google chrome', 'chrome', '瀏覽器', '網頁', 'com.android.chrome'],
      'settings': ['設定', '系統設定', 'settings', 'com.android.settings'],
      'line': ['line', '連我', 'jp.naver.line.android'],
      'youtube': ['youtube', 'yt', '油管', 'com.google.android.youtube'],
      'maps': ['google maps', 'google 地圖', '地圖', '導航', 'com.google.android.apps.maps'],
      'camera': ['相機', '照相機', 'camera', 'com.android.camera'],
      'gallery': ['相簿', '相片', '照片', 'gallery', 'photos', 'com.google.android.apps.photos'],
      'telegram': ['telegram', 'tg', '紙飛機', 'org.telegram.messenger'],
      'whatsapp': ['whatsapp', 'wa', 'com.whatsapp'],
      'gmail': ['gmail', '信箱', 'google mail', 'com.google.android.gm'],
      'termux': ['termux', '終端機', 'com.termux']
    };
  }

  async refreshInstalledApps(force = false) {
    const now = Date.now();
    if (!force && this.cachedApps.length > 0 && (now - this.lastFetchedAt < this.ttlMs)) {
      return this.cachedApps;
    }

    try {
      const resp = await this.deviceClient.sendRequest('/apps', { query: '' });
      if (resp && Array.isArray(resp.matches)) {
        this.cachedApps = resp.matches.map(item => ({
          displayName: item.label,
          packageName: item.package,
          launchable: true,
          aliases: this.generateAliasesForApp(item.label, item.package)
        }));
        this.lastFetchedAt = now;
      }
    } catch (e) {
      console.warn('[AppRegistry] Failed to refresh apps:', e.message);
    }
    return this.cachedApps;
  }

  generateAliasesForApp(label, pkg) {
    const aliases = new Set();
    if (label) {
      aliases.add(label.toLowerCase());
      aliases.add(label.replace(/\s+/g, '').toLowerCase());
    }
    if (pkg) {
      aliases.add(pkg.toLowerCase());
      const suffix = pkg.split('.').pop();
      if (suffix) aliases.add(suffix.toLowerCase());
    }
    for (const [key, list] of Object.entries(this.builtInAliases)) {
      if (pkg && pkg.toLowerCase().includes(key)) {
        list.forEach(a => aliases.add(a.toLowerCase()));
      }
      if (label && label.toLowerCase().includes(key)) {
        list.forEach(a => aliases.add(a.toLowerCase()));
      }
    }
    return Array.from(aliases);
  }

  async resolveApp(query) {
    if (!query) return null;
    const cleanQuery = String(query).trim().toLowerCase();
    const apps = await this.refreshInstalledApps();

    // 1. Direct package match
    const exactPkg = apps.find(a => a.packageName.toLowerCase() === cleanQuery);
    if (exactPkg) return exactPkg;

    // 2. Direct displayName match
    const exactName = apps.find(a => a.displayName.toLowerCase() === cleanQuery);
    if (exactName) return exactName;

    // 3. Alias match
    const aliasMatch = apps.find(a => a.aliases && a.aliases.includes(cleanQuery));
    if (aliasMatch) return aliasMatch;

    // 4. Substring / Token matching
    const substringMatch = apps.find(a =>
      a.displayName.toLowerCase().includes(cleanQuery) ||
      cleanQuery.includes(a.displayName.toLowerCase()) ||
      a.packageName.toLowerCase().includes(cleanQuery)
    );
    if (substringMatch) return substringMatch;

    // 5. Check built-in aliases directly as fallback
    for (const [key, aliasList] of Object.entries(this.builtInAliases)) {
      if (aliasList.some(al => al.toLowerCase() === cleanQuery || cleanQuery.includes(al.toLowerCase()))) {
        const found = apps.find(a => a.packageName.toLowerCase().includes(key));
        if (found) return found;
        return {
          displayName: key.charAt(0).toUpperCase() + key.slice(1),
          packageName: aliasList.find(a => a.includes('.')) || key,
          launchable: true,
          aliases: aliasList
        };
      }
    }

    return null;
  }
}

module.exports = {
  AppRegistry
};
