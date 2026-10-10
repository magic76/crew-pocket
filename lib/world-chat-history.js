'use strict';
// Strictly read-only, Role-scoped projection of visible conversation messages for Crew World.
// Never activates another conversation, loads memory, or returns tool/thinking traces.
const ROLE_ID = /^[A-Za-z0-9._-]{1,160}$/;
function projectReplies(history, limit = 16) {
  const raw = Array.isArray(history?.messages) ? history.messages : [];
  return raw.filter(message =>
    message && ['user','assistant'].includes(message.role) && typeof message.content === 'string' &&
    message.content.trim()
  ).slice(-Math.min(32,Math.max(1,limit))).map((message,position) => ({
    id: String(message.id || message.message_id || position).slice(0,160),
    role: message.role,
    text: message.content.trim().slice(0,8000),
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
function createWorldChatLatest({readWorldChatHistory}) {
  return async function readLatestWorldReply(roleId) {
    const history=await readWorldChatHistory(roleId);
    const message=[...(history.messages||[])].reverse().find(item=>
      item.role==='assistant'&&typeof item.text==='string'&&item.text.trim());
    return {
      roleId,
      message:message?{
        id:message.id,
        text:message.text.slice(0,1200),
        timestamp:typeof message.timestamp==='string'?message.timestamp.slice(0,40):null
      }:null,
      busy:history.busy===true
    };
  };
}
// Receipt is keyed to exactly the request accepted by POST /api/role-submit.
// Do not conflate a conversation's latest unrelated assistant message with
// the answer for this particular user submission.
function createWorldChatResult({getRole,readReceipts}) {
  return async function readWorldChatResult(roleId,requestId) {
    if(typeof roleId!=='string'||!ROLE_ID.test(roleId)||
       typeof requestId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) {
      const error=new Error('Invalid Role submission query');error.statusCode=400;throw error;
    }
    if(!await getRole(roleId)){
      const error=new Error('Role not found');error.statusCode=404;throw error;
    }
    const receipt=(await readReceipts())[requestId];
    if(!receipt||receipt.roleId!==roleId){
      const error=new Error('Role submission not found');error.statusCode=404;throw error;
    }
    const status=['queued','running','completed','failed','unknown','cancelled'].includes(receipt.status)
      ?receipt.status:'unknown';
    return {
      roleId,requestId,status,
      response:status==='completed'&&typeof receipt.replyText==='string'
        ?receipt.replyText.slice(0,8000):'',
      truncated:status==='completed'&&receipt.replyTruncated===true,
      error:status==='failed'&&typeof receipt.error==='string'
        ?receipt.error.slice(0,300):null
    };
  };
}
module.exports={createWorldChatHistory,createWorldChatLatest,projectReplies,createWorldChatResult};
