'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_PATH = path.join(os.homedir(), '.crew-pocket', 'helper-coach-v1.json');
const MAX_EVENTS = 5000;
const MAX_TASKS = 600;
const MAX_NONCES = 2000;
const MAX_PROPOSALS = 200;

function emptyState() {
  return {
    version: 1,
    optedIn: false,
    secret: null,
    pairedAt: null,
    runtimeLastSeenAt: null,
    events: [],
    tasks: {},
    nonces: [],
    codeProposals: []
  };
}

class HelperCoachStore {
  constructor({ storagePath = DEFAULT_PATH } = {}) {
    this.storagePath = storagePath;
    this.queue = Promise.resolve();
  }

  async read() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.storagePath, 'utf8'));
      if (parsed?.version !== 1) return emptyState();
      return {
        ...emptyState(),
        ...parsed,
        events: Array.isArray(parsed.events) ? parsed.events.slice(-MAX_EVENTS) : [],
        tasks: parsed.tasks && typeof parsed.tasks === 'object' && !Array.isArray(parsed.tasks) ? parsed.tasks : {},
        nonces: Array.isArray(parsed.nonces) ? parsed.nonces.slice(-MAX_NONCES) : [],
        codeProposals: Array.isArray(parsed.codeProposals) ? parsed.codeProposals.slice(-MAX_PROPOSALS) : []
      };
    } catch (error) {
      if (error.code === 'ENOENT') return emptyState();
      throw error;
    }
  }

  async write(state) {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true, mode: 0o700 });
    await fs.chmod(path.dirname(this.storagePath), 0o700).catch(() => {});
    const tempPath = `${this.storagePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify({
      ...state,
      events: state.events.slice(-MAX_EVENTS),
      nonces: state.nonces.slice(-MAX_NONCES),
      codeProposals: state.codeProposals.slice(-MAX_PROPOSALS)
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tempPath, this.storagePath);
    await fs.chmod(this.storagePath, 0o600).catch(() => {});
  }

  async mutate(fn) {
    const run = this.queue.then(async () => {
      const state = await this.read();
      const result = await fn(state);
      if (result?.changed !== false) await this.write(state);
      return result?.value;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async snapshot() {
    await this.queue;
    return this.read();
  }
}

module.exports = { HelperCoachStore, DEFAULT_PATH, MAX_EVENTS, MAX_TASKS, MAX_NONCES };
