'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const CLIENT_TIMING_DIR = path.join(process.env.HOME || '/data/data/com.termux/files/home', '.crew-pocket');
const CLIENT_TIMING_FILE = path.join(CLIENT_TIMING_DIR, 'client-timing.jsonl');
const MAX_FILE_BYTES = 1024 * 1024;
const KEEP_RECORDS = 1000;
let writeQueue = Promise.resolve();

function duration(value) {
  return Number.isFinite(value) && value >= 0 && value <= 86400000
    ? Math.round(value)
    : null;
}

function count(value, max = 10000000) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
}

function safeLabel(value, maxLength = 80) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]+$/.test(value) && value.length <= maxLength
    ? value
    : null;
}

function normalizeClientTiming(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (typeof input.request_id !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(input.request_id)) return null;

  const clientClasses = new Set(['mobile', 'tablet', 'desktop', 'unknown']);
  const clientShells = new Set(['webview', 'browser', 'unknown']);
  const networkTypes = new Set(['slow-2g', '2g', '3g', '4g', 'unknown']);
  const statuses = new Set(['completed', 'failed', 'interrupted', 'unknown']);
  const executionModes = new Set(['CHAT', 'SURGICAL_EDIT', 'DEBUG', 'BUILD', 'INSPECT']);

  return {
    schema_version: 1,
    recorded_at: Date.now(),
    request_id: input.request_id,
    provider: safeLabel(input.provider, 32),
    model: safeLabel(input.model),
    client_class: clientClasses.has(input.client_class) ? input.client_class : 'unknown',
    client_shell: clientShells.has(input.client_shell) ? input.client_shell : 'unknown',
    network_type: networkTypes.has(input.network_type) ? input.network_type : 'unknown',
    execution_mode: executionModes.has(input.execution_mode) ? input.execution_mode : null,
    status: statuses.has(input.status) ? input.status : 'unknown',
    fetch_headers_ms: duration(input.fetch_headers_ms),
    first_event_ms: duration(input.first_event_ms),
    server_init_ms: duration(input.server_init_ms),
    first_text_ms: duration(input.first_text_ms),
    first_render_ms: duration(input.first_render_ms),
    first_frame_ms: duration(input.first_frame_ms),
    done_event_ms: duration(input.done_event_ms),
    finalize_ui_ms: duration(input.finalize_ui_ms),
    client_total_ms: duration(input.client_total_ms),
    render_total_ms: duration(input.render_total_ms),
    render_max_ms: duration(input.render_max_ms),
    render_count: count(input.render_count),
    chunk_count: count(input.chunk_count),
    response_chars: count(input.response_chars),
    hidden_ms: duration(input.hidden_ms),
    hidden_during_turn: input.hidden_during_turn === true
  };
}

async function appendClientTiming(record) {
  if (!record || record.schema_version !== 1 || !record.request_id) {
    throw new TypeError('Invalid client timing record');
  }
  const line = JSON.stringify(record) + '\n';
  const work = writeQueue.then(async () => {
    await fs.mkdir(CLIENT_TIMING_DIR, { recursive: true });
    let currentBytes = 0;
    try { currentBytes = (await fs.stat(CLIENT_TIMING_FILE)).size; } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    if (currentBytes + Buffer.byteLength(line) > MAX_FILE_BYTES) {
      let existing = '';
      try { existing = await fs.readFile(CLIENT_TIMING_FILE, 'utf8'); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const retained = existing.split('\n').filter(Boolean).slice(-(KEEP_RECORDS - 1));
      retained.push(line.trimEnd());
      const compacted = retained.join('\n') + '\n';
      const temporary = `${CLIENT_TIMING_FILE}.${process.pid}.${Date.now()}.tmp`;
      try {
        await fs.writeFile(temporary, compacted, { mode: 0o600 });
        await fs.rename(temporary, CLIENT_TIMING_FILE);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
      return;
    }

    await fs.appendFile(CLIENT_TIMING_FILE, line, { mode: 0o600 });
  });
  writeQueue = work.catch(() => {});
  return work;
}

module.exports = { normalizeClientTiming, appendClientTiming };
