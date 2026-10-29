import {showScheduleSettings,showAdvancedRegistration} from './ui-test-helpers.mjs';
// Optional end-to-end check. Start Rewind first; this briefly adds example.com.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
const base=process.env.REWIND_URL || 'http://127.0.0.1:3000';
const browser=await chromium.launch({env:{...process.env,LD_LIBRARY_PATH:[resolve(process.env.REWIND_DATA_DIR||'data','browser-libs/usr/lib/x86_64-linux-gnu'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
let id;
const call=async(path,method='GET',data)=>{
 const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
 return {status:res.status,body:await res.json()};
};
async function waitForCapture(count){
 for(let i=0;i<90;i++){
  const site=(await call('/api/sites')).body.sites.find(s=>s.id===id);
  if(site.error&&!site.capturing)throw new Error(site.error);
  if(site.captures.length>=count&&!site.capturing)return site;
  await new Promise(r=>setTimeout(r,1000));
 }
 throw new Error('Capture timed out');
}
try {
 await page.goto(base);
 assert.equal(await page.title(),'Rewind — 웹의 시간을 기록하세요');
 const blocked=await call('/api/sites','POST',{url:'http://127.0.0.1'});
 assert.equal(blocked.status,400);
 const forbidden=await fetch(base+'/api/sites',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});
 assert.equal(forbidden.status,403);
 await page.locator('#add-site').click();
 await page.locator('#url').fill('https://example.com');
 await showAdvancedRegistration(page);await page.locator('#add-capture-mode').selectOption('full_page');
 await page.locator('input[name="frequency"][value="manual"]').check();
 await page.locator('#submit-url').click();
 await page.waitForFunction(()=>!document.querySelector('#add-dialog').open);
 id=(await call('/api/sites')).body.sites.find(s=>s.url==='https://example.com/').id;
 const first=await waitForCapture(1);assert.equal(first.capture_mode,'full_page');assert.equal(first.captures[0].capture_mode,'full_page');assert.equal(first.captures[0].width,1440);assert.ok(first.captures[0].height>=1000);
 assert.equal((await call(`/api/sites/${id}`,'PATCH',{display_name:'My Example',favorite:true})).status,200);
 assert.equal((await call(`/api/sites/${id}`,'PATCH',{favorite:'invalid'})).status,400);
 assert.equal(first.daily,0,'manual recording preference should be saved');
 assert.equal((await call(`/api/sites/${id}`,'PATCH',{paused:true})).status,200);
 assert.equal((await call(`/api/sites/${id}/capture`,'POST')).status,409,'held sites reject manual capture');
 assert.equal((await call('/api/sites')).body.sites.find(s=>s.id===id).captures.length,1);
 assert.equal((await call(`/api/sites/${id}`,'PATCH',{paused:'invalid'})).status,400);
 assert.equal((await call(`/api/sites/${id}`,'PATCH',{paused:false})).status,200);
 assert.equal((await call('/api/sites')).body.sites.find(s=>s.id===id).daily,0,'resume preserves recording preference');
 assert.equal((await fetch(base+first.captures[0].image)).headers.get('content-type'),'image/png');
 await page.locator('#capture-now').waitFor();
 await page.waitForFunction(()=>!document.querySelector('#capture-now').disabled);
 await page.locator('#capture-now').click();
 const second=await waitForCapture(2);
 assert.equal(second.title,'My Example','custom names survive new captures');
 assert.equal(second.favorite,1);
 await page.waitForFunction(()=>document.querySelectorAll('.moment').length===2);
 await page.locator('#compare-mode').click();
 await page.locator('.compare-range').fill('27');
 assert.match(await page.locator('.before-image').getAttribute('style'),/73%/);
 await page.locator('.compare-range').focus();
 await page.keyboard.press('ArrowRight');
 assert.equal(await page.locator('.compare-range').inputValue(),'28');
 await page.locator('#split-mode').click();
 assert.equal(await page.locator('.split-wrapper figure').count(),2);
 await page.locator('#compare-mode').click();
 await showScheduleSettings(page);await page.locator('#daily').check();
 await page.waitForTimeout(200);
 await showScheduleSettings(page);await page.locator('#daily').uncheck();
 await page.waitForFunction(()=>!document.querySelector('#daily').checked);
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile should not overflow');
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:'test-results/compare.png',fullPage:true});
 const captured=(await call('/api/sites')).body.sites.find(s=>s.id===id).captures[0];
 assert.equal((await call(`/api/sites/other/captures/${captured.id}`,'DELETE')).status,404);
 assert.equal((await call(`/api/sites/${id}/captures/${captured.id}`,'DELETE')).status,200);
 assert.equal((await fetch(base+captured.image)).status,404);
 assert.equal((await call('/api/sites')).body.sites.find(s=>s.id===id).captures.length,1);
 assert.deepEqual(errors,[]);
 console.log('PASS: registration, public URL boundary, CSRF, real captures, PNG, comparison, keyboard, schedule, mobile, browser errors');
} finally {
 if(id){const result=await call(`/api/sites/${id}`,'DELETE');assert.equal(result.status,200);console.log('PASS: deletion');}
 await browser.close();
}
