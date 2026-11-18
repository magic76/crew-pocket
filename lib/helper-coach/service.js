'use strict';

const crypto = require('node:crypto');
const { defaultHelperCoachStore, MAX_TASKS } = require('./store');
const { TASKS, MAX_CLOCK_SKEW_MS, MAX_EVENT_BYTES, normalizeEvent } = require('./protocol');
const { ADVICE_TTL_MS, MAX_ADVICE_PER_TASK, diagnoseObservation, isVerifiedOutcome } = require('./engine');
const { MemoryDerivationType, MemoryScope, MemorySourceType } = require('../memory');

const ROLE_ID = 'role-helper-coach';
const MAX_RETRIES = 3;
const REQUESTS_PER_MINUTE = 60;
const ACTIVE_WINDOW_MS = 60 * 1000;
const CODE_PROPOSAL_RE = /^coach-code-[a-f0-9]{12}$/;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createSignature(secret, timestamp, nonce, rawBody) {
  return crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\n`)
    .update(rawBody)
    .digest('hex');
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(String(left || '')) || !/^[a-f0-9]{64}$/i.test(String(right || ''))) return false;
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cleanFailureCause(code) {
  return String(code || 'UNKNOWN').replace(/[^A-Z0-9_]/g, '').slice(0, 64) || 'UNKNOWN';
}

function publicTask(task) {
  return {
    taskId: task.taskId,
    taskType: task.taskType,
    label: TASKS[task.taskType]?.label || task.taskType,
    appPackage: task.appPackage,
    appVersion: task.appVersion,
    uiSignature: task.uiSignature,
    stage: task.stage,
    retryCount: task.retryCount,
    maxRetries: MAX_RETRIES,
    lastFailureCause: task.lastFailureCause || null,
    failureAttribution: task.failureAttribution || null,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    outcome: task.outcome || null,
    eventCount: task.eventIds?.length || 0
  };
}

class HelperCoachService {
  constructor({
    store = defaultHelperCoachStore,
    skillRegistry = null,
    memoryProvider = null,
    now = Date.now,
    logger = console
  } = {}) {
    this.store = store;
    this.skillRegistry = skillRegistry;
    this.memoryProvider = memoryProvider;
    this.now = now;
    this.logger = logger;
    this.queue = Promise.resolve();
    this.requestTimes = [];
  }

  serial(operation) {
    const run = this.queue.then(operation);
    this.queue = run.catch(() => {});
    return run;
  }

  async pair() {
    return this.serial(async () => {
      const secret = crypto.randomBytes(32).toString('base64url');
      const pairedAt = this.now();
      await this.store.mutate(state => {
        state.optedIn = true;
        state.secret = secret;
        state.pairedAt = pairedAt;
        state.runtimeLastSeenAt = null;
        state.runtimeProtocolAvailable = false;
        state.nonces = [];
        for (const task of Object.values(state.tasks)) {
          if (!['outcome_verified', 'failed', 'aborted'].includes(task.stage)) {
            task.stage = 'aborted';
            task.activeAdvice = null;
            task.validatedAction = null;
            task.abortReason = 'Pairing secret was rotated; start a fresh Helper task.';
            task.updatedAt = pairedAt;
          }
        }
        state.events = [...state.events, {
          eventId: `coach_${crypto.randomUUID().replace(/-/g, '')}`,
          kind: 'pairing_created', source: 'pocket', at: pairedAt,
          summary: '使用者啟用 Helper Coach 配對。'
        }].slice(-5000);
      });
      return {
        enabled: true,
        pairedAt,
        pairingSecret: secret,
        runtimeConnected: false,
        note: '配對密鑰只顯示這一次。請在 Crew Helper 的 Coach v1 設定中輸入；若該版本尚無此設定，需先更新 Helper Runtime。'
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
        state.nonces = [];
        for (const task of Object.values(state.tasks)) {
          if (!['outcome_verified', 'failed', 'aborted'].includes(task.stage)) {
            task.stage = 'aborted';
            task.activeAdvice = null;
            task.validatedAction = null;
            task.abortReason = 'Helper Coach pairing was revoked.';
            task.updatedAt = at;
          }
        }
        state.events = [...state.events, {
          eventId: `coach_${crypto.randomUUID().replace(/-/g, '')}`,
          kind: 'pairing_revoked', source: 'pocket', at,
          summary: '使用者撤銷 Helper Coach 配對。'
        }].slice(-5000);
      });
      return { enabled: false, runtimeConnected: false };
    });
  }

  checkRateLimit(now) {
    this.requestTimes = this.requestTimes.filter(at => now - at < ACTIVE_WINDOW_MS);
    if (this.requestTimes.length >= REQUESTS_PER_MINUTE) throw Object.assign(new Error('Coach event rate limit exceeded'), { statusCode: 429 });
    this.requestTimes.push(now);
  }

  async receiveSignedEvent({ rawBody, timestamp, nonce, signature }) {
    return this.serial(async () => {
      const now = this.now();
      this.checkRateLimit(now);
      const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
      if (raw.length > MAX_EVENT_BYTES) throw Object.assign(new Error('Coach event payload too large'), { statusCode: 413 });
      if (!/^\d{10,16}$/.test(String(timestamp || '')) || Math.abs(now - Number(timestamp)) > MAX_CLOCK_SKEW_MS) {
        throw Object.assign(new Error('Stale or invalid Coach timestamp'), { statusCode: 401 });
      }
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(nonce || ''))) {
        throw Object.assign(new Error('Invalid Coach nonce'), { statusCode: 401 });
      }
      const state = await this.store.snapshot();
      if (!state.optedIn || !state.secret) throw Object.assign(new Error('Helper Coach pairing is disabled'), { statusCode: 403 });
      const expected = createSignature(state.secret, timestamp, nonce, raw);
      if (!safeEqualHex(signature, expected)) throw Object.assign(new Error('Invalid Coach signature'), { statusCode: 401 });

      let payload;
      try { payload = JSON.parse(raw.toString('utf8')); }
      catch (_) { throw Object.assign(new Error('Invalid Coach JSON'), { statusCode: 400 }); }
      const event = normalizeEvent(payload, now);

      let response;
      await this.store.mutate(current => {
        if (!current.optedIn || !current.secret || !safeEqualHex(signature,
          createSignature(current.secret, timestamp, nonce, raw))) {
          throw Object.assign(new Error('Coach pairing changed during request'), { statusCode: 401 });
        }
        const nonceHash = sha256(nonce);
        if (current.nonces.some(item => item.hash === nonceHash && item.expiresAt > now)) {
          throw Object.assign(new Error('Replayed Coach nonce'), { statusCode: 409 });
        }
        if (current.events.some(item => item.eventId === event.event_id)) {
          throw Object.assign(new Error('Duplicate Coach event'), { statusCode: 409 });
        }

        const task = current.tasks[event.task_id] || null;
        if (event.kind === 'task_observation') response = this.applyObservation(current, task, event, now);
        else if (event.kind === 'advice_validation') response = this.applyAdviceValidation(current, task, event, now);
        else response = this.applyOutcome(current, task, event, now);

        current.nonces = [...current.nonces.filter(item => item.expiresAt > now), {
          hash: nonceHash, expiresAt: now + MAX_CLOCK_SKEW_MS
        }].slice(-2000);
        current.runtimeLastSeenAt = now;
        current.runtimeProtocolAvailable = true;
        current.events = [...current.events, {
          eventId: event.event_id,
          taskId: event.task_id,
          kind: event.kind,
          source: 'helper',
          at: Date.parse(event.timestamp),
          summary: this.eventSummary(event),
          stage: response.stage
        }];
        if (event.kind === 'task_observation' && event.previous_action) current.events.push({
          eventId: `action_${event.event_id}`,
          taskId: event.task_id,
          kind: 'task_action_result',
          source: 'helper',
          at: Date.parse(event.timestamp),
          summary: `${event.previous_action.action_id} 回傳 ${event.previous_action.result}${event.previous_action.error_code ? ` · ${event.previous_action.error_code}` : ''}`,
          stage: 'executed'
        });
        if (response.advice) current.events.push({
          eventId: response.advice.event_id,
          taskId: event.task_id,
          kind: 'coach_advice',
          source: 'pocket',
          at: now,
          summary: response.advice.diagnosis,
          stage: response.stage,
          actionId: response.advice.suggested_action_id
        });
        if (response.task) current.tasks[event.task_id] = response.task;
        if (response.task) this.ensureRuntimeCodeSuggestion(current, response.task, now);
        current.events = current.events.slice(-5000);
        const taskIds = Object.keys(current.tasks);
        for (const id of taskIds.slice(0, Math.max(0, taskIds.length - MAX_TASKS))) delete current.tasks[id];
      });

      if (response.learningOutcome) {
        try {
          const skill = await this.recordLearning(response.learningOutcome);
          if (response.publicResponse.skill && skill) {
            response.publicResponse.skill = {
              id: skill.id,
              status: skill.status,
              successfulTasks: (skill.helperEvidence || []).filter(item => item.outcome === 'passed').length,
              note: skill.status === 'active'
                ? '已由兩個不同任務的 Helper Runtime 獨立驗證並啟用。'
                : '獨立驗證紀錄已保存；需兩個不同任務成功才會啟用。'
            };
          }
          if (skill) await this.store.mutate(current => {
            current.events.push({
              eventId: `coach_${crypto.randomUUID().replace(/-/g, '')}`,
              taskId: response.learningOutcome.taskId,
              kind: 'skill_candidate_recorded',
              source: 'pocket',
              at: this.now(),
              summary: skill.status === 'active'
                ? `技能已獨立驗證並啟用：${skill.title}`
                : `新增技能候選：${skill.title}`,
              stage: skill.status === 'active' ? 'skill_activated' : 'candidate_recorded'
            });
            current.events = current.events.slice(-5000);
          });
        } catch (error) {
          this.logger.warn?.('[Helper Coach] Learning record failed:', String(error?.message || error).slice(0, 180));
        }
      }
      return response.publicResponse;
    });
  }

  eventSummary(event) {
    if (event.kind === 'task_observation') {
      const prior = event.previous_action ? `${event.previous_action.action_id}: ${event.previous_action.result}` : '起始畫面';
      return `${TASKS[event.task_type].label} · 第 ${event.step_index + 1} 個畫面 · ${prior}${event.error_code ? ` · ${event.error_code}` : ''}`;
    }
    if (event.kind === 'advice_validation') return event.accepted ? 'Helper Runtime 驗證建議並準備執行。' : `Helper Runtime 拒絕建議${event.rejection_code ? `：${event.rejection_code}` : ''}`;
    return event.verified ? `Runtime 回報完成並驗證：${event.verification_method}` : `Runtime 回報未完成：${event.verification_method}`;
  }

  abortTask(task, reason, now) {
    const next = { ...task, stage: 'aborted', activeAdvice: null, validatedAction: null,
      abortReason: reason, updatedAt: now };
    return { stage: 'aborted', task: next, publicResponse: { accepted: false, stage: 'aborted', reason } };
  }

  ensureRuntimeCodeSuggestion(state, task, now) {
    if (!task || task.failureAttribution !== 'runtime_defect' || !['failed', 'aborted'].includes(task.stage)) return null;
    const existing = state.codeProposals.find(item => item.taskId === task.taskId);
    if (existing) return existing;
    const taskName = TASKS[task.taskType]?.label || task.taskType;
    const actionTrail = Array.isArray(task.completedActions) ? task.completedActions : [];
    const diagnosis = `Crew Helper Runtime attributed ${task.lastFailureCause || 'UNKNOWN'} to its action flow during ${task.taskType}; inspect the Helper source before proposing a change.`;
    const proposal = {
      id: `coach-code-${crypto.randomBytes(6).toString('hex')}`,
      taskId: task.taskId,
      diagnosis,
      reproductionSteps: [
        `Start the ${taskName} task in ${task.appPackage} ${task.appVersion}.`,
        ...(actionTrail.length ? [`Runtime completed: ${actionTrail.join(' → ')}.`] : []),
        `Observe Runtime failure ${task.lastFailureCause || 'UNKNOWN'} and the aborted task state.`
      ],
      testPlan: [
        'Inspect the Helper Runtime path that owns the reported action and error code.',
        'Add a focused regression for the reported task failure.',
        './gradlew testDebugUnitTest --no-daemon'
      ],
      evidenceEventIds: (task.eventIds || []).slice(-20),
      repository: 'magic76/crew-helper',
      status: 'needs_code_review',
      createdAt: now,
      source: 'helper-runtime-attributed-failure'
    };
    state.codeProposals.push(proposal);
    return proposal;
  }

  applyObservation(state, existing, event, now) {
    const definition = TASKS[event.task_type];
    let task = existing;
    if (!task) {
      if (event.step_index !== 0 || event.previous_action) {
        return { stage: 'aborted', task: null,
          publicResponse: { accepted: false, stage: 'aborted', reason: 'Task must begin with step 0 and no previous action.' } };
      }
      task = {
        taskId: event.task_id,
        taskType: event.task_type,
        appPackage: event.app_package,
        appVersion: event.app_version,
        uiSignature: event.ui_signature,
        stepIndex: 0,
        stage: 'observed',
        retryCount: 0,
        adviceCount: 0,
        lastFailureCause: null,
        eventIds: [],
        completedActions: [],
        activeAdvice: null,
        validatedAction: null,
        startedAt: now,
        updatedAt: now,
        outcome: null
      };
    } else {
      if (!['runtime_validated', 'diagnosed'].includes(task.stage)) {
        return this.abortTask(task, 'Task is not awaiting a Runtime-validated action or fresh observation.', now);
      }
      if (event.task_type !== task.taskType || event.app_package !== definition.appPackage || event.app_package !== task.appPackage) {
        return this.abortTask(task, 'Foreground app changed; stop this coaching attempt and re-observe in a new task.', now);
      }
      if (event.app_version !== task.appVersion) return this.abortTask(task, 'App version changed during the task; re-observe.', now);
      if (task.activeAdvice) return this.abortTask(task, 'A fresh advice validation is required before any action or next observation.', now);
      if (task.validatedAction) {
        const previous = event.previous_action;
        if (!previous || previous.action_id !== task.validatedAction.action_id || previous.result !== event.result) {
          return this.abortTask(task, 'Observed action did not match the Runtime-validated advice; re-observe.', now);
        }
        const expectedStep = previous.result === 'success' && task.validatedAction.advancesStep
          ? task.stepIndex + 1 : task.stepIndex;
        if (event.step_index !== expectedStep) return this.abortTask(task, 'UI step changed unexpectedly; request a new task observation.', now);
        if (previous.result === 'success') {
          if (task.validatedAction.advancesStep) {
            task.completedActions = [...task.completedActions, TASKS[task.taskType].actions[task.stepIndex]];
          }
        } else {
          task.lastFailureCause = cleanFailureCause(event.error_code || previous.error_code);
          if (event.failure_attribution === 'runtime_defect') task.failureAttribution = 'runtime_defect';
          else if (event.failure_attribution === 'interaction_issue') task.failureAttribution = 'interaction_issue';
          if (task.retryCount >= MAX_RETRIES) return this.abortTask(task, 'Retry limit reached; start a new observation after the user or Runtime changes the situation.', now);
        }
        task.stepIndex = event.step_index;
        task.validatedAction = null;
      } else if (event.previous_action || event.step_index !== task.stepIndex) {
        return this.abortTask(task, 'Observation has no matching validated previous action; re-observe.', now);
      }
    }

    if (event.app_package !== definition.appPackage) return this.abortTask(task, 'The expected app is not in the foreground; re-observe after opening the selected app.', now);
    task.uiSignature = event.ui_signature;
    if (event.result === 'failed' && event.failure_attribution === 'runtime_defect') task.failureAttribution = 'runtime_defect';
    else if (event.result === 'failed' && event.failure_attribution === 'interaction_issue') task.failureAttribution = 'interaction_issue';
    task.updatedAt = now;
    task.eventIds = [...task.eventIds, event.event_id].slice(-50);
    const diagnosis = diagnoseObservation(event, task, now);
    task.stage = diagnosis.stage === 'aborted' ? 'aborted' : (diagnosis.advice ? 'advice_proposed' : diagnosis.stage);
    task.activeAdvice = diagnosis.advice ? {
      ...diagnosis.advice,
      ui_signature: event.ui_signature,
      requires_user_confirmation: diagnosis.advice.requires_user_confirmation,
      expires_at: diagnosis.advice.expires_at
    } : null;
    if (diagnosis.advice) {
      task.adviceCount++;
      task.lastSuggestedAction = diagnosis.advice.suggested_action_id;
      if (event.previous_action?.result === 'failed') task.retryCount++;
    }
    if (diagnosis.stage === 'aborted') task.abortReason = diagnosis.reason;
    task.eventIds = [...task.eventIds, ...(diagnosis.advice ? [diagnosis.advice.event_id] : [])].slice(-50);
    return {
      stage: task.stage,
      task,
      advice: diagnosis.advice,
      publicResponse: {
        accepted: true,
        stage: task.stage,
        task_id: task.taskId,
        advice: diagnosis.advice,
        reason: diagnosis.reason || null,
        retry_count: task.retryCount,
        max_retries: MAX_RETRIES
      }
    };
  }

  applyAdviceValidation(state, task, event, now) {
    if (!task || task.stage !== 'advice_proposed' || !task.activeAdvice) {
      return { stage: 'aborted', publicResponse: { accepted: false, stage: 'aborted', reason: 'No current advice is awaiting validation.' } };
    }
    const advice = task.activeAdvice;
    if (Date.parse(advice.expires_at) <= now) return this.abortTask(task, 'Advice expired; obtain a fresh observation.', now);
    if (event.advice_event_id !== advice.event_id || event.observation_event_id !== advice.observation_event_id ||
        event.suggested_action_id !== advice.suggested_action_id || event.ui_signature !== advice.ui_signature) {
      return this.abortTask(task, 'Advice ID, action, observation or UI signature did not match; re-observe.', now);
    }
    if (advice.requires_user_confirmation && event.accepted && !event.user_confirmed) {
      return this.abortTask(task, 'The action requires explicit user confirmation.', now);
    }
    if (!event.accepted) return this.abortTask(task, 'Helper Runtime rejected the advice; ask for a fresh observation.', now);
    task.stage = 'runtime_validated';
    const taskAction = TASKS[task.taskType].actions[task.stepIndex];
    task.validatedAction = {
      action_id: advice.suggested_action_id,
      advice_event_id: advice.event_id,
      advancesStep: advice.suggested_action_id === taskAction || advice.suggested_action_id === 'common.retry_last_action'
    };
    task.activeAdvice = null;
    task.updatedAt = now;
    task.eventIds = [...task.eventIds, event.event_id].slice(-50);
    return {
      stage: task.stage,
      task,
      publicResponse: { accepted: true, stage: 'runtime_validated', task_id: task.taskId,
        action_id: task.validatedAction.action_id, expires_at: advice.expires_at }
    };
  }

  applyOutcome(state, task, event, now) {
    if (!task || task.stage !== 'awaiting_verification' || task.stepIndex !== TASKS[task.taskType].actions.length) {
      return { stage: 'aborted', publicResponse: { accepted: false, stage: 'aborted', reason: 'Task steps are not complete; outcome cannot be recorded yet.' } };
    }
    if (JSON.stringify(task.completedActions) !== JSON.stringify(TASKS[task.taskType].actions)) {
      return this.abortTask(task, 'The verified action sequence is incomplete; start a fresh Runtime observation.', now);
    }
    if (task.appPackage !== TASKS[task.taskType].appPackage) return this.abortTask(task, 'Task foreground app changed.', now);
    const verified = isVerifiedOutcome(task.taskType, event);
    task.stage = verified ? 'outcome_verified' : 'failed';
    task.updatedAt = now;
    task.outcome = {
      verified,
      verificationMethod: event.verification_method,
      durationMs: event.duration_ms,
      evidenceRefs: event.evidence_refs,
      eventId: event.event_id,
      at: now
    };
    task.eventIds = [...task.eventIds, event.event_id].slice(-50);
    const learningOutcome = {
      taskId: task.taskId,
      taskType: task.taskType,
      appPackage: task.appPackage,
      appVersion: task.appVersion,
      uiSignature: task.uiSignature,
      eventIds: [event.event_id, ...task.eventIds.slice(-7)],
      outcomeEventId: event.event_id,
      verificationMethod: event.verification_method,
      evidenceRefs: event.evidence_refs,
      verified,
      at: now
    };
    return {
      stage: task.stage,
      task,
      learningOutcome,
      publicResponse: {
        accepted: true,
        stage: task.stage,
        verified,
        task_id: task.taskId,
        verification_method: event.verification_method,
        skill: verified ? { status: 'candidate', note: '獨立驗證紀錄已保存；需兩個不同任務成功才會啟用。' } : null
      }
    };
  }

  async recordLearning(outcome) {
    let skill = null;
    if (this.skillRegistry?.recordHelperOutcome) {
      skill = await this.skillRegistry.recordHelperOutcome(ROLE_ID, {
        taskId: outcome.taskId,
        taskType: outcome.taskType,
        appPackage: outcome.appPackage,
        appVersion: outcome.appVersion,
        uiSignature: outcome.uiSignature,
        outcomeEventId: outcome.outcomeEventId,
        evidenceRefs: outcome.evidenceRefs,
        verificationMethod: outcome.verificationMethod,
        sourceEventIds: outcome.eventIds,
        verified: outcome.verified
      });
    }
    if (outcome.verified && this.memoryProvider?.retain) {
      await this.memoryProvider.retain({
        id: `helper-coach-${outcome.outcomeEventId}`,
        text: `Helper 在 ${outcome.appPackage} ${outcome.appVersion} 完成 ${outcome.taskType} 任務；Runtime 使用 ${outcome.verificationMethod} 獨立驗證成功。`,
        scope: MemoryScope.ROLE,
        roleId: ROLE_ID,
        kind: 'experience',
        tags: ['helper-coach', outcome.taskType, 'verified-success'],
        importance: 0.72,
        source: 'helper-coach-runtime',
        provenance: {
          sources: [{ type: MemorySourceType.TOOL, id: outcome.outcomeEventId, timestamp: outcome.at }],
          derivedFrom: outcome.eventIds.slice(-32),
          derivation: MemoryDerivationType.SYSTEM_OBSERVED
        },
        confidence: 0.96
      });
    }
    return skill;
  }

  async dashboard() {
    const state = await this.store.snapshot();
    const tasks = Object.values(state.tasks).map(publicTask).sort((a, b) => b.updatedAt - a.updatedAt);
    const terminal = tasks.filter(task => task.outcome);
    const verifiedCount = terminal.filter(task => task.outcome.verified).length;
    const failedCount = terminal.length - verifiedCount;
    const activeSkills = this.skillRegistry
      ? (await Promise.all(['role-helper-coach'].map(async roleId => (await this.skillRegistry.list(roleId, { withHistory: true })))))
          .flatMap(result => result.skills)
      : [];
    const events = state.events.slice(-100).reverse();
    const failureCauses = {};
    for (const task of tasks) {
      if (task.lastFailureCause) failureCauses[task.lastFailureCause] = (failureCauses[task.lastFailureCause] || 0) + 1;
    }
    const runtimeProtocolAvailable = state.optedIn && state.runtimeProtocolAvailable === true;
    return {
      protocolVersion: 1,
      status: state.optedIn ? (state.runtimeLastSeenAt && this.now() - state.runtimeLastSeenAt < 30_000 ? 'runtime_connected' : 'waiting_for_helper_runtime') : 'not_paired',
      enabled: Boolean(state.optedIn),
      pairedAt: state.pairedAt,
      runtimeLastSeenAt: state.runtimeLastSeenAt,
      runtimeProtocolAvailable,
      helperCompatibility: runtimeProtocolAvailable
        ? '已收到使用配對密鑰簽署的 Coach v1 Runtime 事件。'
        : 'Helper Android Runtime 尚未回報 Coach v1 事件；目前只有 Mock Adapter 可走完整流程。',
      metrics: {
        observedTasks: tasks.length,
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
        appVersion: skill.helperScope?.appVersion || null,
        uiSignature: skill.helperScope?.uiSignature || null,
        sourceEventIds: (skill.sourceEventIds || []).slice(-8),
        verification: skill.verification,
        successRate: (skill.helperEvidence || []).length
          ? (skill.helperEvidence.filter(item => item.outcome === 'passed').length / skill.helperEvidence.length)
          : null,
        outcomeCount: (skill.helperEvidence || []).length,
        evidence: (skill.helperEvidence || []).map(item => ({
          taskId: item.taskId, outcomeEventId: item.outcomeEventId, at: item.at,
          verificationMethod: item.verificationMethod, outcome: item.outcome
        }))
      })),
      tasks,
      events,
      codeProposals: state.codeProposals.map(proposal => ({
        id: proposal.id, status: proposal.status, diagnosis: proposal.diagnosis,
        taskId: proposal.taskId,
        reproductionSteps: proposal.reproductionSteps || [],
        testPlan: proposal.testPlan || [],
        evidenceEventIds: proposal.evidenceEventIds || [],
        createdAt: proposal.createdAt, prUrl: proposal.prUrl || null
      })).reverse()
    };
  }

  async recordCodeProposal({ proposalId, taskId, diagnosis, reproductionSteps, testPlan }) {
    const clean = (value, max) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
    const state = await this.store.snapshot();
    const namedProposal = proposalId ? state.codeProposals.find(item => item.id === proposalId) : null;
    const resolvedTaskId = String(taskId || namedProposal?.taskId || '');
    const task = state.tasks[resolvedTaskId];
    if (!task || !task.eventIds?.length || !['failed', 'aborted'].includes(task.stage)) {
      throw Object.assign(new Error('A real failed Helper task is required before proposing a Runtime code fix.'), { statusCode: 409 });
    }
    if (task.failureAttribution !== 'runtime_defect') {
      throw Object.assign(new Error('Only a Helper Runtime-attributed failure can start a code proposal.'), { statusCode: 409 });
    }
    const existing = state.codeProposals.find(item => item.taskId === task.taskId && item.status === 'needs_code_review');
    const target = proposalId ? namedProposal : existing;
    if (proposalId && (!target || target.status !== 'needs_code_review' || target.taskId !== task.taskId)) {
      throw Object.assign(new Error('Runtime code suggestion is no longer editable.'), { statusCode: 409 });
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
      createdAt: target?.createdAt || this.now(),
      updatedAt: this.now(),
      source: 'helper-runtime-attributed-failure'
    };
    if (proposal.diagnosis.length < 12 || !proposal.reproductionSteps.length || !proposal.testPlan.length) {
      throw Object.assign(new Error('Code proposal needs diagnosis, reproduction steps, and a test plan.'), { statusCode: 400 });
    }
    await this.store.mutate(state => {
      const index = state.codeProposals.findIndex(item => item.id === proposal.id);
      if (index >= 0) state.codeProposals[index] = proposal;
      else state.codeProposals.push(proposal);
    });
    return proposal;
  }
}

module.exports = {
  HelperCoachService,
  ROLE_ID,
  MAX_RETRIES,
  REQUESTS_PER_MINUTE,
  createSignature,
  CODE_PROPOSAL_RE
};
