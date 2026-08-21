const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('node:events');
const { StringDecoder } = require('node:string_decoder');
const { BRAIN_DIR, IDLE_TIMEOUT_MS } = require('./config');

const MAX_SESSIONS = 2;

class ActiveSessionManager {
  constructor() {
    this.sessions = new Map(); // key: conversationId, value: sessionObj
  }

  // Get or initialize persistent session (pool of up to MAX_SESSIONS)
  async getOrCreateSession(targetConversationId, targetModel) {
    // Try to find an existing session that matches
    if (targetConversationId && this.sessions.has(targetConversationId)) {
      const existing = this.sessions.get(targetConversationId);
      if (existing.process && !existing.process.killed) {
        const modelMatches = !targetModel || existing.model === targetModel;
        if (modelMatches) {
          existing.lastUsedAt = Date.now();
          this.resetIdleTimer(existing);
          console.log(`[SessionManager] Reusing existing session: ${targetConversationId} (Pool: ${this.sessions.size}/${MAX_SESSIONS})`);
          return existing;
        } else {
          // Model changed for same conversation — close old, spawn new
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
      if (standby.process && !standby.process.killed && (!targetModel || standby.model === targetModel) && !standby.isBusy) {
        console.log(`[SessionManager] ⚡ Instantly attaching prewarmed standby session! (0ms cold start spawn)`);
        standby.lastUsedAt = Date.now();
        this.resetIdleTimer(standby);
        return standby;
      }
    }

    // If pool is full, evict the least recently used non-busy session
    if (this.sessions.size >= MAX_SESSIONS) {
      this._evictLRU();
    }

    console.log(`[SessionManager] Spawning resident agy process for session: ${targetConversationId || 'NEW'} (Model: ${targetModel || 'default'}) (Pool: ${this.sessions.size}/${MAX_SESSIONS})`);

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
      if (targetModel.endsWith('-low')) {
        args.push('--effort', 'low');
      } else if (targetModel.endsWith('-medium')) {
        args.push('--effort', 'medium');
      } else if (targetModel.endsWith('-high')) {
        args.push('--effort', 'high');
      }
    }

    if (validConvId) {
      args.push('--conversation', validConvId);
    }

    const child = spawn('agy', args, {
      cwd: '/data/data/com.termux/files/home',
      env: process.env
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);

    const sessionObj = {
      conversationId: validConvId || null,
      model: targetModel || 'gemini-3.7-flash-high',
      process: child,
      emitter,
      decoder: new StringDecoder('utf8'),
      isBusy: false,
      idleTimer: null,
      buffer: '',
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    };

    // Set up stdout stream parsing and dynamic conversation_id registration with lossless UTF-8 streaming
    child.stdout.on('data', (chunk) => {
      const textChunk = typeof chunk === 'string' ? chunk : sessionObj.decoder.write(chunk);
      sessionObj.buffer += textChunk;
      const lines = sessionObj.buffer.split('\n');
      sessionObj.buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          if (item.event === 'init' && item.conversation_id) {
            const oldConvId = sessionObj.conversationId;
            sessionObj.conversationId = item.conversation_id;
            console.log(`[SessionManager] Resident session initialized: ${sessionObj.conversationId} (Pool: ${this.sessions.size}/${MAX_SESSIONS})`);

            if (this.sessions.get('__standby__') === sessionObj) {
              this.sessions.delete('__standby__');
            }
            if (oldConvId && this.sessions.has(oldConvId)) {
              this.sessions.delete(oldConvId);
            }
            this.sessions.set(sessionObj.conversationId, sessionObj);
            this.resetIdleTimer(sessionObj);

            // Asynchronously pre-warm the next standby session in background
            setTimeout(() => this.prewarm(sessionObj.model), 1500);
          }
          emitter.emit('event', item);
        } catch (e) {
          emitter.emit('raw', line);
        }
      }
    });

    child.stderr.on('data', (errChunk) => {
      console.error(`[Resident agy stderr] ${errChunk.toString()}`);
    });

    child.on('close', (code) => {
      console.log(`[SessionManager] Resident process exited with code ${code} (conv: ${sessionObj.conversationId})`);
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

  // 🔥 Pre-warm a background standby session for 0ms cold-start spawn
  prewarm(targetModel = 'gemini-3.7-flash-low') {
    if (this.sessions.has('__standby__')) return;
    if (this.sessions.size >= MAX_SESSIONS) return;
    try {
      console.log(`[SessionManager] 🔥 Pre-warming background standby session (Model: ${targetModel})...`);
      this.getOrCreateSession(null, targetModel);
    } catch (e) {
      console.warn(`[SessionManager] Prewarm error:`, e.message);
    }
  }

  // Reset idle timer for a specific session
  resetIdleTimer(session) {
    if (!session) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      console.log(`[SessionManager] Session ${session.conversationId} idle for 30m, sleeping to save battery/RAM. (Pool: ${this.sessions.size - 1}/${MAX_SESSIONS})`);
      this.closeSession(session.conversationId);
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
    if (!convId) return;
    const session = this.sessions.get(convId);
    if (session) {
      if (session.idleTimer) clearTimeout(session.idleTimer);
      try {
        session.process.kill('SIGTERM');
      } catch (e) {}
      this.sessions.delete(convId);
      console.log(`[SessionManager] Closed session: ${convId} (Pool: ${this.sessions.size}/${MAX_SESSIONS})`);
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
    return { maxSessions: MAX_SESSIONS, activeSessions: sessions };
  }
}

const sessionManager = new ActiveSessionManager();

module.exports = {
  ActiveSessionManager,
  sessionManager
};
