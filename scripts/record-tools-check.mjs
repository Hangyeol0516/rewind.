import {showTimelineFilters} from './ui-test-helpers.mjs';
import {showRecordBrowser,closeRecordBrowser} from './ui-test-helpers.mjs';
// Run against an isolated server; fixtures never request an external website.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {writeFile,readFile,rm} from 'node:fs/promises';
import {PNG} from 'pngjs';
import {chromium} from 'playwright';
if(!process.env.REWIND_DATA_DIR || !process.env.REWIND_DATA_DIR.startsWith('/tmp/'))throw new Error('Use an isolated /tmp/ REWIND_DATA_DIR.');
const data=process.env.REWIND_DATA_DIR, base=process.env.REWIND_URL||'http://127.0.0.1:4318';
const db=new DatabaseSync(resolve(data,'rewind.sqlite')), sid=randomUUID(), other=randomUUID(), ids=Array.from({length:15},()=>randomUUID()), foreign=randomUUID();
db.exec('PRAGMA busy_timeout=5000');
for(const id of[sid,other])db.prepare('INSERT INTO sites(id,url,title,created_at,daily,paused) VALUES(?,?,?,?,0,1)').run(id,`https://example.com/?tools=${id}`,'기록 도구 테스트',new Date().toISOString());
const png=new PNG({width:1440,height:1000});png.data.fill(255);const clean=PNG.sync.write(png);
for(let i=0;i<ids.length;i++){
 const id=ids[i];
 db.prepare('INSERT INTO captures(id,site_id,created_at,title,bytes) VALUES(?,?,?,?,?)').run(id,sid,new Date(Date.UTC(2026,9,29-i,2)).toISOString(),'테스트 화면',clean.length);
 if(i===0){for(let y=100;y<200;y++)for(let x=100;x<200;x++){const k=(y*1440+x)*4;png.data[k]=0;png.data[k+1]=0;png.data[k+2]=0;}await writeFile(resolve(data,'captures',`${id}.png`),PNG.sync.write(png));}
 else await writeFile(resolve(data,'captures',`${id}.png`),clean);
}
db.prepare('INSERT INTO captures(id,site_id,created_at,title,bytes) VALUES(?,?,?,?,0)').run(foreign,other,new Date().toISOString(),'다른 사이트');
const api=async(path,method='GET',input)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)});return {status:r.status,body:await r.json()};};
const browser=await chromium.launch({env:{...process.env,LD_LIBRARY_PATH:resolve('data/browser-libs/usr/lib/x86_64-linux-gnu')}});
const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 const endpoint=`/api/sites/${sid}/captures`;
 assert.equal((await api(`${endpoint}/delete`,'POST',{ids:[ids[0],foreign]})).status,404);
 assert.equal(db.prepare('SELECT count(*) n FROM captures WHERE site_id=?').get(sid).n,15);
 assert.equal((await api(`${endpoint}/delete`,'POST',{ids:[ids[0],ids[0]]})).status,400);
 assert.equal((await api(`${endpoint}/${ids[0]}`,'PATCH',{important:true,note:42})).status,400);
 assert.equal(db.prepare('SELECT important FROM captures WHERE id=?').get(ids[0]).important,0);
 assert.equal((await api(`${endpoint}/${foreign}`,'PATCH',{note:'must not mutate'})).status,404);
 await page.goto(`${base}/?site=${sid}`);await page.locator('#select-records').waitFor();
 await page.locator('#select-records').click();await page.locator('.record-checkbox').first().check();
 assert.match(await page.locator('#selection-count').textContent(),/1개/);
 await page.locator('#timeline-next').click();assert.match(await page.locator('#selection-count').textContent(),/1개/);
 await page.locator('#select-page').click();assert.match(await page.locator('#selection-count').textContent(),/4개/);
 await page.locator('#delete-selected').click();assert.match(await page.locator('#bulk-delete-description').textContent(),/4개/);
 await page.locator('#cancel-bulk-delete').click();assert.equal(db.prepare('SELECT count(*) n FROM captures WHERE site_id=?').get(sid).n,15);
 await page.locator('#clear-selection').click();await page.locator('#range-start').fill('2026-10-15');await page.locator('#range-end').fill('2026-10-16');await page.locator('#select-range').click();assert.match(await page.locator('#selection-count').textContent(),/2개/);
 await page.locator('#delete-selected').click();await page.locator('#confirm-bulk-delete').click();await page.locator('#bulk-delete-dialog').waitFor({state:'hidden'});
 assert.equal(db.prepare('SELECT count(*) n FROM captures WHERE site_id=?').get(sid).n,13);
 assert.ok(db.prepare('SELECT id FROM captures WHERE id=?').get(foreign));
 assert.equal(await fetch(base+`/captures/${ids[14]}.png`).then(r=>r.status),404);
 await page.locator('#select-records').click();
 await page.locator('#important-record').click();await page.waitForFunction(()=>document.querySelector('#important-record').getAttribute('aria-pressed')==='true');
 await page.locator('#edit-record-note').click();await page.locator('#record-note-input').fill('리뉴얼 전\n<script>메모는 텍스트로</script>');await page.locator('#save-record-note').click();await page.locator('#record-note-dialog').waitFor({state:'hidden'});
 assert.match(await page.locator('.record-note').textContent(),/<script>/);assert.equal(await page.locator('.record-note script').count(),0);
 await page.reload();await page.locator('#important-record').waitFor();assert.equal(await page.locator('#important-record').getAttribute('aria-pressed'),'true');assert.match(await page.locator('.record-note').textContent(),/리뉴얼/);
 await showTimelineFilters(page);
 await page.locator('#important-only').click();assert.equal(await page.locator('.moment').count(),1);
 await page.locator('#important-record').click();await page.locator('#empty-clear-date').waitFor();await page.locator('#empty-clear-date').click();assert.equal(await page.locator('.moment').count(),12);
 await page.locator('#important-record').click();await page.waitForFunction(()=>document.querySelector('#important-record').getAttribute('aria-pressed')==='true');
 await page.locator('#split-mode').click();await page.locator('#target-before').click();await page.locator('#edit-record-note').click();await page.locator('#record-note-input').fill('왼쪽 기록 메모');await page.locator('#save-record-note').click();await page.locator('#record-note-dialog').waitFor({state:'hidden'});
 assert.equal(db.prepare('SELECT note FROM captures WHERE id=?').get(ids[1]).note,'왼쪽 기록 메모');assert.match(db.prepare('SELECT note FROM captures WHERE id=?').get(ids[0]).note,/리뉴얼/);
 await page.locator('#target-after').click();
 // The optional diff section is enabled as the third implementation stage lands.
 if(await page.locator('#diff-mode').count()) {
  await page.locator('#diff-mode').click();await page.locator('#diff-summary[data-ready=true]').waitFor();
  assert.match(await page.locator('#diff-summary').textContent(),/0\.69%/);
  assert.equal(await page.locator('#diff-canvas').evaluate(c=>c.width),1440);
  await page.locator('#diff-threshold').selectOption('12');await page.locator('#diff-summary[data-ready=true]').waitFor();
  await page.screenshot({path:'test-results/record-tools-diff-desktop.png',fullPage:true});
  await page.locator('#swap-records').click();await page.locator('#diff-summary[data-ready=true]').waitFor();assert.match(await page.locator('#diff-summary').textContent(),/0\.69%/);
  const downloadPromise=page.waitForEvent('download');await page.locator('#download-diff').click();const download=await downloadPromise;
  const exported=PNG.sync.read(await readFile(await download.path()));assert.equal(exported.width,1440);assert.equal(exported.height,1000);const pixel=(150*1440+150)*4;assert.ok(exported.data[pixel]>exported.data[pixel+1]);
  await page.reload();await page.locator('#diff-summary[data-ready=true]').waitFor();assert.match(await page.locator('#diff-summary').textContent(),/0\.69%/);assert.equal(await page.locator('#diff-mode').getAttribute('aria-pressed'),'true');
  await page.locator('#before-select').selectOption(ids[2]);await page.locator('#diff-summary[data-ready=true]').waitFor();assert.match(await page.locator('#diff-summary').textContent(),/차이가 없어요/);
  await page.locator('#before-select').selectOption(ids[0]);await page.locator('#diff-summary[data-ready=true]').waitFor();
 }
 for(const width of[390,320]){
  await page.setViewportSize({width,height:844});await showRecordBrowser(page);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#select-records').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`test-results/record-tools-${width}.png`,fullPage:true});await page.locator('#select-records').click();await closeRecordBrowser(page);
 }
 await page.locator('#single-mode').click();const cleared=new URL(page.url()).searchParams.get('after');await page.locator('#edit-record-note').click();await page.locator('#record-note-input').fill('');await page.locator('#save-record-note').click();await page.locator('#record-note-dialog').waitFor({state:'hidden'});
 assert.equal(db.prepare('SELECT note FROM captures WHERE id=?').get(cleared).note,'');
 await showRecordBrowser(page);await page.locator('#select-records').click();await page.locator('#range-start').fill('2026-01-01');await page.locator('#range-end').fill('2026-12-31');await page.locator('#select-range').click();await page.locator('#delete-selected').click();assert.match(await page.locator('#bulk-delete-description').textContent(),/중요 표시한 기록 1개/);await page.locator('#confirm-bulk-delete').click();await page.locator('#bulk-delete-dialog').waitFor({state:'hidden'});await page.locator('.viewer-empty').waitFor();assert.equal(db.prepare('SELECT count(*) n FROM captures WHERE site_id=?').get(sid).n,0);
 assert.deepEqual(errors,[]);console.log('Record tools passed: atomic/cross-site validation, cross-page/range selection, confirmed deletion, files removed, persistent important/note, safe text, target side, empty filters, diff ratio/PNG/deep link/identical pair, mobile widths, delete-all fallback.');
}finally{
 await browser.close();for(const id of[sid,other])db.prepare('DELETE FROM sites WHERE id=?').run(id);db.close();await Promise.all(ids.map(id=>rm(resolve(data,'captures',`${id}.png`),{force:true})));
}
