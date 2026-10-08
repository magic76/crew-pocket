const path = require('node:path');
const crypto = require('node:crypto');
const { HOME_DIR, listWorkspaces } = require('./workspaces');

function cleanText(value, maxLength = 160) {
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

function projectForWorkspace(workspace) {
  const name = projectLabelFor(workspace);
  const hash = shortHash(workspace.path);
  return {
    id: `project-${slug(name)}-${hash}`,
    name,
    workspace: workspace.path,
    icon: workspace.icon || (workspace.path === HOME_DIR ? '🏠' : '📁'),
    systemContext: '',
    source: 'workspace'
  };
}

async function listProjects() {
  return (await listWorkspaces()).map(projectForWorkspace);
}

async function getProject(projectId) {
  const id = cleanText(projectId, 160);
  if (!id) return null;
  return (await listProjects()).find(project => project.id === id) || null;
}

async function getProjectByWorkspace(workspace) {
  const target = String(workspace || '').trim();
  if (!target) return null;
  return (await listProjects()).find(project => project.workspace === target) || null;
}

module.exports = { listProjects, getProject, getProjectByWorkspace, projectForWorkspace };
