const { DEFAULT_ROLE_ID, getRole, deleteRole } = require('./roles');
const { defaultMemoryProvider } = require('./memory');
const { clearRoleConversation } = require('./role-runtime');
const { removePendingCrewMessagesForRole } = require('./crew-messages');
const { markRoleDeleted } = require('./conversation-settings');

async function deleteRoleLifecycle(roleId, {
  getRoleFn = getRole,
  deleteRoleFn = deleteRole,
  memoryProvider = defaultMemoryProvider,
  clearRoleRuntimeFn = clearRoleConversation,
  removePendingMessagesFn = removePendingCrewMessagesForRole,
  markRoleDeletedFn = markRoleDeleted,
  stopActiveRoleFn = async () => false,
  now = () => Date.now()
} = {}) {
  const id = String(roleId || '').trim();
  if (!id) throw new Error('Role id is required');
  if (id === DEFAULT_ROLE_ID) throw new Error('General Developer is the default Role and cannot be deleted');

  const role = await getRoleFn(id);
  if (!role) throw new Error('Role does not exist');

  const deletedAt = Number(now()) || Date.now();
  const stoppedActiveWork = Boolean(await stopActiveRoleFn(role));

  // Preserve immutable history references before deleting the live identity.
  const conversationSnapshots = await markRoleDeletedFn(role.id, role.name, deletedAt);
  const messageCleanup = await removePendingMessagesFn(role.id, role.name);
  const deletedMemories = await memoryProvider.forgetRole(role.id);
  const runtimeDeleted = Boolean(await clearRoleRuntimeFn(role.id));

  const deletedRole = await deleteRoleFn(role.id);
  if (!deletedRole) throw new Error('Role disappeared before deletion completed');

  return {
    role: deletedRole,
    deletedAt,
    stoppedActiveWork,
    deletedMemories: Number(deletedMemories) || 0,
    runtimeDeleted,
    pendingMessagesDeleted: Number(messageCleanup?.removed) || 0,
    historicalMessagesPreserved: Number(messageCleanup?.preserved) || 0,
    conversationSnapshots: Number(conversationSnapshots) || 0
  };
}

module.exports = { deleteRoleLifecycle };
