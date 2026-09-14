#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(rel):
    return (ROOT / rel).read_text()


def write(rel, text):
    (ROOT / rel).write_text(text)


def replace_once(rel, old, new):
    text = read(rel)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{rel}: expected exactly one match, found {count}: {old[:80]!r}')
    write(rel, text.replace(old, new, 1))


def regex_once(rel, pattern, replacement, flags=0):
    text = read(rel)
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{rel}: expected one regex match, found {count}: {pattern[:80]!r}')
    write(rel, next_text)


# server.js: central request security, targeted stop, LAN token status.
replace_once(
    'server.js',
    "const auth = require('./lib/auth');\n",
    "const auth = require('./lib/auth');\nconst { applyCors, authorizeApiRequest, securityStatus } = require('./lib/http-security');\n"
)

regex_once(
    'server.js',
    r"// 🛑 Abort Active Generation\nasync function handleStop\(req, res\) \{[\s\S]*?\n\}\n\n(?=async function handleProviderRename)",
    """// 🛑 Abort Active Generation\nasync function handleStop(req, res) {\n  try {\n    const body = await parseJsonBody(req);\n    const providerId = normalizeProviderId(body.provider);\n    const conversationId = String(body.conversation_id || '').trim();\n    if (conversationId && !/^[a-zA-Z0-9_-]+$/.test(conversationId)) {\n      res.writeHead(400, { 'Content-Type': 'application/json' });\n      return res.end(JSON.stringify({ error: 'Invalid conversation_id' }));\n    }\n    console.log(`[Stop Request] Aborting ${providerId} generation${conversationId ? ` for ${conversationId}` : 's'}...`);\n    const result = await getProvider(providerId).stop(conversationId || null);\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({\n      success: true,\n      conversation_id: conversationId || null,\n      stopped: result?.stopped !== false,\n      message: conversationId ? 'Generation interrupted' : 'All generations interrupted'\n    }));\n  } catch (err) {\n    res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ error: err.message }));\n  }\n}\n\n""",
)

server_text = read('server.js')
start = server_text.find("const server = http.createServer(async (req, res) => {")
route_start = server_text.find("  if (pathname === '/api/conversations'", start)
if start < 0 or route_start < 0:
    raise SystemExit('server.js: could not locate request dispatcher prelude')
new_prelude = """const server = http.createServer(async (req, res) => {\n  const parsedUrl = url.parse(req.url, true);\n  const pathname = parsedUrl.pathname;\n  applyCors(req, res);\n\n  if (req.method === 'OPTIONS') {\n    const origin = String(req.headers.origin || '').trim();\n    if (origin && !res.getHeader('Access-Control-Allow-Origin')) {\n      res.writeHead(403, { 'Content-Type': 'application/json' });\n      return res.end(JSON.stringify({ error: 'Cross-origin API access is not allowed' }));\n    }\n    res.writeHead(204);\n    return res.end();\n  }\n\n  if (pathname.startsWith('/api/')) {\n    const authorization = authorizeApiRequest(req, parsedUrl);\n    if (!authorization.ok) {\n      res.writeHead(authorization.statusCode || 403, { 'Content-Type': 'application/json' });\n      return res.end(JSON.stringify({ error: authorization.error || 'Forbidden' }));\n    }\n  }\n\n"""
server_text = server_text[:start] + new_prelude + server_text[route_start:]
write('server.js', server_text)

replace_once(
    'server.js',
    """server.listen(PORT, HOST, () => {\n  console.log(`=================================================`);\n  console.log(`🚀 Crew Pocket Web UI (Resident Pipe) at: http://${HOST}:${PORT}`);\n  console.log(`=================================================`);\n});""",
    """server.listen(PORT, HOST, () => {\n  console.log(`=================================================`);\n  console.log(`🚀 Crew Pocket Web UI (Resident Pipe) at: http://${HOST}:${PORT}`);\n  const runtimeSecurity = securityStatus();\n  if (runtimeSecurity.tokenRequired) {\n    console.log(`🔐 LAN API token: ${runtimeSecurity.token}`);\n    console.log(`   第一次開啟 LAN UI 時在網址加上 ?token=<上方 token>，之後瀏覽器會記住。`);\n  }\n  console.log(`=================================================`);\n});"""
)

# Session pool: never kill a busy turn to make room.
replace_once(
    'lib/session.js',
    """    if (this.sessions.size >= MAX_SESSIONS) {\n      this._evictLRU();\n    }""",
    """    if (this.sessions.size >= MAX_SESSIONS && !this._evictLRU()) {\n      const error = new Error('All resident sessions are busy; retry after an active turn completes');\n      error.code = 'SESSION_POOL_BUSY';\n      error.statusCode = 409;\n      throw error;\n    }"""
)

replace_once(
    'lib/session.js',
    """    if (oldestKey) {\n      console.log(`[SessionManager] Evicting LRU session: ${oldestKey} (lastUsed: ${new Date(oldest.lastUsedAt).toLocaleTimeString()})`);\n      this.closeSession(oldestKey);\n    } else {\n      // All sessions busy — force evict the oldest anyway\n      for (const [convId, session] of this.sessions) {\n        if (!oldest || session.lastUsedAt < oldest.lastUsedAt) {\n          oldest = session;\n          oldestKey = convId;\n        }\n      }\n      if (oldestKey) {\n        console.log(`[SessionManager] Force evicting oldest busy session: ${oldestKey}`);\n        this.closeSession(oldestKey);\n      }\n    }""",
    """    if (oldestKey) {\n      console.log(`[SessionManager] Evicting LRU session: ${oldestKey} (lastUsed: ${new Date(oldest.lastUsedAt).toLocaleTimeString()})`);\n      this.closeSession(oldestKey);\n      return true;\n    }\n\n    console.log('[SessionManager] Pool is full and every session is busy; refusing to evict an active turn.');\n    return false;"""
)

# Browser bridge: reject arbitrary web origins before upgrading to WebSocket.
replace_once(
    'lib/extension_bridge.js',
    "const { parseJsonBody } = require('./config');\n",
    "const { parseJsonBody } = require('./config');\nconst { authorizeWebSocket } = require('./http-security');\n"
)
replace_once(
    'lib/extension_bridge.js',
    """  function attach(server) {\n    server.on('upgrade', (req, socket) => {\n      if (url.parse(req.url).pathname !== '/api/extension/ws') return socket.destroy();\n      const key = req.headers['sec-websocket-key'];""",
    """  function attach(server) {\n    server.on('upgrade', (req, socket) => {\n      const parsedUrl = url.parse(req.url, true);\n      if (parsedUrl.pathname !== '/api/extension/ws') return socket.destroy();\n      const authorization = authorizeWebSocket(req, parsedUrl);\n      if (!authorization.ok) {\n        const statusCode = authorization.statusCode || 403;\n        const statusText = statusCode === 401 ? 'Unauthorized' : 'Forbidden';\n        const message = authorization.error || statusText;\n        socket.write(`HTTP/1.1 ${statusCode} ${statusText}\\r\\nConnection: close\\r\\nContent-Type: text/plain; charset=utf-8\\r\\nContent-Length: ${Buffer.byteLength(message)}\\r\\n\\r\\n${message}`);\n        socket.destroy();\n        return;\n      }\n      const key = req.headers['sec-websocket-key'];"""
)

# LAN UI token bootstrap: remember ?token= and attach it to same-origin API calls.
app_path = ROOT / 'public/js/app.js'
app_text = app_path.read_text()
marker = '// Crew Pocket API security bootstrap'
if marker in app_text:
    raise SystemExit('public/js/app.js: API bootstrap already present')
bootstrap = """// Crew Pocket API security bootstrap\n(function configureCrewPocketApiAuth() {\n  const params = new URLSearchParams(window.location.search);\n  const queryToken = params.get('token');\n  if (queryToken) {\n    localStorage.setItem('crewApiToken', queryToken);\n    params.delete('token');\n    const remaining = params.toString();\n    const cleanUrl = `${window.location.pathname}${remaining ? `?${remaining}` : ''}${window.location.hash || ''}`;\n    window.history.replaceState(window.history.state, '', cleanUrl);\n  }\n\n  const apiToken = localStorage.getItem('crewApiToken') || '';\n  if (!apiToken) return;\n  const nativeFetch = window.fetch.bind(window);\n  window.fetch = function crewAuthenticatedFetch(input, init = {}) {\n    try {\n      const sourceUrl = input instanceof Request ? input.url : String(input);\n      const targetUrl = new URL(sourceUrl, window.location.href);\n      if (targetUrl.origin === window.location.origin && targetUrl.pathname.startsWith('/api/')) {\n        const headers = new Headers(input instanceof Request ? input.headers : undefined);\n        new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));\n        headers.set('X-Crew-Pocket-Token', apiToken);\n        if (input instanceof Request) {\n          return nativeFetch(new Request(input, { ...init, headers }));\n        }\n        return nativeFetch(input, { ...init, headers });\n      }\n    } catch (_) {}\n    return nativeFetch(input, init);\n  };\n})();\n\n"""
app_path.write_text(bootstrap + app_text)

# Stop only the current conversation rather than every provider turn.
replace_once(
    'public/js/chat.js',
    "await fetch('/api/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: currentProvider }) });",
    "await fetch('/api/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: currentProvider, conversation_id: currentConversationId || null }) });"
)

print('Runtime safety patch applied successfully.')
