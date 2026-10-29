// Proves the running scheduler (not a manual capture endpoint) starts both modes.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {isCaptureDue,nextScheduledAt} from '../public/schedule.js';
if(!process.env.REWIND_DATA_DIR)throw new Error('Use isolated test server data.');
const db=new DatabaseSync(resolve(process.env.REWIND_DATA_DIR,'rewind.sqlite'));
const base=process.env.REWIND_URL || 'http://127.0.0.1:4318';
const seedTime=Date.now(), shifted=new Date(seedTime-60000+9*3600000);
const time=`${String(shifted.getUTCHours()).padStart(2,'0')}:${String(shifted.getUTCMinutes()).padStart(2,'0')}`;
const ids=[];
try {
 for(const kind of ['interval','daily_time','minutes']) {
  const mode=kind==='minutes' ? 'interval' : kind,minutes=kind==='minutes' ? 5 : 120;
  const id=randomUUID();ids.push(id);
  db.prepare('INSERT INTO sites (id,url,title,created_at,daily,last_attempt,interval_hours,schedule_mode,daily_time,interval_minutes,capture_mode) VALUES (?,?,?,?,1,?,?,?,?,?,?)').run(id,`https://example.com/?scheduled-check=${id}`,`Scheduler ${mode}`,new Date(seedTime).toISOString(),new Date(seedTime-(kind==='minutes' ? 6*60000 : 2*86400000)).toISOString(),2,mode,time,minutes,kind==='minutes' ? 'full_page' : 'viewport');
  assert.equal(isCaptureDue(db.prepare('SELECT * FROM sites WHERE id=?').get(id)),true);
 }
 console.log('Waiting for the running 60-second scheduler tick; no manual capture request is sent.');
 let complete=false;
 for(let i=0;i<100;i++) {
  await setTimeout(1000);
  const states=ids.map(id=>({...db.prepare('SELECT * FROM sites WHERE id=?').get(id),count:db.prepare('SELECT count(*) AS n FROM captures WHERE site_id=?').get(id).n}));
  const failure=states.find(site=>site.error);if(failure)throw new Error(failure.error);
  if(states.every(site=>site.count===1)) {
   for(const site of states){assert.equal(isCaptureDue(site),false);assert.ok(Date.parse(nextScheduledAt(site))>Date.now());assert.equal(db.prepare("SELECT count(*) n FROM capture_attempts WHERE site_id=? AND status='success'").get(site.id).n,1);const record=db.prepare('SELECT capture_mode,width,height FROM captures WHERE site_id=?').get(site.id);assert.equal(record.capture_mode,site.capture_mode);assert.equal(record.width,1440);assert.ok(record.height>=1000);}
   console.log(JSON.stringify({scheduled_captures:states.map(site=>({mode:site.schedule_mode,interval_hours:site.interval_hours,interval_minutes:site.interval_minutes,daily_time:site.daily_time,captures:site.count,next:nextScheduledAt(site)}))}));
   complete=true;break;
  }
 }
 assert.equal(complete,true,'all scheduled modes should capture within one polling cycle');
 console.log('PASS: actual hour/minute interval and daily-time scheduler execution, screenshots stored, no repeated fulfilled slot');
} finally {
 for(const id of ids)await fetch(`${base}/api/sites/${id}`,{method:'DELETE',headers:{'Content-Type':'application/json'}}).catch(()=>{});
 db.close();
}
