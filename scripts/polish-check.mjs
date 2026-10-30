// Browser-only fixtures. Every API request is intercepted; no archive data is touched.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {showTimelineFilters,showRecordBrowser,closeRecordBrowser} from './ui-test-helpers.mjs';
const base=process.env.REWIND_URL || 'http://127.0.0.1:4318';
assert.equal(new URL(base).hostname,'127.0.0.1');
const now=Date.now();
const records=Array.from({length:30},(_,i)=>({id:`r${i}`,title:`기록 ${i}`,created_at:new Date(now-i*60000).toISOString(),image:`/captures/r${i}.png`,width:1440,height:1000,important:i===5,content_change:i===0?'changed':'unchanged'}));
const site={id:'archive',title:'디자인 아카이브',url:'https://archive.example/',created_at:new Date(now).toISOString(),daily:1,interval_minutes:30,last_attempt:new Date(now).toISOString(),captures:records,capture_mode:'viewport'};
const sites=[site,{...site,id:'held',title:'보류 중인 사이트',paused:1},{...site,id:'busy',title:'촬영 중인 사이트',capturing:true}];
const browser=await chromium.launch({env:{...process.env,LD_LIBRARY_PATH:[resolve('data/browser-libs/usr/lib/x86_64-linux-gnu'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],mutations=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',route=>{
 const req=route.request();if(req.method()!=='GET'){mutations.push(req.url());return route.abort();}
 return route.fulfill({json:new URL(req.url()).pathname.endsWith('/history')?{events:[]}:{sites}});
});
await page.route('**/captures/*.png',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1000"><rect width="1440" height="1000" fill="#e9eee4"/><rect x="80" y="80" width="800" height="260" fill="#365f46"/><text x="90" y="500" font-size="60" fill="#365f46">Rewind / Archive</text></svg>'}));
await mkdir('test-results/polish',{recursive:true});
try {
 for(const width of [1440,1024,768,390,360]) {
  await page.setViewportSize({width,height:width<700?844:1000});
  await page.goto(base+'/?view=list');await page.locator('.card').first().waitFor();
  const problems=await page.locator('.card').evaluateAll(cards=>cards.flatMap(card=>{
   const b=card.getBoundingClientRect(),p=card.querySelector('.card-preview').getBoundingClientRect(),r=card.querySelector('.card-record-group').getBoundingClientRect(),s=card.querySelector('.card-schedule-group').getBoundingClientRect();
   const overlapping=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
   const issues=[];if(overlapping(p,r)||overlapping(p,s)||overlapping(r,s))issues.push('metadata overlaps preview or other group');
   for(const button of card.querySelectorAll('.card-actions button')){const a=button.getBoundingClientRect();if(a.left<b.left||a.right>b.right||a.bottom>b.bottom)issues.push('clipped action');}
   return issues;
  }));assert.deepEqual(problems,[],`list grouping at ${width}`);
  assert.equal(await page.locator('.card-record-group .card-record-count').count(),3);
  assert.equal(await page.locator('.card-schedule-group .next-capture').count(),3);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`test-results/polish/list-${width}.png`});
  await page.locator('.card-title[data-site="archive"]').click();await page.locator('#compare-mode').click();
  assert.equal(await page.locator('#timeline-filters').evaluate(el=>el.open),false);
  await page.selectOption('#before-select','r5');await page.locator('#target-before').click();
  assert.match(await page.locator('#target-before .target-action').textContent(),/선택 대상/);
  await showRecordBrowser(page);
  assert.equal(await page.locator('.moment.is-target').getAttribute('data-capture'),'r5');
  assert.match(await page.locator('#moment-r5 .moment-side').textContent(),/왼쪽 · 선택 대상/);
  assert.match(await page.locator('#moment-r0 .moment-side').textContent(),/오른쪽 · 비교 기록/);
  await showTimelineFilters(page);await page.locator('#important-only').click();
  assert.equal(await page.locator('.moment').count(),1);
  assert.match(await page.locator('.timeline-filter-summary').textContent(),/중요 기록/);
  assert.match(await page.locator('.timeline-heading h2 span').textContent(),/1 \/ 30/);
  const expandedHeight=await page.locator('#timeline-filters').evaluate(el=>el.getBoundingClientRect().height);
  await page.locator('#timeline-filter-toggle').click();
  assert.equal(await page.locator('#important-only').isVisible(),false);
  assert.match(await page.locator('.timeline-filter-summary').textContent(),/중요 기록/);
  assert.ok(await page.locator('#timeline-filters').evaluate(el=>el.getBoundingClientRect().height)<expandedHeight-80,'collapsing filters exposes records');
  await showTimelineFilters(page);await page.selectOption('#change-filter','changed');
  assert.equal(await page.locator('.moment').count(),0);
  await page.locator('#empty-clear-date').click();assert.equal(await page.locator('.moment').count(),12);
  await page.locator('#important-only').click();await page.locator('#reset-timeline-filters').click();
  assert.equal(await page.locator('#timeline-filters').evaluate(el=>el.open),true,'reset preserves disclosure');
  assert.equal(await page.locator('#important-only').getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#change-filter').inputValue(),'all');assert.equal(await page.locator('#timeline-date').inputValue(),'');
  assert.match(await page.locator('.timeline-filter-summary').textContent(),/모든 기록/);
  await page.locator('#timeline-filter-toggle').click();
  if(width<700){
   for(let i=0;i<30;i++){await page.keyboard.press('Tab');assert.ok(await page.locator('#record-browser').evaluate(el=>el.contains(document.activeElement)));}
   await page.locator('#close-records').focus();await page.locator('#record-browser-content').evaluate(el=>el.scrollTop=0);
   await page.screenshot({path:`test-results/polish/records-${width}.png`});
  }
  await closeRecordBrowser(page);await page.locator('#target-after').click();
  assert.match(await page.locator('#target-after .target-action').textContent(),/선택 대상/);
  await showRecordBrowser(page);assert.equal(await page.locator('.moment.is-target').getAttribute('data-capture'),'r0');
  await closeRecordBrowser(page);await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:`test-results/polish/viewer-${width}.png`});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
 console.log('PASS: grouped list metadata without overlap, collapsed filters and visible active conditions, combined empty/reset behavior, target/peer labels, mobile keyboard, 1440/1024/768/390/360. No mutations.');
}finally{await browser.close();}
