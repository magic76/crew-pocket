'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

// Recovery metadata is separate from provider histories. Only completed
// operations are saved; a restart must never turn unfinished work into success.
class TurnResultStore {
  constructor({ directory = path.join(process.env.HOME || '/data/data/com.termux/files/home', '.crew-pocket', 'turn-results'),
    now = Date.now, ttlMs = 7 * 24 * 60 * 60_000, maxRecords = 500,
    maxBytes = 32 * 1024 * 1024 } = {}) {
    Object.assign(this, { directory, now, ttlMs, maxRecords, maxBytes });
    this.queue = Promise.resolve();
  }

  file(provider, requestId) {
    if (![provider, requestId].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value))) return null;
    return path.join(this.directory, `${provider}--${requestId}.json`);
  }

  save(record) {
    const target = this.file(record.provider, record.request_id);
    if (!target || record.terminal !== true) return Promise.resolve();
    const data = JSON.stringify(record);
    const work = this.queue.then(async () => {
      if (Buffer.byteLength(data) > this.maxBytes) throw new Error('Turn result exceeds recovery storage limit');
      await fs.mkdir(this.directory, { recursive: true });
      const temp = `${target}.${process.pid}.tmp`;
      try {
        await fs.writeFile(temp, data, { mode: 0o600 });
        await fs.rename(temp, target);
      } finally {
        await fs.rm(temp, { force: true }).catch(() => {});
      }
      await this.prune();
    });
    this.queue = work.catch(() => {});
    return work;
  }

  async get(provider, requestId) {
    const file = this.file(provider, requestId);
    if (!file) return null;
    await this.queue;
    try {
      const stat = await fs.stat(file);
      if (stat.size > this.maxBytes || this.now() - stat.mtimeMs >= this.ttlMs) return null;
      const record = JSON.parse(await fs.readFile(file, 'utf8'));
      return record.provider === provider && record.request_id === requestId && record.terminal === true &&
        record.result?.request_id === requestId ? record : null;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async prune() {
    const names = (await fs.readdir(this.directory)).filter(name => /^[A-Za-z0-9_-]+--[A-Za-z0-9_-]+\.json$/.test(name));
    const files = await Promise.all(names.map(async name => {
      const file = path.join(this.directory, name);
      const stat = await fs.stat(file).catch(() => null);
      return stat ? { file, bytes: stat.size, at: stat.mtimeMs } : null;
    }));
    let count = 0;
    let bytes = 0;
    for (const item of files.filter(Boolean).sort((a, b) => b.at - a.at)) {
      if (this.now() - item.at >= this.ttlMs || count >= this.maxRecords || bytes + item.bytes > this.maxBytes) {
        await fs.rm(item.file, { force: true });
      } else {
        count += 1;
        bytes += item.bytes;
      }
    }
  }
}

module.exports = { TurnResultStore };
