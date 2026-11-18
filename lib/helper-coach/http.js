'use strict';

const { MAX_EVENT_BYTES } = require('./protocol');

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}

function readBoundedRawBody(req, limit = MAX_EVENT_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const cleanup = () => {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = chunk => {
      size += chunk.length;
      if (size > limit) {
        fail(Object.assign(new Error('Coach request payload too large'), { statusCode: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const onError = error => fail(error);
    const onAborted = () => fail(Object.assign(new Error('Coach request was interrupted'), { statusCode: 400 }));
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}

async function readBoundedJson(req, limit = MAX_EVENT_BYTES) {
  const raw = await readBoundedRawBody(req, limit);
  try { return JSON.parse(raw.toString('utf8')); }
  catch (_) { throw Object.assign(new Error('Invalid Helper Coach JSON'), { statusCode: 400 }); }
}

function hasSameOrigin(req) {
  const origin = String(req.headers.origin || '').trim();
  const host = String(req.headers.host || '').trim();
  if (!origin || !host) return false;
  try {
    const source = new URL(origin);
    const target = new URL(`http://${host}`);
    return ['http:', 'https:'].includes(source.protocol) &&
      source.hostname.toLowerCase() === target.hostname.toLowerCase() &&
      (source.port || (source.protocol === 'https:' ? '443' : '80')) === (target.port || '80');
  } catch (_) { return false; }
}

async function handleHelperCoachRoute(req, res, pathname, {
  service,
  codePRService,
  isLoopbackAddress
}) {
  if (!pathname.startsWith('/api/helper-coach/')) return false;
  if (!isLoopbackAddress(req.socket?.remoteAddress || '')) {
    sendJson(res, 403, { success: false, error: 'Helper Coach v1 only accepts requests from this phone.' });
    return true;
  }
  if (req.method === 'POST' && pathname !== '/api/helper-coach/events' && !hasSameOrigin(req)) {
    sendJson(res, 403, { success: false, error: 'Helper Coach settings require a same-origin Crew Pocket action.' });
    return true;
  }
  try {
    if (pathname === '/api/helper-coach/events' && req.method === 'POST') {
      const rawBody = await readBoundedRawBody(req);
      const result = await service.receiveSignedEvent({
        rawBody,
        timestamp: req.headers['x-crew-coach-timestamp'],
        nonce: req.headers['x-crew-coach-nonce'],
        signature: req.headers['x-crew-coach-signature']
      });
      sendJson(res, 200, { success: true, ...result });
      return true;
    }
    if (pathname === '/api/helper-coach/dashboard' && req.method === 'GET') {
      sendJson(res, 200, { success: true, ...(await service.dashboard()) });
      return true;
    }
    if (pathname === '/api/helper-coach/pair' && req.method === 'POST') {
      const result = await service.pair();
      sendJson(res, 201, { success: true, ...result });
      return true;
    }
    if (pathname === '/api/helper-coach/revoke' && req.method === 'POST') {
      sendJson(res, 200, { success: true, ...(await service.revoke()) });
      return true;
    }
    if (pathname === '/api/helper-coach/code-proposals' && req.method === 'POST') {
      const body = await readBoundedJson(req, 32 * 1024);
      const proposal = await service.recordCodeProposal(body);
      sendJson(res, 201, { success: true, proposal });
      return true;
    }
    if (pathname === '/api/helper-coach/code-pr' && req.method === 'POST') {
      const body = await readBoundedJson(req, 72 * 1024);
      const result = await codePRService.openPullRequest(body);
      sendJson(res, 201, { success: true, ...result });
      return true;
    }
    sendJson(res, 404, { success: false, error: 'Unknown Helper Coach route' });
    return true;
  } catch (error) {
    const status = Number(error?.statusCode) || 400;
    sendJson(res, status >= 400 && status <= 599 ? status : 400, {
      success: false,
      error: String(error?.message || 'Helper Coach request failed').slice(0, 220)
    });
    return true;
  }
}

module.exports = { handleHelperCoachRoute, readBoundedRawBody, readBoundedJson, sendJson };
