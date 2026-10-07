const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { listProjects, getProject } = require('./projects');

const DEFAULT_ROLE_ID = 'role-general';
const DEFAULT_ROLE_NAME = 'General Developer';
const DEFAULT_ROLES_PATH = path.join(
  process.env.HOME || '/data/data/com.termux/files/home',
  '.crew-pocket',
  'roles.json'
);

function cleanText(value, maxLength = 4000) {
  return String(value || '').trim().slice(0, maxLength);
}

function roleIdForProject(projectId) {
  const suffix = cleanText(projectId, 160)
    .replace(/^project-/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return suffix ? `role-${suffix}` : `role-${crypto.randomUUID()}`;
}

function validateRoleId(value) {
  const id = cleanText(value, 160);
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(id)) throw new Error('Invalid role id');
  return id;
}

function normalizeRole(input = {}, fallback = {}, now = Date.now()) {
  const createdAt = Number(input.createdAt || fallback.createdAt) || now;
  return {
    id: validateRoleId(input.id || fallback.id || `role-${crypto.randomUUID()}`),
    name: cleanText(input.name || fallback.name || 'Developer', 120),
    description: cleanText(input.description ?? fallback.description, 1200),
    projectId: cleanText(input.projectId ?? fallback.projectId, 160) || null,
    systemContext: cleanText(input.systemContext ?? fallback.systemContext, 6000),
    skills: Array.isArray(input.skills ?? fallback.skills)
      ? [...new Set((input.skills ?? fallback.skills).map(value => cleanText(value, 120)).filter(Boolean))].slice(0, 64)
      : [],
    createdAt,
    updatedAt: Number(input.updatedAt) || now,
    source: cleanText(input.source || fallback.source || 'saved', 40)
  };
}

function defaultRole(now = Date.now()) {
  return normalizeRole({
    id: DEFAULT_ROLE_ID,
    name: DEFAULT_ROLE_NAME,
    description: 'Default long-lived developer role for conversations that predate Role support.',
    projectId: null,
    systemContext: '',
    skills: [],
    createdAt: now,
    updatedAt: now,
    source: 'default'
  }, {}, now);
}

function developerRoleNameForProject(project) {
  const raw = cleanText(project?.name, 120);
  if (!raw || raw.toLowerCase() === 'general') return DEFAULT_ROLE_NAME;
  const readable = raw
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
  return `${readable} Developer`;
}

function roleSeedForProject(project, now = Date.now()) {
  return normalizeRole({
    id: roleIdForProject(project.id),
    name: developerRoleNameForProject(project),
    description: `Long-lived developer role for ${project.name}.`,
    projectId: project.id,
    systemContext: '',
    skills: [],
    createdAt: now,
    updatedAt: now,
    source: 'project'
  }, {}, now);
}

class RoleStore {
  constructor({ storagePath = DEFAULT_ROLES_PATH, projectProvider = { listProjects, getProject } } = {}) {
    this.storagePath = storagePath;
    this.projectProvider = projectProvider;
    this.mutationQueue = Promise.resolve();
  }

  async readSaved() {
    try {
      const raw = await fs.readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.roles) ? parsed.roles : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async writeSaved(roles) {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    const tempPath = `${this.storagePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify({ version: 1, roles }, null, 2) + '\n', 'utf8');
    await fs.rename(tempPath, this.storagePath);
  }

  async ensureSeeded() {
    const run = this.mutationQueue.then(async () => {
      const [saved, projects] = await Promise.all([
        this.readSaved(),
        this.projectProvider.listProjects()
      ]);
      const now = Date.now();
      const byId = new Map(saved.map(role => [role.id, role]));
      let changed = false;

      const projectSeeds = projects
        .filter(project => cleanText(project?.name, 120).toLowerCase() !== 'general')
        .map(project => roleSeedForProject(project, now));
      const seeds = [defaultRole(now), ...projectSeeds];
      for (const seed of seeds) {
        if (byId.has(seed.id)) continue;
        byId.set(seed.id, seed);
        changed = true;
      }

      const roles = [...byId.values()].map(role => normalizeRole(role, {}, now));
      if (changed) await this.writeSaved(roles);
      return roles.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  async list() {
    return this.ensureSeeded();
  }

  async get(roleId) {
    const id = cleanText(roleId, 160) || DEFAULT_ROLE_ID;
    return (await this.list()).find(role => role.id === id) || null;
  }

  async save(input = {}) {
    const run = this.mutationQueue.then(async () => {
      const saved = await this.readSaved();
      const now = Date.now();
      const id = validateRoleId(input.id || `role-${crypto.randomUUID()}`);
      const existingIndex = saved.findIndex(role => role.id === id);
      const existing = existingIndex >= 0 ? saved[existingIndex] : null;
      const projectId = cleanText(input.projectId ?? existing?.projectId, 160) || null;
      if (projectId && !(await this.projectProvider.getProject(projectId))) {
        throw new Error('Role project does not exist');
      }
      const role = normalizeRole({
        ...existing,
        ...input,
        id,
        projectId,
        createdAt: existing?.createdAt || input.createdAt || now,
        updatedAt: now,
        source: 'saved'
      }, {}, now);
      if (existingIndex >= 0) saved[existingIndex] = role;
      else saved.push(role);
      await this.writeSaved(saved);
      return role;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }
}

const defaultRoleStore = new RoleStore();

module.exports = {
  DEFAULT_ROLE_ID,
  DEFAULT_ROLE_NAME,
  RoleStore,
  normalizeRole,
  developerRoleNameForProject,
  roleIdForProject,
  listRoles: () => defaultRoleStore.list(),
  getRole: roleId => defaultRoleStore.get(roleId),
  saveRole: input => defaultRoleStore.save(input)
};
