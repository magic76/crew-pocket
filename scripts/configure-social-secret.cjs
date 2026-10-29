#!/usr/bin/env node
'use strict';

const { createSocialAccounts } = require('../lib/social-accounts');

const platform = String(process.argv[2] || '').trim().toLowerCase();
if (!['facebook', 'threads'].includes(platform)) {
  process.stderr.write('用法：node scripts/configure-social-secret.cjs <facebook|threads>\n');
  process.exit(2);
}

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
  process.stderr.write('請在 Termux 終端機直接執行此命令，App Secret 輸入時不會顯示。\n');
  process.exit(2);
}

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    let value = '';
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = chunk => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('已取消'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value.trim());
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
        } else if (character >= ' ' && character !== '\u0000') {
          value += character;
        }
      }
    };

    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

(async () => {
  try {
    const secret = await readHidden(platform === 'facebook' ? 'Facebook App Secret（隱藏輸入）：' : 'Threads App Secret（隱藏輸入）：');
    if (!secret || secret.length > 512) throw new Error('App Secret 不可空白，且不可超過 512 個字元');
    const accounts = createSocialAccounts();
    await accounts.saveCredentials(platform, { appSecret: secret });
    process.stdout.write('App Secret 已加密儲存在 Termux 本機保管庫，沒有傳入 WebView。\n');
  } catch (error) {
    process.stderr.write(String(error.message || '無法儲存 App Secret') + '\n');
    process.exitCode = 1;
  }
})();
