#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
server = root / 'server.js'
text = server.read_text()

old_import = "const { applyCors, authorizeApiRequest, securityStatus } = require('./lib/http-security');"
new_import = "const { applyCors, authorizeApiRequest, maybeSetAuthCookie, securityStatus } = require('./lib/http-security');"
if text.count(old_import) != 1:
    raise SystemExit('Expected http-security import was not found exactly once')
text = text.replace(old_import, new_import, 1)

old_router = "  const parsedUrl = url.parse(req.url, true);\n  const pathname = parsedUrl.pathname;\n  applyCors(req, res);"
new_router = "  const parsedUrl = url.parse(req.url, true);\n  const pathname = parsedUrl.pathname;\n  maybeSetAuthCookie(res, parsedUrl);\n  applyCors(req, res);"
if text.count(old_router) != 1:
    raise SystemExit('Expected request router prelude was not found exactly once')
text = text.replace(old_router, new_router, 1)

server.write_text(text)
print('LAN cookie compatibility patch applied.')
