// Every API request is fulfilled in the browser. No server data is read or written.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {resolve} from 'node:path';

const base = process.env.REWIND_URL || 'http://127.0.0.1:4318';
assert.equal(new URL(base).hostname, '127.0.0.1', 'Use the isolated local QA server');
const now = Date.now(), hour = 3_600_000;
const record = i => ({id:`h${i}`, created_at:new Date(now-i*hour).toISOString(),
  title:`기록 ${i}`, bytes:1024, width:1440, height:1000, image:`/captures/h${i}.png`});
const make = (id, overrides={}) => ({id, title:`사이트 ${id}`, page_title:`사이트 ${id}`,
  url:`https://${id}.example/`, created_at:new Date(now-48*hour).toISOString(),
  daily:1, paused:0, favorite:0, capturing:false, error:null,
  schedule_mode:'interval', interval_minutes:60, capture_mode:'viewport',
  last_attempt:new Date(now).toISOString(), captures:[record(0)], ...overrides});
const data = [
  make('history', {title:'300개 기록 사이트', captures:Array.from({length:300},(_,i)=>record(i))}),
  make('bulk-auto', {title:'범위검사 자동', interval_minutes:30, capture_mode:'full_page'}),
  make('bulk-manual', {title:'범위검사 수동', daily:0}),
  make('bulk-paused', {title:'범위검사 보류', paused:1}),
  make('bulk-busy', {title:'범위검사 진행', capturing:true, capture_status:'queued'}),
  make('overdue', {last_attempt:new Date(now-2*hour).toISOString(), error:'Timeout'}),
  ...Array.from({length:34},(_,i)=>make(`filler${i}`, {daily:i%2})),
];
const browser = await chromium.launch({env:{...process.env,
  LD_LIBRARY_PATH:[resolve('data/browser-libs/usr/lib/x86_64-linux-gnu'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}});
const page = await browser.newPage({viewport:{width:1440,height:1000}, locale:'ko-KR', timezoneId:'Asia/Seoul'});
const errors=[], captures=[], unexpected=[];
let releaseCapture, captureStarted, submitted=null;
const firstCapture = new Promise(resolve=>captureStarted=resolve);
page.on('pageerror', error=>errors.push(error.message));
await page.route('**/api/**', async route=>{
  const request=route.request(), path=new URL(request.url()).pathname, method=request.method();
  if(method==='GET') return route.fulfill({json:path.endsWith('/history') ? {events:[]} : {sites:structuredClone(data)}});
  if(method==='POST' && path.endsWith('/capture')) {
    captures.push(path.split('/')[3]);
    if(captures.length===1) {
      captureStarted();
      await new Promise(resolve=>releaseCapture=resolve);
    }
    return route.fulfill({json:{ok:true}});
  }
  if(method==='POST' && path==='/api/sites') {
    submitted=request.postDataJSON();
    return route.fulfill({status:400,json:{error:'테스트 요청: 실제 사이트를 추가하지 않았어요.'}});
  }
  unexpected.push(`${method} ${path}`);
  return route.fulfill({status:400,json:{error:'Unexpected mock API operation'}});
});
await page.route('**/captures/*.png', route=>route.fulfill({contentType:'image/svg+xml',body:
  '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1000"><rect width="1440" height="1000" fill="#e5ecdc"/><rect x="90" y="100" width="960" height="300" fill="#406243"/><circle cx="1000" cy="650" r="140" fill="#abc394"/></svg>'}));
const card = id => page.locator('.card').filter({has:page.locator(`.card-title[data-site="${id}"]`)});
async function noOverflow(label) {
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), label);
}
async function targetSize(selector) {
  const box=await page.locator(selector).boundingBox();
  assert.ok(box && box.width>=43.5 && box.height>=43.5, `${selector} needs a 44px touch target: ${JSON.stringify(box)}`);
}
async function returnHome() {
  await page.locator('#back-to-archive').click();
  await page.locator('#archive').waitFor({state:'visible'});
}
async function settingsKeyboardCheck() {
  await page.locator('#edit-site').click();
  await page.locator('#settings-dialog').waitFor({state:'visible'});
  for(const key of ['Tab','Shift+Tab']) for(let i=0;i<30;i++) {
    await page.keyboard.press(key);
    assert.ok(await page.evaluate(()=>document.querySelector('#settings-dialog').contains(document.activeElement)), `${key} remains inside site settings`);
  }
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#settings-dialog').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#edit-site').evaluate(el=>el===document.activeElement),true, 'settings dismissal restores its trigger');
}
try {
  await page.goto(base);
  await page.locator('.card').first().waitFor();
  assert.equal(await page.locator('.card').count(),40);
  if(process.env.REWIND_CHECK_SCOPE==='settings-date') {
    await page.setViewportSize({width:390,height:844});
    await page.locator('.card-title[data-site="history"]').click();
    await settingsKeyboardCheck();
    await page.locator('#compare-mode').click();
    const year=new Date(now).getFullYear().toString();
    for(const id of ['before-select','after-select']) {
      const select=page.locator(`#${id}`), selected=select.locator('option:checked');
      assert.ok(!(await selected.textContent()).includes(year), 'current-year picker omits the year');
      assert.ok((await select.getAttribute('title')).includes(year), 'picker title retains the full date');
      assert.ok((await selected.getAttribute('title')).includes(year), 'option title retains the full date');
    }
    await noOverflow('compact date pickers at 390px');
    await page.screenshot({path:'/tmp/rewind-usability-picker-390.png',fullPage:false});
    assert.deepEqual(unexpected,[]); assert.deepEqual(errors,[]);
    console.log('PASS: settings Tab/Shift+Tab, Escape, trigger focus restoration; compact mobile picker dates and full titles (all APIs mocked)');
  } else {
  await page.locator('#list-view').click();
  assert.match(await card('bulk-auto').locator('.badge').textContent(),/자동/);
  assert.match(await card('bulk-manual').locator('.badge').textContent(),/수동/);
  assert.match(await card('bulk-paused').locator('.badge').textContent(),/보류/);
  assert.match(await card('bulk-busy').locator('.badge').textContent(),/대기|촬영/);
  assert.match(await card('bulk-auto').locator('.schedule-cadence').textContent(),/30분/);
  assert.match(await card('bulk-auto').locator('.capture-format').textContent(),/전체 페이지/);
  const relative=card('bulk-auto').locator('[data-next-relative]');
  assert.ok(await relative.isVisible()); assert.match(await relative.textContent(),/분 후/);
  const exact=card('bulk-auto').locator('.next-capture time');
  assert.ok(await exact.isVisible());
  assert.ok(Number.isFinite(Date.parse(await exact.getAttribute('datetime'))));
  assert.match(await card('overdue').locator('[data-next-relative]').textContent(),/예정 시각 지남/);
  for(const id of ['bulk-paused','bulk-busy','bulk-manual']) {
    assert.equal(await card(id).locator('.next-capture time').count(),0, `${id} must not claim an automatic next time`);
  }

  // Search and filter scope are visible; clearing search preserves the filter.
  await page.locator('[data-filter="manual"]').click();
  await page.locator('#search').fill('범위검사');
  assert.equal(await page.locator('.card').count(),1);
  assert.match(await page.locator('#query-summary').textContent(),/수동|범위검사/);
  await page.locator('#clear-search').click();
  assert.equal(await page.locator('#search').inputValue(),'');
  assert.equal(await page.locator('[data-filter="manual"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-filter="all"]').click();
  await page.locator('#search').fill('범위검사');
  assert.equal(await page.locator('.card').count(),4);
  assert.match(await page.locator('#capture-visible').textContent(),/현재 결과 모두 촬영\s*\(2\)/);
  assert.match(await page.locator('#batch-scope-help').textContent(),/보류/);
  assert.match(await page.locator('#batch-scope-help').textContent(),/촬영/);
  await page.locator('#capture-visible').click();
  await firstCapture;
  await page.waitForFunction(()=>document.querySelector('#capture-visible').disabled);
  // A second click while the first request is pending must not enqueue duplicates.
  await page.locator('#capture-visible').dispatchEvent('click');
  assert.equal(captures.length,1);
  releaseCapture(); releaseCapture=null;
  await page.waitForFunction(()=>!document.querySelector('#capture-visible').disabled);
  assert.deepEqual([...captures].sort(),['bulk-auto','bulk-manual']);
  await page.locator('#clear-search').click();

  // Mobile filters expose the final choice and keep the active choice on screen.
  await page.setViewportSize({width:390,height:844});
  await targetSize('#filter-next');
  await page.locator('#filter-next').click();
  await page.locator('[data-filter="error"]').click();
  const active=await page.locator('[data-filter="error"]').boundingBox();
  assert.ok(active.x>=0 && active.x+active.width<=390,'last selected filter is fully visible');
  assert.match(await page.locator('#query-summary').textContent(),/확인 필요|오류/);
  await page.locator('[data-filter="all"]').click();

  // The basic registration fits without advanced settings; keyboard stays in the modal.
  await page.locator('#mobile-add').click();
  assert.equal(await page.locator('#add-advanced').evaluate(el=>el.open),false);
  assert.ok(await page.locator('#url').isVisible());
  assert.ok(await page.locator('#add-summary').isVisible());
  assert.match(await page.locator('#submit-url').textContent(),/사이트 추가하고 첫 화면 저장/);
  await targetSize('#submit-url');
  for(let i=0;i<14;i++) {
    await page.keyboard.press('Tab');
    const focus=await page.evaluate(()=>({inside:document.querySelector('#add-dialog').contains(document.activeElement), element:document.activeElement.outerHTML.slice(0,180)}));
    assert.ok(focus.inside, `Tab remains inside the registration modal: ${focus.element}`);
  }
  for(let i=0;i<14;i++) {
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.evaluate(()=>document.querySelector('#add-dialog').contains(document.activeElement)), 'Shift+Tab remains inside registration');
  }
  await page.locator('#add-advanced > summary').click();
  await page.locator('#add-schedule-mode').selectOption('interval');
  await page.locator('#add-interval').selectOption('custom');
  await page.locator('#add-custom-interval').fill('0');
  await page.locator('#url').fill('test-only.example');
  await page.locator('#add-advanced > summary').click();
  await page.locator('#submit-url').click();
  assert.equal(await page.locator('#add-advanced').evaluate(el=>el.open),true);
  assert.equal(await page.locator('#add-custom-interval').evaluate(el=>el===document.activeElement),true);
  assert.equal(submitted,null,'invalid settings never reach the API');
  await page.locator('#add-custom-interval').fill('2');
  await page.locator('input[name="frequency"][value="manual"]').check();
  assert.match(await page.locator('#add-summary').textContent(),/수동|직접/);
  await page.locator('#submit-url').click();
  await page.locator('#form-error').waitFor({state:'visible'});
  assert.equal(submitted.daily,false);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#add-dialog').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#mobile-add').evaluate(el=>el===document.activeElement),true);

  // A long history remains navigable beside the image in single and comparison modes.
  await page.locator('.card-title[data-site="history"]').click();
  await settingsKeyboardCheck();
  assert.equal(await page.locator('#viewer-schedule').evaluate(el=>el.open),false);
  assert.match(await page.locator('#viewer-schedule > summary').textContent(),/자동/);
  await page.locator('#older-record').click();
  assert.equal(await page.locator('#after-select').inputValue(),'h1');
  await page.locator('#latest-record').click();
  assert.equal(await page.locator('#after-select').inputValue(),'h0');
  await page.locator('#compare-mode').click();
  await page.locator('#before-select').selectOption('h10');
  assert.match(await page.locator('#comparison-gap').textContent(),/10시간/);
  assert.match(await page.locator('#target-before').textContent(),/왼쪽.*이전/);
  assert.match(await page.locator('#target-after').textContent(),/오른쪽.*이후/);
  assert.match(await page.locator('#swap-records').textContent(),/좌우 교환/);
  await page.locator('#swap-records').click();
  assert.equal(await page.locator('#before-select').inputValue(),'h0');
  assert.equal(await page.locator('#after-select').inputValue(),'h10');
  assert.match(await page.locator('#comparison-gap').textContent(),/10시간/);
  assert.match(await page.locator('#target-before').textContent(),/왼쪽.*이후/);
  assert.match(await page.locator('#target-after').textContent(),/오른쪽.*이전/);
  assert.match(await page.locator('.image-label.before').textContent(),/왼쪽.*이후/);
  assert.match(await page.locator('.image-label.after').textContent(),/오른쪽.*이전/);
  assert.match(await page.locator('#before-select').getAttribute('aria-label'),/왼쪽/);
  assert.match(await page.locator('#compare-slider').getAttribute('aria-label'),/왼쪽/);
  await page.locator('#split-mode').click();
  assert.match(await page.locator('.split-wrapper figcaption').first().textContent(),/왼쪽.*이후/);
  assert.match(await page.locator('.split-wrapper figcaption').last().textContent(),/오른쪽.*이전/);
  await page.locator('#compare-mode').click();
  await page.locator('#target-before').click();
  assert.match(await page.locator('.record-target-label').textContent(),/왼쪽/);
  await page.locator('#older-record').click();
  assert.equal(await page.locator('#before-select').inputValue(),'h1');
  await page.locator('#latest-record').click();
  assert.equal(await page.locator('#before-select').inputValue(),'h0');
  await page.locator('#target-after').click();
  await page.locator('#latest-record').click();
  assert.equal(await page.locator('#after-select').inputValue(),'h0');
  assert.notEqual(await page.locator('#before-select').inputValue(),'h0','latest keeps distinct compared records');

  for(const width of [1440,390,360,768]) {
    await page.setViewportSize({width,height:900});
    await noOverflow(`comparison overflow at ${width}`);
    if(width===390 && process.env.REWIND_USABILITY_SCREENSHOTS) {
      await page.evaluate(()=>scrollTo(0,0));
      console.log('390px comparison image top:', await page.locator('#capture-stage').evaluate(el=>Math.round(el.getBoundingClientRect().top+scrollY)));
      await page.screenshot({path:'/tmp/rewind-usability-compare-390.png',fullPage:true});
    }
    if(width<400) for(const selector of ['#inspect-image','#latest-record','#older-record','#newer-record','#swap-records','#target-before','#target-after']) await targetSize(selector);
    await returnHome(); await noOverflow(`archive overflow at ${width}`);
    if(width===390 && process.env.REWIND_USABILITY_SCREENSHOTS) {
      await page.evaluate(()=>scrollTo(0,0));
      console.log('390px first list row top:', await page.locator('.card').first().evaluate(el=>Math.round(el.getBoundingClientRect().top+scrollY)));
      await page.screenshot({path:'/tmp/rewind-usability-list-390.png',fullPage:true});
    }
    assert.ok(await card('bulk-auto').locator('[data-next-relative]').isVisible(), `relative schedule visible at ${width}`);
    assert.ok(await card('bulk-auto').locator('.next-capture time').isVisible(), `exact schedule visible at ${width}`);
    await page.locator('.card-title[data-site="history"]').click();
    await page.locator('#compare-mode').click();
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#inspect-image').scrollIntoViewIfNeeded();
  const scroll=await page.evaluate(()=>scrollY);
  await page.locator('#inspect-image').click();
  await page.locator('#zoom-actual').click();
  await noOverflow('original enlargement overflow');
  for(const key of ['Tab','Shift+Tab']) for(let i=0;i<18;i++) {
    await page.keyboard.press(key);
    assert.ok(await page.evaluate(()=>document.querySelector('#inspector-dialog').contains(document.activeElement)), 'keyboard focus remains inside original enlargement');
  }
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#inspect-image').evaluate(el=>el===document.activeElement),true);
  assert.ok(Math.abs((await page.evaluate(()=>scrollY))-scroll)<3,'enlargement close restores reading position');
  await page.locator('#inspect-image').click();
  await page.locator('#close-inspector').click();
  assert.equal(await page.locator('#inspect-image').evaluate(el=>el===document.activeElement),true);
  assert.ok(Math.abs((await page.evaluate(()=>scrollY))-scroll)<3,'close button also restores reading position');
  assert.deepEqual(unexpected,[]); assert.deepEqual(errors,[]);
  console.log('PASS: 40 sites / 300-record history; scoped batch and duplicate guard; search/filter clarity; mobile filters; registration disclosure, validation and keyboard; latest/previous/next/side swap; schedule labels; 44px targets; 1440/390/360/768 overflow; original-view focus and scroll return (all APIs mocked)');
  }
} finally { releaseCapture?.(); await browser.close(); }
