import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, rm, appendFile, stat, rename, writeFile, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isIP, createServer as createLocalServer } from 'node:net';
import { capturePage } from './capture-browser.mjs';
import { PNG } from 'pngjs';
import { normalizeUrl, assertPublicUrl } from './lib.mjs';
import { validateSchedule, isCaptureDue } from './public/schedule.js';
import {validateOrganization, parseTags, analyzeContent} from './content-analysis.mjs';

const root = dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(resolve(root,'.env.local')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const allowedIps = new Set((process.env.ALLOWED_IPS || '').split(',').map(ip => ip.trim()).filter(Boolean));
if ([...allowedIps].some(ip => !isIP(ip))) throw new Error('ALLOWED_IPS에는 유효한 IP 주소만 입력하세요.');
const data = resolve(process.env.REWIND_DATA_DIR || resolve(root, 'data'));
await mkdir(resolve(data, 'captures'), { recursive: true });
const db = new DatabaseSync(resolve(data, 'rewind.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, url TEXT UNIQUE NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, daily INTEGER DEFAULT 1, last_attempt TEXT, error TEXT);
 CREATE TABLE IF NOT EXISTS captures (id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE, created_at TEXT NOT NULL, title TEXT, bytes INTEGER);`);
const siteColumns = new Set(db.prepare('PRAGMA table_info(sites)').all().map(column => column.name));
if (!siteColumns.has('display_name')) db.exec('ALTER TABLE sites ADD COLUMN display_name TEXT');
if (!siteColumns.has('favorite')) db.exec('ALTER TABLE sites ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
if (!siteColumns.has('paused')) db.exec('ALTER TABLE sites ADD COLUMN paused INTEGER NOT NULL DEFAULT 0');
if (!siteColumns.has('interval_hours')) db.exec('ALTER TABLE sites ADD COLUMN interval_hours INTEGER NOT NULL DEFAULT 24');
if (!siteColumns.has('interval_minutes')) {
 db.exec('ALTER TABLE sites ADD COLUMN interval_minutes INTEGER NOT NULL DEFAULT 1440');
 db.exec('UPDATE sites SET interval_minutes=interval_hours*60');
}
if (!siteColumns.has('schedule_mode')) db.exec("ALTER TABLE sites ADD COLUMN schedule_mode TEXT NOT NULL DEFAULT 'interval'");
if (!siteColumns.has('capture_mode')) db.exec("ALTER TABLE sites ADD COLUMN capture_mode TEXT NOT NULL DEFAULT 'viewport'");
if (!siteColumns.has('daily_time')) db.exec("ALTER TABLE sites ADD COLUMN daily_time TEXT NOT NULL DEFAULT '09:00'");
if (!siteColumns.has('tags')) db.exec("ALTER TABLE sites ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
if (!siteColumns.has('group_name')) db.exec("ALTER TABLE sites ADD COLUMN group_name TEXT NOT NULL DEFAULT ''");
if (!db.prepare('PRAGMA table_info(captures)').all().some(column => column.name === 'source')) db.exec("ALTER TABLE captures ADD COLUMN source TEXT NOT NULL DEFAULT 'browser'");
const captureColumns = new Set(db.prepare('PRAGMA table_info(captures)').all().map(column => column.name));
if (!captureColumns.has('important')) db.exec('ALTER TABLE captures ADD COLUMN important INTEGER NOT NULL DEFAULT 0');
if (!captureColumns.has('note')) db.exec("ALTER TABLE captures ADD COLUMN note TEXT NOT NULL DEFAULT ''");
for (const [name,definition] of [['width','INTEGER NOT NULL DEFAULT 1440'],['height','INTEGER NOT NULL DEFAULT 1000'],['capture_mode',"TEXT NOT NULL DEFAULT 'viewport'"],['truncated','INTEGER NOT NULL DEFAULT 0']]) {
 if (!captureColumns.has(name)) db.exec(`ALTER TABLE captures ADD COLUMN ${name} ${definition}`);
}
for (const [name,definition] of [
 ['content_hash','TEXT'], ['content_excerpt','TEXT'], ['content_scope','TEXT'], ['content_url','TEXT'],
 ['content_change',"TEXT NOT NULL DEFAULT 'unavailable'"],
 ['content_summary',"TEXT NOT NULL DEFAULT '본문 텍스트 분석이 없는 기록이에요.'"], ['compared_capture_id','TEXT'],
]) {
 if (!captureColumns.has(name)) db.exec(`ALTER TABLE captures ADD COLUMN ${name} ${definition}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS capture_attempts (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
 started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, error TEXT, capture_id TEXT REFERENCES captures(id) ON DELETE SET NULL);
 CREATE INDEX IF NOT EXISTS capture_attempts_site_date ON capture_attempts(site_id,started_at);
 CREATE INDEX IF NOT EXISTS capture_attempts_date ON capture_attempts(started_at DESC);
 CREATE INDEX IF NOT EXISTS capture_attempts_status_date ON capture_attempts(status,started_at DESC);`);
db.prepare("UPDATE capture_attempts SET status='failed',error='서버가 종료되어 촬영을 마치지 못했어요.',finished_at=? WHERE status='running'").run(new Date().toISOString());
// Only the latest legacy failure is known; earlier failures cannot be reconstructed.
db.exec(`INSERT INTO capture_attempts (id,site_id,started_at,finished_at,status,error)
 SELECT 'legacy-' || s.id,s.id,s.last_attempt,s.last_attempt,'failed',s.error FROM sites s
 WHERE s.error IS NOT NULL AND s.last_attempt IS NOT NULL AND NOT EXISTS (SELECT 1 FROM capture_attempts a WHERE a.site_id=s.id);`);
const jobs = new Map();
let queue = Promise.resolve();
let stopping = false;
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const origin = `http://127.0.0.1:${port}`;
const json = (res, status, value) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
let logQueue = Promise.resolve();
const lastDenied = new Map();
function logDenied(req, clientIp) {
 const now = Date.now();
 if (now-(lastDenied.get(clientIp) || 0) < 3000) return;
 if (lastDenied.size >= 256) lastDenied.delete(lastDenied.keys().next().value);
 lastDenied.set(clientIp,now);
 const entry = JSON.stringify({time:new Date(now).toISOString(),event:'access_denied',remote_ip:clientIp,method:req.method,path:new URL(req.url,'http://localhost').pathname.slice(0,200),forwarded_for:req.headers['x-forwarded-for']?.slice(0,200) || null,real_ip:req.headers['x-real-ip']?.slice(0,200) || null});
 console.warn(entry);
 logQueue = logQueue.then(async () => {
  const path = resolve(data,'access-denied.log');
  const info = await stat(path).catch(() => null);
  if (info?.size > 1048576) await rename(path,`${path}.1`);
  await appendFile(path,`${entry}\n`,{mode:0o600});
 }).catch(error => console.error('Access log:',error.message));
}
async function sites() {
 return Promise.all(db.prepare('SELECT * FROM sites ORDER BY created_at DESC').all().map(async s => {
  const recheck = await readFile(resolve(data,`recheck-${s.id}.json`),'utf8').then(JSON.parse).catch(() => null);
  return {...s, tags:parseTags(s.tags), title:s.display_name || s.title, page_title:s.title, recheck, capturing: jobs.has(s.id), capture_status: jobs.get(s.id)?.phase || null, captures: db.prepare('SELECT * FROM captures WHERE site_id=? ORDER BY created_at DESC').all(s.id).map(c => ({...c, image: `/captures/${c.id}.png`}))};
 }));
}
function capture(id) {
 if (jobs.has(id) || stopping) return;
 const work = queue.then(async () => {
  const site = db.prepare('SELECT * FROM sites WHERE id=?').get(id);
  if (!site || site.paused) return;
  jobs.get(id).phase = 'capturing';
  const startedAt=new Date().toISOString(), attemptId=randomUUID();
  db.prepare("INSERT INTO capture_attempts (id,site_id,started_at,status) VALUES (?,?,?,'running')").run(attemptId,id,startedAt);
  db.prepare('UPDATE sites SET last_attempt=?, error=NULL WHERE id=?').run(startedAt,id);
  let path;
  const diagnosticsPath = resolve(data,'diagnostics',id,`${Date.now()}.json`);
  async function saveDiagnostic(details) {
   try { await mkdir(dirname(diagnosticsPath),{recursive:true,mode:0o700}); await writeFile(diagnosticsPath,JSON.stringify(details,null,2),{mode:0o600}); }
   catch(error) { console.error('Capture diagnostic:',error.message); }
  }
  try {
   const captureId = randomUUID();
   path = resolve(data,'captures',`${captureId}.png`);
   const {title,buffer,details,content} = await capturePage({url:site.url,path,captureMode:site.capture_mode,env:{...process.env,LD_LIBRARY_PATH:[resolve(data,'browser-libs/usr/lib/x86_64-linux-gnu'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}});
   await saveDiagnostic(details);
   const previous = db.prepare('SELECT * FROM captures WHERE site_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(id);
   const analysis = analyzeContent(content,previous,site.url);
   db.prepare('INSERT INTO captures (id,site_id,created_at,title,bytes,width,height,capture_mode,truncated,content_hash,content_excerpt,content_scope,content_url,content_change,content_summary,compared_capture_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(captureId,id,new Date().toISOString(),title,buffer.length,buffer.readUInt32BE(16),buffer.readUInt32BE(20),site.capture_mode,Number(details.capture.truncated),analysis.content_hash,analysis.content_excerpt,analysis.content_scope,analysis.content_url,analysis.content_change,analysis.content_summary,analysis.compared_capture_id);
   db.prepare("UPDATE capture_attempts SET status='success',finished_at=?,capture_id=? WHERE id=?").run(new Date().toISOString(),captureId,attemptId);
   db.prepare('UPDATE sites SET title=?, error=NULL WHERE id=?').run(title,id);
  } catch (error) {
   if (path) await rm(path,{force:true});
   if (error.details) await saveDiagnostic(error.details);
   db.prepare("UPDATE capture_attempts SET status='failed',finished_at=?,error=? WHERE id=?").run(new Date().toISOString(),error.message.slice(0,400),attemptId);
   console.error('Capture failed:',site.url,error.message);
   db.prepare('UPDATE sites SET error=? WHERE id=?').run(error.message.includes('Executable') ? '브라우저 설치가 필요해요. npm run browser:install을 실행해 주세요.' : error.message.slice(0,400),id);
  }
 });
 jobs.set(id,{phase:'queued'});
 queue = work.catch(console.error).finally(() => jobs.delete(id));
}
async function body(req, limit = 8192) {
 let content = '';
 for await (const chunk of req) { content += chunk; if (content.length > limit) throw new Error('요청이 너무 커요.'); }
 return JSON.parse(content || '{}');
}
const server = http.createServer(async (req,res) => {
 try {
  const clientIp = req.socket.remoteAddress?.replace(/^::ffff:/,'');
  if (allowedIps.size && !allowedIps.has(clientIp)) { logDenied(req,clientIp); return json(res,403,{error:'접근이 허용되지 않은 IP입니다.'}); }
  if (host === '127.0.0.1' && ![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) return json(res,403,{error:'허용되지 않은 호스트입니다.'});
  const requestOrigin = new URL(`http://${req.headers.host}`).origin;
  if (!['GET','HEAD'].includes(req.method)) {
   if (req.headers.origin && req.headers.origin !== requestOrigin) return json(res,403,{error:'다른 사이트에서의 요청은 허용하지 않아요.'});
   if (!req.headers['content-type']?.startsWith('application/json')) return json(res,415,{error:'JSON 요청만 지원합니다.'});
  }
  const path = new URL(req.url, origin).pathname;
  if (path === '/api/attempts' && req.method === 'GET') {
   const query = new URL(req.url,origin).searchParams;
   const integer = (name,fallback,max) => {
    const value = query.get(name);
    if (value === null) return fallback;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max || (name === 'limit' && Number(value) < 1)) throw new Error('조회 개수 또는 시작 위치를 확인해 주세요.');
    return Number(value);
   };
   const limit = integer('limit',50,100), offset = integer('offset',0,100000);
   const status = query.get('status') || 'all', siteId = query.get('site_id');
   if (!['all','failed','success','running'].includes(status)) throw new Error('조회할 촬영 상태를 확인해 주세요.');
   if (siteId !== null && !db.prepare('SELECT id FROM sites WHERE id=?').get(siteId)) return json(res,404,{error:'사이트를 찾을 수 없어요.'});
   const where = [], values = [];
   if (siteId !== null) { where.push('a.site_id=?'); values.push(siteId); }
   if (status !== 'all') { where.push('a.status=?'); values.push(status); }
   const rows = db.prepare(`SELECT a.*,COALESCE(NULLIF(s.display_name,''),s.title) AS site_title,s.url AS site_url,s.paused,s.daily FROM capture_attempts a JOIN sites s ON s.id=a.site_id ${where.length ? 'WHERE '+where.join(' AND ') : ''} ORDER BY a.started_at DESC,a.rowid DESC LIMIT ? OFFSET ?`).all(...values,limit+1,offset);
   const hasMore = rows.length > limit;
   const queued = [...jobs].filter(([id,job]) => job.phase === 'queued' && (siteId === null || siteId === id)).map(([id]) => {
    const site = db.prepare('SELECT id,title,display_name,url FROM sites WHERE id=?').get(id);
    return {site_id:id,site_title:site.display_name || site.title,site_url:site.url,status:'queued'};
   });
   return json(res,200,{attempts:rows.slice(0,limit),has_more:hasMore,next_offset:hasMore ? offset+limit : null,queued});
  }
  const historyMatch=path.match(/^\/api\/sites\/([\w-]+)\/history$/);
  if (historyMatch && req.method==='GET') {
   const id=historyMatch[1], query=new URL(req.url,origin).searchParams;
   if (!db.prepare('SELECT id FROM sites WHERE id=?').get(id)) return json(res,404,{error:'사이트를 찾을 수 없어요.'});
   const from=query.get('from'),to=query.get('to'),start=Date.parse(from),end=Date.parse(to);
   if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString()!==from || new Date(end).toISOString()!==to || end<=start || end-start>32*86400000) throw new Error('조회할 달의 시작과 끝을 지정해 주세요.');
   const records=db.prepare('SELECT * FROM captures WHERE site_id=? AND created_at>=? AND created_at<? ORDER BY created_at DESC').all(id,from,to).map(record=>({...record,type:'capture',at:record.created_at,image:`/captures/${record.id}.png`}));
   const attempts=db.prepare("SELECT id,started_at,finished_at,status,error FROM capture_attempts WHERE site_id=? AND started_at>=? AND started_at<? AND status IN ('failed','running') ORDER BY started_at DESC").all(id,from,to).map(attempt=>({...attempt,type:attempt.status,at:attempt.started_at}));
   return json(res,200,{events:[...records,...attempts].sort((a,b)=>b.at.localeCompare(a.at))});
  }
  if (path === '/api/sites' && req.method === 'GET') return json(res,200,{sites:await sites()});
  if (path === '/api/sites' && req.method === 'POST') {
   const input = await body(req);
   const organization = validateOrganization(input);
   const url = normalizeUrl(input.url);
   if (input.daily !== undefined && typeof input.daily !== 'boolean') throw new Error('daily 값은 boolean이어야 합니다.');
   const schedule = validateSchedule(input);
   const captureMode=input.capture_mode ?? 'viewport';
   if (!['viewport','full_page'].includes(captureMode)) throw new Error('촬영 범위를 선택해 주세요.');
   await assertPublicUrl(url);
   if (db.prepare('SELECT id FROM sites WHERE url=?').get(url)) return json(res,409,{error:'이미 기록 중인 사이트예요.'});
   const id = randomUUID();
   db.prepare('INSERT INTO sites (id,url,title,created_at,daily,schedule_mode,interval_hours,daily_time,capture_mode,interval_minutes,tags,group_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,url,new URL(url).hostname,new Date().toISOString(),input.daily === false ? 0 : 1,schedule.schedule_mode,schedule.interval_hours,schedule.daily_time,captureMode,schedule.interval_minutes,JSON.stringify(organization.tags || []),organization.group_name || '');
   capture(id);
   return json(res,201,{id});
  }
  const bulkMatch = path.match(/^\/api\/sites\/([\w-]+)\/captures\/delete$/);
  if (bulkMatch && req.method === 'POST') {
   const siteId = bulkMatch[1], input = await body(req,32768);
   if (!db.prepare('SELECT id FROM sites WHERE id=?').get(siteId)) return json(res,404,{error:'사이트를 찾을 수 없어요.'});
   if (jobs.has(siteId)) return json(res,409,{error:'촬영이 끝난 뒤 기록을 삭제해 주세요.'});
   if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 500 || input.ids.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) || new Set(input.ids).size !== input.ids.length) throw new Error('삭제할 기록을 1~500개 선택해 주세요.');
   const find = db.prepare('SELECT id FROM captures WHERE site_id=? AND id=?');
   if (input.ids.some(id => !find.get(siteId,id))) return json(res,404,{error:'일부 기록을 찾을 수 없어요. 목록을 새로 확인해 주세요.'});
   db.exec('BEGIN');
   try {
    const remove = db.prepare('DELETE FROM captures WHERE site_id=? AND id=?');
    for (const id of input.ids) remove.run(siteId,id);
    db.exec('COMMIT');
   } catch (error) { db.exec('ROLLBACK'); throw error; }
   await Promise.all(input.ids.map(id => rm(resolve(data,'captures',`${id}.png`),{force:true})));
   return json(res,200,{ok:true,deleted:input.ids.length});
  }
  const recordMatch = path.match(/^\/api\/sites\/([\w-]+)\/captures\/([\w-]+)$/);
  if (recordMatch && req.method === 'PATCH') {
   const [,siteId,captureId] = recordMatch, input = await body(req);
   if (!db.prepare('SELECT id FROM captures WHERE site_id=? AND id=?').get(siteId,captureId)) return json(res,404,{error:'기록을 찾을 수 없어요.'});
   if (input.important === undefined && input.note === undefined) throw new Error('변경할 기록 설정이 없어요.');
   if (input.important !== undefined && typeof input.important !== 'boolean') throw new Error('중요 표시 설정이 올바르지 않아요.');
   if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 1000)) throw new Error('메모는 1,000자 이내로 입력해 주세요.');
   if (input.important !== undefined) db.prepare('UPDATE captures SET important=? WHERE site_id=? AND id=?').run(Number(input.important),siteId,captureId);
   if (input.note !== undefined) db.prepare('UPDATE captures SET note=? WHERE site_id=? AND id=?').run(input.note.trim(),siteId,captureId);
   return json(res,200,{ok:true});
  }
  if (recordMatch && req.method === 'DELETE') {
   const [,siteId,captureId] = recordMatch;
   if (jobs.has(siteId)) return json(res,409,{error:'촬영이 끝난 뒤 기록을 삭제해 주세요.'});
   const record = db.prepare('SELECT id FROM captures WHERE site_id=? AND id=?').get(siteId,captureId);
   if (!record) return json(res,404,{error:'기록을 찾을 수 없어요.'});
   db.prepare('DELETE FROM captures WHERE id=?').run(captureId);
   await rm(resolve(data,'captures',`${captureId}.png`),{force:true});
   return json(res,200,{ok:true});
  }
  const match = path.match(/^\/api\/sites\/([\w-]+)(?:\/(capture|schedule|import))?$/);
  if (match) {
   const [,id,action] = match;
   if (!db.prepare('SELECT id FROM sites WHERE id=?').get(id)) return json(res,404,{error:'사이트를 찾을 수 없어요.'});
   if (action === 'import' && req.method === 'POST') {
    if (jobs.has(id)) return json(res,409,{error:'진행 중인 촬영이 끝난 뒤 저장해 주세요.'});
    const input = await body(req,8*1024*1024);
    if (input.pause_daily !== undefined && typeof input.pause_daily !== 'boolean') throw new Error('자동 촬영 설정이 올바르지 않아요.');
    if (typeof input.image !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(input.image)) throw new Error('PNG 이미지를 선택해 주세요.');
    const bytes = Buffer.from(input.image.slice('data:image/png;base64,'.length),'base64');
    if (bytes.length > 6*1024*1024 || bytes.length < 33 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.readUInt32BE(16) !== 1440 || bytes.readUInt32BE(20) !== 1000) throw new Error('1440 × 1000 PNG 이미지가 필요해요. 파일을 다시 선택해 주세요.');
    let decoded;
    try { decoded = PNG.sync.read(bytes,{checkCRC:true}); } catch { throw new Error('이미지가 손상되어 읽을 수 없어요. 다른 파일을 선택해 주세요.'); }
    if (decoded.width !== 1440 || decoded.height !== 1000) throw new Error('이미지 크기를 확인해 주세요.');
    const clean = PNG.sync.write(decoded);
    const captureId = randomUUID(), file = resolve(data,'captures',`${captureId}.png`);
    await writeFile(file,clean);
    try {
     const site = db.prepare('SELECT display_name,title FROM sites WHERE id=?').get(id);
     db.prepare("INSERT INTO captures (id,site_id,created_at,title,bytes,source) VALUES (?,?,?,?,?,'import')").run(captureId,id,new Date().toISOString(),site.display_name || site.title,clean.length);
     if (input.pause_daily) db.prepare('UPDATE sites SET daily=0 WHERE id=?').run(id);
    } catch (error) { await rm(file,{force:true}); throw error; }
    return json(res,201,{id:captureId});
   }
   if (!action && req.method === 'PATCH') {
    const input = await body(req);
    const organization = validateOrganization(input);
    const schedule = validateSchedule(input,{partial:true});
    if (input.display_name === undefined && input.favorite === undefined && input.url === undefined && input.paused === undefined && input.capture_mode === undefined && !Object.keys(schedule).length && !Object.keys(organization).length) throw new Error('변경할 설정이 없어요.');
    if (input.capture_mode !== undefined && !['viewport','full_page'].includes(input.capture_mode)) throw new Error('촬영 범위를 선택해 주세요.');
    if (input.capture_mode !== undefined && jobs.has(id) && input.capture_mode !== db.prepare('SELECT capture_mode FROM sites WHERE id=?').get(id).capture_mode) return json(res,409,{error:'촬영이 끝난 뒤 범위를 변경해 주세요.'});
    if (input.display_name !== undefined && (typeof input.display_name !== 'string' || input.display_name.trim().length > 100)) throw new Error('사이트 이름은 100자 이내로 입력해 주세요.');
    if (input.favorite !== undefined && typeof input.favorite !== 'boolean') throw new Error('favorite 값은 boolean이어야 합니다.');
    if (input.paused !== undefined && typeof input.paused !== 'boolean') throw new Error('paused 값은 boolean이어야 합니다.');
    if (input.paused && jobs.has(id)) return json(res,409,{error:'진행 중인 촬영이 끝난 뒤 보류할 수 있어요.'});
    let newUrl = null;
    if (input.url !== undefined) {
     newUrl = await assertPublicUrl(normalizeUrl(input.url));
     if (db.prepare('SELECT id FROM sites WHERE url=? AND id<>?').get(newUrl,id)) return json(res,409,{error:'이미 등록된 다른 사이트의 주소예요.'});
     if (db.prepare('SELECT url FROM sites WHERE id=?').get(id).url === newUrl) newUrl = null;
     else if (jobs.has(id)) return json(res,409,{error:'촬영이 끝난 뒤 주소를 변경해 주세요.'});
    }
    if (input.capture_mode !== undefined) db.prepare('UPDATE sites SET capture_mode=? WHERE id=?').run(input.capture_mode,id);
    if (organization.tags !== undefined) db.prepare('UPDATE sites SET tags=? WHERE id=?').run(JSON.stringify(organization.tags),id);
    if (organization.group_name !== undefined) db.prepare('UPDATE sites SET group_name=? WHERE id=?').run(organization.group_name,id);
    if (input.display_name !== undefined) db.prepare('UPDATE sites SET display_name=? WHERE id=?').run(input.display_name.trim() || null,id);
    if (input.favorite !== undefined) db.prepare('UPDATE sites SET favorite=? WHERE id=?').run(Number(input.favorite),id);
    if (input.paused !== undefined) db.prepare('UPDATE sites SET paused=? WHERE id=?').run(Number(input.paused),id);
    for (const [key,value] of Object.entries(schedule)) db.prepare(`UPDATE sites SET ${key}=? WHERE id=?`).run(value,id);
    if (newUrl) { db.prepare('UPDATE sites SET url=?, error=NULL, last_attempt=NULL WHERE id=?').run(newUrl,id); capture(id); }
    return json(res,200,{ok:true});
   }
   if (action === 'capture' && req.method === 'POST') {
    if (db.prepare('SELECT paused FROM sites WHERE id=?').get(id).paused) return json(res,409,{error:'보류 중인 사이트예요. 기록을 재개한 뒤 촬영해 주세요.'});
    capture(id); return json(res,202,{ok:true});
   }
   if (action === 'schedule' && req.method === 'PATCH') {
    const input=await body(req), schedule=validateSchedule(input,{partial:true});
    if (typeof input.daily !== 'boolean') throw new Error('daily 값은 boolean이어야 합니다.');
    db.prepare('UPDATE sites SET daily=? WHERE id=?').run(Number(input.daily),id);
    for (const [key,value] of Object.entries(schedule)) db.prepare(`UPDATE sites SET ${key}=? WHERE id=?`).run(value,id);
    return json(res,200,{ok:true});
   }
   if (!action && req.method === 'DELETE') {
    if (jobs.has(id)) return json(res,409,{error:'촬영이 끝난 뒤 삭제해 주세요.'});
    const records = db.prepare('SELECT id FROM captures WHERE site_id=?').all(id);
    db.prepare('DELETE FROM sites WHERE id=?').run(id);
    await Promise.all(records.map(c => rm(resolve(data,'captures',`${c.id}.png`),{force:true})));
    return json(res,200,{ok:true});
   }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,405,{error:'지원하지 않는 요청입니다.'});
  const capturePath = path.match(/^\/captures\/([a-f0-9-]{36})\.png$/);
  const assets = {'/':'index.html','/app.js':'app.js','/view-utils.js':'view-utils.js','/schedule.js':'schedule.js','/record-tools.js':'record-tools.js','/calendar.js':'calendar.js','/diff.js':'diff.js','/style.css':'style.css','/workspace.css':'workspace.css'};
  const file = capturePath ? resolve(data,'captures',`${capturePath[1]}.png`) : assets[path] && resolve(root,'public',assets[path]);
  if (!file) return json(res,404,{error:'페이지를 찾을 수 없어요.'});
  try {
   const content = await readFile(file);
   res.writeHead(200,{'Content-Type': capturePath ? 'image/png' : path.endsWith('.js') ? 'text/javascript; charset=utf-8' : path.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':capturePath ? 'private, max-age=31536000, immutable' : 'no-cache'});
   res.end(req.method === 'HEAD' ? undefined : content);
  } catch { json(res,404,{error:'파일을 찾을 수 없어요.'}); }
 } catch(error) { json(res,400,{error:error.message}); }
});
function tick() {
 const now=Date.now();
 for (const site of db.prepare('SELECT * FROM sites WHERE daily=1 AND paused=0').all()) if (isCaptureDue(site,now)) capture(site.id);
}
const timer = setInterval(tick,60000);
// Owner-only local maintenance channel. It does not expose another TCP port.
const controlPath = resolve(data,'control.sock');
const control = createLocalServer(socket => {
 let input = '';
 socket.setTimeout(5000,() => socket.destroy());
 socket.on('error',() => {});
 socket.on('data',chunk => {
  input += chunk;
  if (input.length > 1024) return socket.destroy();
  if (!input.includes('\n')) return;
  try {
   const {site_id:id} = JSON.parse(input.split('\n')[0]);
   const site = typeof id === 'string' && db.prepare('SELECT id,paused FROM sites WHERE id=?').get(id);
   if (!site) return socket.end(JSON.stringify({error:'사이트를 찾을 수 없어요.'})+'\n');
   if (site.paused) return socket.end(JSON.stringify({error:'보류 중인 사이트예요.'})+'\n');
   capture(id); socket.end(JSON.stringify({accepted:true})+'\n');
  } catch { socket.end(JSON.stringify({error:'잘못된 요청입니다.'})+'\n'); }
 });
});
control.on('error',error => console.error('Local control:',error.message));
server.on('error', error => {
 console.error(error.code === 'EADDRINUSE' ? `포트 ${port}가 사용 중입니다. PORT=4317 npm start 처럼 다른 포트를 지정하세요.` : error.message);
 clearInterval(timer); db.close(); process.exitCode=1;
});
server.listen(port,host,async () => {
 console.log(`Rewind → http://${host}:${port}`); tick();
 if (process.platform !== 'win32') {
  await rm(controlPath,{force:true});
  const oldMask = process.umask(0o077);
  try { control.listen(controlPath,() => { chmod(controlPath,0o600).catch(console.error); }); }
  finally { process.umask(oldMask); }
 }
});
async function shutdown() { if (stopping) return; stopping=true; clearInterval(timer); server.close(); control.close(); await queue; await logQueue; await rm(controlPath,{force:true}); db.close(); }
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
