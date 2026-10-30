// All API requests are mocked. This exercises UI flows without touching archive data.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
const base=process.env.REWIND_URL || 'http://127.0.0.1:4318';
assert.equal(new URL(base).hostname,'127.0.0.1');
const now=Date.now();
const records=Array.from({length:30},(_,i)=>({id:`r${i}`,created_at:new Date(now-i*60000).toISOString(),title:`기록 ${i}`,bytes:1024,image:`/captures/r${i}.png`,content_change:i===0?'changed':i===1?'unchanged':i===2?'new':'unavailable',content_summary:i===0?'직전 촬영과 본문 텍스트가 달라요.':'본문 텍스트 분석 결과',compared_capture_id:i<2?`r${i+1}`:null,content_excerpt:'새로운 소식과 업데이트'}));
const sites=Array.from({length:160},(_,i)=>({id:`s${i}`,title:`사이트 ${i}`,url:`https://site${i}.example/`,created_at:new Date(now-i*60000).toISOString(),daily:0,paused:i===1?1:0,tags:i%2===0?['뉴스','업무']:['디자인'],group_name:i%2===0?'리서치':'참고',captures:structuredClone(records),capturing:false}));
const attempts=Array.from({length:61},(_,i)=>({id:`a${i}`,site_id:i===1?'s1':'s0',site_title:i===1?'사이트 1':'사이트 0',status:i===2?'success':'failed',started_at:new Date(now-i*60000).toISOString(),finished_at:new Date(now-i*60000+1000).toISOString(),error:i===2?null:'HTTP 403 <script>alert(1)</script>',capture_id:i===2?'r0':null}));
const browser=await chromium.launch({env:{...process.env,LD_LIBRARY_PATH:[resolve('data/browser-libs/usr/lib/x86_64-linux-gnu'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}});
const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[], requests=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',async route=>{
 const req=route.request(),url=new URL(req.url()),method=req.method(),path=url.pathname;
 requests.push({path,method});
 if(path==='/api/attempts') {
   let rows=attempts.filter(a=>(!url.searchParams.get('site_id') || a.site_id===url.searchParams.get('site_id'))&&(url.searchParams.get('status')==='all'||a.status===url.searchParams.get('status')));
   const offset=Number(url.searchParams.get('offset')),limit=Number(url.searchParams.get('limit'));
   return route.fulfill({json:{attempts:rows.slice(offset,offset+limit),has_more:rows.length>offset+limit,next_offset:offset+limit,queued:[]}});
 }
 if(method==='GET') return route.fulfill({json:path.endsWith('/history')?{events:[]}:{sites}});
 const site=sites.find(s=>path.includes('/sites/'+s.id));
 if(method==='PATCH') {Object.assign(site,req.postDataJSON());return route.fulfill({json:{ok:true}});}
 if(method==='POST'&&path.endsWith('/capture')) {site.capturing=true;return route.fulfill({json:{ok:true}});}
 throw new Error('Unexpected API: '+method+' '+path);
});
await page.route('**/captures/*.png',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1000"><rect width="1440" height="1000" fill="#e6eee6"/><text x="80" y="150" font-size="60" fill="#2e5843">Archive preview</text></svg>'}));
await page.goto(base+'/?view=list');await page.locator('.card').first().waitFor();
await page.selectOption('#group-filter','리서치');assert.equal(await page.locator('.card').count(),80);
await page.selectOption('#tag-filter','뉴스');assert.equal(await page.locator('.card').count(),80);
assert.ok(page.url().includes('group='));assert.ok(page.url().includes('tag='));
await page.reload();await page.locator('.card').first().waitFor();assert.equal(await page.locator('.card').count(),80);
await page.locator('#search').fill('업무');assert.equal(await page.locator('.card').count(),80);
await page.locator('#clear-search').click();await page.locator('#clear-organization').click();assert.equal(await page.locator('.card').count(),160);
await page.locator('[data-site="s0"].card-title').click();await page.locator('#edit-site').click();
await page.locator('.organization-settings summary').click();await page.locator('#site-group').fill('프로젝트');await page.locator('#site-tags').fill('업데이트, 관심');await page.locator('#save-settings').click();
await page.waitForFunction(()=>!document.querySelector('#settings-dialog').open);assert.equal(sites[0].group_name,'프로젝트');assert.deepEqual(sites[0].tags,['업데이트','관심']);
await page.selectOption('#change-filter','changed');assert.equal(await page.locator('.moment').count(),1);
await page.locator('.content-analysis summary').click();await page.locator('#compare-content-baseline').click();assert.equal(await page.locator('#before-select').inputValue(),'r1');assert.equal(await page.locator('#after-select').inputValue(),'r0');
await page.locator('#single-mode').click();await page.selectOption('#change-filter','unavailable');assert.equal(await page.locator('.moment').count(),12);
await page.locator('#back-to-archive').click();await page.locator('#open-activity').click();await page.locator('.activity-list li').first().waitFor();assert.equal(await page.locator('.activity-list li').count(),50);
assert.equal(await page.locator('#activity-results script').count(),0);
await page.locator('#activity-more').click();await page.waitForFunction(()=>document.querySelectorAll('.activity-list li').length===61);assert.equal(await page.locator('#activity-more').isVisible(),false);
assert.equal(await page.locator('[data-attempt-retry="s1"]').first().isDisabled(),true);
await page.selectOption('#activity-status','success');await page.waitForFunction(()=>document.querySelectorAll('.activity-list li').length===1);
await page.locator('[data-attempt-record]').click();assert.equal(await page.locator('#after-select').inputValue(),'r0');
await page.locator('#site-menu-toggle').click();await page.locator('#show-site-activity').click();await page.selectOption('#activity-status','failed');await page.locator('[data-attempt-retry="s0"]').first().click();
await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-attempt-retry]')).some(b=>b.textContent==='촬영 진행 중'));
assert.equal(requests.filter(r=>r.path==='/api/sites/s0/capture').length,1);
await page.keyboard.press('Escape');assert.equal(await page.locator('#activity-dialog').isVisible(),false);
await page.locator('#back-to-archive').click();
await mkdir('test-results/features',{recursive:true});
for(const width of [1440,768,390,360]) {
 await page.setViewportSize({width,height:width<600?844:1000});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`);
 if(width<600)await page.locator('#mobile-menu').click();
 await page.locator('#open-activity').click();await page.locator('.activity-list li').first().waitFor();
 assert.ok(await page.evaluate(()=>document.querySelector('#activity-dialog').scrollWidth<=document.querySelector('#activity-dialog').clientWidth+1),`dialog overflow ${width}`);
 for(let i=0;i<18;i++){await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.querySelector('#activity-dialog').contains(document.activeElement)),`dialog focus ${width}`);}
 await page.locator('#close-activity').focus();await page.locator('#activity-results').evaluate(el=>el.scrollTop=0);
 await page.locator('#activity-dialog').screenshot({path:`test-results/features/activity-${width}.png`});
 await page.keyboard.press('Escape');
 if(width<600)await page.waitForFunction(()=>document.activeElement.id==='mobile-menu');
 await page.screenshot({path:`test-results/features/list-${width}.png`});
}
assert.deepEqual(errors,[]);await browser.close();console.log('Feature UI checks passed: 160 sites, organization persistence/editing, text change discovery, attempts pagination/filter/retry, 4 widths, keyboard focus, escaped errors.');
