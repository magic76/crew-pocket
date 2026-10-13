const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { MemoryScope, MemoryDerivationType, MemorySourceType } = require('./types');
const { defaultSkillRegistry } = require('../skills/registry');
const { defaultMemoryCandidateStore } = require('../mcp/memory-candidates');

const DEFAULT_DREAMING_PATH = process.env.CREW_DREAMING_STATE_PATH ||
  path.join(process.env.HOME || '/data/data/com.termux/files/home', '.crew-pocket', 'dreaming.json');
const DEFAULT_DREAMING_SETTINGS = Object.freeze({
  enabled: true,
  provider: 'codex',
  model: 'gpt-6-luna',
  effort: 'low',
  idleMinutes: 15,
  dailyLimit: 1,
  minEvents: 2
});
const DAY_MS = 24 * 60 * 60 * 1000;
const ERROR_BACKOFF_MS = 60 * 60 * 1000;
const MAX_EVENTS = 24;

function short(value, length = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, length);
}

function normalizeSettings(input = {}, previous = DEFAULT_DREAMING_SETTINGS) {
  const result = { ...previous };
  if (Object.prototype.hasOwnProperty.call(input, 'enabled')) {
    if (typeof input.enabled !== 'boolean') throw new Error('enabled must be a boolean');
    result.enabled = input.enabled;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'model')) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/.test(input.model || '')) {
      throw new Error('Invalid dreaming model ID');
    }
    result.model = input.model;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'effort')) {
    if (!['low', 'medium', 'high'].includes(input.effort)) throw new Error('Invalid dreaming effort');
    result.effort = input.effort;
  }
  for (const [key, min, max] of [['idleMinutes', 5, 120], ['dailyLimit', 0, 4], ['minEvents', 1, 10]]) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) {
        throw new Error('Invalid dreaming setting: ' + key);
      }
      result[key] = input[key];
    }
  }
  // First version isolates the model in disposable Codex threads only.
  result.provider = 'codex';
  return result;
}

function defaultState() {
  return { version: 1, settings: { ...DEFAULT_DREAMING_SETTINGS }, roles: {} };
}

function pendingEvents(roleData = {}) {
  return Array.isArray(roleData.pending) ? roleData.pending : [];
}

function eligible(roleData, settings, now) {
  const pending = pendingEvents(roleData);
  return Boolean(
    settings.enabled && settings.dailyLimit > 0 &&
    pending.length >= settings.minEvents &&
    now - Number(roleData.lastEventAt || 0) >= settings.idleMinutes * 60000 &&
    (!roleData.lastAttemptAt || now - roleData.lastAttemptAt >= DAY_MS / settings.dailyLimit) &&
    (!roleData.lastFailedAt || now - roleData.lastFailedAt >= ERROR_BACKOFF_MS)
  );
}

class DreamingManager {
  constructor({ storagePath = DEFAULT_DREAMING_PATH, memoryProvider, skillRegistry = defaultSkillRegistry,
    candidateStore = defaultMemoryCandidateStore, getRole, getProvider, now = Date.now, logger = console } = {}) {
    if (!memoryProvider || !getRole || !getProvider) throw new Error('Dreaming dependencies are required');
    this.storagePath = storagePath;
    this.memoryProvider = memoryProvider;
    this.skillRegistry = skillRegistry;
    this.candidateStore = candidateStore;
    this.getRole = getRole;
    this.getProvider = getProvider;
    this.now = now;
    this.logger = logger;
    this.mutationQueue = Promise.resolve();
    this.running = new Set();
    this.timer = null;
  }

  async readState() {
    try {
      const state = JSON.parse(await fs.readFile(this.storagePath, 'utf8'));
      return {
        version: 1,
        settings: normalizeSettings(state.settings || {}),
        roles: state.roles && typeof state.roles === 'object' && !Array.isArray(state.roles) ? state.roles : {}
      };
    } catch (error) {
      if (error.code === 'ENOENT') return defaultState();
      throw error;
    }
  }

  async writeState(state) {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    const temp = this.storagePath + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(state, null, 2) + '\n', 'utf8');
    await fs.rename(temp, this.storagePath);
  }

  mutate(callback) {
    const operation = this.mutationQueue.then(async () => {
      const state = await this.readState();
      const result = await callback(state);
      await this.writeState(state);
      return result;
    });
    this.mutationQueue = operation.catch(() => {});
    return operation;
  }

  async getStatus() {
    await this.mutationQueue;
    const state = await this.readState();
    return {
      settings: state.settings,
      roles: Object.fromEntries(Object.entries(state.roles).map(([roleId, data]) => [
        roleId, {
          pending: pendingEvents(data).length,
          lastEventAt: data.lastEventAt || null,
          lastDreamedAt: data.lastDreamedAt || null,
          lastAttemptAt: data.lastAttemptAt || null,
          lastFailedAt: data.lastFailedAt || null,
          lastError: data.lastError || null,
          running: this.running.has(roleId)
        }
      ]))
    };
  }

  async configure(input) {
    return this.mutate(state => {
      state.settings = normalizeSettings(input, state.settings);
      return state.settings;
    });
  }

  async recordTurn({ roleId, projectId, providerId, conversationId, prompt, response, status } = {}) {
    if (!roleId || !conversationId || ['error', 'failed', 'cancelled', 'interrupted', 'aborted'].includes(String(status || '').toLowerCase())) return false;
    const request = short(prompt, 460);
    const outcome = short(response, 520);
    if (!request || !outcome) return false;
    const event = {
      id: crypto.randomUUID(),
      at: this.now(),
      providerId: short(providerId, 60),
      conversationId: short(conversationId, 180),
      request,
      outcome
    };
    return this.mutate(async state => {
      const data = state.roles[roleId] || { pending: [], recent: [] };
      const latest = data.recent?.[0];
      if (latest && latest.conversationId === event.conversationId && latest.request === request && latest.outcome === outcome) return false;
      data.pending = [...pendingEvents(data), event].slice(-MAX_EVENTS);
      data.recent = [event, ...(data.recent || [])].slice(0, 3);
      data.lastEventAt = event.at;
      state.roles[roleId] = data;

      // Keep the event queue for consolidation; do not publish another copy of
      // the conversation as memory on every turn. Dreaming replaces one summary.
      return true;
    });
  }

  async runDue() {
    await this.mutationQueue;
    const snapshot = await this.readState();
    const now = this.now();
    const candidateList = (await this.candidateStore.readAll()).filter(c=>c.status==='pending');
    const roleIds = new Set([...Object.keys(snapshot.roles),...candidateList.map(c=>c.roleId)]);
    for (const roleId of roleIds) {
      const data = snapshot.roles[roleId] || { pending:[],recent:[] };
      const roleCandidates = candidateList.filter(c=>c.roleId===roleId).slice(0,8);
      const candidateEvents = roleCandidates.map(c=>({
        id:c.id,at:c.createdAt,
        conversationId:c.conversationId || c.id,
        candidateId:c.id,
        evidence:c.provenance?.sources || [],
        request:'Proposed lesson ('+c.kind+'); verify as untrusted candidate',
        outcome:short(c.text,520)
      }));
      const batch = [...pendingEvents(data),...candidateEvents].sort((a,b)=>a.at-b.at).slice(-MAX_EVENTS);
      const synthesized = {...data, pending:batch, lastEventAt:Math.max(
        Number(data.lastEventAt)||0,...candidateEvents.map(c=>c.at),0)};
      const gate = roleCandidates.length ? {...snapshot.settings,minEvents:1} : snapshot.settings;
      if (this.running.has(roleId) || !eligible(synthesized,gate,now)) continue;
      this.running.add(roleId);
      // Never share the working Thread. A disposable Codex thread performs analysis.
      try {
        const role = await this.getRole(roleId);
        if (!role) continue;
        const provider = this.getProvider('codex');
        // Yield to user work. Do not compete with active Codex turns.
        if (provider.turns instanceof Map && provider.turns.size > 0) continue;
        if (typeof provider.summarizeMemoryEvents !== 'function') throw new Error('Codex dreaming is not available');
        // Reserve quota BEFORE contacting the model, including failed attempts.
        const reserved = await this.mutate(state => {
          const current = state.roles[roleId] || {pending:[],recent:[]};
          const liveGate=roleCandidates.length?{...state.settings,minEvents:1}:state.settings;
          if (!eligible({...current,pending:batch,lastEventAt:synthesized.lastEventAt},
            liveGate,this.now())) return false;
          current.lastAttemptAt = this.now();
          state.roles[roleId] = current;
          return true;
        });
        if (!reserved) continue;
        const result = await provider.summarizeMemoryEvents({
          model: snapshot.settings.model,
          effort: snapshot.settings.effort,
          roleName: role.name,
          events: batch,
          previousSummary: data.workingSummary || ''
        });
        // Legacy test providers returned a memories array. New providers return
        // both memories and skill candidates from ONE inference, same quota.
        const entries = Array.isArray(result) ? result : result?.memories;
        const skills = Array.isArray(result?.skills) ? result.skills.slice(0, 2) : [];
        if (!Array.isArray(entries)) throw new Error('Dreaming output is invalid');
        const admittedIds = await this.mutate(async latestState => {
          if (!latestState.settings.enabled || !(await this.getRole(roleId))) return;
          const current = latestState.roles[roleId];
          if (!current) return;
          const batchIds = new Set(batch.map(item => item.id));
          const sources = batch.slice(-5).flatMap(item => item.candidateId
            ? [{type:MemorySourceType.TOOL,id:item.candidateId,timestamp:item.at},
              ...item.evidence.filter(x=>x?.type && x?.id).map(x=>({type:x.type,id:x.id}))]
            : [{type:MemorySourceType.CONVERSATION,id:item.conversationId,timestamp:item.at}]
          ).slice(0,20);
          // Compare against existing active long-term memory before admitting
          // another model-inferred summary of the same lesson.
          const previous=(await this.memoryProvider.recall({
            scopes:[MemoryScope.ROLE],roleId,limit:50,maxChars:24000
          })).map(x=>String(x.record?.text||'').toLocaleLowerCase().replace(/\s+/g,' ').trim());
          const admitted=[];
          const workingSummary = short(result?.workingSummary, 1400);
          if (workingSummary) {
            await this.memoryProvider.retain({
              id: 'working-' + roleId,
              text: 'Working summary (reported, not independently verified):\n' + workingSummary,
              scope: MemoryScope.ROLE,
              roleId,
              projectId: role.projectId || null,
              kind: 'working',
              tags: ['current-work', 'summary'],
              importance: 0.95,
              source: 'crew-dreaming-checkpoint',
              confidence: 0.55,
              provenance: { derivation: MemoryDerivationType.MODEL_INFERRED, sources }
            });
            current.workingSummary = workingSummary;
          }
          const batchKey = crypto.createHash('sha256').update(batch.map(item => item.id).join('|')).digest('hex').slice(0, 16);
          for (const [index, entry] of entries.slice(0, 3).entries()) {
            const text = short(entry?.text, 750);
            if (!text || text.length < 16) continue;
            const normalized=text.toLocaleLowerCase().replace(/\s+/g,' ').trim();
            if (previous.some(x=>x===normalized || (normalized.length>70 &&
              x.includes(normalized)))) continue;
            const id='dream-' + roleId + '-' + batchKey + '-' + index;
            await this.memoryProvider.retain({
              id,
              text,
              scope: MemoryScope.ROLE,
              roleId,
              projectId: role.projectId || null,
              kind: 'experience',
              tags: ['dreaming', 'work-experience'],
              importance: 0.7,
              source: 'crew-dreaming',
              confidence: 0.6,
              provenance: { derivation: MemoryDerivationType.MODEL_INFERRED, sources }
            });
            previous.push(normalized);
            admitted.push(id);
          }
          // Candidate extraction is non-blocking for memory retention. It cannot
          // promote, activate or overwrite already reviewed Role skills.
          const conversations = [...new Set(batch.map(event => event.conversationId).filter(Boolean))];
          for (const candidate of skills) {
            try {
              await this.skillRegistry.propose(roleId, candidate, conversations);
            } catch (error) {
              this.logger.warn('[Role DNA] Candidate rejected: ' + String(error.message || error).slice(0, 120));
            }
          }
          current.pending = pendingEvents(current).filter(item => !batchIds.has(item.id));
          current.lastDreamedAt = this.now();
          current.lastFailedAt = null;
          current.lastError = null;
          return admitted;
        });
        // A model-generated lesson is not a verified fact; candidate decisions
        // are provenance checkpoints rather than direct raw-memory promotion.
        for (const candidate of roleCandidates.filter(c=>batch.some(e=>e.candidateId===c.id))) {
          await this.candidateStore.review(candidate.id,{
            status:admittedIds?.length?'consolidated':'discarded',
            summaryIds:admittedIds || []
          });
        }
      } catch (error) {
        this.logger.warn('[Dreaming] ' + roleId + ': ' + String(error.message || error).slice(0, 200));
        await this.mutate(state => {
          if (!state.roles[roleId]) return;
          state.roles[roleId].lastFailedAt = this.now();
          state.roles[roleId].lastError = short(error.message, 150);
        }).catch(() => {});
      } finally {
        this.running.delete(roleId);
      }
    }
  }

  async forgetRole(roleId) {
    return this.mutate(state => {
      const exists = Boolean(state.roles[roleId]);
      delete state.roles[roleId];
      return exists;
    });
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runDue().catch(error => this.logger.warn('[Dreaming] tick failed:', error.message));
    }, 60000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = {
  DreamingManager,
  DEFAULT_DREAMING_SETTINGS,
  DEFAULT_DREAMING_PATH,
  normalizeSettings,
  eligible
};
