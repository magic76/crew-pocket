// Crew Pocket Termux Bridge Server with In-Page Direct Messenger
const http = require('http');
const crypto = require('crypto');

const PORT = 8765;
let extensionSocket = null;
const collectedLogs = [];
const apiRecords = [];
const userMessages = [];
const pendingPromises = new Map();
let cmdIdCounter = 1;
let latestSnapshot = null;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /status
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'RUNNING',
      connected: extensionSocket !== null,
      totalLogs: collectedLogs.length,
      totalApis: apiRecords.length,
      totalUserMessages: userMessages.length,
      timestamp: Date.now()
    }));
    return;
  }

  // GET /messages (Get messages typed directly on web page by user)
  if (req.url === '/messages') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total: userMessages.length,
      messages: userMessages.slice(-20)
    }));
    return;
  }

  // GET /apis
  if (req.url === '/apis') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ total: apiRecords.length, recent: apiRecords.slice(-50) }));
    return;
  }

  // GET /snapshot
  if (req.url === '/snapshot') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(latestSnapshot || { status: 'NO_SNAPSHOT_YET' }));
    return;
  }

  // GET /logs
  if (req.url === '/logs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(collectedLogs.slice(-50)));
    return;
  }

  // POST /command
  if (req.url === '/command' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const cmd = JSON.parse(body);
        if (!extensionSocket) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Extension not connected' }));
          return;
        }

        const id = 'cmd_' + (cmdIdCounter++);
        cmd.id = id;

        sendWsMessage(extensionSocket, JSON.stringify(cmd));

        const timeout = setTimeout(() => {
          if (pendingPromises.has(id)) {
            pendingPromises.delete(id);
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Command timeout' }));
          }
        }, 8000);

        pendingPromises.set(id, (resp) => {
          clearTimeout(timeout);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(resp));
        });

      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const digest = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${digest}`
  ];

  socket.write(headers.join('\r\n') + '\r\n\r\n');
  extensionSocket = socket;
  console.log('⚡ [Bridge] Lemur Browser Extension connected!');

  socket.on('data', (buffer) => {
    handleWsFrame(buffer, (msgStr) => {
      try {
        const msg = JSON.parse(msgStr);
        if (msg.responseTo && pendingPromises.has(msg.responseTo)) {
          const resolve = pendingPromises.get(msg.responseTo);
          pendingPromises.delete(msg.responseTo);
          resolve(msg);
        } else {
          if (msg.type === 'USER_DIRECT_MESSAGE') {
            userMessages.push(msg.payload);
            console.log(`\n💬 [收到網頁直接打字訊息] "${msg.payload.text}" 來自: ${msg.payload.url}`);
            
            // Forward to Crew Pocket Web Chat on port 8000
            try {
              const postData = JSON.stringify(msg.payload);
              const fReq = http.request({
                hostname: '127.0.0.1',
                port: 8000,
                path: '/api/inbound-message',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(postData)
                }
              });
              fReq.on('error', () => {});
              fReq.write(postData);
              fReq.end();
            } catch (e) {}
          }
          if (msg.type === 'PAGE_SNAPSHOT') {
            latestSnapshot = msg.payload;
          }
          if (msg.type === 'API_RESPONSE' || msg.type === 'API_ERROR') {
            apiRecords.push(msg.payload);
            if (apiRecords.length > 300) apiRecords.shift();
          }
          collectedLogs.push(msg);
          if (collectedLogs.length > 300) collectedLogs.shift();
        }
      } catch (e) {}
    });
  });

  socket.on('close', () => {
    if (extensionSocket === socket) extensionSocket = null;
  });

  socket.on('error', () => {});
});

function sendWsMessage(socket, text) {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;
  let header;

  if (length <= 125) {
    header = Buffer.from([0x81, length]);
  } else if (length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}

function handleWsFrame(buffer, onMessage) {
  if (buffer.length < 2) return;
  const isMasked = (buffer[1] & 0x80) === 0x80;
  let payloadLen = buffer[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  if (isMasked) {
    const maskKey = buffer.slice(offset, offset + 4);
    offset += 4;
    const payload = buffer.slice(offset, offset + payloadLen);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i % 4];
    }
    onMessage(payload.toString('utf8'));
  } else {
    const payload = buffer.slice(offset, offset + payloadLen);
    onMessage(payload.toString('utf8'));
  }
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Bridge Server with In-Page Messenger active on :${PORT}`);
});
