const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const BIND_HOST = String(process.env.CREW_BIND_HOST || '127.0.0.1').trim().toLowerCase();
const TOKEN_DIR = path.join(os.homedir(), '.crew-pocket');
const TOKEN_PATH = path.join(TOKEN_DIR, 'api-token');
const AUTH_COOKIE = 'crew_api_token';
const REMOTE_SESSION_COOKIE = 'crew_remote_session';
const REMOTE_PAIRING_TTL_MS = 2 * 60 * 1000;
const REMOTE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REMOTE_ACTIVE_WINDOW_MS = 2 * 60 * 1000;

// Pairing tickets and remote sessions stay in memory. The persistent API token
// remains an internal compatibility fallback, while new remote browsers use a
// short-lived one-time ticket and receive their own revocable session.
const pairingTickets = new Map();
const remoteSessions = new Map();

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

function appendSetCookie(res, value) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [value]);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, value]);
  } else {
    res.setHeader('Set-Cookie', [existing, value]);
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

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const entry of cookies) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(entry.slice(separator + 1).trim()); }
    catch (_) { return entry.slice(separator + 1).trim(); }
  }
  return '';
}

function cookieToken(req) {
  return cookieValue(req, AUTH_COOKIE);
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
  appendSetCookie(res, `${AUTH_COOKIE}=${encodeURIComponent(API_TOKEN)}; Path=/; Max-Age=2592000; SameSite=Strict`);
  return true;
}

function cleanupRemoteState(now = Date.now()) {
  for (const [ticket, entry] of pairingTickets.entries()) {
    if (!entry || entry.expiresAt <= now) pairingTickets.delete(ticket);
  }
  for (const [token, session] of remoteSessions.entries()) {
    if (!session || session.expiresAt <= now) remoteSessions.delete(token);
  }
}

function createRemotePairing() {
  cleanupRemoteState();
  pairingTickets.clear();
  let ticket = crypto.randomBytes(24).toString('base64url');
  while (pairingTickets.has(ticket)) ticket = crypto.randomBytes(24).toString('base64url');
  const expiresAt = Date.now() + REMOTE_PAIRING_TTL_MS;
  pairingTickets.set(ticket, { expiresAt });
  return { ticket, expiresAt };
}

function normalizeRemoteAddress(address = '') {
  const value = String(address || '').trim();
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

function createRemoteSession(req) {
  const now = Date.now();
  let token = crypto.randomBytes(32).toString('base64url');
  while (remoteSessions.has(token)) token = crypto.randomBytes(32).toString('base64url');
  const session = {
    id: `remote_${crypto.randomBytes(6).toString('hex')}`,
    address: normalizeRemoteAddress(req.socket?.remoteAddress || ''),
    userAgent: String(req.headers['user-agent'] || '').trim().slice(0, 180),
    connectedAt: now,
    lastSeen: now,
    expiresAt: now + REMOTE_SESSION_TTL_MS
  };
  remoteSessions.set(token, { ...session, token });
  return { token, session };
}

function getRemoteSession(req) {
  if (req.crewRemoteSession) {
    req.crewRemoteSession.lastSeen = Date.now();
    return req.crewRemoteSession;
  }
  const candidate = cookieValue(req, REMOTE_SESSION_COOKIE);
  if (!candidate) return null;
  cleanupRemoteState();
  const session = remoteSessions.get(candidate);
  if (!session) return null;
  session.lastSeen = Date.now();
  session.address = normalizeRemoteAddress(req.socket?.remoteAddress || session.address);
  const userAgent = String(req.headers['user-agent'] || '').trim();
  if (userAgent) session.userAgent = userAgent.slice(0, 180);
  return session;
}

function maybeSetPairingCookie(req, res, parsedUrl) {
  if (!TOKEN_REQUIRED) return false;
  const ticket = typeof parsedUrl?.query?.pair === 'string' ? parsedUrl.query.pair.trim() : '';
  if (!ticket) return false;
  cleanupRemoteState();
  const entry = pairingTickets.get(ticket);
  if (!entry || entry.expiresAt <= Date.now()) {
    pairingTickets.delete(ticket);
    return false;
  }
  pairingTickets.delete(ticket);
  const { token, session } = createRemoteSession(req);
  req.crewRemoteSession = session;
  appendSetCookie(res, `${REMOTE_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${Math.floor(REMOTE_SESSION_TTL_MS / 1000)}; SameSite=Lax`);
  return true;
}

function describeRemoteSession(session) {
  return {
    id: session.id,
    address: session.address || '未知裝置',
    userAgent: session.userAgent || '未知瀏覽器',
    connectedAt: session.connectedAt,
    lastSeen: session.lastSeen
  };
}

function getRemoteConnectionSummary(req) {
  cleanupRemoteState();
  const current = getRemoteSession(req);
  const now = Date.now();
  const active = [...remoteSessions.values()]
    .filter(session => now - session.lastSeen <= REMOTE_ACTIVE_WINDOW_MS)
    .sort((a, b) => b.lastSeen - a.lastSeen);
  const localClient = isLoopbackAddress(req.socket?.remoteAddress || '');
  return {
    connectionCount: active.length,
    connections: localClient ? active.map(describeRemoteSession) : [],
    currentConnection: !localClient && current ? describeRemoteSession(current) : null,
    activeWindowSeconds: Math.floor(REMOTE_ACTIVE_WINDOW_MS / 1000)
  };
}

function revokeRemoteConnection(id) {
  const target = String(id || '').trim();
  if (!target) return false;
  for (const [token, session] of remoteSessions.entries()) {
    if (session.id === target) {
      remoteSessions.delete(token);
      return true;
    }
  }
  return false;
}

function revokeAllRemoteConnections() {
  const count = remoteSessions.size;
  remoteSessions.clear();
  pairingTickets.clear();
  return count;
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

  const localClient = isLoopbackAddress(req.socket?.remoteAddress || '');
  return { ok: true, remoteSession: getRemoteSession(req) };
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

  const localClient = isLoopbackAddress(remoteAddress);
  return { ok: true, remoteSession: getRemoteSession(req) };
}

function securityStatus() {
  return {
    bindHost: BIND_HOST,
    tokenRequired: TOKEN_REQUIRED,
    tokenPath: TOKEN_PATH,
    pairingAvailable: TOKEN_REQUIRED
  };
}

module.exports = {
  applyCors,
  authorizeApiRequest,
  authorizeWebSocket,
  maybeSetAuthCookie,
  maybeSetPairingCookie,
  createRemotePairing,
  getRemoteConnectionSummary,
  revokeRemoteConnection,
  revokeAllRemoteConnections,
  securityStatus,
  isLoopbackHost,
  isLoopbackAddress,
  tokenMatches
};
