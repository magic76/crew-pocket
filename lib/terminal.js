const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseJsonBody } = require('./config');
const { findExecutable } = require('./runtime/toolchain');

const sessions = new Map();
const MAX_OUTPUT = 2 * 1024 * 1024;
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function emit(session, type, data) {
  const record = { id: ++session.sequence, type, data };
  const wire = `id: ${record.id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  session.records.push({ ...record, wire }); session.bytes += Buffer.byteLength(wire);
  while (session.bytes > MAX_OUTPUT && session.records.length > 1) session.bytes -= Buffer.byteLength(session.records.shift().wire);
  for (const res of session.clients) {
    if (!res.write(wire)) { session.clients.delete(res); res.end(); }
  }
}
function send(session, type, payload) {
  if (session.ended || !session.child.stdin.writable) throw new Error('Terminal has ended');
  if (session.child.stdin.writableLength > 256 * 1024) throw new Error('Terminal input is busy; retry shortly');
  const frame = Buffer.alloc(5 + payload.length);
  frame.writeUInt32BE(1 + payload.length); frame[4] = type.charCodeAt(0); payload.copy(frame, 5);
  session.child.stdin.write(frame);
}
async function handleTerminal(req, res, parsedUrl) {
  try {
    const route = parsedUrl.pathname.slice('/api/terminal'.length);
    if (route === '' && req.method === 'POST') {
      if (sessions.size >= 3) return json(res, 409, { error: '最多同時開啟三個終端，請先結束舊終端。' });
      const native = process.env.CREW_NATIVE_DIR;
      const helper = findExecutable(native ? path.join(native, 'libcrew_terminal_host.so') : process.env.CREW_TERMINAL_HOST || 'crew-terminal-host');
      const bash = findExecutable('bash');
      if (!helper || !bash) return json(res, 409, { error: '目前 Runtime 尚未提供 Terminal helper，請更新 Runtime APK。' });
      const home = fs.realpathSync(process.env.HOME);
      const cwd = path.join(home, 'projects'); fs.mkdirSync(cwd, { recursive: true });
      const id = crypto.randomBytes(24).toString('hex');
      const child = spawn(helper, [bash], { cwd, env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', PS1: '\\w \\$ ', HISTFILE: path.join(home, '.crew-pocket', 'terminal-history'), BASH_ENV: '' } });
      const session = { child, clients: new Set(), records: [], bytes: 0, sequence: 0, ended: false };
      sessions.set(id, session);
      const finish = (exitCode, error) => {
        if (session.ended) return;
        session.ended = true; emit(session, 'exit', { exitCode, error });
        for (const client of session.clients) client.end(); session.clients.clear();
        setTimeout(() => { if (sessions.get(id) === session) sessions.delete(id); }, 10 * 60 * 1000).unref();
      };
      child.stdout.on('data', data => emit(session, 'output', { bytes: data.toString('base64') }));
      child.stderr.on('data', data => emit(session, 'output', { bytes: data.toString('base64') }));
      child.stdin.on('error', error => finish(null, error.message));
      child.on('error', error => finish(null, error.message)); child.on('close', code => finish(code));
      return json(res, 201, { id, cwd, home });
    }
    const match = route.match(/^\/([a-f0-9]{48})(?:\/(events|input|resize))?$/);
    const session = match && sessions.get(match[1]);
    if (!session) return json(res, 404, { error: '終端已結束或 Runtime 已重新啟動。' });
    if (req.method === 'DELETE' && !match[2]) {
      session.child.stdin.end(); session.child.kill('SIGTERM'); sessions.delete(match[1]);
      return json(res, 200, { success: true });
    }
    if (req.method === 'GET' && !match[2]) return json(res, 200, { ended: session.ended });
    if (req.method === 'GET' && match[2] === 'events') {
      const after = Number(req.headers['last-event-id'] || parsedUrl.query.after || 0);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': connected\n\n');
      if (after && session.records[0]?.id > after + 1) res.write('event: gap\ndata: {}\n\n');
      for (const record of session.records) if (record.id > after && !res.write(record.wire)) { res.end(); return; }
      if (session.ended) { res.end(); return; }
      session.clients.add(res);
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
      res.on('close', () => { clearInterval(heartbeat); session.clients.delete(res); });
      return;
    }
    if (req.method === 'POST' && ['input', 'resize'].includes(match[2])) {
      const body = await parseJsonBody(req);
      if (match[2] === 'input') {
        if (typeof body.data !== 'string' || Buffer.byteLength(body.data) > 60000) return json(res, 400, { error: 'Invalid terminal input' });
        send(session, 'I', Buffer.from(body.data));
      } else {
        if (![body.rows, body.cols].every(v => Number.isInteger(v) && v >= 2 && v <= 500)) return json(res, 400, { error: 'Invalid terminal size' });
        const size = Buffer.alloc(4); size.writeUInt16BE(body.rows); size.writeUInt16BE(body.cols, 2); send(session, 'R', size);
      }
      return json(res, 200, { success: true });
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) { if (!res.headersSent) json(res, 400, { error: error.message }); else res.end(); }
}
module.exports = { handleTerminal, hasActiveTerminals: () => [...sessions.values()].some(session => !session.ended && session.child.exitCode === null && session.child.signalCode === null) };
