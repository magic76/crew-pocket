const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PORT } = require('./config');

const VALID_PLATFORMS = new Set(['facebook', 'threads']);
const GRAPH_VERSION = /^v\d+\.\d+$/.test(String(process.env.CREW_META_GRAPH_VERSION || ''))
  ? String(process.env.CREW_META_GRAPH_VERSION)
  : 'v26.0';
const VAULT_AAD = Buffer.from('crew-pocket-social-v1');
const STATE_TTL_MS = 10 * 60 * 1000;
const READ_TARGET_TTL_MS = 30 * 60 * 1000;
const MAX_READ_TARGETS = 1500;

function socialError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validPlatform(value) {
  const platform = String(value || '').trim().toLowerCase();
  if (!VALID_PLATFORMS.has(platform)) throw socialError('不支援的社群平台');
  return platform;
}

function validObjectId(value, label = '內容') {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(id)) {
    throw socialError(label + '識別碼格式不正確');
  }
  return id;
}

function validCursor(value) {
  const cursor = String(value || '').trim();
  if (cursor.length > 4096) throw socialError('分頁游標格式不正確');
  return cursor;
}

function pageInfo(result = {}) {
  const after = String(result.paging?.cursors?.after || '');
  return {
    after,
    hasMore: Boolean(after && result.paging?.next)
  };
}

function htmlResponse(ok, message) {
  const heading = ok ? '社群帳號授權完成' : '社群帳號授權未完成';
  const color = ok ? '#34d399' : '#fbbf24';
  const safeMessage = String(message || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  return '<!doctype html><html lang="zh-Hant"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="referrer" content="no-referrer"><title>' + heading + '</title>' +
    '<body style="margin:0;background:#0b1020;color:#e2e8f0;font:16px system-ui,sans-serif">' +
    '<main style="max-width:34rem;margin:12vh auto;padding:1.5rem">' +
    '<h1 style="color:' + color + ';font-size:1.35rem">' + heading + '</h1>' +
    '<p>' + safeMessage + '</p><p>請切回 Crew Pocket 並重新整理社群帳號狀態。</p>' +
    '</main></body></html>';
}

function createSocialAccounts(options = {}) {
  const homeDir = path.resolve(options.homeDir || process.env.HOME || '/data/data/com.termux/files/home');
  const stateDir = path.resolve(options.stateDir || process.env.CREW_SOCIAL_DIR || path.join(homeDir, '.crew-pocket', 'social'));
  const vaultPath = path.join(stateDir, 'accounts.enc');
  const keyPath = path.join(stateDir, 'vault.key');
  const configuredBaseUrl = String(options.publicBaseUrl || process.env.CREW_SOCIAL_PUBLIC_BASE_URL || ('http://localhost:' + PORT))
    .trim().replace(/\/$/, '');
  let baseUrl = configuredBaseUrl;
  let baseUrlError = '';
  try {
    const parsedBaseUrl = new URL(configuredBaseUrl);
    if (parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash || parsedBaseUrl.pathname !== '/') {
      throw new Error('CREW_SOCIAL_PUBLIC_BASE_URL 必須是沒有路徑或認證資料的網站 Origin');
    }
    if (parsedBaseUrl.protocol !== 'https:' && !(parsedBaseUrl.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsedBaseUrl.hostname))) {
      throw new Error('社群 OAuth 回呼只能使用 HTTPS，或手機本機 localhost');
    }
  } catch (error) {
    baseUrlError = error.message || '社群 OAuth 回呼網址設定不正確';
    baseUrl = 'http://localhost:' + PORT;
  }

  const pendingStates = new Map();
  const processingStates = new Set();
  const oauthFeedback = new Map();
  const readTargets = new Map();
  const activePublishes = new Set();
  let writeQueue = Promise.resolve();

  function redirectUri(platform) {
    if (baseUrlError) throw socialError(baseUrlError, 500);
    return baseUrl + '/oauth/meta/' + platform + '/callback';
  }

  async function ensureKey() {
    await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    await fs.chmod(stateDir, 0o700).catch(() => {});
    try {
      const key = await fs.readFile(keyPath);
      if (key.length !== 32) throw new Error('Vault key has an invalid length');
      await fs.chmod(keyPath, 0o600).catch(() => {});
      return key;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const key = crypto.randomBytes(32);
      try {
        await fs.writeFile(keyPath, key, { flag: 'wx', mode: 0o600 });
        await fs.chmod(keyPath, 0o600).catch(() => {});
        return key;
      } catch (writeError) {
        if (writeError.code !== 'EEXIST') throw writeError;
        const racedKey = await fs.readFile(keyPath);
        if (racedKey.length !== 32) throw new Error('Vault key has an invalid length');
        return racedKey;
      }
    }
  }

  async function readVault() {
    try {
      const contents = await fs.readFile(vaultPath, 'utf8');
      await fs.chmod(vaultPath, 0o600).catch(() => {});
      const encrypted = JSON.parse(contents);
      if (encrypted.version !== 1 || !encrypted.iv || !encrypted.tag || !encrypted.data) {
        throw new Error('Invalid vault format');
      }
      const key = await ensureKey();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
      decipher.setAAD(VAULT_AAD);
      decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(encrypted.data, 'base64')),
        decipher.final()
      ]).toString('utf8');
      const value = JSON.parse(plain);
      return value && value.version === 1 && value.providers && typeof value.providers === 'object'
        ? value
        : { version: 1, providers: {} };
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, providers: {} };
      throw new Error('無法讀取社群憑證保管庫；請確認本機加密檔與金鑰未被分開或損毀。');
    }
  }

  async function writeVault(vault) {
    const operation = writeQueue.then(async () => {
      await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
      await fs.chmod(stateDir, 0o700).catch(() => {});
      const key = await ensureKey();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(VAULT_AAD);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(vault), 'utf8'),
        cipher.final()
      ]);
      const contents = JSON.stringify({
        version: 1,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: encrypted.toString('base64')
      });
      const temporaryPath = vaultPath + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
      await fs.writeFile(temporaryPath, contents, { mode: 0o600 });
      await fs.chmod(temporaryPath, 0o600).catch(() => {});
      await fs.rename(temporaryPath, vaultPath);
      await fs.chmod(vaultPath, 0o600).catch(() => {});
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }

  function publicProviderStatus(platform, config = {}) {
    const connected = platform === 'facebook'
      ? Boolean(config.userAccessToken)
      : Boolean(config.accessToken);
    const expiresAt = Number(config.expiresAt || 0) || null;
    const feedback = oauthFeedback.get(platform) || config.oauthStatus || { status: 'idle', message: '' };
    const pages = platform === 'facebook' && Array.isArray(config.pages)
      ? config.pages.map(page => ({ id: page.id, name: page.name, tasks: page.tasks || [] }))
      : [];
    const selectedPage = pages.find(page => page.id === config.selectedPageId) || null;
    return {
      platform,
      configured: Boolean(config.appId && config.appSecret),
      appId: config.appId || '',
      hasSecret: Boolean(config.appSecret),
      callbackUrl: baseUrlError ? '' : redirectUri(platform),
      configurationError: baseUrlError,
      connected,
      expired: Boolean(expiresAt && expiresAt <= Date.now()),
      expiresAt,
      identity: platform === 'facebook'
        ? (config.userName || config.userId || '')
        : (config.username ? '@' + config.username : config.userId || ''),
      selectedPage,
      pageCount: pages.length,
      oauth: { ...feedback }
    };
  }

  async function getStatus() {
    const vault = await readVault();
    const providers = vault.providers || {};
    const result = {
      facebook: publicProviderStatus('facebook', providers.facebook || {}),
      threads: publicProviderStatus('threads', providers.threads || {})
    };
    let changed = false;
    for (const platform of VALID_PLATFORMS) {
      const config = providers[platform] || {};
      const pending = config.oauthPending;
      if (pending && pending.expiresAt > Date.now()) {
        result[platform].oauth = { status: 'pending', message: '正在等待 Meta 授權回呼' };
      } else if (pending) {
        delete config.oauthPending;
        config.oauthStatus = { status: 'failed', message: '授權狀態已過期，請重新開始登入' };
        providers[platform] = config;
        result[platform].oauth = { ...config.oauthStatus };
        changed = true;
        for (const [state, entry] of pendingStates) {
          if (entry.platform === platform) pendingStates.delete(state);
        }
      } else if (config.oauthStatus?.status === 'processing') {
        config.oauthStatus = { status: 'failed', message: 'Runtime 曾在完成授權時中斷，請重新開始登入' };
        providers[platform] = config;
        result[platform].oauth = { ...config.oauthStatus };
        changed = true;
      }
    }
    if (vault.providers !== providers) vault.providers = providers;
    if (changed) await writeVault(vault);
    return { providers: result, graphVersion: GRAPH_VERSION };
  }

  async function saveCredentials(platformValue, input = {}) {
    const platform = validPlatform(platformValue);
    const appId = String(input.appId || '').trim();
    if (Object.prototype.hasOwnProperty.call(input, 'appSecret') && typeof input.appSecret !== 'string') {
      throw socialError('Meta App Secret 格式不正確');
    }
    const newSecret = String(input.appSecret || '').trim();
    if (appId && !/^[0-9]{1,32}$/.test(appId)) throw socialError('Meta App ID 格式不正確');
    if (newSecret.length > 512) throw socialError('Meta App Secret 過長');
    const vault = await readVault();
    const current = vault.providers[platform] || {};
    const nextAppId = appId || String(current.appId || '');
    const appChanged = Boolean(appId && current.appId && current.appId !== appId);
    if (!nextAppId) throw socialError('請先在工作台儲存 Meta App ID');
    if (appChanged) {
      delete current.appSecret;
      delete current.userAccessToken;
      delete current.accessToken;
      delete current.userId;
      delete current.userName;
      delete current.username;
      delete current.expiresAt;
      delete current.pages;
      delete current.selectedPageId;
    }
    current.appId = nextAppId;
    if (newSecret) current.appSecret = newSecret;
    delete current.oauthPending;
    current.oauthStatus = { status: 'idle', message: 'App 設定已儲存' };
    vault.providers[platform] = current;
    await writeVault(vault);
    oauthFeedback.set(platform, { status: 'idle', message: 'App 設定已儲存' });
    return (await getStatus()).providers[platform];
  }

  async function beginOAuth(platformValue) {
    const platform = validPlatform(platformValue);
    const vault = await readVault();
    const config = vault.providers[platform] || {};
    if (!config.appId || !config.appSecret) throw socialError('請先儲存 Meta App ID 與 App Secret');
    const state = crypto.randomBytes(32).toString('base64url');
    const callback = redirectUri(platform);
    const scopes = platform === 'facebook'
      ? ['pages_show_list', 'pages_read_engagement', 'pages_read_user_content', 'pages_manage_posts', 'pages_manage_engagement']
      : ['threads_basic', 'threads_content_publish', 'threads_read_replies', 'threads_manage_replies'];
    const authUrl = platform === 'facebook'
      ? new URL('https://www.facebook.com/' + GRAPH_VERSION + '/dialog/oauth')
      : new URL('https://threads.net/oauth/authorize');
    authUrl.searchParams.set('client_id', config.appId);
    authUrl.searchParams.set('redirect_uri', callback);
    authUrl.searchParams.set('scope', scopes.join(','));
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', state);
    const now = Date.now();
    for (const [oldState, entry] of pendingStates) {
      if (entry.expiresAt <= now || entry.platform === platform) pendingStates.delete(oldState);
    }
    const entry = {
      platform,
      appId: config.appId,
      redirectUri: callback,
      expiresAt: now + STATE_TTL_MS
    };
    config.oauthPending = { state, ...entry };
    config.oauthStatus = { status: 'pending', message: '正在等待 Meta 授權回呼' };
    vault.providers[platform] = config;
    await writeVault(vault);
    pendingStates.set(state, entry);
    oauthFeedback.set(platform, { status: 'pending', message: '正在等待 Meta 授權回呼' });
    return { authorizationUrl: authUrl.toString(), callbackUrl: callback, expiresAt: now + STATE_TTL_MS };
  }

  function uncertainPublishError(message, statusCode = 502) {
    const error = socialError(message, statusCode);
    error.publishOutcomeUnknown = true;
    return error;
  }

  async function readJsonResponse(response, { publishRequest = false } = {}) {
    let result = {};
    try { result = await response.json(); }
    catch (_) {
      throw publishRequest
        ? uncertainPublishError('Meta 回傳無法讀取，發布結果尚未確認。請先在平台確認內容是否已發布，再決定是否重試，避免重複發文。')
        : socialError('Meta 回傳的資料格式無法讀取', 502);
    }
    if (!response.ok || result.error) {
      const code = result.error?.code || result.error?.error_subcode || '';
      if (publishRequest && response.status >= 500) {
        throw uncertainPublishError('Meta 伺服器回應異常，發布結果尚未確認。請先在平台確認內容是否已發布，再決定是否重試，避免重複發文。', 502);
      }
      throw socialError('Meta API 呼叫失敗（HTTP ' + response.status + (code ? ', code ' + String(code).slice(0, 24) : '') + '）。請確認 App 權限、帳號授權和目標內容。', 502);
    }
    return result;
  }

  async function fetchWithTimeout(targetUrl, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const { publishRequest = false, ...fetchOptions } = options;
    try {
      return await fetch(targetUrl, { ...fetchOptions, signal: controller.signal, redirect: 'error' });
    } catch (error) {
      if (error.name === 'AbortError') {
        throw publishRequest
          ? uncertainPublishError('Meta 沒有回覆，發布結果尚未確認。請先在平台確認內容是否已發布，再決定是否重試，避免重複發文。', 504)
          : socialError('Meta API 等待逾時，請稍後再試', 504);
      }
      throw publishRequest
        ? uncertainPublishError('連線中斷，發布結果尚未確認。請先在平台確認內容是否已發布，再決定是否重試，避免重複發文。', 502)
        : socialError('目前無法連線到 Meta API', 502);
    } finally {
      clearTimeout(timer);
    }
  }

  async function exchangeFacebookCode(code, config, callback) {
    const shortUrl = new URL('https://graph.facebook.com/' + GRAPH_VERSION + '/oauth/access_token');
    shortUrl.searchParams.set('client_id', config.appId);
    shortUrl.searchParams.set('client_secret', config.appSecret);
    shortUrl.searchParams.set('redirect_uri', callback);
    shortUrl.searchParams.set('code', code);
    const shortToken = await readJsonResponse(await fetchWithTimeout(shortUrl.toString(), { method: 'GET' }));
    if (!shortToken.access_token) throw socialError('Facebook 未回傳登入憑證', 502);

    const longUrl = new URL('https://graph.facebook.com/' + GRAPH_VERSION + '/oauth/access_token');
    longUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longUrl.searchParams.set('client_id', config.appId);
    longUrl.searchParams.set('client_secret', config.appSecret);
    longUrl.searchParams.set('fb_exchange_token', shortToken.access_token);
    const longToken = await readJsonResponse(await fetchWithTimeout(longUrl.toString(), { method: 'GET' }));
    if (!longToken.access_token) throw socialError('Facebook 未回傳長效登入憑證', 502);
    const profileUrl = new URL('https://graph.facebook.com/' + GRAPH_VERSION + '/me');
    profileUrl.searchParams.set('fields', 'id,name');
    const profile = await readJsonResponse(await fetchWithTimeout(profileUrl.toString(), {
      headers: { Authorization: 'Bearer ' + longToken.access_token }
    }));
    return {
      userAccessToken: longToken.access_token,
      userId: String(profile.id || ''),
      userName: String(profile.name || ''),
      expiresAt: Date.now() + Math.max(0, Number(longToken.expires_in || 0)) * 1000,
      pages: []
    };
  }

  async function exchangeThreadsCode(code, config, callback) {
    const form = new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: callback
    });
    const shortToken = await readJsonResponse(await fetchWithTimeout('https://graph.threads.net/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    }));
    if (!shortToken.access_token) throw socialError('Threads 未回傳登入憑證', 502);

    const longUrl = new URL('https://graph.threads.net/access_token');
    longUrl.searchParams.set('grant_type', 'th_exchange_token');
    longUrl.searchParams.set('client_secret', config.appSecret);
    longUrl.searchParams.set('access_token', shortToken.access_token);
    const longToken = await readJsonResponse(await fetchWithTimeout(longUrl.toString(), { method: 'GET' }));
    if (!longToken.access_token) throw socialError('Threads 未回傳長效登入憑證', 502);

    const profileUrl = new URL('https://graph.threads.net/me');
    profileUrl.searchParams.set('fields', 'id,username');
    const profile = await readJsonResponse(await fetchWithTimeout(profileUrl.toString(), {
      headers: { Authorization: 'Bearer ' + longToken.access_token }
    }));
    return {
      accessToken: longToken.access_token,
      userId: String(profile.id || longToken.user_id || ''),
      username: String(profile.username || ''),
      expiresAt: Date.now() + Math.max(0, Number(longToken.expires_in || 0)) * 1000
    };
  }

  async function handleOAuthCallback(platformValue, query = {}) {
    const platform = validPlatform(platformValue);
    const state = String(query.state || '');
    if (!state || processingStates.has(state)) {
      return { ok: false, html: htmlResponse(false, '授權狀態已使用或不符合這次登入，請切回 Crew Pocket 重新開始。') };
    }
    processingStates.add(state);
    try {
      const vault = await readVault();
      const current = vault.providers[platform] || {};
      const pending = current.oauthPending;
      const memoryEntry = pendingStates.get(state);
      const entry = memoryEntry || (pending?.state === state ? pending : null);
      if (!entry || entry.platform !== platform || entry.expiresAt <= Date.now() || pending?.state !== state) {
        if (pending?.state === state) {
          delete current.oauthPending;
          current.oauthStatus = { status: 'failed', message: '授權狀態已過期，請重新開始登入' };
          vault.providers[platform] = current;
          await writeVault(vault);
        }
        return { ok: false, html: htmlResponse(false, '授權狀態已過期或不符合此平台，請切回 Crew Pocket 重新開始。') };
      }
      pendingStates.delete(state);
      delete current.oauthPending;
      current.oauthStatus = { status: 'processing', message: '正在完成 Meta 授權' };
      vault.providers[platform] = current;
      await writeVault(vault);
      if (query.error || query.error_reason) {
        current.oauthStatus = { status: 'failed', message: '你取消了授權或 Meta 拒絕此登入' };
        vault.providers[platform] = current;
        await writeVault(vault);
        oauthFeedback.set(platform, { ...current.oauthStatus });
        return { ok: false, html: htmlResponse(false, '你取消了授權，或 Meta 未接受這次登入。') };
      }
      const code = String(query.code || '');
      if (!code || code.length > 8192) {
        current.oauthStatus = { status: 'failed', message: 'Meta 沒有提供有效授權碼' };
        vault.providers[platform] = current;
        await writeVault(vault);
        oauthFeedback.set(platform, { ...current.oauthStatus });
        return { ok: false, html: htmlResponse(false, 'Meta 沒有提供有效授權碼，請切回 Crew Pocket 重新登入。') };
      }
      if (current.appId !== entry.appId || !current.appSecret) throw socialError('App 設定在授權期間已變更');
      const credentials = platform === 'facebook'
        ? await exchangeFacebookCode(code, current, entry.redirectUri)
        : await exchangeThreadsCode(code, current, entry.redirectUri);
      const latestVault = await readVault();
      const latest = latestVault.providers[platform] || {};
      if (latest.appId !== entry.appId || !latest.appSecret) throw socialError('App 設定在授權期間已變更');
      latestVault.providers[platform] = {
        ...latest,
        ...credentials,
        oauthStatus: { status: 'connected', message: '授權完成' }
      };
      await writeVault(latestVault);
      oauthFeedback.set(platform, { status: 'connected', message: '授權完成' });
      return { ok: true, html: htmlResponse(true, platform === 'facebook' ? 'Facebook 已授權。回到 Crew Pocket 選擇要管理的粉絲專頁。' : 'Threads 已授權。回到 Crew Pocket 載入自己的串文。') };
    } catch (_) {
      const failed = { status: 'failed', message: 'Meta 授權交換失敗，請檢查 App 設定與回呼網址' };
      oauthFeedback.set(platform, failed);
      try {
        const vault = await readVault();
        const current = vault.providers[platform] || {};
        delete current.oauthPending;
        current.oauthStatus = failed;
        vault.providers[platform] = current;
        await writeVault(vault);
      } catch (_) {}
      return { ok: false, html: htmlResponse(false, 'Meta 授權交換失敗。請回到 Crew Pocket 檢查 App ID、App Secret、回呼網址和 Meta App 設定。') };
    } finally {
      processingStates.delete(state);
    }
  }

  async function graphRequest(pathname, token, options = {}) {
    const target = new URL('https://graph.facebook.com/' + GRAPH_VERSION + pathname);
    const method = options.method || 'GET';
    const headers = { Authorization: 'Bearer ' + token };
    let body;
    if (method === 'GET') {
      for (const [key, value] of Object.entries(options.params || {})) target.searchParams.set(key, String(value));
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(options.body || {})) form.set(key, String(value));
      body = form.toString();
    }
    const publishRequest = options.publishRequest === true;
    return readJsonResponse(await fetchWithTimeout(target.toString(), {
      method, headers, body, publishRequest: options.publishRequest === true
    }), { publishRequest });
  }

  async function threadsRequest(pathname, token, options = {}) {
    const target = new URL('https://graph.threads.net/' + pathname);
    const method = options.method || 'GET';
    const headers = { Authorization: 'Bearer ' + token };
    let body;
    if (method === 'GET') {
      for (const [key, value] of Object.entries(options.params || {})) target.searchParams.set(key, String(value));
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(options.body || {})) form.set(key, String(value));
      body = form.toString();
    }
    const publishRequest = options.publishRequest === true;
    return readJsonResponse(await fetchWithTimeout(target.toString(), {
      method, headers, body, publishRequest: options.publishRequest === true
    }), { publishRequest });
  }

  function rememberTarget(platform, type, id, parentId = '') {
    const key = platform + ':' + type + ':' + String(id);
    readTargets.delete(key);
    readTargets.set(key, { platform, type, id: String(id), parentId: String(parentId || ''), expiresAt: Date.now() + READ_TARGET_TTL_MS });
    while (readTargets.size > MAX_READ_TARGETS) readTargets.delete(readTargets.keys().next().value);
  }

  function requireReadTarget(platform, types, id, parentId) {
    const key = platform + ':' + types + ':' + String(id);
    const entry = readTargets.get(key);
    if (!entry || entry.expiresAt <= Date.now() || (parentId && entry.parentId !== String(parentId))) {
      readTargets.delete(key);
      throw socialError('請先在工作台重新載入這則內容，再回覆。', 409);
    }
    return entry;
  }

  async function getFacebookPages(input = {}) {
    const vault = await readVault();
    const config = vault.providers.facebook || {};
    if (!config.userAccessToken) throw socialError('請先連接 Facebook 帳號');
    const after = validCursor(input.after);
    const result = await graphRequest('/me/accounts', config.userAccessToken, {
      params: { fields: 'id,name,access_token,tasks', limit: 100, ...(after ? { after } : {}) }
    });
    const fetchedPages = (Array.isArray(result.data) ? result.data : []).filter(page => page && page.id && page.access_token).map(page => ({
      id: String(page.id), name: String(page.name || '未命名粉絲專頁'),
      accessToken: String(page.access_token), tasks: Array.isArray(page.tasks) ? page.tasks.map(String) : []
    }));
    const pagesById = new Map((after ? config.pages || [] : []).map(page => [page.id, page]));
    for (const page of fetchedPages) pagesById.set(page.id, page);
    config.pages = Array.from(pagesById.values());
    if (!pageInfo(result).hasMore && config.selectedPageId && !config.pages.some(page => page.id === config.selectedPageId)) {
      delete config.selectedPageId;
    }
    vault.providers.facebook = config;
    await writeVault(vault);
    return {
      pages: config.pages.map(page => ({ id: page.id, name: page.name, tasks: page.tasks })),
      paging: pageInfo(result)
    };
  }

  async function selectFacebookPage(input = {}) {
    const pageId = validObjectId(input.pageId, '粉絲專頁');
    const vault = await readVault();
    const config = vault.providers.facebook || {};
    if (!config.userAccessToken) throw socialError('請先連接 Facebook 帳號');
    if (!(config.pages || []).some(page => page.id === pageId && page.accessToken)) {
      throw socialError('請先重新載入粉絲專頁清單');
    }
    config.selectedPageId = pageId;
    vault.providers.facebook = config;
    await writeVault(vault);
    return (await getStatus()).providers.facebook.selectedPage;
  }

  async function getSelectedFacebook(vault) {
    const config = vault.providers.facebook || {};
    const page = (config.pages || []).find(item => item.id === config.selectedPageId && item.accessToken);
    if (!page) throw socialError('請先載入並選擇要管理的 Facebook 粉絲專頁');
    return { config, page };
  }

  async function getFacebookPosts(input = {}) {
    const vault = await readVault();
    const { page } = await getSelectedFacebook(vault);
    const after = validCursor(input.after);
    const result = await graphRequest('/' + validObjectId(page.id, '粉絲專頁') + '/posts', page.accessToken, {
      params: { fields: 'id,message,created_time,permalink_url', limit: 25, ...(after ? { after } : {}) }
    });
    const posts = (Array.isArray(result.data) ? result.data : []).map(post => ({
      id: String(post.id || ''), text: String(post.message || ''), createdAt: String(post.created_time || ''), permalink: String(post.permalink_url || '')
    })).filter(post => post.id);
    posts.forEach(post => rememberTarget('facebook', 'post', post.id, page.id));
    return { posts, page: { id: page.id, name: page.name }, paging: pageInfo(result) };
  }

  async function getFacebookComments(input = {}) {
    const postId = validObjectId(input.postId, '貼文');
    const vault = await readVault();
    const { page } = await getSelectedFacebook(vault);
    requireReadTarget('facebook', 'post', postId, page.id);
    const after = validCursor(input.after);
    const result = await graphRequest('/' + postId + '/comments', page.accessToken, {
      params: {
        fields: 'id,message,from{id,name},created_time',
        limit: 50,
        ...(after ? { after } : {})
      }
    });
    const comments = (Array.isArray(result.data) ? result.data : []).map(comment => {
      rememberTarget('facebook', 'comment', comment.id, page.id);
      return {
        id: String(comment.id || ''), text: String(comment.message || ''),
        author: String(comment.from?.name || 'Facebook 使用者'), createdAt: String(comment.created_time || ''),
        replies: []
      };
    }).filter(comment => comment.id);
    return { comments, postId, paging: pageInfo(result) };
  }

  async function getFacebookCommentReplies(input = {}) {
    const commentId = validObjectId(input.commentId, '留言');
    const vault = await readVault();
    const { page } = await getSelectedFacebook(vault);
    requireReadTarget('facebook', 'comment', commentId, page.id);
    const after = validCursor(input.after);
    const result = await graphRequest('/' + commentId + '/comments', page.accessToken, {
      params: {
        fields: 'id,message,from{id,name},created_time',
        limit: 50,
        ...(after ? { after } : {})
      }
    });
    const replies = (Array.isArray(result.data) ? result.data : []).map(reply => ({
      id: String(reply.id || ''), text: String(reply.message || ''),
      author: String(reply.from?.name || 'Facebook 使用者'), createdAt: String(reply.created_time || '')
    })).filter(reply => reply.id);
    replies.forEach(reply => rememberTarget('facebook', 'comment', reply.id, page.id));
    return { replies, commentId, paging: pageInfo(result) };
  }

  async function getThreadsConfig({ refresh = true } = {}) {
    const vault = await readVault();
    const config = vault.providers.threads || {};
    if (!config.accessToken) throw socialError('請先連接 Threads 帳號');
    if (config.expiresAt && config.expiresAt <= Date.now()) throw socialError('Threads 授權已過期，請重新連接');
    if (refresh && config.expiresAt && config.expiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000) {
      const refreshUrl = new URL('https://graph.threads.net/refresh_access_token');
      refreshUrl.searchParams.set('grant_type', 'th_refresh_token');
      refreshUrl.searchParams.set('access_token', config.accessToken);
      const result = await readJsonResponse(await fetchWithTimeout(refreshUrl.toString()));
      if (result.access_token) config.accessToken = result.access_token;
      if (result.expires_in) config.expiresAt = Date.now() + Number(result.expires_in) * 1000;
      vault.providers.threads = config;
      await writeVault(vault);
    }
    return { vault, config };
  }

  async function getThreadsPosts(input = {}) {
    const { config } = await getThreadsConfig();
    const after = validCursor(input.after);
    const result = await threadsRequest('me/threads', config.accessToken, {
      params: { fields: 'id,text,timestamp,permalink,has_replies,username', limit: 25, ...(after ? { after } : {}) }
    });
    const posts = (Array.isArray(result.data) ? result.data : []).map(post => ({
      id: String(post.id || ''), text: String(post.text || ''), timestamp: String(post.timestamp || ''),
      permalink: String(post.permalink || ''), hasReplies: Boolean(post.has_replies), username: String(post.username || config.username || '')
    })).filter(post => post.id);
    posts.forEach(post => rememberTarget('threads', 'post', post.id, config.userId));
    return { posts, identity: config.username ? '@' + config.username : '', paging: pageInfo(result) };
  }

  async function getThreadsReplies(input = {}) {
    const threadId = validObjectId(input.threadId, '串文');
    const { config } = await getThreadsConfig();
    requireReadTarget('threads', 'post', threadId, config.userId);
    const after = validCursor(input.after);
    const result = await threadsRequest(threadId + '/replies', config.accessToken, {
      params: { fields: 'id,text,timestamp,permalink,username,has_replies,is_reply,root_post,replied_to', reverse: 'false', limit: 50, ...(after ? { after } : {}) }
    });
    const replies = (Array.isArray(result.data) ? result.data : []).map(reply => ({
      id: String(reply.id || ''), text: String(reply.text || ''), timestamp: String(reply.timestamp || ''),
      permalink: String(reply.permalink || ''), username: String(reply.username || ''), hasReplies: Boolean(reply.has_replies)
    })).filter(reply => reply.id);
    replies.forEach(reply => rememberTarget('threads', 'reply', reply.id, threadId));
    return { replies, threadId, paging: pageInfo(result) };
  }

  function normalizePublishText(platform, textValue) {
    const text = String(textValue || '').trim();
    const max = platform === 'threads' ? 500 : 50000;
    if (!text) throw socialError('請先準備要發布的文字');
    if (text.length > max) throw socialError(platform === 'threads' ? 'Threads 文字最多 500 字元' : 'Facebook 貼文超過本工作台支援的長度');
    return text;
  }

  async function publish(input = {}) {
    const platform = validPlatform(input.platform);
    if (input.confirmed !== true) throw socialError('發布必須由使用者在確認畫面明確同意', 403);
    const mode = input.mode === 'reply' ? 'reply' : input.mode === 'post' ? 'post' : '';
    if (!mode) throw socialError('請選擇發布貼文或回覆留言');
    const text = normalizePublishText(platform, input.text);
    const targetId = mode === 'reply' ? validObjectId(input.targetId, '回覆目標') : '';
    const publishKey = platform;
    if (activePublishes.has(publishKey)) throw socialError('此平台已有發布動作進行中', 409);
    activePublishes.add(publishKey);
    try {
      if (platform === 'facebook') {
        const vault = await readVault();
        const { page } = await getSelectedFacebook(vault);
        const tasks = new Set((page.tasks || []).map(task => String(task).toUpperCase()));
        const requiredTasks = mode === 'post' ? ['CREATE_CONTENT', 'MANAGE'] : ['MODERATE', 'MANAGE'];
        if (tasks.size && !requiredTasks.some(task => tasks.has(task))) {
          throw socialError(mode === 'post'
            ? '此粉絲專頁帳號缺少發佈內容的 Page 任務（CREATE_CONTENT 或 MANAGE）'
            : '此粉絲專頁帳號缺少管理留言的 Page 任務（MODERATE 或 MANAGE）', 403);
        }
        let result;
        if (mode === 'post') {
          result = await graphRequest('/' + validObjectId(page.id, '粉絲專頁') + '/feed', page.accessToken, {
            method: 'POST', body: { message: text }, publishRequest: true
          });
        } else {
          if (input.targetType === 'post') requireReadTarget('facebook', 'post', targetId, page.id);
          else requireReadTarget('facebook', 'comment', targetId, page.id);
          result = await graphRequest('/' + targetId + '/comments', page.accessToken, {
            method: 'POST', body: { message: text }, publishRequest: true
          });
        }
        return { platform, mode, id: String(result.id || ''), pageName: page.name };
      }

      const { config } = await getThreadsConfig();
      if (mode === 'reply') {
        const key = 'threads:post:' + targetId;
        if (!readTargets.has(key)) requireReadTarget('threads', 'reply', targetId);
        else requireReadTarget('threads', 'post', targetId, config.userId);
      }
      const container = await threadsRequest('me/threads', config.accessToken, {
        method: 'POST', body: { media_type: 'TEXT', text, ...(mode === 'reply' ? { reply_to_id: targetId } : {}) }
      });
      if (!container.id) throw socialError('Threads 沒有建立發布容器', 502);
      try {
        const published = await threadsRequest('me/threads_publish', config.accessToken, {
          method: 'POST', body: { creation_id: container.id }, publishRequest: true
        });
        return { platform, mode, id: String(published.id || ''), username: config.username || '' };
      } catch (error) {
        if (!error.publishOutcomeUnknown) throw error;
        throw uncertainPublishError('Threads 已建立發布容器，但發布結果未確認。請先到 Threads 檢查是否已發布，再決定是否重試，避免重複發文。', error.statusCode || 502);
      }
    } finally {
      activePublishes.delete(publishKey);
    }
  }

  async function disconnect(platformValue) {
    const platform = validPlatform(platformValue);
    const vault = await readVault();
    const config = vault.providers[platform] || {};
    for (const field of ['userAccessToken', 'accessToken', 'userId', 'userName', 'username', 'expiresAt', 'pages', 'selectedPageId', 'oauthPending']) delete config[field];
    config.oauthStatus = { status: 'idle', message: '已移除此裝置保存的登入憑證' };
    vault.providers[platform] = config;
    await writeVault(vault);
    for (const [key, item] of readTargets) if (item.platform === platform) readTargets.delete(key);
    for (const [state, item] of pendingStates) if (item.platform === platform) pendingStates.delete(state);
    oauthFeedback.set(platform, { status: 'idle', message: '已移除此裝置保存的登入憑證' });
    return (await getStatus()).providers[platform];
  }

  return {
    getStatus,
    saveCredentials,
    beginOAuth,
    handleOAuthCallback,
    getFacebookPages,
    selectFacebookPage,
    getFacebookPosts,
    getFacebookComments,
    getFacebookCommentReplies,
    getThreadsPosts,
    getThreadsReplies,
    publish,
    disconnect,
    callbackHtml: htmlResponse
  };
}

module.exports = { createSocialAccounts };
