const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { HOME_DIR, listWorkspaces, resolveWorkspace } = require('./workspaces');

const MEMBERS_DIR = path.join(HOME_DIR, '.crew-pocket');
const MEMBERS_PATH = path.join(MEMBERS_DIR, 'crew-members.json');
let mutationQueue = Promise.resolve();

function cleanText(value, maxLength = 4000) {
  return String(value || '').trim().slice(0, maxLength);
}

function slug(value) {
  return cleanText(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

function projectLabelFor(workspace) {
  const label = cleanText(workspace?.label, 120) || path.basename(workspace?.path || HOME_DIR) || 'Home';
  return label === 'Home' ? 'General' : label;
}

function defaultMemberName(workspace) {
  const name = String(workspace?.label || path.basename(workspace?.path || '') || '').toLowerCase();
  if (!name || name === 'home') return 'General Crew';
  if (name === 'agy-web' || name.includes('crew-pocket')) return 'Pocket Dev';
  if (name.includes('crew-teacher')) return 'Teacher Dev';
  if (name.includes('crew-story')) return 'Story Dev';
  if (name.includes('crew-fortune')) return 'Fortune Dev';
  if (name.includes('crew-helper')) return 'Helper Dev';
  return `${projectLabelFor(workspace)} Dev`;
}

function discoveredMember(workspace) {
  const projectLabel = projectLabelFor(workspace);
  const projectSlug = slug(projectLabel);
  const hash = shortHash(workspace.path);
  const isHome = workspace.path === HOME_DIR;
  return {
    id: `member-${projectSlug}-${hash}`,
    name: defaultMemberName(workspace),
    icon: workspace.icon || (isHome ? '🏠' : '💻'),
    role: isHome ? 'general' : 'software_engineer',
    workspace: workspace.path,
    project: { id: `project-${projectSlug}-${hash}`, label: projectLabel },
    provider: '',
    model: '',
    effort: '',
    instructions: '',
    source: 'workspace',
    updatedAt: 0
  };
}

async function readSavedMembers() {
  try {
    const raw = await fs.readFile(MEMBERS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.members) ? parsed.members : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeSavedMembers(members) {
  await fs.mkdir(MEMBERS_DIR, { recursive: true });
  const temporaryPath = `${MEMBERS_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify({ version: 1, members }, null, 2) + '\n', 'utf8');
  await fs.rename(temporaryPath, MEMBERS_PATH);
}

function normalizeSavedMember(input, fallback) {
  return {
    ...fallback,
    id: cleanText(input?.id, 160) || fallback.id,
    name: cleanText(input?.name, 120) || fallback.name,
    icon: cleanText(input?.icon, 16) || fallback.icon,
    role: cleanText(input?.role, 80) || fallback.role,
    project: {
      id: cleanText(input?.project?.id, 160) || fallback.project.id,
      label: cleanText(input?.project?.label, 160) || fallback.project.label
    },
    provider: cleanText(input?.provider, 80),
    model: cleanText(input?.model, 160),
    effort: cleanText(input?.effort, 40),
    instructions: cleanText(input?.instructions, 4000),
    source: input ? 'saved' : fallback.source,
    updatedAt: Number(input?.updatedAt) || fallback.updatedAt
  };
}

async function listCrewMembers() {
  const [workspaces, saved] = await Promise.all([listWorkspaces(), readSavedMembers()]);
  const savedByWorkspace = new Map(saved.map(item => [item.workspace, item]));
  return workspaces.map(workspace => normalizeSavedMember(savedByWorkspace.get(workspace.path), discoveredMember(workspace)));
}

async function getCrewMember(id) {
  const memberId = cleanText(id, 160);
  if (!memberId) return null;
  return (await listCrewMembers()).find(member => member.id === memberId) || null;
}

async function saveCrewMember(input = {}) {
  const workspace = await resolveWorkspace(input.workspace);
  const workspaces = await listWorkspaces();
  const workspaceMeta = workspaces.find(item => item.path === workspace);
  if (!workspaceMeta) throw new Error('Crew Member 必須綁定可用的專案工作區');
  const fallback = discoveredMember(workspaceMeta);

  const run = mutationQueue.then(async () => {
    const saved = await readSavedMembers();
    const existingIndex = saved.findIndex(item => item.workspace === workspace);
    const current = existingIndex >= 0 ? saved[existingIndex] : null;
    const member = normalizeSavedMember({
      ...current,
      ...input,
      id: current?.id || input.id || fallback.id,
      workspace,
      project: { ...(current?.project || {}), ...(input.project || {}) },
      updatedAt: Date.now()
    }, fallback);
    member.workspace = workspace;
    member.updatedAt = Date.now();
    if (existingIndex >= 0) saved[existingIndex] = member;
    else saved.push(member);
    await writeSavedMembers(saved);
    return member;
  });
  mutationQueue = run.catch(() => {});
  return run;
}

function buildCrewMemberGuide(member) {
  if (!member) return '';
  const custom = cleanText(member.instructions, 4000);
  return `[Crew Member Context]
You are ${member.name}, the persistent ${member.role || 'project assistant'} for project ${member.project?.label || 'this project'}.
Project workspace: ${member.workspace}
Treat this project as your durable ownership boundary. Keep project-specific decisions, files, task state, and assumptions isolated from other Crew Members. Conversation history is execution context, not your identity.${custom ? `\nProject instructions: ${custom}` : ''}`;
}

module.exports = { listCrewMembers, getCrewMember, saveCrewMember, buildCrewMemberGuide };
