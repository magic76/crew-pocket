const crypto = require('node:crypto');
const url = require('node:url');
const { parseJsonBody } = require('./config');

function createExtensionBridge({ onInboundMessage }) {
  let extensionSocket = null;
  const collectedLogs = [];
  const apiRecords = [];
  const userMessages = [];
  const pendingCommands = new Map();
  let commandCounter = 1;
  let latestSnapshot = null;

  const remember = (list, item, max = 300) => {
    list.push(item);
    if (list.length > max) list.shift();
  };

  function handle(req, res, pathname) {
    if (pathname === '/api/extension/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'RUNNING', connected: extensionSocket !== null, totalLogs: collectedLogs.length, totalApis: apiRecords.length, totalUserMessages: userMessages.length, timestamp: Date.now() }));
    }
    if (pathname === '/api/extension/messages' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ total: userMessages.length, messages: userMessages.slice(-20) }));
    }
    if (pathname === '/api/extension/apis' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ total: apiRecords.length, recent: apiRecords.slice(-50) }));
    }
    if (pathname === '/api/extension/snapshot' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(latestSnapshot || { status: 'NO_SNAPSHOT_YET' }));
    }
    if (pathname === '/api/extension/logs' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(collectedLogs.slice(-50)));
    }
    if (pathname === '/api/extension/command' && req.method === 'POST') {
      return parseJsonBody(req).then((command) => {
        if (!extensionSocket) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Extension not connected' }));
        }
        const id = `cmd_${commandCounter++}`;
        command.id = id;
        sendWsMessage(extensionSocket, JSON.stringify(command));
        const timeout = setTimeout(() => {
          if (!pendingCommands.has(id)) return;
          pendingCommands.delete(id);
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Command timeout' }));
        }, 8000);
        pendingCommands.set(id, (response) => {
          clearTimeout(timeout);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        });
      }).catch((err) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unknown extension endpoint' }));
  }

  function attach(server) {
    server.on('upgrade', (req, socket) => {
      if (url.parse(req.url).pathname !== '/api/extension/ws') return socket.destroy();
      const key = req.headers['sec-websocket-key'];
      if (!key) return socket.destroy();
      const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`].join('\r\n') + '\r\n\r\n');
      extensionSocket = socket;
      console.log('⚡ [Extension Bridge] Browser extension connected');
      socket.on('data', (buffer) => handleWsFrame(buffer, (text) => { try { handleMessage(JSON.parse(text)); } catch (_) {} }));
      socket.on('close', () => { if (extensionSocket === socket) extensionSocket = null; });
      socket.on('error', () => { if (extensionSocket === socket) extensionSocket = null; });
    });
  }

  function handleMessage(message) {
    if (message.responseTo && pendingCommands.has(message.responseTo)) {
      const resolve = pendingCommands.get(message.responseTo);
      pendingCommands.delete(message.responseTo);
      return resolve(message);
    }
    if (message.type === 'USER_DIRECT_MESSAGE' && message.payload && message.payload.text) {
      remember(userMessages, message.payload, 50);
      onInboundMessage({ ...message.payload, source: 'BrowserExtension' });
    }
    if (message.type === 'PAGE_SNAPSHOT') latestSnapshot = message.payload;
    if (message.type === 'API_RESPONSE' || message.type === 'API_ERROR') remember(apiRecords, message.payload);
    remember(collectedLogs, message);
  }

  return { attach, handle };
}

function sendWsMessage(socket, text) {
  const payload = Buffer.from(text, 'utf8');
  let header;
  if (payload.length <= 125) header = Buffer.from([0x81, payload.length]);
  else if (payload.length <= 65535) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  socket.write(Buffer.concat([header, payload]));
}

function handleWsFrame(buffer, onMessage) {
  if (buffer.length < 2 || (buffer[0] & 0x0f) !== 0x1) return;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
  else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
  if (masked) {
    const mask = buffer.slice(offset, offset + 4); offset += 4;
    const payload = Buffer.from(buffer.slice(offset, offset + length));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    return onMessage(payload.toString('utf8'));
  }
  onMessage(buffer.slice(offset, offset + length).toString('utf8'));
}

module.exports = { createExtensionBridge };
