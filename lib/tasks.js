const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { BRAIN_DIR } = require('./config');

const TASKS_PATH = path.join(BRAIN_DIR, '.crew-pocket-tasks.json');
let mutationQueue = Promise.resolve();

function cleanText(value, maxLength = 7000) {
  return String(value || '').trim().slice(0, maxLength);
}

function taskTitle(task) {
  const firstLine = cleanText(task, 120).split(/\r?\n/)[0];
  return firstLine || '未命名任務';
}

async function readTasksFile() {
  try {
    const raw = await fs.readFile(TASKS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.tasks) ? parsed.tasks : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeTasksFile(tasks) {
  await fs.mkdir(BRAIN_DIR, { recursive: true });
  const tempPath = `${TASKS_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify({ version: 1, tasks }, null, 2), 'utf8');
  await fs.rename(tempPath, TASKS_PATH);
}

function mutateTasks(mutator) {
  const run = mutationQueue.then(async () => {
    const tasks = await readTasksFile();
    const result = await mutator(tasks);
    await writeTasksFile(tasks);
    return result;
  });
  mutationQueue = run.catch(() => {});
  return run;
}

function addEvent(task, type, message) {
  if (!message) return;
  if (!Array.isArray(task.events)) task.events = [];
  task.events.push({ at: Date.now(), type: cleanText(type, 40) || 'info', message: cleanText(message, 800) });
  if (task.events.length > 40) task.events.splice(0, task.events.length - 40);
}

async function createTask(input = {}) {
  return mutateTasks(tasks => {
    const now = Date.now();
    const task = {
      id: crypto.randomUUID(),
      source: cleanText(input.source, 40) || 'main_chat',
      provider: cleanText(input.provider, 80) || 'antigravity',
      conversationId: cleanText(input.conversationId, 160),
      model: cleanText(input.model, 160),
      effort: cleanText(input.effort, 40) || 'low',
      title: cleanText(input.title, 160) || taskTitle(input.task),
      task: cleanText(input.task, 5000),
      status: cleanText(input.status, 40) || 'pending_confirmation',
      createdAt: now,
      updatedAt: now,
      result: '',
      error: '',
      events: []
    };
    addEvent(task, 'created', input.event || '已建立任務草稿，等待確認。');
    tasks.push(task);
    return task;
  });
}

async function getTask(id) {
  const tasks = await readTasksFile();
  return tasks.find(task => task.id === id) || null;
}

async function listTasks(limit = 80) {
  const tasks = await readTasksFile();
  return tasks
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, Math.max(1, Math.min(Number(limit) || 80, 200)));
}

async function updateTask(id, patch = {}, event = null) {
  return mutateTasks(tasks => {
    const task = tasks.find(item => item.id === id);
    if (!task) return null;
    const allowed = ['status', 'provider', 'conversationId', 'model', 'effort', 'title', 'result', 'error'];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) task[key] = cleanText(patch[key], key === 'result' || key === 'error' ? 7000 : 5000);
    }
    task.updatedAt = Date.now();
    if (event) addEvent(task, event.type, event.message);
    return task;
  });
}

module.exports = { createTask, getTask, listTasks, updateTask };
