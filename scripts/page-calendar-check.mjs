import {showRecordBrowser} from './ui-test-helpers.mjs';
import {showScheduleSettings,showAdvancedRegistration} from './ui-test-helpers.mjs';
// Isolated synthetic images and failure logs: never requests a monitored URL.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {writeFile,readFile,rm} from 'node:fs/promises';
import {PNG} from 'pngjs';
import {chromium} from 'playwright';
const data=process.env.REWIND_DATA_DIR,base=process.env.REWIND_URL||'http://127.0.0.1:4318';
if(!data?.startsWith('/tmp/'))throw new Error('Use isolated /tmp/ test data.');
const db=new DatabaseSync(resolve(data,'rewind.sqlite')),sid=randomUUID(),other=randomUUID(),blocked=randomUUID(),full=randomUUID(),old=randomUUID();
for(const id of[sid,other])db.prepare('INSERT INTO sites(id,url,title,created_at,daily,paused) VALUES(?,?,?,?,1,1)').run(id,`https://example.com/?page-calendar=${id}`,'전체 페이지 테스트','2026-10-01T00:00:00.000Z');
for(const [id,height,date] of[[full,3200,'2026-10-29T01:00:00.000Z'],[old,1000,'2026-10-28T01:00:00.000Z']]){
 const png=new PNG({width:1440,height});png.data.fill(255);
 if(id===full)for(let y=3000;y<3100;y++)for(let x=100;x<200;x++){const k=(y*1440+x)*4;png.data[k]=0;png.data[k+1]=0;png.data[k+2]=0;}
 const image=PNG.sync.write(png);await writeFile(resolve(data,'captures',`${id}.png`),image);
 db.prepare('INSERT INTO captures(id,site_id,created_at,title,bytes,width,height,capture_mode) VALUES(?,?,?,?,?,1440,?,?)').run(id,sid,date,'테스트 사진',image.length,height,id===full?'full_page':'viewport');
}
const fail=(site,date,message)=>db.prepare("INSERT INTO capture_attempts(id,site_id,started_at,finished_at,status,error) VALUES(?,?,?,?,'failed',?)").run(randomUUID(),site,date,date,message);
fail(sid,'2026-10-28T22:30:00.000Z','<script>실패 메시지도 안전하게</script>');
fail(sid,'2026-10-31T23:30:00.000Z','월 경계 실패');fail(other,'2026-10-28T22:30:00.000Z','다른 사이트 비공개 실패');
const request=async(path,method='GET',input)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)});return {status:r.status,body:await r.json()};};
const browser=await chromium.launch({env:{...process.env,LD_LIBRARY_PATH:resolve('data/browser-libs/usr/lib/x86_64-linux-gnu')}}),context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Seoul',locale:'ko-KR'}),page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 for(const invalid of[{interval_minutes:0},{interval_minutes:1.5},{interval_minutes:43201},{interval_hours:1,interval_minutes:5},{capture_mode:'invalid'}]){
  assert.equal((await request(`/api/sites/${sid}`,'PATCH',{display_name:'Must not mutate',...invalid})).status,400);
  assert.equal(db.prepare('SELECT display_name FROM sites WHERE id=?').get(sid).display_name,null);
 }
 db.prepare('INSERT INTO sites(id,url,title,created_at,daily,paused,capture_mode) VALUES(?,?,?,?,0,0,?)').run(blocked,'http://127.0.0.1/?guard='+blocked,'Blocked worker fixture',new Date().toISOString(),'full_page');
 assert.equal((await request(`/api/sites/${blocked}/capture`,'POST')).status,202);
 for(let i=0;i<100 && !db.prepare('SELECT error FROM sites WHERE id=?').get(blocked).error;i++)await new Promise(r=>setTimeout(r,100));
 assert.ok(db.prepare('SELECT error FROM sites WHERE id=?').get(blocked).error);assert.equal(db.prepare('SELECT status FROM capture_attempts WHERE site_id=?').get(blocked).status,'failed');assert.equal(db.prepare('SELECT count(*) n FROM captures WHERE site_id=?').get(blocked).n,0);
 const history=await request(`/api/sites/${sid}/history?from=2026-10-01T00%3A00%3A00.000Z&to=2026-11-01T00%3A00%3A00.000Z`);assert.equal(history.status,200);assert.equal(history.body.events.length,4);assert.ok(!history.body.events.some(e=>e.error==='다른 사이트 비공개 실패'));
 assert.equal((await request(`/api/sites/${sid}/history?from=2026-01-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z`)).status,400);
 await page.goto(`${base}/?site=${sid}`);await showScheduleSettings(page);await page.locator('#schedule-config').waitFor();
 await showScheduleSettings(page);await page.locator('#schedule-config').click();await page.locator('#settings-schedule-mode').selectOption('minute_interval');await page.locator('#settings-interval-minutes').fill('15');await page.locator('#settings-capture-mode').selectOption('full_page');await page.locator('#save-settings').click();await page.waitForFunction(()=>document.querySelector('#schedule-config')?.textContent.includes('15분'));
 let row=db.prepare('SELECT * FROM sites WHERE id=?').get(sid);assert.equal(row.interval_minutes,15);assert.equal(row.capture_mode,'full_page');assert.equal(row.paused,1);
 await page.reload();await showScheduleSettings(page);await page.locator('#schedule-config').waitFor();await showScheduleSettings(page);await page.locator('#schedule-config').click();assert.equal(await page.locator('#settings-schedule-mode').inputValue(),'minute_interval');assert.equal(await page.locator('#settings-interval-minutes').inputValue(),'15');assert.equal(await page.locator('#settings-capture-mode').inputValue(),'full_page');
 await page.locator('#settings-interval-minutes').fill('0');await page.locator('#save-settings').click();assert.equal(await page.locator('#settings-dialog').evaluate(el=>el.open),true);assert.equal(db.prepare('SELECT interval_minutes FROM sites WHERE id=?').get(sid).interval_minutes,15);await page.locator('#cancel-settings').click();
 await page.locator('#add-from-viewer').click();await showAdvancedRegistration(page);await page.locator('#add-schedule-mode').selectOption('minute_interval');await showAdvancedRegistration(page);await page.locator('#add-interval-minutes').fill('5');await showAdvancedRegistration(page);await page.locator('#add-capture-mode').selectOption('full_page');let submitted;
 await page.route('**/api/sites',route=>{if(route.request().method()==='POST'){submitted=route.request().postDataJSON();return route.fulfill({status:400,json:{error:'Test-only submission'}});}return route.continue();});
 await page.locator('#url').fill('https://example.org/');await page.locator('#submit-url').click();await page.locator('#form-error').waitFor();assert.equal(submitted.interval_minutes,5);assert.equal(submitted.capture_mode,'full_page');await page.locator('#close-dialog').click();
 assert.equal(await page.locator('#capture-stage').evaluate(el=>el.classList.contains('long-capture')),true);
 const natural=await page.locator('.canvas>img').evaluate(async img=>{await img.decode();return {height:img.naturalHeight,ratio:img.clientHeight/img.clientWidth};});assert.equal(natural.height,3200);assert.ok(Math.abs(natural.ratio-3200/1440)<.01);
 await page.locator('#inspect-image').click();await page.locator('#zoom-actual').click();assert.equal(await page.locator('#inspector-image').evaluate(el=>el.style.width),'1440px');await page.locator('#zoom-fit').click();assert.ok(await page.locator('#inspector-image').evaluate(img=>img.clientHeight<=document.querySelector('#inspector-viewport').clientHeight));await page.keyboard.press('Escape');
 await page.locator('#compare-mode').click();assert.ok(await page.locator('.canvas').evaluate(el=>el.clientHeight/el.clientWidth>2));await page.locator('#compare-slider').fill('35');assert.match(await page.locator('.before-image').getAttribute('style'),/65%/);
 await page.locator('#diff-mode').click();await page.locator('#diff-summary[data-ready=true]').waitFor();assert.equal(await page.locator('#diff-canvas').evaluate(c=>c.height),3200);assert.match(await page.locator('#diff-summary').textContent(),/0\.22%/);assert.match(await page.locator('#diff-summary').textContent(),/흰색/);
 const downloadPromise=page.waitForEvent('download');await page.locator('#download-diff').click();const download=await downloadPromise;assert.equal(PNG.sync.read(await readFile(await download.path())).height,3200);
 await page.locator('#single-mode').click();await page.locator('#record-calendar>summary').click();await page.locator('#calendar-day-2026-10-29').waitFor();assert.match(await page.locator('#calendar-day-2026-10-29').getAttribute('aria-label'),/저장 1개, 실패 1회/);
 await page.locator('#calendar-day-2026-10-29').click();assert.equal(new URL(page.url()).searchParams.get('after'),full);await page.locator('.calendar-attempt.failed').waitFor();assert.match(await page.locator('#calendar-day-events').textContent(),/<script>/);assert.equal(await page.locator('#calendar-day-events script').count(),0);assert.equal(await page.locator('.moment').count(),1);assert.equal(await page.locator('#calendar-retry').isDisabled(),true);
 await page.locator('#calendar-next').click();await page.locator('#calendar-day-2026-11-01').waitFor();assert.match(await page.locator('#calendar-day-2026-11-01').getAttribute('aria-label'),/실패 1회/);await page.locator('#calendar-day-2026-11-01').click();await page.waitForFunction(()=>document.querySelector('#calendar-day-events').textContent.includes('월 경계 실패'));
 await page.locator('#calendar-month').fill('2026-10');await page.locator('#calendar-month').dispatchEvent('change');await page.locator('#calendar-day-2026-10-28').waitFor();await page.locator('#calendar-day-2026-10-28').click();await page.locator(`[data-record="${old}"]`).click();assert.equal(new URL(page.url()).searchParams.get('after'),old);
 for(const width of[390,320]){
  await page.setViewportSize({width,height:844});await showRecordBrowser(page);await page.locator('#calendar-day-2026-10-29').click();await page.locator('#calendar-day-events .calendar-attempt').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`test-results/page-calendar-${width}.png`,fullPage:true});
 }
 const overseas=await browser.newContext({timezoneId:'America/Los_Angeles'}),abroad=await overseas.newPage();abroad.on('pageerror',e=>errors.push(e.message));await abroad.goto(`${base}/?site=${sid}`);await abroad.locator('#record-calendar>summary').click();await abroad.locator('#calendar-day-2026-10-31').waitFor();assert.match(await abroad.locator('#calendar-day-2026-10-31').getAttribute('aria-label'),/실패 1회/);await overseas.close();
 // Failure history must survive the successful screenshot's deletion.
 assert.equal((await request(`/api/sites/${sid}/captures/${full}`,'DELETE')).status,200);
 const afterDelete=await request(`/api/sites/${sid}/history?from=2026-10-01T00%3A00%3A00.000Z&to=2026-11-01T00%3A00%3A00.000Z`);assert.equal(afterDelete.body.events.filter(e=>e.type==='failed').length,2);assert.ok(!afterDelete.body.events.some(e=>e.id===full));
 assert.deepEqual(errors,[]);console.log('PASS: minute/full-page settings and add payload, validation atomicity, tall images/zoom/slider/diff PNG, month/day navigation, failure history and isolation, timezone month boundary, safe error text, 320/390 mobile.');
}finally{await browser.close();for(const id of[sid,other,blocked])db.prepare('DELETE FROM sites WHERE id=?').run(id);db.close();await Promise.all([full,old].map(id=>rm(resolve(data,'captures',`${id}.png`),{force:true})));}
