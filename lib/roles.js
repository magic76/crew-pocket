const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { listProjects, getProject } = require('./projects');

const DEFAULT_ROLE_ID = 'role-general';
const DEFAULT_ROLE_NAME = 'General';
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

function compactLegacyRoleName(value) {
  const name = cleanText(value, 120);
  if (name === 'General Developer') return DEFAULT_ROLE_NAME;
  const crewMatch = name.match(/^Crew\s+(.+?)\s+Developer$/i);
  if (crewMatch) return `${crewMatch[1].trim()} Dev`;
  return name;
}

function developerRoleNameForProject(project) {
  const raw = cleanText(project?.name, 120);
  if (!raw || raw.toLowerCase() === 'general') return DEFAULT_ROLE_NAME;
  let readable = raw
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
  readable = readable.replace(/^Crew\s+/i, '');
  return `${readable} Dev`;
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

  async readState() {
    try {
      const raw = await fs.readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        exists: true,
        roles: Array.isArray(parsed?.roles) ? parsed.roles : []
      };
    } catch (error) {
      if (error.code === 'ENOENT') return { exists: false, roles: [] };
      throw error;
    }
  }

  async readSaved() {
    return (await this.readState()).roles;
  }

  async writeSaved(roles) {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    const tempPath = `${this.storagePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify({
      version: 2,
      bootstrapped: true,
      roles
    }, null, 2) + '\n', 'utf8');
    await fs.rename(tempPath, this.storagePath);
  }

  async loadSeededRoles() {
    const state = await this.readState();
    const now = Date.now();
    const byId = new Map(state.roles.map(role => [role.id, role]));
    let changed = false;

    for (const [id, role] of byId.entries()) {
      const compactName = compactLegacyRoleName(role?.name);
      if (compactName && compactName !== role?.name) {
        byId.set(id, { ...role, name: compactName });
        changed = true;
      }
    }

    // General Developer is the permanent fallback identity.
    if (!byId.has(DEFAULT_ROLE_ID)) {
      byId.set(DEFAULT_ROLE_ID, defaultRole(now));
      changed = true;
    }

    // Project-derived Roles are bootstrap convenience only. Once the Role
    // store exists, a missing Role is treated as an intentional deletion and
    // is never recreated just because the Project still exists.
    if (!state.exists) {
      const projects = await this.projectProvider.listProjects();
      const projectSeeds = projects
        .filter(project => cleanText(project?.name, 120).toLowerCase() !== 'general')
        .map(project => roleSeedForProject(project, now));
      for (const seed of projectSeeds) {
        if (byId.has(seed.id)) continue;
        byId.set(seed.id, seed);
        changed = true;
      }
    }

    const roles = [...byId.values()].map(role => normalizeRole(role, {}, now));
    if (!state.exists || changed) await this.writeSaved(roles);
    return roles;
  }

  async ensureSeeded() {
    const run = this.mutationQueue.then(async () =>
      (await this.loadSeededRoles()).sort((a, b) => a.name.localeCompare(b.name, 'en'))
    );
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
      const saved = await this.loadSeededRoles();
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
        source: existing?.source === 'default' ? 'default' : 'saved'
      }, {}, now);
      if (existingIndex >= 0) saved[existingIndex] = role;
      else saved.push(role);
      await this.writeSaved(saved);
      return role;
    });
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  async delete(roleId) {
    const id = validateRoleId(roleId);
    if (id === DEFAULT_ROLE_ID) throw new Error('General Developer is the default Role and cannot be deleted');

    const run = this.mutationQueue.then(async () => {
      const saved = await this.loadSeededRoles();
      const existing = saved.find(role => role.id === id) || null;
      if (!existing) return null;
      await this.writeSaved(saved.filter(role => role.id !== id));
      return existing;
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
  compactLegacyRoleName,
  roleIdForProject,
  listRoles: () => defaultRoleStore.list(),
  getRole: roleId => defaultRoleStore.get(roleId),
  saveRole: input => defaultRoleStore.save(input),
  deleteRole: roleId => defaultRoleStore.delete(roleId)
};
