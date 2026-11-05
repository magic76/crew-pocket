'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const DEFAULT_INTERVAL_MINUTES = 30;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 24 * 60;
const GIT_UPDATE_TIMEOUT_MS = 120 * 1000;
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
  const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf8') : String(error?.stderr || '');
  let message = [error?.message || error, stderr].filter(Boolean).join(': ');
  message = message
    .replace(/\b(access_token|refresh_token|client_secret|app_secret|token)\s*[=:]\s*[^\s,;]+/gi, '$1=[已隱藏]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [已隱藏]')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://[已隱藏]@')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return message.slice(0, 240) || 'Publisher 執行失敗';
}

class SocialPublisherScheduler {
  constructor({
    homeDir = process.env.HOME || '/data/data/com.termux/files/home',
    projectDir = process.env.CREW_SOCIAL_AGENT_DIR || path.join(homeDir, 'crew-social-agent'),
    storagePath = path.join(homeDir, '.crew-pocket', 'social-publisher-scheduler.json'),
    gitRemote = process.env.SOCIAL_PUBLISHER_GIT_REMOTE || 'origin',
    gitBranch = process.env.SOCIAL_PUBLISHER_GIT_BRANCH || 'main',
    now = Date.now,
    runCommand = null,
    logger = console
  } = {}) {
    this.homeDir = path.resolve(homeDir);
    this.projectDir = path.resolve(projectDir);
    this.storagePath = storagePath;
    this.gitRemote = String(gitRemote || 'origin');
    this.gitBranch = String(gitBranch || 'main');
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
      lastRun: null,
      lastError: null
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
        lastRun: value?.lastRun && typeof value.lastRun === 'object' ? value.lastRun : null,
        lastError: value?.lastError && typeof value.lastError === 'object' ? value.lastError : null
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
        codeUpdate: this.state.lastRun.codeUpdate || null,
        error: this.state.lastRun.error ? safeErrorMessage(this.state.lastRun.error) : null
      } : null,
      lastError: this.state.lastError ? {
        id: String(this.state.lastError.id || ''),
        startedAt: Number(this.state.lastError.startedAt) || null,
        finishedAt: Number(this.state.lastError.finishedAt) || null,
        source: String(this.state.lastError.source || '').slice(0, 24),
        message: safeErrorMessage(this.state.lastError.message),
        codeUpdate: this.state.lastError.codeUpdate || null
      } : null
    };
  }

  async git(args) {
    const result = await execFileAsync('git', args, {
      cwd: this.projectDir,
      timeout: GIT_UPDATE_TIMEOUT_MS,
      maxBuffer: 512 * 1024,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
    });
    return String(result.stdout || '').trim();
  }

  async updatePublisherCode() {
    const checkedAt = this.now();
    try {
      if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(this.gitBranch) || this.gitBranch.includes('..')) {
        throw new Error('Publisher Git branch 設定無效');
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(this.gitRemote)) {
        throw new Error('Publisher Git remote 設定無效');
      }
      const branch = await this.git(['branch', '--show-current']);
      if (branch !== this.gitBranch) {
        throw new Error(`Publisher 目前分支為 ${branch || 'detached'}，預期 ${this.gitBranch}；已停止本輪`);
      }
      const dirty = await this.git(['status', '--porcelain=v1', '--untracked-files=no']);
      if (dirty) {
        const changed = dirty.split('\n').slice(0, 4).map(line => line.slice(3).trim()).filter(Boolean);
        throw new Error(`Publisher 有未提交的追蹤檔案修改，為避免覆蓋已停止本輪${changed.length ? `：${changed.join(', ')}` : ''}`);
      }
      const before = await this.git(['rev-parse', 'HEAD']);
      await this.git(['pull', '--ff-only', this.gitRemote, this.gitBranch]);
      const after = await this.git(['rev-parse', 'HEAD']);
      const pulledHead = await this.git(['rev-parse', 'FETCH_HEAD']);
      if (after !== pulledHead) throw new Error(`Publisher 本機分支不是 ${this.gitRemote}/${this.gitBranch} 的最新版本；已停止本輪`);
      return {
        status: before === after ? 'up_to_date' : 'updated',
        remote: this.gitRemote,
        branch: this.gitBranch,
        from: before.slice(0, 12),
        to: after.slice(0, 12),
        checkedAt: this.now()
      };
    } catch (error) {
      error.publisherCodeUpdate = {
        status: 'failed',
        remote: this.gitRemote,
        branch: this.gitBranch,
        checkedAt: this.now(),
        error: safeErrorMessage(error)
      };
      throw error;
    }
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
        this.state.lastError = {
          id: String(this.state.lastRun.startedAt || this.now()),
          startedAt: Number(this.state.lastRun.startedAt) || null,
          finishedAt: this.now(),
          source: this.state.lastRun.source || 'unknown',
          message: this.state.lastRun.error,
          codeUpdate: this.state.lastRun.codeUpdate || null
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

  async acknowledgeError(errorId = null) {
    await this.ensureStarted();
    if (!errorId) throw new Error('需要提供要標記的錯誤 ID');
    await this.mutate(async () => {
      if (!this.state.lastError) return;
      if (errorId && String(errorId) !== String(this.state.lastError.id || '')) {
        const error = new Error('錯誤狀態已更新，請重新整理後確認');
        error.statusCode = 409;
        throw error;
      }
      this.state.lastError = null;
      await this.persist();
    });
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
        this.state.lastRun = {
          startedAt, finishedAt: null, status: 'running', source,
          codeUpdate: { status: 'checking', remote: this.gitRemote, branch: this.gitBranch, checkedAt: startedAt }
        };
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
    let codeUpdate = null;
    try {
      codeUpdate = await this.updatePublisherCode();
      await this.mutate(async () => {
        if (this.state.lastRun?.startedAt !== startedAt) return;
        this.state.lastRun.codeUpdate = codeUpdate;
        await this.persist();
      });
      const result = await this.runCommand();
      const summary = summarizeRun(result.stdout);
      await this.mutate(async () => {
        const finishedAt = this.now();
        this.state.lastRun = { startedAt, finishedAt, status: 'completed', source, codeUpdate, summary };
        const nextRun = this.state.enabled ? nextRunAfter(finishedAt, this.state.intervalMinutes, summary) : null;
        this.state.nextRunAt = nextRun?.at || null;
        this.state.nextRunReason = nextRun?.reason || null;
        await this.persist();
      });
    } catch (error) {
      codeUpdate = error.publisherCodeUpdate || codeUpdate;
      try {
        await this.mutate(async () => {
          const finishedAt = this.now();
          this.state.lastRun = {
            startedAt, finishedAt, status: 'failed', source,
            codeUpdate,
            error: safeErrorMessage(error)
          };
          this.state.lastError = {
            id: String(startedAt), startedAt, finishedAt, source,
            message: safeErrorMessage(error), codeUpdate
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
