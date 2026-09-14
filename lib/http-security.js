const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const BIND_HOST = String(process.env.CREW_BIND_HOST || '127.0.0.1').trim().toLowerCase();
const TOKEN_DIR = path.join(os.homedir(), '.crew-pocket');
const TOKEN_PATH = path.join(TOKEN_DIR, 'api-token');
const AUTH_COOKIE = 'crew_api_token';

function isLoopbackHost(hostname = '') {
  return LOOPBACK_HOSTS.has(String(hostname).trim().toLowerCase());
}

function isLoopbackAddress(address = '') {
  const value = String(address || '').toLowerCase();
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function loadOrCreateToken() {
  const configured = String(process.env.CREW_API_TOKEN || '').trim();
  if (configured) return configured;
  try {
    const existing = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
    if (existing) return existing;
  } catch (_) {}

  const generated = crypto.randomBytes(24).toString('base64url');
  try {
    fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(TOKEN_PATH, `${generated}\n`, { mode: 0o600 });
  } catch (err) {
    console.warn('[Security] Could not persist API token:', err.message);
  }
  return generated;
}

const API_TOKEN = loadOrCreateToken();
const TOKEN_REQUIRED = !isLoopbackHost(BIND_HOST);

function requestHostname(req) {
  const host = String(req.headers.host || '').trim();
  if (!host) return '';
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch (_) {
    return host.replace(/^\[/, '').replace(/\](?::\d+)?$/, '').split(':')[0].toLowerCase();
  }
}

function requestPort(req) {
  const host = String(req.headers.host || '').trim();
  try {
    return new URL(`http://${host}`).port || '80';
  } catch (_) {
    const match = host.match(/:(\d+)$/);
    return match ? match[1] : '80';
  }
}

function hostAllowed(req) {
  if (TOKEN_REQUIRED) return true;
  return isLoopbackHost(requestHostname(req));
}

function sameOrigin(req, origin) {
  if (!origin) return true;
  let parsed;
  try { parsed = new URL(origin); } catch (_) { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;

  const reqHost = requestHostname(req);
  const originHost = parsed.hostname.toLowerCase();
  const reqPort = requestPort(req);
  const originPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  if (reqHost === originHost && reqPort === originPort) return true;
  return isLoopbackHost(reqHost) && isLoopbackHost(originHost) && reqPort === originPort;
}

function cookieToken(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const entry of cookies) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() !== AUTH_COOKIE) continue;
    try { return decodeURIComponent(entry.slice(separator + 1).trim()); }
    catch (_) { return entry.slice(separator + 1).trim(); }
  }
  return '';
}

function extractToken(req, parsedUrl = null) {
  const authHeader = String(req.headers.authorization || '');
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();

  const headerToken = String(req.headers['x-crew-pocket-token'] || '').trim();
  if (headerToken) return headerToken;

  const cookie = cookieToken(req);
  if (cookie) return cookie;

  const queryToken = parsedUrl?.query?.token;
  return typeof queryToken === 'string' ? queryToken.trim() : '';
}

function tokenMatches(candidate) {
  if (!candidate || !API_TOKEN) return false;
  const left = Buffer.from(String(candidate));
  const right = Buffer.from(API_TOKEN);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function maybeSetAuthCookie(res, parsedUrl) {
  if (!TOKEN_REQUIRED) return false;
  const queryToken = typeof parsedUrl?.query?.token === 'string' ? parsedUrl.query.token.trim() : '';
  if (!tokenMatches(queryToken)) return false;
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(API_TOKEN)}; Path=/; Max-Age=2592000; SameSite=Strict`);
  return true;
}

function applyCors(req, res) {
  const origin = String(req.headers.origin || '').trim();
  if (hostAllowed(req) && origin && sameOrigin(req, origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Crew-Pocket-Token');
}

function authorizeApiRequest(req, parsedUrl) {
  if (!hostAllowed(req)) {
    return { ok: false, statusCode: 403, error: 'Invalid Crew Pocket host' };
  }

  const origin = String(req.headers.origin || '').trim();
  if (origin && !sameOrigin(req, origin)) {
    return { ok: false, statusCode: 403, error: 'Cross-origin API access is not allowed' };
  }

  if (TOKEN_REQUIRED && !tokenMatches(extractToken(req, parsedUrl))) {
    return { ok: false, statusCode: 401, error: 'Crew Pocket API token required' };
  }

  return { ok: true };
}

function isExtensionOrigin(origin = '') {
  return /^chrome-extension:\/\/[a-z0-9_-]+$/i.test(origin)
    || /^moz-extension:\/\/[a-z0-9_-]+$/i.test(origin);
}

function authorizeWebSocket(req, parsedUrl) {
  const origin = String(req.headers.origin || '').trim();
  const remoteAddress = req.socket?.remoteAddress || '';

  // The bundled browser bridge is a local extension. Keep it zero-config while
  // still rejecting ordinary web pages that attempt to hijack the bridge.
  if (isExtensionOrigin(origin) && isLoopbackAddress(remoteAddress)) return { ok: true };

  if (!hostAllowed(req)) {
    return { ok: false, statusCode: 403, error: 'Invalid Crew Pocket host' };
  }

  if (origin && !sameOrigin(req, origin)) {
    return { ok: false, statusCode: 403, error: 'Untrusted WebSocket origin' };
  }

  if (TOKEN_REQUIRED && !tokenMatches(extractToken(req, parsedUrl))) {
    return { ok: false, statusCode: 401, error: 'Crew Pocket WebSocket token required' };
  }

  if (!origin && !isLoopbackAddress(remoteAddress) && !tokenMatches(extractToken(req, parsedUrl))) {
    return { ok: false, statusCode: 401, error: 'Crew Pocket WebSocket token required' };
  }

  return { ok: true };
}

function securityStatus() {
  return {
    bindHost: BIND_HOST,
    tokenRequired: TOKEN_REQUIRED,
    tokenPath: TOKEN_PATH,
    token: TOKEN_REQUIRED ? API_TOKEN : null
  };
}

module.exports = {
  applyCors,
  authorizeApiRequest,
  authorizeWebSocket,
  maybeSetAuthCookie,
  securityStatus,
  isLoopbackHost,
  tokenMatches
};
