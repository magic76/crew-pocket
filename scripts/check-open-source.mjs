#!/usr/bin/env node
/* Cheap checkout-only hygiene gate; not a replacement for Git history/secret scans. */
'use strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const forbidden=[
  /(^|\/)\.env(?:\.[^/]*)?$/i,
  /(^|\/)(?:auth|credentials)\.json$/i,
  /(^|\/)api-token$/i,
  /(^|\/)transcript(?:_full)?\.jsonl$/i,
  /(^|\/)id_(?:rsa|ed25519)$/i,
  /\.(?:pem|p12|pfx|keystore|jks|key)$/i,
  /^(?:\.codex|\.gemini|\.crew-pocket)\//i,
  /^scratch\/run_[^/]+\.(?:sh|py|js)$/i
];
const textExtensions=new Set(['.js','.mjs','.cjs','.ts','.tsx','.json','.yaml','.yml','.md','.sh','.py','.html','.txt','.toml']);
const tokenPatterns=[
  /\bghp_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g,
  /\bsk-proj-[A-Za-z0-9_-]{30,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY-----/g
];
const violations=[];
for(const file of files){
  if(forbidden.some(pattern=>pattern.test(file))){
    violations.push(file+': tracked private credential/state/temp path');
    continue;
  }
  if(!textExtensions.has(extname(file).toLowerCase()))continue;
  if(/^(?:public\/vendor\/|lib\/vendor\/|public\/js\/.*\.min\.js$)/.test(file))continue;
  let content;
  try{
    const blob=readFileSync(file);
    if(blob.length>2*1024*1024 || blob.includes(0))continue;
    content=blob.toString('utf8');
  }catch{continue;}
  for(const pattern of tokenPatterns){
    pattern.lastIndex=0;
    if(pattern.test(content)){
      violations.push(file+': possible embedded credential (value intentionally suppressed)');
      break;
    }
  }
}
if(violations.length){
  console.error('Open-source hygiene check failed:\n'+violations.join('\n'));
  process.exitCode=1;
}else console.log('Open-source hygiene check passed ('+files.length+' tracked paths). This does not scan Git history or certify asset licenses.');
