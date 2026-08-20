const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('node:events');
const { BRAIN_DIR, IDLE_TIMEOUT_MS } = require('./config');

class ActiveSessionManager {
  constructor() {
    this.current = null; // { conversationId, process, emitter, isBusy, idleTimer, buffer }
    this.initPromise = null;
  }

  // Get or initialize persistent session
  async getOrCreateSession(targetConversationId, targetModel) {
    if (this.initPromise) {
      try {
        await this.initPromise;
      } catch (e) {}
    }

    // If targetConversationId matches current running session AND model matches (if specified), reuse it!
    if (targetConversationId && this.current && this.current.process && !this.current.process.killed) {
      const modelMatches = !targetModel || this.current.model === targetModel;
      if (this.current.conversationId === targetConversationId && modelMatches) {
        this.resetIdleTimer();
        return this.current;
      }
    }

    // Otherwise (new session requested, switching conversation or switching model): spawn new process
    this.closeActiveSession();

    console.log(`[SessionManager] Spawning resident agy process for session: ${targetConversationId || 'NEW'} (Model: ${targetModel || 'default'})`);
    
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
      buffer: ''
    };

    this.current = sessionObj;
    this.resetIdleTimer();

    let initDone = false;
    let timeoutTimer = null;

    this.initPromise = new Promise((resolve, reject) => {
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
              sessionObj.conversationId = item.conversation_id;
              console.log(`[SessionManager] Resident session initialized: ${sessionObj.conversationId}`);
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
      console.log(`[SessionManager] Resident process exited with code ${code}`);
      if (this.current === sessionObj) {
        this.current = null;
      }
    });

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
    return sessionObj;
  }

  resetIdleTimer() {
    if (!this.current) return;
    if (this.current.idleTimer) clearTimeout(this.current.idleTimer);
    this.current.idleTimer = setTimeout(() => {
      console.log(`[SessionManager] Session idle for 30m, sleeping process to save battery/RAM.`);
      this.closeActiveSession();
    }, IDLE_TIMEOUT_MS);
  }

  closeActiveSession() {
    if (this.current && this.current.process) {
      if (this.current.idleTimer) clearTimeout(this.current.idleTimer);
      try {
        this.current.process.kill('SIGTERM');
      } catch (e) {}
      this.current = null;
    }
  }

  // Handle deletion of a session
  onSessionDeleted(convId) {
    if (this.current && this.current.conversationId === convId) {
      this.closeActiveSession();
    }
  }
}

const sessionManager = new ActiveSessionManager();

module.exports = {
  ActiveSessionManager,
  sessionManager
};
