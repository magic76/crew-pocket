'use strict';

const crypto = require('node:crypto');
const { defaultHelperCoachStore, MAX_TASKS } = require('./store');
const { ACTIONS, MAX_CLOCK_SKEW_MS, MAX_EVENT_BYTES, isVerifiedOutcome, normalizeEvent, normalizeFeedPage, taskProfile } = require('./protocol');
const { MAX_ADVICE_PER_TASK, diagnoseObservation } = require('./engine');
const { validSecret } = require('./bridge-client');
const { MemoryDerivationType, MemoryScope, MemorySourceType } = require('../memory');

const ROLE_ID = 'role-helper-coach';
const REQUESTS_PER_MINUTE = 60;
const ACTIVE_WINDOW_MS = 60 * 1000;
const POLL_INTERVAL_MS = 2500;
const MAX_PAGES_PER_POLL = 8;
const CODE_PROPOSAL_RE = /^coach-code-[a-f0-9]{12}$/;
const GENERIC_PRECONDITION = 'Helper has an active task in this app and GoalIntent.';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeCode(value) {
  const code = String(value || '').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 64);
  return /^[A-Z][A-Z0-9_]*$/.test(code) ? code : 'UNKNOWN';
}

function safeDecision(value) {
  if (typeof value !== 'string') return null;
  const decision = value.trim();
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(decision) ? decision : null;
}

function labelFor(appPackage, goal) {
  return taskProfile(appPackage, goal)?.label || goal || 'Helper 任務';
}

function publicTask(task, advice = {}) {
  const taskAdvice = Object.values(advice).filter(item => item.taskId === task.taskId)
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  return {
    taskId: task.taskId,
    goal: task.goal || '',
    label: labelFor(task.appPackage, task.goal),
    appPackage: task.appPackage || '—',
    coachSupported: Boolean(taskProfile(task.appPackage, task.goal)),
    stage: task.stage || 'observed',
    retryCount: Number(task.retryCount) || 0,
    maxRetries: MAX_ADVICE_PER_TASK,
    adviceCount: Number(task.adviceCount) || 0,
    lastFailureCause: task.lastFailureCause || null,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    outcome: task.outcome || null,
    eventCount: task.eventIds?.length || 0,
    advice: taskAdvice.map(item => ({
      adviceEventId: item.adviceEventId,
      observationEventId: item.observationEventId,
      actionId: item.actionId,
      status: item.status,
      runtimeActionSuccess: item.runtimeActionSuccess,
      errorCode: item.errorCode || null,
      runtimeDecision: item.runtimeDecision || null,
      createdAt: item.createdAt,
      completedAt: item.completedAt || null
    }))
  };
}

class HelperCoachService {
  constructor({
    store = defaultHelperCoachStore,
    skillRegistry = null,
    memoryProvider = null,
    bridgeClient = null,
    now = Date.now,
    logger = console
  } = {}) {
    this.store = store;
    this.skillRegistry = skillRegistry;
    this.memoryProvider = memoryProvider;
    this.bridgeClient = bridgeClient;
    this.now = now;
    this.logger = logger;
    this.queue = Promise.resolve();
    this.pollRunning = false;
    this.pollTimer = null;
    this.requestTimes = [];
  }

  serial(operation) {
    const run = this.queue.then(operation);
    this.queue = run.catch(() => {});
    return run;
  }

  async pair({ secret } = {}) {
    if (!validSecret(secret)) {
      throw Object.assign(new Error('請輸入 Helper Coach 設定畫面提供的 64 位十六進位配對金鑰。'), { statusCode: 400 });
    }
    return this.serial(async () => {
      const pairedAt = this.now();
      await this.store.mutate(state => {
        state.optedIn = true;
        state.secret = secret.toLowerCase();
        state.pairedAt = pairedAt;
        state.runtimeLastSeenAt = null;
        state.runtimeProtocolAvailable = false;
        state.bridgeCursor = '';
        state.bridgeLastError = null;
        for (const task of Object.values(state.tasks)) {
          if (!['outcome_verified', 'failed', 'aborted'].includes(task.stage)) {
            task.stage = 'aborted';
            task.updatedAt = pairedAt;
            task.abortReason = 'Helper Coach pairing changed; wait for a fresh task observation.';
          }
        }
        state.events = [...state.events, {
          eventId: `coach_${crypto.randomUUID().replace(/-/g, '')}`,
          kind: 'pairing_created', source: 'pocket', at: pairedAt,
          summary: '使用者在本機啟用 Helper Coach Bridge 配對。', stage: 'paired'
        }].slice(-5000);
      });
      return {
        enabled: true,
        pairedAt,
        runtimeConnected: false,
        note: '配對金鑰已保存在 Pocket 私有設定；Pocket 會經 127.0.0.1:8766 輪詢 Helper Coach Bridge。'
      };
    });
  }

  async revoke() {
    return this.serial(async () => {
      const at = this.now();
      await this.store.mutate(state => {
        state.optedIn = false;
        state.secret = null;
        state.pairedAt = null;
        state.runtimeLastSeenAt = null;
        state.runtimeProtocolAvailable = false;
        state.bridgeCursor = '';
        state.bridgeLastReachableAt = null;
        state.bridgeLastError = null;
        for (const task of Object.values(state.tasks)) {
          if (!['outcome_verified', 'failed', 'aborted'].includes(task.stage)) {
            task.stage = 'aborted';
            task.updatedAt = at;
            task.abortReason = 'Helper Coach pairing was revoked.';
          }
        }
        state.events = [...state.events, {
          eventId: `coach_${crypto.randomUUID().replace(/-/g, '')}`,
          kind: 'pairing_revoked', source: 'pocket', at,
          summary: '使用者撤銷 Helper Coach 配對。', stage: 'revoked'
        }].slice(-5000);
      });
      return { enabled: false, runtimeConnected: false };
    });
  }

  startPolling(intervalMs = POLL_INTERVAL_MS) {
    if (this.pollTimer || !this.bridgeClient) return false;
    this.pollTimer = setInterval(() => {
      this.pollBridge().catch(error => this.logger.warn?.('[Helper Coach] Bridge poll failed:', error.code || 'POLL_FAILED'));
    }, intervalMs);
    this.pollTimer.unref?.();
    return true;
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  checkRateLimit(now) {
    this.requestTimes = this.requestTimes.filter(at => now - at < ACTIVE_WINDOW_MS);
    if (this.requestTimes.length >= REQUESTS_PER_MINUTE) throw Object.assign(new Error('Helper Coach Bridge rate limit exceeded'), { statusCode: 429 });
    this.requestTimes.push(now);
  }

  async pollBridge() {
    if (!this.bridgeClient || this.pollRunning) return { skipped: true };
    this.pollRunning = true;
    let processed = 0;
    try {
      let state = await this.store.snapshot();
      if (!state.optedIn || !validSecret(state.secret)) return { skipped: true, reason: 'not_paired' };
      const secret = state.secret;
      let cursor = state.bridgeCursor || '';
      let pages = 0;
      let fetchError = null;
      const batches = [];
      while (pages < MAX_PAGES_PER_POLL) {
        let feed;
        try {
          this.checkRateLimit(this.now());
          feed = normalizeFeedPage(await this.bridgeClient.getEvents({ secret, sinceEventId: cursor, limit: 20 }));
        } catch (error) {
          fetchError = error;
          break;
        }
        pages++;
        const fallbackCursor = feed.events.map(event => event?.event_id)
          .filter(eventId => typeof eventId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(eventId)).at(-1) || cursor;
        const nextCursor = feed.next_cursor || fallbackCursor;
        batches.push({ feed, cursor, nextCursor });
        const cursorAdvanced = nextCursor !== cursor;
        cursor = nextCursor;
        if (!feed.has_more || !cursorAdvanced || !feed.events.length) break;
      }

      // Read the whole bounded feed window before advising. A later outcome in
      // these pages makes earlier observations terminal for coaching purposes.
      const awaitingOutcomeTaskIds = new Set();
      for (const { feed } of batches) {
        for (const rawEvent of feed.events) {
          try {
            const event = normalizeEvent(rawEvent);
            if (event.kind === 'task_outcome' ||
                (event.kind === 'task_observation' && event.result === 'success' && event.error_code === 'RUNTIME_VERIFIED')) {
              awaitingOutcomeTaskIds.add(event.task_id);
            }
          } catch (_) {}
        }
      }

      for (const { feed, cursor: pageCursor, nextCursor } of batches) {
        for (const rawEvent of feed.events) {
          try {
            const result = await this.processRuntimeEvent(rawEvent, secret, { awaitingOutcomeTaskIds });
            if (result.processed) processed++;
          } catch (error) {
            await this.recordRejectedEvent(rawEvent, error);
          }
        }
        await this.store.mutate(current => {
          if (current.optedIn && current.secret === secret) {
            current.bridgeCursor = nextCursor || pageCursor;
            current.bridgeLastReachableAt = this.now();
            current.bridgeLastError = null;
          }
        });
      }

      if (fetchError) {
        const code = safeCode(fetchError?.code || (fetchError?.statusCode ? `HTTP_${fetchError.statusCode}` : 'BRIDGE_UNAVAILABLE'));
        await this.store.mutate(current => { current.bridgeLastError = code; });
        return { skipped: false, pages, processed, error: code };
      }
      return { skipped: false, pages, processed };
    } catch (error) {
      const code = safeCode(error?.code || (error?.statusCode ? `HTTP_${error.statusCode}` : 'BRIDGE_UNAVAILABLE'));
      await this.store.mutate(state => { state.bridgeLastError = code; });
      return { skipped: false, processed, error: code };
    } finally {
      this.pollRunning = false;
    }
  }

  async processRuntimeEvent(rawEvent, expectedSecret, { awaitingOutcomeTaskIds = new Set() } = {}) {
    const event = normalizeEvent(rawEvent);
    let adviceToSend = null;
    let learningOutcome = null;
    let skillCandidate = null;
    let failedOutcome = null;
    const result = await this.serial(async () => this.store.mutate(state => {
      if (!state.optedIn || state.secret !== expectedSecret) return { changed: false, value: { processed: false, eventId: event.event_id } };
      if (state.processedEventIds.includes(event.event_id)) return { changed: false, value: { processed: false, eventId: event.event_id } };

      const now = this.now();
      const task = state.tasks[event.task_id] || null;
      let nextTask = task;
      let summary = '';
      let stage = '';
      if (event.kind === 'task_observation') {
        nextTask = task || {
          taskId: event.task_id,
          appPackage: event.app_package,
          goal: event.goal,
          stage: 'observed',
          observationCount: 0,
          adviceCount: 0,
          retryCount: 0,
          successfulInspectCount: 0,
          awaitingTerminalOutcome: false,
          eventIds: [],
          startedAt: now,
          updatedAt: now,
          outcome: null
        };
        if (task && ((task.appPackage && task.appPackage !== event.app_package) || (task.goal && task.goal !== event.goal))) {
          nextTask = { ...task, stage: 'aborted', updatedAt: now, abortReason: 'Task app or GoalIntent changed; wait for a new task.' };
          summary = '任務 app 或 GoalIntent 改變；停止本次教練建議。';
        } else if (nextTask.outcome) {
          summary = '收到已結束任務的額外觀察；不再送出建議。';
        } else {
          const successfulRuntimeVerification = event.result === 'success' && event.error_code === 'RUNTIME_VERIFIED';
          const awaitingTerminalOutcome = nextTask.awaitingTerminalOutcome === true || successfulRuntimeVerification ||
            awaitingOutcomeTaskIds.has(event.task_id);
          nextTask = { ...nextTask, appPackage: event.app_package, goal: event.goal, observationCount: (nextTask.observationCount || 0) + 1,
            eventIds: [...(nextTask.eventIds || []), event.event_id].slice(-50), updatedAt: now,
            awaitingTerminalOutcome,
            lastFailureCause: event.result === 'failed' ? event.error_code || 'UNKNOWN' : nextTask.lastFailureCause || null };
          for (const pending of Object.values(state.advice)) {
            if (pending.taskId !== event.task_id || !['sending', 'queued', 'acceptance_unknown'].includes(pending.status)) continue;
            const expiry = Number.isFinite(Number(pending.expiresAt))
              ? Number(pending.expiresAt)
              : (Number(pending.createdAt) || 0) + 60_000;
            if (expiry > now) continue;
            pending.status = 'expired_no_result';
            pending.completedAt = now;
            pending.errorCode = 'ADVICE_TTL_EXPIRED';
            state.events = [...state.events, { eventId: `expired_${pending.adviceEventId}`, taskId: event.task_id,
              kind: 'coach_advice_expired', source: 'pocket', at: now,
              summary: '建議已超過 Helper 的 60 秒有效期限，尚未收到 Runtime 終態。', stage: 'expired_no_result' }].slice(-5000);
          }
          const outstanding = Object.values(state.advice).some(item => item.taskId === event.task_id &&
            ['sending', 'queued', 'acceptance_unknown'].includes(item.status));
          const decision = awaitingTerminalOutcome
            ? { stage: 'awaiting_outcome', advice: null, reason: 'Helper has marked this task successful or a terminal outcome is present in the fetched feed; wait for outcome reconciliation.' }
            : outstanding
            ? { stage: 'awaiting_action_result', advice: null, reason: 'A prior advice is still awaiting its Runtime result.' }
            : diagnoseObservation(event, nextTask, now);
          nextTask.stage = decision.stage;
          if (decision.advice) {
            adviceToSend = decision.advice;
            nextTask.adviceCount = (nextTask.adviceCount || 0) + 1;
            if (decision.advice.suggested_action_id === 'retry_previous_safe_tap') nextTask.retryCount = (nextTask.retryCount || 0) + 1;
            state.advice[decision.advice.event_id] = {
              adviceEventId: decision.advice.event_id,
              observationEventId: event.event_id,
              taskId: event.task_id,
              actionId: decision.advice.suggested_action_id,
              expectedPostcondition: decision.advice.expected_postcondition,
              confidence: decision.advice.confidence,
              status: 'sending',
              createdAt: now,
              expiresAt: Date.parse(decision.advice.expires_at),
              diagnosis: decision.advice.diagnosis
            };
          }
          summary = `${labelFor(event.app_package, event.goal)} · 第 ${event.step_index + 1} 個觀察 · ${event.result}${event.error_code ? ` · ${event.error_code}` : ''}`;
          if (decision.reason) summary += ` · ${decision.reason}`;
        }
        nextTask.eventIds = [...(nextTask.eventIds || []), event.event_id].slice(-50);
        nextTask.updatedAt = now;
        stage = nextTask.stage;
      } else if (event.kind === 'coach_action_result') {
        const advice = state.advice[event.advice_event_id];
        if (!advice || advice.taskId !== event.task_id || advice.observationEventId !== event.observation_event_id || advice.actionId !== event.suggested_action_id) {
          summary = '收到無法與本機建議關聯的 Runtime 操作結果；未套用至任務。';
          stage = 'unmatched_action_result';
        } else {
          advice.status = event.status;
          advice.runtimeActionSuccess = event.runtime_action_success;
          advice.errorCode = event.error_code;
          advice.evidenceRefs = event.evidence_refs;
          advice.completedAt = now;
          const successfulInspect = event.suggested_action_id === 'inspect_ui' &&
            event.status === 'executed' && event.runtime_action_success === true;
          nextTask = { ...(task || { taskId: event.task_id, eventIds: [], adviceCount: 0, retryCount: 0 }),
            stage: task?.outcome ? task.stage : task?.awaitingTerminalOutcome ? 'awaiting_outcome' : 'awaiting_observation', updatedAt: now,
            successfulInspectCount: (task?.successfulInspectCount || 0) + (successfulInspect ? 1 : 0),
            eventIds: [...(task?.eventIds || []), event.event_id].slice(-50),
            lastFailureCause: event.status === 'failed' ? event.error_code || 'UNKNOWN' : task?.lastFailureCause || null };
          summary = `Runtime 建議操作 ${event.status}${event.runtime_action_success ? ' · 操作成功' : ''}${event.error_code ? ` · ${event.error_code}` : ''}；任務仍待獨立驗證。`;
          stage = event.status;
        }
      } else {
        nextTask = task || { taskId: event.task_id, appPackage: event.app_package, goal: '', eventIds: [], startedAt: now, adviceCount: 0, retryCount: 0 };
        const verified = isVerifiedOutcome(nextTask, event);
        nextTask = { ...nextTask, appPackage: event.app_package, stage: verified ? 'outcome_verified' : 'failed', updatedAt: now,
          awaitingTerminalOutcome: false,
          eventIds: [...(nextTask.eventIds || []), event.event_id].slice(-50),
          lastFailureCause: verified ? nextTask.lastFailureCause || null : event.error_code || 'VERIFICATION_FAILED',
          outcome: { verified, reportedVerified: event.verified, verificationMethod: event.verification_method,
            durationMs: event.duration_ms, result: event.result || null, errorCode: event.error_code,
            evidenceRefs: event.evidence_refs, eventId: event.event_id, at: now } };
        summary = verified
          ? `Helper 獨立驗證任務完成：${event.verification_method}`
          : `Helper 未驗證任務完成${event.error_code ? ` · ${event.error_code}` : ''}`;
        stage = nextTask.stage;
        const profile = taskProfile(nextTask.appPackage, nextTask.goal);
        if (profile?.verificationMethods?.length) {
          learningOutcome = {
            taskId: nextTask.taskId, goal: nextTask.goal, appPackage: nextTask.appPackage,
            verificationMethod: event.verification_method, evidenceRefs: event.evidence_refs,
            outcomeEventId: event.event_id, eventIds: [...new Set([...(nextTask.eventIds || []), event.event_id])].slice(-40),
            verified
          };
          if (verified) skillCandidate = this.makeSkillCandidate(event, profile);
          else failedOutcome = { task: nextTask, event };
        }
      }

      if (nextTask) state.tasks[event.task_id] = nextTask;
      state.processedEventIds = [...state.processedEventIds, event.event_id].slice(-1000);
      state.runtimeLastSeenAt = now;
      state.runtimeProtocolAvailable = true;
      state.events = [...state.events, { eventId: event.event_id, taskId: event.task_id, kind: event.kind,
        source: 'helper', at: event.timestamp_ms, summary, stage }].slice(-5000);
      const taskIds = Object.keys(state.tasks);
      for (const id of taskIds.slice(0, Math.max(0, taskIds.length - MAX_TASKS))) delete state.tasks[id];
      return { value: { processed: true, eventId: event.event_id } };
    }));

    if (result?.processed && adviceToSend) await this.submitAdvice(adviceToSend, expectedSecret);
    if (result?.processed && learningOutcome) await this.recordLearning(learningOutcome);
    if (result?.processed && skillCandidate) await this.stageSkillCandidate(skillCandidate, expectedSecret);
    if (result?.processed && failedOutcome) await this.ensureCodeReviewSuggestion(failedOutcome.task, failedOutcome.event);
    return result;
  }

  async submitAdvice(advice, secret) {
    if (!this.bridgeClient) return;
    try {
      const current = await this.store.snapshot();
      if (!current.optedIn || current.secret !== secret) return;
      if (current.tasks[advice.task_id]?.awaitingTerminalOutcome) {
        await this.updateAdvice(advice.event_id, 'suppressed_awaiting_outcome', { errorCode: 'TASK_OUTCOME_PENDING' });
        return;
      }
      if (current.tasks[advice.task_id]?.outcome) {
        await this.updateAdvice(advice.event_id, 'suppressed_terminal', { errorCode: 'TASK_ALREADY_TERMINAL' });
        return;
      }
      this.checkRateLimit(this.now());
      const receipt = await this.bridgeClient.postAdvice({ secret, advice });
      const validReceipt = receipt?.protocol_version === 1 && receipt.status === 'accepted' && receipt.queued === true &&
        receipt.advice_event_id === advice.event_id && receipt.observation_event_id === advice.observation_event_id && receipt.task_id === advice.task_id;
      await this.updateAdvice(advice.event_id, validReceipt ? 'queued' : 'acceptance_unknown', {
        receiptEventId: typeof receipt?.event_id === 'string' ? receipt.event_id : null,
        errorCode: validReceipt ? null : 'INVALID_RECEIPT'
      });
    } catch (error) {
      const status = Number(error?.statusCode) || 0;
      const final = status >= 400 && status < 500 ? 'rejected' : 'acceptance_unknown';
      await this.updateAdvice(advice.event_id, final, {
        errorCode: safeCode(error?.code || (status ? `HTTP_${status}` : 'SUBMIT_UNKNOWN')),
        runtimeDecision: safeDecision(error?.runtimeDecision)
      });
    }
  }

  async updateAdvice(adviceEventId, status, extra = {}) {
    return this.serial(() => this.store.mutate(state => {
      const advice = state.advice[adviceEventId];
      if (!advice) return { changed: false };
      if (advice.status !== 'sending') return { changed: false };
      Object.assign(advice, extra, { status, acceptedAt: status === 'queued' ? this.now() : advice.acceptedAt || null });
      if (status !== 'queued') advice.completedAt = this.now();
      const summary = status === 'queued'
        ? `建議已排入 Helper Runtime 佇列；等待 coach_action_result。`
        : status === 'suppressed_awaiting_outcome'
          ? `Pocket 暫停建議，等待 Helper 任務終態${extra.errorCode ? ` · ${extra.errorCode}` : ''}`
        : status === 'suppressed_terminal'
          ? `任務已有終態；Pocket 未送出建議${extra.errorCode ? ` · ${extra.errorCode}` : ''}`
        : status === 'rejected'
          ? `Helper Bridge 拒絕建議${extra.errorCode ? ` · ${extra.errorCode}` : ''}${extra.runtimeDecision ? ` · ${extra.runtimeDecision}` : ''}`
          : `建議送達狀態不明；不自動重送${extra.errorCode ? ` · ${extra.errorCode}` : ''}`;
      state.events = [...state.events, { eventId: adviceEventId, taskId: advice.taskId, kind: 'coach_advice', source: 'pocket',
        at: this.now(), summary, stage: status, actionId: advice.actionId }].slice(-5000);
    }));
  }

  async recordRejectedEvent(rawEvent, error) {
    const eventId = typeof rawEvent?.event_id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(rawEvent.event_id)
      ? rawEvent.event_id : '';
    if (!eventId) return '';
    const kind = typeof rawEvent?.kind === 'string' && /^[a-z_]{1,40}$/.test(rawEvent.kind) ? rawEvent.kind : 'unknown';
    await this.store.mutate(state => {
      if (state.processedEventIds.includes(eventId)) return { changed: false };
      state.processedEventIds = [...state.processedEventIds, eventId].slice(-1000);
      state.events = [...state.events, { eventId, kind: 'rejected_runtime_event', source: 'helper', at: this.now(),
        summary: `忽略不符合 Helper Coach schema 的 ${kind} 事件 (${safeCode(error?.code || 'INVALID_EVENT')})。`, stage: 'rejected' }].slice(-5000);
    });
    return eventId;
  }

  makeSkillCandidate(event, profile) {
    if (!profile.skillPostcondition) return null;
    return {
      protocol_version: 1,
      event_id: crypto.randomUUID(),
      task_id: event.task_id,
      timestamp: new Date(this.now()).toISOString(),
      source: 'pocket',
      kind: 'skill_candidate',
      skill_id: profile.skillId,
      name: profile.skillName,
      app_package: profile.appPackage,
      preconditions: [GENERIC_PRECONDITION, `GoalIntent is ${profile.goal}.`],
      action_sequence: ['inspect_ui'],
      postconditions: [profile.skillPostcondition],
      evidence_refs: event.evidence_refs,
      status: 'candidate'
    };
  }

  async stageSkillCandidate(candidate, secret) {
    const skillId = candidate.skill_id;
    const state = await this.store.snapshot();
    if (!state.optedIn || state.secret !== secret || state.stagedSkillCandidates[skillId]) return;
    await this.store.mutate(current => {
      current.stagedSkillCandidates[skillId] = { status: 'sending', taskId: candidate.task_id, eventId: candidate.event_id, at: this.now() };
    });
    try {
      this.checkRateLimit(this.now());
      const response = await this.bridgeClient.postSkillCandidate({ secret, candidate });
      await this.store.mutate(current => {
        const staged = current.stagedSkillCandidates[skillId];
        if (staged?.eventId === candidate.event_id) Object.assign(staged, { status: response?.success === true ? 'staged' : 'unknown', helperStatus: response?.status || null });
      });
    } catch (error) {
      await this.store.mutate(current => {
        const staged = current.stagedSkillCandidates[skillId];
        if (staged?.eventId === candidate.event_id) Object.assign(staged, { status: 'unknown', errorCode: safeCode(error?.code || 'STAGE_UNKNOWN') });
      });
    }
  }

  async recordLearning(outcome) {
    if (this.skillRegistry?.recordHelperOutcome) {
      try {
        await this.skillRegistry.recordHelperOutcome(ROLE_ID, {
          taskId: outcome.taskId,
          goal: outcome.goal,
          appPackage: outcome.appPackage,
          outcomeEventId: outcome.outcomeEventId,
          evidenceRefs: outcome.evidenceRefs,
          verificationMethod: outcome.verificationMethod,
          sourceEventIds: outcome.eventIds,
          verified: outcome.verified
        });
      } catch (error) {
        this.logger.warn?.('[Helper Coach] Skill provenance save failed:', safeCode(error?.code || 'SKILL_SAVE_FAILED'));
      }
    }
    if (outcome.verified && this.memoryProvider?.retain) {
      try {
        await this.memoryProvider.retain({
          id: `helper-coach-${outcome.outcomeEventId}`,
          text: `Helper 在 ${outcome.appPackage} 完成 ${outcome.goal} 任務；Runtime 使用 ${outcome.verificationMethod} 獨立驗證成功。`,
          scope: MemoryScope.ROLE,
          roleId: ROLE_ID,
          kind: 'experience',
          tags: ['helper-coach', outcome.goal, 'verified-success'],
          importance: 0.72,
          source: 'helper-coach-runtime',
          provenance: {
            sources: [{ type: MemorySourceType.TOOL, id: outcome.outcomeEventId, timestamp: this.now() }],
            derivedFrom: outcome.eventIds.slice(-32),
            derivation: MemoryDerivationType.SYSTEM_OBSERVED
          },
          confidence: 0.96
        });
      } catch (error) {
        this.logger.warn?.('[Helper Coach] Memory provenance save failed:', safeCode(error?.code || 'MEMORY_SAVE_FAILED'));
      }
    }
  }

  async dashboard() {
    const state = await this.store.snapshot();
    const tasks = Object.values(state.tasks).map(task => publicTask(task, state.advice)).sort((a, b) => b.updatedAt - a.updatedAt);
    const supportedTasks = tasks.filter(task => taskProfile(task.appPackage, task.goal));
    const terminal = supportedTasks.filter(task => task.outcome);
    const verifiedCount = terminal.filter(task => task.outcome.verified).length;
    const failedCount = terminal.length - verifiedCount;
    const activeSkills = this.skillRegistry
      ? (await this.skillRegistry.list(ROLE_ID, { withHistory: true })).skills
      : [];
    const events = state.events.slice(-100).reverse();
    const failureCauses = {};
    for (const task of supportedTasks) if (task.lastFailureCause) failureCauses[task.lastFailureCause] = (failureCauses[task.lastFailureCause] || 0) + 1;
    const enabled = Boolean(state.optedIn && validSecret(state.secret));
    const bridgeReachable = Boolean(state.bridgeLastReachableAt && this.now() - state.bridgeLastReachableAt < 15_000);
    const runtimeProtocolAvailable = enabled && state.runtimeProtocolAvailable === true;
    return {
      protocolVersion: 1,
      status: !enabled ? 'not_paired' : bridgeReachable ? (runtimeProtocolAvailable ? 'runtime_connected' : 'bridge_connected_waiting') : 'bridge_unavailable',
      enabled,
      pairedAt: state.pairedAt,
      runtimeLastSeenAt: state.runtimeLastSeenAt,
      runtimeProtocolAvailable,
      bridgeLastReachableAt: state.bridgeLastReachableAt,
      bridgeLastError: state.bridgeLastError,
      helperCompatibility: !enabled
        ? '請從 Helper 的 Crew Experience 複製 64 位 Coach 金鑰，再貼到 Pocket 配對欄。'
        : bridgeReachable
          ? '已連到 Helper 127.0.0.1:8766；事件以 HMAC 輪詢，202 只視為已排隊。'
          : '等待 Helper Coach Bridge 127.0.0.1:8766；Pocket 不會讀取既有 Bridge Token。',
      metrics: {
        observedTasks: supportedTasks.length,
        completedTasks: terminal.length,
        verifiedSuccesses: verifiedCount,
        failedOutcomes: failedCount,
        successRate: terminal.length ? verifiedCount / terminal.length : null,
        retryCount: tasks.reduce((sum, task) => sum + task.retryCount, 0),
        failureCauses
      },
      skills: activeSkills.map(skill => ({
        id: skill.id,
        title: skill.title,
        status: skill.status,
        preconditions: skill.preconditions || [],
        steps: skill.steps || [],
        appPackage: skill.helperScope?.appPackage || null,
        goal: skill.helperScope?.goal || null,
        sourceEventIds: (skill.sourceEventIds || []).slice(-8),
        verification: skill.verification,
        readyForReview: Boolean(skill.helperVerificationReady),
        successRate: (skill.helperEvidence || []).length
          ? skill.helperEvidence.filter(item => item.outcome === 'passed').length / skill.helperEvidence.length : null,
        outcomeCount: (skill.helperEvidence || []).length,
        evidence: (skill.helperEvidence || []).map(item => ({
          taskId: item.taskId, outcomeEventId: item.outcomeEventId, at: item.at,
          verificationMethod: item.verificationMethod, outcome: item.outcome
        }))
      })),
      tasks,
      events,
      advice: Object.values(state.advice).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100),
      codeProposals: state.codeProposals.map(proposal => ({
        id: proposal.id, status: proposal.status, diagnosis: proposal.diagnosis,
        taskId: proposal.taskId, reproductionSteps: proposal.reproductionSteps || [],
        testPlan: proposal.testPlan || [], evidenceEventIds: proposal.evidenceEventIds || [],
        createdAt: proposal.createdAt, prUrl: proposal.prUrl || null,
        helperStageStatus: proposal.helperStageStatus || null
      })).reverse()
    };
  }

  async ensureCodeReviewSuggestion(task, event) {
    const existing = await this.store.snapshot();
    if (existing.codeProposals.some(item => item.taskId === task.taskId)) return;
    const proposal = {
      id: `coach-code-${crypto.randomBytes(6).toString('hex')}`,
      taskId: task.taskId,
      diagnosis: `Helper 回報 ${task.appPackage} 的 ${task.goal} 任務未能獨立驗證（${event.error_code || event.verification_method}）；請先確認是否為 Runtime 缺陷。`,
      reproductionSteps: [`在 ${task.appPackage} 啟動 GoalIntent ${task.goal}。`, `查看事件 ${event.event_id} 及安全錯誤代碼 ${event.error_code || 'UNKNOWN'}。`],
      testPlan: ['檢查 Helper Runtime 對應操作與驗證路徑。', './gradlew testDebugUnitTest --no-daemon'],
      evidenceEventIds: [...new Set([...(task.eventIds || []), event.event_id])].slice(-20),
      repository: 'magic76/crew-helper',
      status: 'needs_code_review',
      createdAt: this.now(),
      source: 'unverified-helper-task-outcome'
    };
    await this.store.mutate(state => {
      if (!state.codeProposals.some(item => item.taskId === task.taskId)) state.codeProposals.push(proposal);
    });
  }

  async recordCodeProposal({ proposalId, taskId, diagnosis, reproductionSteps, testPlan, runtimeDefectConfirmed } = {}) {
    if (runtimeDefectConfirmed !== true) throw Object.assign(new Error('請先明確確認這是 Helper Runtime 程式缺陷，才可建立程式改善提案。'), { statusCode: 400 });
    const clean = (value, max) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
    const state = await this.store.snapshot();
    const namedProposal = proposalId ? state.codeProposals.find(item => item.id === proposalId) : null;
    const resolvedTaskId = String(taskId || namedProposal?.taskId || '');
    const task = state.tasks[resolvedTaskId];
    if (!task || !task.eventIds?.length || task.outcome?.verified !== false) {
      throw Object.assign(new Error('需要一筆 Helper 已回報但未驗證成功的真實任務，才能提出程式改善。'), { statusCode: 409 });
    }
    const existing = state.codeProposals.find(item => item.taskId === task.taskId && item.status === 'needs_code_review');
    const target = proposalId ? namedProposal : existing;
    if (proposalId && (!target || target.status !== 'needs_code_review' || target.taskId !== task.taskId)) {
      throw Object.assign(new Error('這筆 Runtime 缺陷檢查提案已不能編輯。'), { statusCode: 409 });
    }
    const proposal = {
      id: target?.id || `coach-code-${crypto.randomBytes(6).toString('hex')}`,
      taskId: task.taskId,
      diagnosis: clean(diagnosis, 1200),
      reproductionSteps: Array.isArray(reproductionSteps) ? reproductionSteps.slice(0, 8).map(step => clean(step, 240)) : [],
      testPlan: Array.isArray(testPlan) ? testPlan.slice(0, 8).map(step => clean(step, 240)) : [],
      evidenceEventIds: task.eventIds.slice(-20),
      repository: 'magic76/crew-helper',
      status: 'proposal_only',
      runtimeDefectConfirmedByUser: true,
      createdAt: target?.createdAt || this.now(),
      updatedAt: this.now(),
      source: 'user-confirmed-runtime-defect'
    };
    if (proposal.diagnosis.length < 12 || !proposal.reproductionSteps.length || !proposal.testPlan.length) {
      throw Object.assign(new Error('程式提案需要診斷、重現步驟與測試計畫。'), { statusCode: 400 });
    }
    await this.store.mutate(current => {
      const index = current.codeProposals.findIndex(item => item.id === proposal.id);
      if (index >= 0) current.codeProposals[index] = proposal;
      else current.codeProposals.push(proposal);
    });
    return proposal;
  }

  async stageCodeChangeProposal({ proposalId, prUrl, title } = {}) {
    if (!/^https:\/\/github\.com\/magic76\/crew-helper\/(pull\/[1-9][0-9]*|commit\/[a-fA-F0-9]{7,40})\/?$/.test(String(prUrl || ''))) {
      throw Object.assign(new Error('Helper 提案只接受 magic76/crew-helper 的 PR 或 commit 連結。'), { statusCode: 400 });
    }
    const state = await this.store.snapshot();
    const proposal = state.codeProposals.find(item => item.id === proposalId && item.status === 'draft_pr_opened');
    if (!proposal) throw Object.assign(new Error('需要已建立測試完成的 Draft PR 才能通知 Helper。'), { statusCode: 409 });
    if (!this.bridgeClient || !state.optedIn || !validSecret(state.secret)) return { staged: false, reason: 'not_paired' };
    const body = {
      protocol_version: 1,
      event_id: crypto.randomUUID(),
      task_id: proposal.taskId,
      timestamp: new Date(this.now()).toISOString(),
      source: 'pocket',
      kind: 'code_change_proposal',
      repository: 'magic76/crew-helper',
      title: String(title || proposal.diagnosis).slice(0, 120),
      diagnosis: proposal.diagnosis,
      reproduction_steps: proposal.reproductionSteps,
      test_plan: proposal.testPlan,
      proposed_diff_ref: prUrl
    };
    try {
      this.checkRateLimit(this.now());
      const receipt = await this.bridgeClient.postCodeChangeProposal({ secret: state.secret, proposal: body });
      const staged = receipt?.success === true;
      await this.store.mutate(current => {
        const item = current.codeProposals.find(row => row.id === proposal.id);
        if (item) { item.helperStageStatus = staged ? 'pending_review' : 'unknown'; item.helperProposalId = receipt?.proposal_id || null; item.updatedAt = this.now(); }
      });
      return { staged, status: receipt?.status || null, proposalId: receipt?.proposal_id || null };
    } catch (error) {
      await this.store.mutate(current => {
        const item = current.codeProposals.find(row => row.id === proposal.id);
        if (item) { item.helperStageStatus = 'unknown'; item.helperStageError = safeCode(error?.code || 'STAGE_UNKNOWN'); }
      });
      return { staged: false, reason: safeCode(error?.code || 'STAGE_UNKNOWN') };
    }
  }
}

module.exports = {
  HelperCoachService,
  ROLE_ID,
  REQUESTS_PER_MINUTE,
  createSignature: () => { throw new Error('Pocket no longer accepts pushed Helper events. Use HelperCoachBridgeClient request signatures.'); },
  CODE_PROPOSAL_RE,
  MAX_EVENT_BYTES,
  MAX_CLOCK_SKEW_MS
};
