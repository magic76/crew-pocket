'use strict';
// Strictly read-only, Role-scoped projection of provider messages for Crew World.
// Never activates another conversation, loads memory, or returns tool/thinking traces.
const ROLE_ID = /^[A-Za-z0-9._-]{1,160}$/;
function projectReplies(history, limit = 8) {
  const raw = Array.isArray(history?.messages) ? history.messages : [];
  return raw.filter(message =>
    message && message.role === 'assistant' && typeof message.content === 'string' &&
    message.content.trim()
  ).slice(-Math.min(12,Math.max(1,limit))).map((message,position) => ({
    id: String(message.id || message.message_id || position).slice(0,160),
    role: 'assistant',
    text: message.content.trim().slice(0,6000),
    timestamp: typeof message.timestamp === 'string' ? message.timestamp.slice(0,40) : null
  }));
}
function createWorldChatHistory({getRole,getRoleRuntime,getConversationSettings,getProvider}) {
  return async function readWorldChat(roleId) {
    if(typeof roleId!=='string'||!ROLE_ID.test(roleId)) {
      const error=new Error('Invalid Role ID');error.statusCode=400;throw error;
    }
    const role=await getRole(roleId);
    if(!role){const error=new Error('Role not found');error.statusCode=404;throw error;}
    const runtime=await getRoleRuntime(roleId);
    if(!runtime?.conversationId||!runtime?.providerId){
      return {roleId,conversationId:null,messages:[],busy:false};
    }
    const settings=await getConversationSettings(runtime.providerId,runtime.conversationId);
    if(!settings || settings.roleId !== roleId){
      const error=new Error('Role conversation ownership could not be verified');
      error.statusCode=409;throw error;
    }
    const provider=getProvider(runtime.providerId);
    if(typeof provider?.getHistory!=='function')throw new Error('Provider does not support history');
    const history=await provider.getHistory(runtime.conversationId);
    let busy=false;
    try{busy=provider.getStatus?.(runtime.conversationId)?.isBusy===true;}catch(_){}
    return {
      roleId,conversationId:runtime.conversationId,
      messages:projectReplies(history),busy
    };
  };
}
module.exports={createWorldChatHistory,projectReplies};
