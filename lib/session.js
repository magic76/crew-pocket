const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('node:events');
const { StringDecoder } = require('node:string_decoder');
const { BRAIN_DIR, IDLE_TIMEOUT_MS } = require('./config');

const MAX_SESSIONS = 2;
const PREWARM_COOLDOWN_MS = 30 * 1000;
const PREWARM_FAILURE_COOLDOWN_MS = 30 * 1000;
const AUTH_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

class ActiveSessionManager {
  constructor() {
    this.sessions = new Map(); // key: conversationId, value: sessionObj
    this.prewarmInFlight = null;
    this.lastPrewarmKey = '';
    this.lastPrewarmAt = 0;
    this.prewarmBlockedUntil = 0;
    this.prewarmFailureReason = '';
  }

  // Get or initialize persistent session (pool of up to MAX_SESSIONS)
  async getOrCreateSession(targetConversationId, targetModel, targetEffort = 'low') {
    // Try to find an existing session that matches
    if (targetConversationId && this.sessions.has(targetConversationId)) {
      const existing = this.sessions.get(targetConversationId);
      if (existing.process && !existing.process.killed) {
        const modelMatches = !targetModel || existing.model === targetModel;
        const effortMatches = !targetEffort || existing.effort === targetEffort;
        if (modelMatches && effortMatches) {
          existing.lastUsedAt = Date.now();
          this.resetIdleTimer(existing);
          console.log(`[SessionManager] Reusing existing session: ${targetConversationId} (Pool: ${this.sessions.size}/${MAX_SESSIONS})`);
          return existing;
        } else {
          // Model or effort changed for same conversation — close old, spawn new
          this.closeSession(targetConversationId);
        }
      } else {
        // Process died, clean up stale entry
        this.sessions.delete(targetConversationId);
      }
    }

    // ⚡ If this is a brand new session, check if we have a pre-warmed standby session ready!
    if (!targetConversationId && this.sessions.has('__standby__')) {
      const standby = this.sessions.get('__standby__');
      if (standby.process && !standby.process.killed && (!targetModel || standby.model === targetModel) && (!targetEffort || standby.effort === targetEffort) && !standby.isBusy) {
        console.log(`[SessionManager] ⚡ Instantly attaching prewarmed standby session! (0ms cold start spawn)`);
        this.sessions.delete('__standby__');
        standby.isStandby = false;
        if (standby.conversationId) this.sessions.set(standby.conversationId, standby);
        standby.lastUsedAt = Date.now();
        this.resetIdleTimer(standby);
        return standby;
      }
    }

    // If pool is full, evict the least recently used non-busy session
    if (this.sessions.size >= MAX_SESSIONS) {
      this._evictLRU();
    }

    console.log(`[SessionManager] Spawning resident agy process for session: ${targetConversationId || 'NEW'} (Model: ${targetModel || 'default'}, Effort: ${targetEffort}) (Pool: ${this.sessions.size}/${MAX_SESSIONS})`);

    // Check if target conversation exists in brain directory
    let validConvId = targetConversationId;
    if (validConvId) {
      const convDir = path.join(BRAIN_DIR, validConvId);
      if (!fs.existsSync(convDir)) {
        console.warn(`[SessionManager] Conversation ${validConvId} directory not found in brain. Starting a new session.`);
        validConvId = null;
      }
    }

    const args = [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--dangerously-skip-permissions',
      '--disable-slash-commands'
    ];

    if (targetModel) {
      args.push('--model', targetModel);
    }
    if (targetEffort) {
      args.push('--effort', targetEffort);
    }

    if (validConvId) {
      args.push('--conversation', validConvId);
    }

    const child = spawn('agy', args, {
      cwd: '/data/data/com.termux/files/home',
      env: process.env
    });

    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);

    const sessionObj = {
      conversationId: validConvId || null,
      model: targetModel || 'gemini-3.7-flash',
      effort: targetEffort || 'low',
      process: child,
      emitter,
      decoder: new StringDecoder('utf8'),
      isBusy: false,
      idleTimer: null,
      buffer: '',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      isStandby: !validConvId,
      authError: null
    };

    // Set up stdout stream parsing and dynamic conversation_id registration with lossless UTF-8 streaming
    child.stdout.on('data', (chunk) => {
      // Decode raw binary buffer through StringDecoder to guarantee multi-byte UTF-8 sequence integrity
      const textChunk = Buffer.isBuffer(chunk) ? sessionObj.decoder.write(chunk) : String(chunk);
      sessionObj.buffer += textChunk;
      const lines = sessionObj.buffer.split('\n');
      sessionObj.buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          if (item.event === 'init' && item.conversation_id) {
            const oldConvId = sessionObj.conversationId;
            const keepAsStandby = sessionObj.isStandby && !sessionObj.isBusy;
            sessionObj.conversationId = item.conversation_id;
            console.log('[SessionManager] Resident session initialized: ' + sessionObj.conversationId + ' (standby=' + keepAsStandby + ', Pool: ' + this.sessions.size + '/' + MAX_SESSIONS + ')');

            if (oldConvId && this.sessions.has(oldConvId)) {
              this.sessions.delete(oldConvId);
            }
            if (keepAsStandby) {
              this.sessions.set('__standby__', sessionObj);
            } else {
              sessionObj.isStandby = false;
              if (this.sessions.get('__standby__') === sessionObj) {
                this.sessions.delete('__standby__');
              }
              this.sessions.set(sessionObj.conversationId, sessionObj);
            }
            this.resetIdleTimer(sessionObj);
          }
          emitter.emit('event', item);
        } catch (e) {
          emitter.emit('raw', line);
        }
      }
    });

    child.stderr.on('data', (errChunk) => {
      const errorText = errChunk.toString();
      console.error('[Resident agy stderr] ' + errorText);
      if (this.isAuthenticationFailure(errorText)) {
        sessionObj.authError = errorText.trim().slice(-240);
        this.prewarmFailureReason = 'authentication';
        this.prewarmBlockedUntil = Math.max(this.prewarmBlockedUntil, Date.now() + AUTH_FAILURE_COOLDOWN_MS);
        console.warn('[SessionManager] AGY authentication unavailable; prewarm paused for ' + (AUTH_FAILURE_COOLDOWN_MS / 1000) + 's.');
      }
    });

    child.on('close', (code) => {
      console.log('[SessionManager] Resident process exited with code ' + code + ' (conv: ' + sessionObj.conversationId + ')');
      if (sessionObj.authError) {
        this.prewarmFailureReason = 'authentication';
        this.prewarmBlockedUntil = Math.max(this.prewarmBlockedUntil, Date.now() + AUTH_FAILURE_COOLDOWN_MS);
      } else if (sessionObj.isStandby && code !== 0) {
        this.prewarmFailureReason = 'process_exit_' + code;
        this.prewarmBlockedUntil = Math.max(this.prewarmBlockedUntil, Date.now() + PREWARM_FAILURE_COOLDOWN_MS);
      }
      if (this.sessions.get('__standby__') === sessionObj) {
        this.sessions.delete('__standby__');
      }
      if (sessionObj.conversationId && this.sessions.get(sessionObj.conversationId) === sessionObj) {
        if (sessionObj.idleTimer) clearTimeout(sessionObj.idleTimer);
        this.sessions.delete(sessionObj.conversationId);
      }
    });

    if (validConvId) {
      this.sessions.set(validConvId, sessionObj);
    } else {
      this.sessions.set('__standby__', sessionObj);
    }
    this.resetIdleTimer(sessionObj);

    return sessionObj;
  }

  isAuthenticationFailure(text = '') {
    return /authentication required|not logged into antigravity|silent auth failed|expired=true/i.test(text);
  }

  // 🔥 Pre-warm a background standby session for 0ms cold-start spawn.
  // Keep this idempotent: UI model/effort changes and app boot can arrive together.
  prewarm(targetModel = 'gemini-3.7-flash', targetEffort = 'low') {
    targetModel = targetModel || 'gemini-3.7-flash';
    targetEffort = targetEffort || 'low';
    const key = String(targetModel) + ':' + String(targetEffort);
    const now = Date.now();
    if (this.prewarmInFlight) return this.prewarmInFlight;
    if (now < this.prewarmBlockedUntil) {
      console.log('[SessionManager] Prewarm skipped (' + this.prewarmFailureReason + ' cooldown).');
      return Promise.resolve({ skipped: 'cooldown', reason: this.prewarmFailureReason });
    }

    const standby = this.sessions.get('__standby__');
    if (standby) {
      const matches = standby.model === targetModel && standby.effort === targetEffort;
      if (matches && standby.process && !standby.process.killed) return Promise.resolve({ skipped: 'already_ready' });
      this.closeSession('__standby__');
    }
    if (this.sessions.size >= MAX_SESSIONS) return Promise.resolve({ skipped: 'pool_full' });
    if (this.lastPrewarmKey === key && now - this.lastPrewarmAt < PREWARM_COOLDOWN_MS) {
      return Promise.resolve({ skipped: 'cooldown' });
    }

    this.lastPrewarmKey = key;
    this.lastPrewarmAt = now;
    console.log('[SessionManager] 🔥 Pre-warming background standby session (Model: ' + targetModel + ', Effort: ' + targetEffort + ')...');
    this.prewarmInFlight = this.getOrCreateSession(null, targetModel, targetEffort)
      .then(() => ({ started: true, model: targetModel, effort: targetEffort }))
      .catch((err) => {
        this.prewarmFailureReason = 'spawn_error';
        this.prewarmBlockedUntil = Date.now() + PREWARM_FAILURE_COOLDOWN_MS;
        console.warn('[SessionManager] Prewarm error:', err.message);
        return { skipped: 'error', error: err.message };
      })
      .finally(() => {
        this.prewarmInFlight = null;
      });
    return this.prewarmInFlight;
  }

  // Reset idle timer for a specific session
  resetIdleTimer(session) {
    if (!session) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      console.log(`[SessionManager] Session ${session.conversationId} idle for 30m, sleeping to save battery/RAM. (Pool: ${this.sessions.size - 1}/${MAX_SESSIONS})`);
      this.closeSession(session.isStandby ? '__standby__' : session.conversationId);
    }, IDLE_TIMEOUT_MS);
  }

  // Reset idle timer for a session by conversationId
  resetIdleTimerByConvId(convId) {
    if (!convId) return;
    const session = this.sessions.get(convId);
    if (session) this.resetIdleTimer(session);
  }

  // Close a specific session by conversationId
  closeSession(convId) {
    const key = convId || '__standby__';
    const session = this.sessions.get(key);
    if (session) {
      if (session.idleTimer) clearTimeout(session.idleTimer);
      try {
        session.process.kill('SIGTERM');
      } catch (e) {}
      this.sessions.delete(key);
      console.log('[SessionManager] Closed session: ' + key + ' (Pool: ' + this.sessions.size + '/' + MAX_SESSIONS + ')');
    }
  }

  // Close ALL sessions (used by /api/stop)
  closeActiveSession() {
    for (const [convId, session] of this.sessions) {
      if (session.idleTimer) clearTimeout(session.idleTimer);
      try {
        session.process.kill('SIGTERM');
      } catch (e) {}
    }
    this.sessions.clear();
    console.log(`[SessionManager] All sessions closed.`);
  }

  // Evict the least recently used non-busy session
  _evictLRU() {
    let oldest = null;
    let oldestKey = null;

    for (const [convId, session] of this.sessions) {
      if (session.isBusy) continue; // never evict a busy session
      if (!oldest || session.lastUsedAt < oldest.lastUsedAt) {
        oldest = session;
        oldestKey = convId;
      }
    }

    if (oldestKey) {
      console.log(`[SessionManager] Evicting LRU session: ${oldestKey} (lastUsed: ${new Date(oldest.lastUsedAt).toLocaleTimeString()})`);
      this.closeSession(oldestKey);
    } else {
      // All sessions busy — force evict the oldest anyway
      for (const [convId, session] of this.sessions) {
        if (!oldest || session.lastUsedAt < oldest.lastUsedAt) {
          oldest = session;
          oldestKey = convId;
        }
      }
      if (oldestKey) {
        console.log(`[SessionManager] Force evicting oldest busy session: ${oldestKey}`);
        this.closeSession(oldestKey);
      }
    }
  }

  // Handle deletion of a session
  onSessionDeleted(convId) {
    this.closeSession(convId);
  }

  // Get current pool status (for debugging / future API)
  getStatus() {
    const sessions = [];
    for (const [convId, session] of this.sessions) {
      sessions.push({
        conversationId: convId,
        model: session.model,
        isBusy: session.isBusy,
        pid: session.process ? session.process.pid : null,
        alive: session.process ? !session.process.killed : false,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt
      });
    }
    return {
      maxSessions: MAX_SESSIONS,
      activeSessions: sessions,
      prewarm: {
        inFlight: Boolean(this.prewarmInFlight),
        blockedUntil: this.prewarmBlockedUntil || 0,
        failureReason: this.prewarmFailureReason || null
      }
    };
  }
}

const sessionManager = new ActiveSessionManager();

module.exports = {
  ActiveSessionManager,
  sessionManager
};
