// All API traffic is mocked; this script never reads or writes archive data.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const base = process.env.REWIND_URL || 'http://127.0.0.1:4318';
const widths = (process.env.REWIND_DESIGN_WIDTHS || '1440,1024,768,390,360').split(',').map(Number);
assert.equal(new URL(base).hostname,'127.0.0.1');
const now = Date.now();
const records = Array.from({length:40},(_,i) => ({
 id:`record-${i}`, created_at:new Date(now-i*3_600_000).toISOString(),
 title:`저장한 화면 ${i}`, image:`/captures/record-${i}.png`, bytes:2048,
 width:1440, height:1000, note:i===5 ? '왼쪽 기록의 기존 메모' : '', important:i===5,
 content_change:i===0 ? 'changed' : 'unavailable', compared_capture_id:i===0 ? 'record-1' : null,
 content_summary:'본문 텍스트 변경 후보입니다. 이미지 의미는 별도로 확인해 주세요.',
}));
const site = {id:'workspace', title:'넓은 화면과 긴 기록을 가진 사이트', page_title:'Workspace',
 url:'https://workspace.example/', created_at:new Date(now).toISOString(), daily:0, paused:0,
 tags:['읽을거리'], group_name:'리서치', favorite:0, capturing:false, captures:records};
const sites = [site,...Array.from({length:11},(_,i) => ({...site,id:`extra-${i}`,
 title:`다른 아카이브 ${i}`,url:`https://extra-${i}.example/`,captures:records.slice(0,2)}))];
const browser = await chromium.launch({env:{...process.env,
 LD_LIBRARY_PATH:[resolve('data/browser-libs/usr/lib/x86_64-linux-gnu'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}});
const page = await browser.newPage({viewport:{width:1440,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul'});
const errors = [], mutations = [], unexpected = [];
page.on('pageerror',error => errors.push(error.message));
await page.route('**/api/**',async route => {
 const request = route.request(), url = new URL(request.url()), path = url.pathname;
 if (request.method() === 'GET') {
  if (path.endsWith('/history')) {
   const from=Date.parse(url.searchParams.get('from')),to=Date.parse(url.searchParams.get('to'));
   return route.fulfill({json:{events:site.captures.filter(c=>Date.parse(c.created_at)>=from && Date.parse(c.created_at)<to).map(c=>({...c,type:'capture',at:c.created_at}))}});
  }
  if (path === '/api/attempts') return route.fulfill({json:{attempts:[],queued:[],has_more:false}});
  return route.fulfill({json:{sites}});
 }
 mutations.push({method:request.method(),path});
 if (path.endsWith('/captures/delete') && request.method() === 'POST') {
  const ids = request.postDataJSON().ids;
  site.captures = site.captures.filter(c=>!ids.includes(c.id));
  return route.fulfill({json:{ok:true,deleted:ids.length}});
 }
 const recordId = path.match(/\/captures\/([^/]+)$/)?.[1];
 if (recordId && request.method() === 'PATCH') {
  Object.assign(site.captures.find(c=>c.id===recordId),request.postDataJSON());
  return route.fulfill({json:{ok:true}});
 }
 unexpected.push(request.method()+' '+path);
 return route.fulfill({status:400,json:{error:'Unexpected mock request'}});
});
await page.route('**/captures/*.png',route => route.fulfill({contentType:'image/svg+xml',body:
 '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1000"><rect width="1440" height="1000" fill="#e7eee1"/><rect x="80" y="80" width="900" height="250" rx="12" fill="#365e45"/><text x="100" y="440" font-size="60" fill="#365e45">Workspace preview</text></svg>'}));
const box = selector => page.locator(selector).boundingBox();
async function noOverflow(label) {
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label);
}
async function openRecords(width) {
 if (width<=700 && !(await page.locator('#record-browser').evaluate(el=>el.open))) await page.locator('#browse-records').click();
}
async function closeRecords(width) {
 if (width<=700 && await page.locator('#record-browser').evaluate(el=>el.open)) await page.locator('#close-records').click();
}
async function uniqueIds() {
 assert.deepEqual(await page.evaluate(()=>{
  const ids=[...document.querySelectorAll('[id]')].map(el=>el.id);
  return ids.filter((id,index)=>ids.indexOf(id)!==index);
 }),[],'desktop/mobile controls reuse a single DOM');
}
await mkdir('test-results/workspace-design',{recursive:true});
try {
 await page.goto(base+'/?view=grid');
 await page.locator('.card').first().waitFor();
 for (const width of widths) {
  await page.setViewportSize({width,height:width<700 ? 844 : 1000});
  await noOverflow(`home overflow at ${width}`);
  await page.screenshot({path:`test-results/workspace-design/home-${width}.png`,fullPage:false});
  await page.locator('#list-view').click();
  const clipped=await page.locator('.card').evaluateAll(cards=>cards.flatMap(card=>{
   const bounds=card.getBoundingClientRect();
   return [...card.querySelectorAll('.card-actions button')].filter(button=>{
    const action=button.getBoundingClientRect();return action.left<bounds.left || action.right>bounds.right || action.top<bounds.top || action.bottom>bounds.bottom;
   }).map(button=>button.getAttribute('aria-label'));
  }));
  assert.deepEqual(clipped,[],`list actions remain inside every card at ${width}`);
  await page.locator('#grid-view').click();
  await page.locator('.card-title[data-site="workspace"]').click();
  await page.locator('#compare-mode').click();
  await page.locator('#before-select').selectOption('record-5');
  await page.locator('#target-before').click();
  await openRecords(width);
  await page.waitForFunction(() => {
   const strip=document.querySelector('.timeline'), selected=document.querySelector('.moment[data-capture="record-5"]');
   const bounds=strip.getBoundingClientRect(), card=selected.getBoundingClientRect();
   return getComputedStyle(strip).flexDirection==='column'
    ? card.top>=bounds.top-2 && card.bottom<=bounds.bottom+2
    : card.left>=bounds.left-2 && card.right<=bounds.right+2;
  },null,{timeout:3000}).catch(async error => {
   console.error('Record reveal geometry',width,await page.evaluate(()=>{
    const strip=document.querySelector('.timeline'),selected=document.querySelector('.moment[data-capture="record-5"]');
    const rect=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};
    return {strip:rect(strip),selected:rect(selected),scrollTop:strip.scrollTop,scrollLeft:strip.scrollLeft,direction:getComputedStyle(strip).flexDirection};
   }));
   throw error;
  });
  if (width<=700) {
   await page.locator('.moment[data-capture="record-5"]').click();
   assert.equal(await page.locator('#record-browser').evaluate(el=>el.open),false,'choosing a mobile history record returns to the image');
   assert.equal(await page.locator('#browse-records').evaluate(el=>el===document.activeElement),true,'history selection restores its trigger');
  }
  assert.match(await page.locator('.record-target-label').textContent(),/왼쪽/);
  assert.match(await page.locator('.record-note').textContent(),/기존 메모/);
  await page.locator('#older-record').click();
  assert.equal(await page.locator('#before-select').inputValue(),'record-6');
  await page.locator('#latest-record').click();
  assert.equal(await page.locator('#before-select').inputValue(),'record-0');
  assert.notEqual(await page.locator('#after-select').inputValue(),'record-0');
  await page.locator('#swap-records').click();
  assert.equal(await page.locator('#after-select').inputValue(),'record-0');
  await noOverflow(`comparison overflow at ${width}`);
  await uniqueIds();
  const stage = await box('#capture-stage'), rail = await box('.viewer-rail');
  if (width>=1100) {
   assert.ok(rail.x>=stage.x+stage.width-2,'desktop history is beside the image');
   assert.ok(stage.width>=600,`desktop screenshot has useful width: ${stage.width}`);
   const scrolling = await page.locator('.timeline').evaluate(el=>({scroll:el.scrollHeight,client:el.clientHeight}));
   assert.ok(scrolling.scroll>scrolling.client,'desktop history has independent vertical scrolling');
   await page.locator('.timeline').hover();
   const before = await page.evaluate(()=>scrollY);
   await page.mouse.wheel(0,300);
   await page.waitForFunction(()=>document.querySelector('.timeline').scrollTop>10);
   await page.locator('.timeline').evaluate(el=>new Promise(resolve=>{
    let timer=setTimeout(done,250);
    function done() { el.removeEventListener('scroll',changed); resolve(); }
    function changed() { clearTimeout(timer); timer=setTimeout(done,250); }
    el.addEventListener('scroll',changed);
   }));
   assert.ok(Math.abs((await page.evaluate(()=>scrollY))-before)<3,'history scrolling leaves the main image in place');
   const scrollTop = await page.locator('.timeline').evaluate(el=>el.scrollTop);
   site.title += ' · 새로고침';
   await page.waitForFunction(title=>document.querySelector('#viewer-title').textContent===title,site.title);
   const refreshedTop = await page.locator('.timeline').evaluate(el=>el.scrollTop);
   assert.ok(Math.abs(refreshedTop-scrollTop)<3,`history position survives background refresh: ${scrollTop} → ${refreshedTop}`);
  } else if (width>700) {
   assert.ok(rail.y>=stage.y+stage.height-2,'tablet history follows the image');
  } else {
   assert.equal(await page.locator('#record-browser').evaluate(el=>el.open),false);
   await page.locator('#browse-records').click();
   assert.equal(await page.locator('#record-browser').evaluate(el=>el.open),true,'mobile history opens a sheet');
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('#record-browser').evaluate(el=>el.open),false);
   assert.equal(await page.locator('#browse-records').evaluate(el=>el===document.activeElement),true,'closing mobile history restores its trigger');
   await openRecords(width);
   const sheet=await box('.viewer-rail');
   assert.ok(sheet.x>=-1 && sheet.x+sheet.width<=width+1,'mobile sheet fits the viewport');
   await page.locator('#record-browser').screenshot({path:`test-results/workspace-design/records-${width}.png`});
   for (let i=0;i<24;i++) {
    await page.keyboard.press('Tab');
    const focus=await page.locator('#record-browser').evaluate(el=>({inside:el.contains(document.activeElement),active:document.activeElement.outerHTML.slice(0,180),controls:[...el.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex]:not([tabindex="-1"])')].filter(item=>item.getClientRects().length && !item.closest('[hidden]')).map(item=>item.id || item.tagName+':'+item.textContent.trim().slice(0,20))}));
    assert.ok(focus.inside,`mobile history keeps keyboard focus inside (${i}): ${focus.active}; controls=${JSON.stringify(focus.controls)}`);
   }
   await page.locator('#close-records').click();
   assert.equal(await page.locator('#browse-records').evaluate(el=>el===document.activeElement),true);
  }
  await openRecords(width);
  assert.equal(await page.locator('.timeline-section').count(),1);
  assert.equal(await page.locator('#record-calendar').count(),1);
  assert.equal(await page.locator('#viewer-schedule').count(),1);
  await page.locator('#record-calendar > summary').click();
  await page.locator('.calendar-record').first().waitFor();
  await page.locator('.calendar-record').first().click();
  if (width<=700) {
   assert.equal(await page.locator('#record-browser').evaluate(el=>el.open),false,'choosing a calendar record returns to the image');
   assert.equal(await page.locator('#browse-records').evaluate(el=>el===document.activeElement),true,'calendar selection restores the history trigger');
  }
  await openRecords(width);
  if (await page.locator('#record-calendar').evaluate(el=>el.open)) await page.locator('#record-calendar > summary').click();
  await closeRecords(width);
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:`test-results/workspace-design/viewer-${width}.png`,fullPage:false});
  if (width===360) {
   await openRecords(width);
   await page.locator('#select-records').click();
   await page.locator('#select-page').click();
   assert.match(await page.locator('#selection-count').textContent(),/12개 선택/);
   await page.locator('#delete-selected').click();
   await page.locator('#confirm-bulk-delete').click();
   await page.waitForFunction(()=>!document.querySelector('#bulk-delete-dialog').open);
   assert.equal(site.captures.length,28);
   assert.ok(await page.locator('#capture-stage').isVisible(),'image remains valid after deleting selected history');
   await closeRecords(width);
  }
  await page.locator('#back-to-archive').click();
  await page.locator('.card').first().waitFor();
 }
 assert.deepEqual(unexpected,[]); assert.deepEqual(errors,[]);
 assert.equal(mutations.filter(item=>item.path.endsWith('/captures/delete')).length,widths.includes(360) ? 1 : 0);
 console.log('PASS: workspace geometry at 1440/1024/768/390/360, single timeline DOM, desktop scroll preservation, mobile sheet focus, comparison targets, metadata, calendar, and mock bulk deletion');
} finally { await browser.close(); }
