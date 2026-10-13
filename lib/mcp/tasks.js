'use strict';
// Persistent task ledger. Each handoff has an immutable identity; only the
// Pocket Web worker changes task status. A standalone MCP process only creates.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { getRole } = require('../roles');
const DEFAULT_DIR = process.env.CREW_MCP_TASK_DIR ||
  path.join(process.env.HOME || '/data/data/com.termux/files/home', '.crew-pocket', 'mcp-tasks');
const ROLE_RE = /^[A-Za-z0-9._-]{1,160}$/;
const TERMINAL = new Set(['completed','failed','interrupted','expired']);
function assertRole(value) {
  if (typeof value !== 'string' || !ROLE_RE.test(value)) throw new Error('Invalid Role ID');
  return value;
}
function safeText(value, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error('Expected non-empty task text (max ' + max + ')');
  return value.trim();
}

class CrewTaskStore {
  constructor({ storageDir = DEFAULT_DIR, resolveRole = getRole, now = Date.now } = {}) {
    this.storageDir = storageDir;
    this.resolveRole = resolveRole;
    this.now = now;
    this.mutationQueue = Promise.resolve();
  }
  filename(id) {
    if (!/^crew-task-[0-9a-f-]{36}$/.test(id || '')) throw new Error('Invalid task ID');
    return path.join(this.storageDir, id + '.json');
  }
  async get(id) {
    let file;
    try { file = this.filename(id); } catch (_) { return null; }
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async list() {
    let names;
    try { names = (await fs.readdir(this.storageDir)).filter(x => /^crew-task-[0-9a-f-]{36}\.json$/.test(x)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return (await Promise.all(names.map(name => this.get(name.slice(0,-5))))).filter(Boolean)
      .sort((a,b) => a.createdAt-b.createdAt);
  }
  async create({ fromRoleId, toRoleId, task, parentTaskId = null, timeoutMinutes = 30 }) {
    const from = assertRole(fromRoleId), to = assertRole(toRoleId);
    const instruction = safeText(task);
    if (from === to) throw new Error('Cannot hand off to the same Role');
    if (!(await this.resolveRole(from)) || !(await this.resolveRole(to))) throw new Error('Role not found');
    const duration = Math.max(5,Math.min(60,Math.trunc(Number(timeoutMinutes) || 30)));
    const operation = this.mutationQueue.then(async () => {
      const all = await this.list();
      const active = all.filter(x => ['queued','running'].includes(x.status));
      if (active.length >= 30 || active.filter(x=>x.fromRoleId===from).length >= 5)
        throw new Error('Crew task queue is full');
      let parent = null, depth=0;
      if (parentTaskId) {
        parent = all.find(t => t.id === parentTaskId);
        if (!parent || parent.toRoleId !== from || parent.status !== 'running')
          throw new Error('Parent task must be active and assigned to calling Role');
        depth = parent.depth+1;
        if (depth > 2) throw new Error('Maximum handoff depth reached');
        const ancestry = new Set([from, parent.fromRoleId]);
        let cursor = parent;
        while (cursor?.parentTaskId) {
          cursor = all.find(t => t.id === cursor.parentTaskId);
          if (cursor) ancestry.add(cursor.fromRoleId);
        }
        if (ancestry.has(to)) throw new Error('Circular task handoff is not allowed');
      }
      // Prevent accidental repeated tool invocations while a task is active.
      const duplicate = active.find(x=> x.fromRoleId===from && x.toRoleId===to &&
        x.parentTaskId===(parentTaskId || null) && x.task===instruction);
      if (duplicate) return { ...duplicate, duplicate: true };
      const now=this.now();
      const record = {
        id:'crew-task-'+crypto.randomUUID(), fromRoleId:from, toRoleId:to,
        task:instruction, parentTaskId:parentTaskId||null, depth,
        status:'queued', createdAt:now, updatedAt:now,
        deadlineAt:now+duration*60000, startedAt:null, finishedAt:null,
        conversationId:null, providerId:null, result:null, error:null
      };
      await fs.mkdir(this.storageDir,{recursive:true,mode:0o700});
      await fs.writeFile(this.filename(record.id),JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
      return record;
    });
    this.mutationQueue=operation.catch(()=>{});
    return operation;
  }
  // The Web Server is the sole status writer; workers serialize updates here.
  async transition(id, statuses, patch = {}) {
    const op = this.mutationQueue.then(async()=>{
      const task=await this.get(id);
      if (!task || !statuses.includes(task.status)) return null;
      const now=this.now();
      const next={...task,...patch,updatedAt:now};
      if (TERMINAL.has(next.status)) next.finishedAt=now;
      const tmp=this.filename(id)+'.'+process.pid+'.'+crypto.randomUUID()+'.tmp';
      await fs.writeFile(tmp,JSON.stringify(next,null,2)+'\n',{mode:0o600});
      await fs.rename(tmp,this.filename(id));
      return next;
    });
    this.mutationQueue=op.catch(()=>{});
    return op;
  }
  async report(roleId, taskId, summary) {
    const task=await this.get(taskId);
    if (!task || task.toRoleId!==assertRole(roleId) || task.status!=='running')
      throw new Error('No running task is assigned to this Role');
    const text=safeText(summary,2000);
    // An immutable report is safe to write from a separate MCP stdio process.
    const dir=path.join(this.storageDir,'reports');
    await fs.mkdir(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,taskId+'.json');
    try {
      await fs.writeFile(file,JSON.stringify({ taskId, roleId, summary:text, at:this.now() })+'\n',{flag:'wx',mode:0o600});
      return { taskId, status:'reported', summary:text };
    } catch (error) {
      if (error.code==='EEXIST') throw new Error('Task result already reported');
      throw error;
    }
  }
  async getReport(id) {
    this.filename(id);
    try {return JSON.parse(await fs.readFile(path.join(this.storageDir,'reports',id+'.json'),'utf8'));}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  async status(id, roleId) {
    const task=await this.get(id);
    if (!task) throw new Error('Task not found');
    if (![task.fromRoleId,task.toRoleId].includes(assertRole(roleId)))
      throw new Error('Task is not visible to this Role');
    return task;
  }
}
const defaultCrewTaskStore = new CrewTaskStore();
module.exports={ CrewTaskStore, defaultCrewTaskStore };
