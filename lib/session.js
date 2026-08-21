const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('node:events');
const { BRAIN_DIR, IDLE_TIMEOUT_MS } = require('./config');

const MAX_SESSIONS = 2;

class ActiveSessionManager {
  constructor() {
    this.sessions = new Map(); // key: conversationId, value: sessionObj
    this.initPromises = new Map(); // key: conversationId (or '__new__'), value: Promise
  }

  // Get or initialize persistent session (pool of up to MAX_SESSIONS)
  async getOrCreateSession(targetConversationId, targetModel) {
    // Wait for any pending init for this specific conversation
    const pendingKey = targetConversationId || '__new__';
    if (this.initPromises.has(pendingKey)) {
      try {
        await this.initPromises.get(pendingKey);
      } catch (e) {}
    }

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
      '--dangerously-skip-permissions'
    ];

    if (targetModel) {
      args.push('--model', targetModel);
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
      model: targetModel || 'gemini-3.7-flash-high',
      process: child,
      emitter,
      isBusy: false,
      idleTimer: null,
      buffer: '',
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    };

    let initDone = false;
    let timeoutTimer = null;

    const initPromise = new Promise((resolve, reject) => {
      timeoutTimer = setTimeout(() => {
        if (!initDone) {
          initDone = true;
          try { child.kill('SIGKILL'); } catch (e) {}
          reject(new Error('Timeout waiting for agy process initialization'));
        }
      }, 15000);

      const onInitData = (chunk) => {
        const text = chunk.toString();
        const lines = text.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const item = JSON.parse(line);
            if (item.event === 'init' && item.conversation_id) {
              const oldConvId = sessionObj.conversationId;
              sessionObj.conversationId = item.conversation_id;
              console.log(`[SessionManager] Resident session initialized: ${sessionObj.conversationId} (Pool: ${this.sessions.size + 1}/${MAX_SESSIONS})`);

              // If convId changed (new session got assigned an id), update the Map key
              if (oldConvId && this.sessions.has(oldConvId)) {
                this.sessions.delete(oldConvId);
              }
              this.sessions.set(sessionObj.conversationId, sessionObj);
              this.resetIdleTimer(sessionObj);

              if (!initDone) {
                initDone = true;
                clearTimeout(timeoutTimer);
                child.stdout.removeListener('data', onInitData);
                resolve();
              }
              return;
            }
          } catch (e) {}
        }
      };

      child.stdout.on('data', onInitData);

      child.once('error', (err) => {
        if (!initDone) {
          initDone = true;
          clearTimeout(timeoutTimer);
          reject(err);
        }
      });

      child.once('close', (code) => {
        if (!initDone) {
          initDone = true;
          clearTimeout(timeoutTimer);
          reject(new Error(`agy process exited prematurely with code ${code}`));
        }
      });
    });

    this.initPromises.set(pendingKey, initPromise);

    // Set up stdout stream parsing
    child.stdout.on('data', (chunk) => {
      sessionObj.buffer += chunk.toString();
      const lines = sessionObj.buffer.split('\n');
      sessionObj.buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
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
      if (sessionObj.conversationId && this.sessions.get(sessionObj.conversationId) === sessionObj) {
        if (sessionObj.idleTimer) clearTimeout(sessionObj.idleTimer);
        this.sessions.delete(sessionObj.conversationId);
      }
    });

    // Temporarily store with placeholder key until init resolves
    if (validConvId) {
      this.sessions.set(validConvId, sessionObj);
    }

    try {
      await initPromise;
    } finally {
      this.initPromises.delete(pendingKey);
    }
    return sessionObj;
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
