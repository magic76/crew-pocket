'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const DEFAULT_INTERVAL_MINUTES = 30;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 24 * 60;
const RUN_TIMEOUT_MS = 15 * 60 * 1000;

function normalizeInterval(value, fallback = DEFAULT_INTERVAL_MINUTES) {
  const parsed = Number(value);
  const interval = Number.isInteger(parsed) ? parsed : fallback;
  if (interval < MIN_INTERVAL_MINUTES || interval > MAX_INTERVAL_MINUTES) {
    throw new Error(`排程間隔需介於 ${MIN_INTERVAL_MINUTES} 到 ${MAX_INTERVAL_MINUTES} 分鐘`);
  }
  return interval;
}

function summarizeRun(stdout) {
  let result;
  try { result = JSON.parse(String(stdout || '').trim()); }
  catch (_) { throw new Error('Publisher 已執行，但未回傳可辨識的結果；請查看 Termux 執行紀錄'); }

  const countStates = values => {
    const counts = {};
    for (const value of Array.isArray(values) ? values : []) {
      const state = String(value?.state || 'unknown').slice(0, 40);
      counts[state] = (counts[state] || 0) + 1;
    }
    return counts;
  };
  const nextScheduledAt = [...(Array.isArray(result.results) ? result.results : []), ...(Array.isArray(result.videoResults) ? result.videoResults : [])]
    .map(item => Date.parse(String(item?.scheduledAt || '')))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  return {
    queueItems: Math.max(0, Number(result.queueItems) || 0),
    queueErrors: Math.max(0, Number(result.queueErrors) || 0),
    videoHandoffs: Math.max(0, Number(result.videoHandoffs) || 0),
    videoErrors: Math.max(0, Number(result.videoErrors) || 0),
    agentMode: ['live', 'dry_run'].includes(result.agentMode) ? result.agentMode : 'unknown',
    results: countStates(result.results),
    videoResults: countStates(result.videoResults),
    nextScheduledAt: nextScheduledAt ? new Date(nextScheduledAt).toISOString() : null
  };
}

function nextRunAfter(finishedAt, intervalMinutes, summary) {
  const queueAt = Date.parse(String(summary?.nextScheduledAt || ''));
  const fallbackAt = finishedAt + intervalMinutes * 60000;
  if (Number.isFinite(queueAt) && queueAt <= finishedAt) {
    return { at: finishedAt + 1000, reason: 'queue_time' };
  }
  if (Number.isFinite(queueAt) && queueAt > finishedAt && queueAt <= fallbackAt) {
    return { at: queueAt, reason: 'queue_time' };
  }
  return { at: fallbackAt, reason: 'queue_refresh' };
}

function safeErrorMessage(error) {
  let message = String(error?.message || error || 'Publisher 執行失敗');
  message = message
    .replace(/\b(access_token|refresh_token|client_secret|app_secret|token)\s*[=:]\s*[^\s,;]+/gi, '$1=[已隱藏]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [已隱藏]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return message.slice(0, 240) || 'Publisher 執行失敗';
}

class SocialPublisherScheduler {
  constructor({
    homeDir = process.env.HOME || '/data/data/com.termux/files/home',
    projectDir = process.env.CREW_SOCIAL_AGENT_DIR || path.join(homeDir, 'crew-social-agent'),
    storagePath = path.join(homeDir, '.crew-pocket', 'social-publisher-scheduler.json'),
    now = Date.now,
    runCommand = null,
    logger = console
  } = {}) {
    this.homeDir = path.resolve(homeDir);
    this.projectDir = path.resolve(projectDir);
    this.storagePath = storagePath;
    this.now = now;
    this.logger = logger;
    this.scriptPath = path.join(this.projectDir, 'scripts', 'social-agent.mjs');
    this.runCommand = runCommand || (() => execFileAsync(process.execPath, [
      '--env-file=.env', this.scriptPath, 'run-once'
    ], {
      cwd: this.projectDir,
      timeout: RUN_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    }));
    this.state = this.emptyState();
    this.timer = null;
    this.started = false;
    this.startPromise = null;
    this.running = false;
    this.runPromise = null;
    this.mutationQueue = Promise.resolve();
  }

  emptyState() {
    return {
      version: 1,
      enabled: false,
      intervalMinutes: DEFAULT_INTERVAL_MINUTES,
      requestedSchedule: null,
      nextRunAt: null,
      nextRunReason: null,
      lastRun: null
    };
  }

  async readState() {
    try {
      const value = JSON.parse(await fs.readFile(this.storagePath, 'utf8'));
      return {
        ...this.emptyState(),
        enabled: value?.enabled === true,
        intervalMinutes: normalizeInterval(value?.intervalMinutes),
        requestedSchedule: value?.requestedSchedule && typeof value.requestedSchedule === 'object'
          ? value.requestedSchedule : null,
        nextRunAt: Number(value?.nextRunAt) || null,
        nextRunReason: ['queue_time', 'queue_refresh', 'initial_sync', 'recovery'].includes(value?.nextRunReason)
          ? value.nextRunReason : null,
        lastRun: value?.lastRun && typeof value.lastRun === 'object' ? value.lastRun : null
      };
    } catch (error) {
      if (error.code === 'ENOENT') return this.emptyState();
      this.logger.warn('[Social Publisher Scheduler] State load failed:', safeErrorMessage(error));
      return this.emptyState();
    }
  }

  async persist() {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true, mode: 0o700 });
    const tempPath = `${this.storagePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(this.state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tempPath, this.storagePath);
  }

  async mutate(callback) {
    const run = this.mutationQueue.then(callback);
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  async isAvailable() {
    const relative = path.relative(this.homeDir, this.scriptPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
    try {
      await fs.access(this.scriptPath);
      await fs.access(path.join(this.projectDir, '.env'));
      return true;
    } catch (_) {
      return false;
    }
  }

  async status() {
    await this.ensureStarted();
    return {
      available: await this.isAvailable(),
      enabled: this.state.enabled,
      intervalMinutes: this.state.intervalMinutes,
      requestedSchedule: this.state.requestedSchedule,
      nextRunAt: this.state.nextRunAt,
      nextRunReason: this.state.nextRunReason,
      running: this.running,
      lastRun: this.state.lastRun ? {
        startedAt: Number(this.state.lastRun.startedAt) || null,
        finishedAt: Number(this.state.lastRun.finishedAt) || null,
        status: String(this.state.lastRun.status || 'unknown').slice(0, 24),
        source: String(this.state.lastRun.source || '').slice(0, 24),
        summary: this.state.lastRun.summary || null,
        error: this.state.lastRun.error ? safeErrorMessage(this.state.lastRun.error) : null
      } : null
    };
  }

  async requestSchedule({ roleId, intervalMinutes = DEFAULT_INTERVAL_MINUTES } = {}) {
    const interval = normalizeInterval(intervalMinutes);
    const requestedByRoleId = String(roleId || '').trim();
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(requestedByRoleId)) throw new Error('無效的 Role ID');
    if (!(await this.isAvailable())) {
      const error = new Error('找不到 crew-social-agent/scripts/social-agent.mjs 或本機 .env');
      error.statusCode = 503;
      throw error;
    }
    await this.ensureStarted();
    await this.mutate(async () => {
      this.state.requestedSchedule = {
        intervalMinutes: interval,
        requestedByRoleId,
        requestedAt: this.now()
      };
      await this.persist();
    });
    return this.status();
  }

  async ensureStarted() {
    if (this.started) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      this.state = await this.readState();
      if (this.state.lastRun?.status === 'running') {
        this.state.lastRun = {
          ...this.state.lastRun,
          status: 'interrupted',
          finishedAt: this.now(),
          error: 'Pocket Runtime 在 Publisher 工作期間停止；請先確認發布狀態，再手動重跑'
        };
        if (this.state.enabled) {
          this.state.nextRunAt = this.now() + this.state.intervalMinutes * 60000;
          this.state.nextRunReason = 'recovery';
        }
        await this.persist();
      }
      this.started = true;
      this.armTimer();
    })();
    try { await this.startPromise; }
    finally { this.startPromise = null; }
  }

  async enable(intervalMinutes = null) {
    await this.ensureStarted();
    const interval = normalizeInterval(intervalMinutes ?? this.state.requestedSchedule?.intervalMinutes ?? this.state.intervalMinutes);
    if (!(await this.isAvailable())) {
      const error = new Error('Publisher 未設定：確認 crew-social-agent 專案與本機 .env');
      error.statusCode = 503;
      throw error;
    }
    await this.mutate(async () => {
      const scheduleChanged = !this.state.enabled || this.state.intervalMinutes !== interval;
      this.state.enabled = true;
      this.state.intervalMinutes = interval;
      this.state.requestedSchedule = null;
      if (scheduleChanged || !this.state.nextRunAt || this.state.nextRunAt <= this.now()) {
        this.state.nextRunAt = this.now();
        this.state.nextRunReason = 'initial_sync';
      }
      await this.persist();
    });
    this.armTimer();
    return this.status();
  }

  async disable() {
    await this.ensureStarted();
    await this.mutate(async () => {
      this.state.enabled = false;
      this.state.nextRunAt = null;
      this.state.nextRunReason = null;
      await this.persist();
    });
    this.armTimer();
    return this.status();
  }

  async launchRunOnce(source = 'manual') {
    await this.ensureStarted();
    if (this.running) {
      const error = new Error('Publisher 目前正在執行');
      error.statusCode = 409;
      throw error;
    }
    this.running = true;
    const startedAt = this.now();
    try {
      await this.mutate(async () => {
        this.state.lastRun = { startedAt, finishedAt: null, status: 'running', source };
        this.state.nextRunAt = null;
        this.state.nextRunReason = null;
        await this.persist();
      });
    } catch (error) {
      this.running = false;
      if (this.state.enabled && !this.state.nextRunAt) {
        this.state.nextRunAt = this.now() + this.state.intervalMinutes * 60000;
        this.state.nextRunReason = 'queue_refresh';
      }
      this.armTimer();
      throw error;
    }
    this.runPromise = this.completeRun(startedAt, source);
    this.runPromise.catch(error => this.logger.warn('[Social Publisher Scheduler] Run state failed:', safeErrorMessage(error)));
    return this.status();
  }

  async completeRun(startedAt, source) {
    try {
      const result = await this.runCommand();
      const summary = summarizeRun(result.stdout);
      await this.mutate(async () => {
        const finishedAt = this.now();
        this.state.lastRun = { startedAt, finishedAt, status: 'completed', source, summary };
        const nextRun = this.state.enabled ? nextRunAfter(finishedAt, this.state.intervalMinutes, summary) : null;
        this.state.nextRunAt = nextRun?.at || null;
        this.state.nextRunReason = nextRun?.reason || null;
        await this.persist();
      });
    } catch (error) {
      try {
        await this.mutate(async () => {
          const finishedAt = this.now();
          this.state.lastRun = {
            startedAt, finishedAt, status: 'failed', source,
            error: safeErrorMessage(error)
          };
          this.state.nextRunAt = this.state.enabled
            ? finishedAt + this.state.intervalMinutes * 60000 : null;
          this.state.nextRunReason = this.state.enabled ? 'queue_refresh' : null;
          await this.persist();
        });
      } catch (recordError) {
        this.logger.warn('[Social Publisher Scheduler] Could not save failed run:', safeErrorMessage(recordError));
      }
      this.logger.warn('[Social Publisher Scheduler] Run failed:', safeErrorMessage(error));
    } finally {
      this.running = false;
      this.runPromise = null;
      this.armTimer();
    }
  }

  async runOnce(source = 'manual') {
    await this.launchRunOnce(source);
    await this.runPromise;
    return this.status();
  }

  armTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.started || !this.state.enabled || !this.state.nextRunAt) return;
    const delay = Math.max(0, this.state.nextRunAt - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.launchRunOnce('scheduled').catch(error => this.logger.warn('[Social Publisher Scheduler] Scheduled run failed:', safeErrorMessage(error)));
    }, delay);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

const defaultSocialPublisherScheduler = new SocialPublisherScheduler();

module.exports = {
  DEFAULT_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  SocialPublisherScheduler,
  defaultSocialPublisherScheduler,
  normalizeSocialPublisherInterval: normalizeInterval
};
