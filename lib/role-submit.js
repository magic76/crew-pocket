'use strict';
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { resolveRoleRuntime, isRoleRuntimeBusy } = require('./crew-auto-response');

// Adapt the existing HTTP/SSE chat handler to a durable queued request. No
// provider dispatch, prompt/context assembly, or history pipeline lives here.
function runChatInBackground(handleChat, body) {
  return new Promise((resolve, reject) => {
    const res = new EventEmitter();
    let payload = null;
    let statusCode = 200;
    res.writableEnded = false;
    res.destroyed = false;
    res.writeHead = code => { statusCode = code; };
    res.write = chunk => {
      const text = String(chunk);
      if (text.startsWith('event: done\n')) payload = JSON.parse(text.split('\ndata: ')[1].trim());
      else if (text.startsWith('event: init\n')) {
        const init = JSON.parse(text.split('\ndata: ')[1].trim());
        res.conversationId = init.conversation_id;
      }
      return true;
    };
    res.end = text => {
      res.writableEnded = true;
      res.emit('finish');
      if (text) payload = JSON.parse(String(text));
      resolve({ ...payload, statusCode, started: Boolean(res.conversationId), conversation_id: payload?.conversation_id || res.conversationId || body.conversation_id });
    };
    Promise.resolve(handleChat({ headers: {} }, res, body)).catch(reject);
  });
}

function createRoleSubmitter({ store, getRole, validateImage, runChat, ...runtimeDeps }) {
  const activeRoles = new Set();
  async function runtimeFor(roleId) {
    const role = await getRole(roleId);
    if (!role) throw new Error('Role 不存在');
    const runtime = await resolveRoleRuntime(roleId, runtimeDeps);
    if (!runtime) throw new Error('Role 的 Provider 尚未準備好');
    return runtime;
  }
  async function submit(body) {
    const roleId = body.role_id;
    const requestId = body.request_id;
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) throw new Error('Invalid submission id');
    if (typeof roleId !== 'string' || !/^[A-Za-z0-9._-]{1,160}$/.test(roleId)) throw new Error('Invalid Role');
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 5000) throw new Error('需求必須為 1–5000 字');
    if (typeof body.image_path !== 'string' || body.image_path.length > 2048) throw new Error('圖片路徑無效');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify([roleId, body.prompt, body.image_path])).digest('hex');
    const previous = (await store.readReceipts())[requestId];
    if (previous) {
      if (previous.fingerprint !== fingerprint) { const error = new Error('此提交編號已用於另一項需求'); error.statusCode = 409; throw error; }
      return previous;
    }
    // Text-only map / quick-share messages have no image; keep validation strict for nonempty paths.
    if (body.image_path) await validateImage(body.image_path);
    const runtime = await runtimeFor(roleId);
    // Ignore all caller-supplied provider/model/workspace/conversation/context.
    return store.submitOnce({ roleId, providerId: runtime.providerId,
      conversationId: runtime.conversationId, text: body.prompt, imagePath: body.image_path }, requestId, fingerprint);
  }
  async function drain(roleId) {
    if (activeRoles.has(roleId)) return;
    activeRoles.add(roleId);
    try {
      const messages = await store.list(roleId);
      const next = messages[0]; // Never overtake earlier chat queue entries.
      if (!next || next.source !== 'quick-share') return;
      const receipt = (await store.readReceipts())[next.id];
      if (receipt?.status !== 'queued') return; // uncertain interrupted dispatch is never replayed
      const runtime = await runtimeFor(roleId);
      if (isRoleRuntimeBusy(runtime, runtimeDeps) || runtimeDeps.isRoleReserved?.(roleId)) return;
      await store.updateSubmission(next.id, { status: 'running' });
      try {
        const result = await runChat({ role_id: roleId, provider: runtime.providerId,
          conversation_id: runtime.conversationId || null, model: runtime.model,
          effort: runtime.effort, workspace: runtime.workspace,
          prompt: next.text, image_path: next.imagePath });
        const busy = result.code === 'CONVERSATION_BUSY' && !result.started;
        // Provider guard rejects before any turn starts; only this is safely retryable.
        await store.updateSubmission(next.id, {
          status: busy ? 'queued' : result.error || ['failed', 'interrupted', 'cancelled'].includes(result.status) ? 'failed' : 'completed',
          error: result.error || null, conversationId: result.conversation_id || runtime.conversationId,
          providerId: runtime.providerId
        }, !busy);
        runtimeDeps.onQueueChanged?.(roleId);
      } catch (error) {
        await store.updateSubmission(next.id, { status: 'failed', error: error.message }, true);
      }
    } finally {
      activeRoles.delete(roleId);
    }
  }
  async function recoverInterrupted() {
    for (const receipt of Object.values(await store.readReceipts())) {
      if (receipt.status === 'running') await store.updateSubmission(receipt.requestId,
        { status: 'unknown', error: 'Runtime 在執行途中結束；請查看目標對話確認結果，勿重複提交。' }, true);
    }
  }
  async function drainAll() {
    const roles = [...new Set((await store.list()).filter(item => item.source === 'quick-share').map(item => item.roleId))];
    await Promise.all(roles.map(roleId => drain(roleId)));
  }
  return { submit, drain, drainAll, recoverInterrupted, activeRoles };
}
module.exports = { createRoleSubmitter, runChatInBackground };
