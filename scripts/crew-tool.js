#!/usr/bin/env node
'use strict';

const http = require('node:http');
const BASE_URL = process.env.CREW_URL || 'http://127.0.0.1:8000';

function fail(message, code = 1) {
  process.stderr.write(String(message || 'Crew tool failed') + '\n');
  process.exit(code);
}

function post(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const target = new URL('/api/crew-tool', BASE_URL);
    const request = http.request({
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; }
        catch (_) { return reject(new Error('Crew runtime returned invalid JSON')); }
        if (response.statusCode >= 400 || data.success === false) {
          return reject(new Error(data.error || ('Crew runtime error (' + response.statusCode + ')')));
        }
        resolve(data);
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

function usage() {
  return [
    'Crew Role messaging',
    '',
    '  crew-tool roles',
    '  crew-tool send <from-role-id> <to-role-id> <message...>',
    '',
    'Only the explicit message text is copied from the sender. The recipient handles it inside their own current conversation.'
  ].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();

  if (command === 'roles' || command === 'list_roles') {
    const data = await post({ action: 'list_roles' });
    for (const role of data.roles || []) {
      let line = role.id + '\t' + role.name;
      if (role.description) line += '\t' + role.description;
      process.stdout.write(line + '\n');
    }
    return;
  }

  if (command === 'send' || command === 'send_message') {
    const fromRoleId = args.shift();
    const toRoleId = args.shift();
    const message = args.join(' ').trim();
    if (!fromRoleId || !toRoleId || !message) fail(usage(), 2);
    const data = await post({
      action: 'send_message',
      from_role_id: fromRoleId,
      to_role_id: toRoleId,
      message
    });
    const sent = data.message;
    process.stdout.write('sent\t' + sent.id + '\t' + sent.toRoleId + '\t' + (sent.toRoleName || sent.toRoleId) + '\n');
    if (data.auto_response) {
      const response = data.auto_response;
      process.stdout.write('auto_response\t' + response.status + (response.reason ? '\t' + response.reason : '') + '\n');
      if (response.reply) {
        process.stdout.write('reply\t' + response.reply.replace(/\s+/g, ' ').trim() + '\n');
      }
      if (response.conversationId) {
        process.stdout.write('recipient_conversation\t' + response.conversationId + '\n');
      }
    }
    return;
  }

  process.stdout.write(usage() + '\n');
  if (command && !['help', '--help', '-h'].includes(command)) process.exitCode = 2;
}

main().catch(error => fail(error.message || error));
