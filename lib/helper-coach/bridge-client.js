'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { URL } = require('node:url');
const { MAX_EVENT_BYTES } = require('./protocol');

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8766';
const BRIDGE_PATHS = new Set([
  '/coach/v1/events', '/coach/v1/advice',
  '/coach/v1/skill-candidate', '/coach/v1/code-change-proposal'
]);

function validSecret(secret) {
  return typeof secret === 'string' && /^[a-fA-F0-9]{64}$/.test(secret);
}

function createRequestSignature(secret, method, requestTarget, timestamp, nonce, rawBody) {
  if (!validSecret(secret)) throw new Error('Invalid Helper Coach pairing secret');
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '');
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  const canonical = `${String(method).toUpperCase()}\n${requestTarget}\n${timestamp}\n${nonce}\n${digest}`;
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(canonical, 'utf8').digest('hex');
}

function parseResponse(raw) {
  try { return JSON.parse(raw.toString('utf8')); }
  catch (_) { throw Object.assign(new Error('Helper Bridge returned invalid JSON'), { code: 'INVALID_JSON' }); }
}

class HelperCoachBridgeClient {
  constructor({ baseUrl = DEFAULT_BRIDGE_URL, now = Date.now, timeoutMs = 3500 } = {}) {
    this.baseUrl = new URL(baseUrl);
    this.now = now;
    this.timeoutMs = timeoutMs;
    if (this.baseUrl.protocol !== 'http:' || this.baseUrl.hostname !== '127.0.0.1' ||
        this.baseUrl.username || this.baseUrl.password || this.baseUrl.pathname !== '/' ||
        this.baseUrl.search || this.baseUrl.hash) {
      throw new Error('Helper Coach Bridge must use a direct 127.0.0.1 HTTP address');
    }
  }

  request(method, requestTarget, secret, rawBody = Buffer.alloc(0), expectedStatus = 200) {
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '');
    if (body.length > MAX_EVENT_BYTES) throw new Error('Helper Coach Bridge request exceeds 32 KiB');
    const parsedTarget = new URL(requestTarget, this.baseUrl);
    const pathname = parsedTarget.pathname;
    if (!BRIDGE_PATHS.has(pathname) || parsedTarget.origin !== this.baseUrl.origin ||
        parsedTarget.hash || parsedTarget.username || parsedTarget.password) {
      throw new Error('Helper Coach Bridge path is not allowlisted');
    }
    const exactTarget = `${parsedTarget.pathname}${parsedTarget.search}`;
    const timestamp = String(this.now());
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const signature = createRequestSignature(secret, method, exactTarget, timestamp, nonce, body);
    const headers = {
      'X-Coach-Timestamp': timestamp,
      'X-Coach-Nonce': nonce,
      'X-Coach-Signature': signature,
      'Accept': 'application/json'
    };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['Content-Length'] = String(body.length);
    }

    return new Promise((resolve, reject) => {
      const req = http.request({
        protocol: 'http:', hostname: '127.0.0.1', port: this.baseUrl.port || 80,
        method, path: exactTarget, headers, agent: false
      }, res => {
        const chunks = [];
        let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_EVENT_BYTES) {
            req.destroy(Object.assign(new Error('Helper Bridge response exceeds 32 KiB'), { code: 'BODY_TOO_LARGE' }));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks, size);
          let json;
          try { json = responseBody.length ? parseResponse(responseBody) : {}; }
          catch (error) { reject(error); return; }
          if (res.statusCode !== expectedStatus) {
            const helperCode = typeof json.error === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(json.error)
              ? json.error : `HTTP_${res.statusCode || 0}`;
            reject(Object.assign(new Error(`Helper Bridge request rejected (${helperCode})`), {
              statusCode: res.statusCode || 0, code: helperCode
            }));
            return;
          }
          resolve({ statusCode: res.statusCode, body: json });
        });
      });
      req.setTimeout(this.timeoutMs, () => req.destroy(Object.assign(new Error('Helper Bridge request timed out'), { code: 'TIMEOUT' })));
      req.on('error', reject);
      if (body.length) req.write(body);
      req.end();
    });
  }

  async getEvents({ secret, sinceEventId = '', limit = 20 }) {
    const cursor = encodeURIComponent(String(sinceEventId || ''));
    const requestTarget = `/coach/v1/events?since_event_id=${cursor}&limit=${Math.min(20, Math.max(1, Number(limit) || 20))}`;
    const response = await this.request('GET', requestTarget, secret);
    return response.body;
  }

  async postAdvice({ secret, advice }) {
    const body = Buffer.from(JSON.stringify(advice));
    const response = await this.request('POST', '/coach/v1/advice', secret, body, 202);
    return response.body;
  }

  async postSkillCandidate({ secret, candidate }) {
    const body = Buffer.from(JSON.stringify(candidate));
    const response = await this.request('POST', '/coach/v1/skill-candidate', secret, body, 202);
    return response.body;
  }

  async postCodeChangeProposal({ secret, proposal }) {
    const body = Buffer.from(JSON.stringify(proposal));
    const response = await this.request('POST', '/coach/v1/code-change-proposal', secret, body, 202);
    return response.body;
  }
}

module.exports = {
  DEFAULT_BRIDGE_URL,
  HelperCoachBridgeClient,
  createRequestSignature,
  validSecret
};
