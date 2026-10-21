'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');

// Load separate copies because binding mode is read from the environment once.
process.env.CREW_API_TOKEN = 'test-api-token-not-for-production';

function load(bindHost) {
  process.env.CREW_BIND_HOST = bindHost;
  const filename = require.resolve('../lib/http-security');
  delete require.cache[filename];
  return require('../lib/http-security');
}
function req({host='192.168.1.12:8000',address='192.168.1.99',origin='',cookie='',authorization='',userAgent='Test Browser'}={}) {
  return {socket:{remoteAddress:address},headers:{host,
    ...(origin?{origin}:{}),...(cookie?{cookie}:{}),
    ...(authorization?{authorization}:{}),'user-agent':userAgent}};
}
function response() {
  const headers=new Map();
  return {getHeader:name=>headers.get(name.toLowerCase()),
    setHeader:(name,value)=>headers.set(name.toLowerCase(),value)};
}
function cookies(res,name) {
  const values=res.getHeader('Set-Cookie')||[];
  const item=values.find(v=>v.startsWith(name+'='));
  assert.ok(item,'expected '+name+' cookie');
  return item.split(';')[0];
}
test('Localhost remains zero-config, foreign Host/Origin requests stay blocked',()=>{
    const security=load('127.0.0.1');
    const local=req({host:'127.0.0.1:8000',address:'127.0.0.1'});
    assert.equal(security.authorizeApiRequest(local,{}).ok,true);
    assert.equal(security.authorizeWebSocket(local,{}).ok,true);
    assert.equal(security.authorizeApiRequest(req({host:'evil.example',address:'127.0.0.1'}),{}).statusCode,403);
    assert.equal(security.authorizeApiRequest(req({host:'127.0.0.1:8000',address:'127.0.0.1',origin:'http://evil.example'}),{}).statusCode,403);
  });
test('LAN REST and WebSocket reject unpaired and stale-cookie clients',()=>{
    const security=load('0.0.0.0');
    const guest=req();
    assert.equal(security.authorizeApiRequest(guest,{}).statusCode,401);
    assert.equal(security.authorizeWebSocket(guest,{}).statusCode,401);
    assert.equal(security.authorizeApiRequest(req({cookie:'crew_remote_session=invalid'}),{}).statusCode,401);
    assert.equal(security.authorizeApiRequest(req({origin:'http://evil.example',authorization:'Bearer test-api-token-not-for-production'}),{}).statusCode,403);
    const ticket=security.createRemotePairing();
    const r=response(),first=req();
    assert.equal(security.maybeSetPairingCookie(first,r,{query:{pair:ticket.ticket}}),true);
    const cookie=cookies(r,'crew_remote_session');
    assert.match(r.getHeader('Set-Cookie')[0],/HttpOnly/);
    assert.equal(security.authorizeApiRequest(req({cookie}),{}).ok,true);
    assert.equal(security.authorizeWebSocket(req({cookie,origin:'http://192.168.1.12:8000'}),{}).ok,true);
    assert.equal(security.maybeSetPairingCookie(req(),response(),{query:{pair:ticket.ticket}}),false,'ticket must be single-use');
    assert.equal(security.revokeRemoteConnection(first.crewRemoteSession.id),true);
    assert.equal(security.authorizeApiRequest(req({cookie}),{}).statusCode,401);
    assert.equal(security.authorizeWebSocket(req({cookie}),{}).statusCode,401);
  });
test('Explicit legacy API token remains accepted; cookies are HttpOnly',()=>{
    const security=load('0.0.0.0');
    const supplied=req({authorization:'Bearer test-api-token-not-for-production'});
    assert.equal(security.authorizeApiRequest(supplied,{}).ok,true);
    assert.equal(security.authorizeWebSocket(supplied,{}).ok,true);
    const r=response();
    assert.equal(security.maybeSetAuthCookie(r,{query:{token:'test-api-token-not-for-production'}}),true);
    assert.match(r.getHeader('Set-Cookie')[0],/HttpOnly/);
    assert.equal(security.authorizeApiRequest(req({cookie:cookies(r,'crew_api_token')}),{}).ok,true);
  });
