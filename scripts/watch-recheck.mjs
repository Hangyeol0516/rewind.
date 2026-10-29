// Low-frequency rechecks of an existing registration; never modifies browser identity,
// proxy, URL, cookies, or the website's access controls. Runs until success or deadline.
import { DatabaseSync } from 'node:sqlite';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, open, rm, readFile, rename } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';

const root = resolve(fileURLToPath(new URL('..',import.meta.url)));
const data = resolve(process.env.REWIND_DATA_DIR || resolve(root,'data'));
const id = process.argv[2];
if (!id) throw new Error('Pass the registered site ID.');
const db = new DatabaseSync(resolve(data,'rewind.sqlite'),{readOnly:true});
const site = () => db.prepare('SELECT * FROM sites WHERE id=?').get(id);
if (!site()) throw new Error('Site not found.');
const shifted = new Date(Date.now()+9*3600000);
let deadline = Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate(),3)-9*3600000;
if (deadline <= Date.now()) deadline += 86400000;
const resultPath = resolve(data,`recheck-${id}.json`);
const lockPath = resolve(data,`recheck-${id}.lock`);
const lock = await open(lockPath,'wx',0o600);
await lock.writeFile(String(process.pid));
let stopped = false;
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => { stopped = true; });
const result = {site_id:id,url:site().url,started_at:new Date().toISOString(),deadline:new Date(deadline).toISOString(),state:'running',attempts:[]};
async function save() {
 const temp = `${resultPath}.tmp-${process.pid}`;
 await writeFile(temp,JSON.stringify(result,null,2),{mode:0o600});
 await rename(temp,resultPath);
}
function log(value) { console.log(JSON.stringify({at:new Date().toISOString(),...value})); }
async function until(time) { while (!stopped && Date.now()<time) await delay(Math.min(30000,time-Date.now())); }
function requestCapture() {
 return new Promise((resolveRequest,reject) => {
  const socket=createConnection(resolve(data,'control.sock'));
  let response=''; socket.setTimeout(10000,() => socket.destroy(new Error('Local control timed out')));
  socket.on('connect',() => socket.write(JSON.stringify({site_id:id})+'\n'));
  socket.on('data',chunk => response+=chunk);
  socket.on('error',reject);
  socket.on('end',() => { try { const value=JSON.parse(response); value.accepted ? resolveRequest() : reject(new Error(value.error)); } catch(error) { reject(error); } });
 });
}
try {
 await save();
 // At most four ordinary rechecks over 6.5 hours, not a tight retry loop.
 for (const minutes of process.argv.includes('--check-now') ? [0] : [30,60,120,180]) {
  const next = Date.now()+minutes*60000;
  if (next >= deadline) { await until(deadline); break; }
  result.next_check_at=new Date(next).toISOString(); await save(); log({state:'waiting',next_check_at:result.next_check_at});
  await until(next); if (stopped || Date.now()>=deadline) break;
  const current=site();
  if (!current || current.url !== result.url) { result.state='registration_changed'; break; }
  if (current.paused) { result.state='paused'; break; }
  const before=db.prepare('SELECT id FROM captures WHERE site_id=? AND source=? ORDER BY created_at DESC LIMIT 1').get(id,'browser')?.id;
  const attempt={at:new Date().toISOString()}; result.attempts.push(attempt);
  try {
   await requestCapture();
   const started=Date.now();
   while (!stopped && Date.now()-started<120000 && Date.now()<deadline) {
    await delay(2000);
    const capture=db.prepare("SELECT * FROM captures WHERE site_id=? AND source='browser' ORDER BY created_at DESC LIMIT 1").get(id);
    const latest=site();
    if (capture && capture.id!==before) {
     const requiresOpggTitle = /(^|\.)op\.gg$/i.test(new URL(result.url).hostname);
     const png = PNG.sync.read(await readFile(resolve(data,'captures',`${capture.id}.png`)));
     let visible = 0, sampled = 0;
     const colors = new Set();
     for (let i=0;i<png.data.length;i+=64) {
      sampled++;
      if (png.data[i+3]) {
       colors.add((png.data[i]<<16)+(png.data[i+1]<<8)+png.data[i+2]);
       if (Math.min(png.data[i],png.data[i+1],png.data[i+2])<245) visible++;
      }
     }
     attempt.nonwhite_ratio = visible/sampled;
     attempt.sampled_colors = colors.size;
     if (colors.size>32 && attempt.nonwhite_ratio > .005 && (!requiresOpggTitle || /op\.gg/i.test(capture.title)) && !/request could not be satisfied|access denied|captcha/i.test(capture.title)) {
      result.state='saved'; result.capture=capture; attempt.state='saved'; log({state:'saved',capture_id:capture.id});
     } else { attempt.state='review_required'; attempt.capture=capture; }
     break;
    }
    if (latest?.last_attempt !== current.last_attempt && latest?.error) { attempt.state='failed'; attempt.error=latest.error; break; }
   }
   if (!attempt.state) attempt.state='timed_out';
  } catch(error) { attempt.state='failed'; attempt.error=error.message; }
  log(attempt); await save(); if (result.state==='saved') break;
 }
 if (result.state==='running') result.state=stopped ? 'stopped' : 'not_resolved';
 result.finished_at=new Date().toISOString(); delete result.next_check_at; await save(); log({state:result.state});
} finally { db.close(); await lock.close(); await rm(lockPath,{force:true}); }
