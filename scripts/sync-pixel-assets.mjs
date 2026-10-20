#!/usr/bin/env node
/* Deterministic vendoring of Pixel Agents' MIT-shipped PNG artwork.
 * Upstream commit is pinned; this script is NOT executed by Crew runtime.
 * Usage: node scripts/sync-pixel-assets.mjs [--check]
 */
import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const revision='b1bafd02896d90d83457266575a1e8e5011ce997';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const destination=join(root,'public/vendor/pixel-agents/assets');
const layout=JSON.parse(await readFile(join(root,'public/vendor/pixel-agents/default-layout.json'),'utf8'));
const groups=[
 'BIN','BOOKSHELF','CACTUS','CLOCK','COFFEE','COFFEE_TABLE','CUSHIONED_BENCH',
 'CUSHIONED_CHAIR','DESK','DOUBLE_BOOKSHELF','HANGING_PLANT','LARGE_PAINTING',
 'LARGE_PLANT','PC','PLANT','PLANT_2','POT','SMALL_PAINTING','SMALL_PAINTING_2',
 'SMALL_TABLE','SOFA','TABLE_FRONT','WHITEBOARD','WOODEN_BENCH','WOODEN_CHAIR'
].sort((a,b)=>b.length-a.length);
const paths=new Set();
for(let i=0;i<6;i++)paths.add('characters/char_'+i+'.png');
for(let i=0;i<9;i++)paths.add('floors/floor_'+i+'.png');
paths.add('walls/wall_0.png');
paths.add('pets/gitcat/pet.png');
paths.add('pets/claudio/pet.png');
for(const item of layout.furniture){
 const type=String(item.type).split(':')[0];
 const group=groups.find(g=>type===g||type.startsWith(g+'_'));
 if(!group)throw Error('Missing official furniture group: '+type);
 paths.add('furniture/'+group+'/'+type+'.png');
}
for(let i=1;i<=3;i++)paths.add('furniture/PC/PC_FRONT_ON_'+i+'.png');
const files=[...paths].sort();
const verify=process.argv.includes('--check');
let failures=0;
async function processFile(path){
 const target=join(destination,path);
 if(verify){
  try{const s=await stat(target);if(s.size<100)throw Error('tiny PNG');}
  catch(e){console.error('MISSING',path);failures++;}
  return;
 }
 const url='https://raw.githubusercontent.com/pixel-agents-hq/pixel-agents/'+revision+'/webview-ui/public/assets/'+path;
 let bytes;
 for(let attempt=0;attempt<4;attempt++){
  try{
   const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error(response.status+' '+url);
   bytes=Buffer.from(await response.arrayBuffer());
   if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Not a PNG: '+path);
   break;
  }catch(error){
   if(attempt===3){console.error(path,error);failures++;return;}
   await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
  }
 }
 await mkdir(dirname(target),{recursive:true});
 await writeFile(target,bytes);
}
for(let i=0;i<files.length;i+=5)await Promise.all(files.slice(i,i+5).map(processFile));
console.log((verify?'verified ':'vendored ')+(files.length-failures)+'/'+files.length+' official Pixel Agents PNG assets @ '+revision);
if(failures)process.exitCode=1;
