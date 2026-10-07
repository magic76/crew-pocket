const { listCrewMembers } = require('./crew-members');

async function listProjects() {
  const members = await listCrewMembers();
  const projects = new Map();
  for (const member of members) {
    const projectId = String(member?.project?.id || '').trim();
    if (!projectId || projects.has(projectId)) continue;
    projects.set(projectId, {
      id: projectId,
      name: String(member.project?.label || member.name || projectId),
      workspace: member.workspace || '',
      legacyCrewMemberId: member.id || '',
      systemContext: '',
      source: 'workspace'
    });
  }
  return [...projects.values()];
}

async function getProject(projectId) {
  const id = String(projectId || '').trim();
  if (!id) return null;
  return (await listProjects()).find(project => project.id === id) || null;
}

async function getProjectByWorkspace(workspace) {
  const target = String(workspace || '').trim();
  if (!target) return null;
  return (await listProjects()).find(project => project.workspace === target) || null;
}

module.exports = { listProjects, getProject, getProjectByWorkspace };
