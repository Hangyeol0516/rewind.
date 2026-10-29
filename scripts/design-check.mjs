// Browser-only visual fixtures. No production registration or capture is changed.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
const base=process.env.REWIND_URL||'http://127.0.0.1:4318',stage=process.env.DESIGN_STAGE||'after';
const out=resolve('test-results',`design-${stage}`);await mkdir(out,{recursive:true});
const now=Date.now(),stamp=minutes=>new Date(now-minutes*60000).toISOString();
const capture=(id,minutes)=>({id,created_at:stamp(minutes),title:'UI 검증용 기록',bytes:148000,width:1440,height:1000,image:`/captures/${id}.png`,capture_mode:'viewport'});
const make=(id,title,domain,minutes,extra={})=>({id,title,page_title:title,url:`https://${domain}/`,created_at:stamp(minutes+5000),daily:1,paused:0,favorite:0,capture_mode:'viewport',schedule_mode:'interval',interval_minutes:1440,interval_hours:24,daily_time:'09:00',last_attempt:stamp(minutes),error:null,capturing:false,captures:[capture(`${id}-new`,minutes),capture(`${id}-old`,minutes+1440)],...extra});
let data=[
 make('docs','MDN Web Docs','developer.mozilla.org',22,{favorite:1}),
 make('github','GitHub','github.com',74,{favorite:1,interval_minutes:120,interval_hours:2,capture_mode:'full_page'}),
 make('museum','국립현대미술관','mmca.go.kr',148,{schedule_mode:'daily_time',daily_time:'09:00'}),
 make('journal','오래 기억하고 싶은 디자인과 개발의 기록 — 아주 긴 사이트 제목을 위한 검증','journal.example.com',283,{daily:0}),
 make('blocked','프로젝트 문서','docs.example.com',410,{error:'원본 사이트가 HTTP 403을 반환했어요.',captures:[]}),
 make('held','아카이브 리서치','research.example.com',1500,{paused:1}),
 make('queued','Product updates','updates.example.com',53,{capturing:true,capture_status:'queued'}),
 make('notes','기술과 일상','notes.example.com',102,{interval_minutes:30,interval_hours:.5}),
];
let offline=false,hold=false,release;
const browser=await chromium.launch({env:{...process.env,LD_LIBRARY_PATH:resolve('data/browser-libs/usr/lib/x86_64-linux-gnu')}});
const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul'}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/sites**',async route=>{
 if(offline)return route.abort();const request=route.request(),method=request.method(),path=new URL(request.url()).pathname;
 if(method==='GET'){if(hold)await new Promise(r=>release=r);return route.fulfill({json:path.includes('/history')?{events:[]}:{sites:data}});}
 const site=data.find(s=>path.includes(`/sites/${s.id}`)),input=request.postDataJSON();
 if(method==='PATCH' && site){if(input.favorite!==undefined)site.favorite=Number(input.favorite);}
 return route.fulfill({status:200,json:{ok:true}});
});
await page.route('**/captures/*.png',route=>{
 const id=new URL(route.request().url()).pathname,theme=id.includes('github')?'#172b24':id.includes('museum')?'#ebe7dd':'#fff';
 const dark=theme==='#172b24',ink=dark?'#e9f0e7':'#273b32',muted=dark?'#72988a':'#bdc6bc';
 return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1000"><rect width="1440" height="1000" fill="${theme}"/><path d="M0 95H1440" stroke="${muted}"/><rect x="70" y="30" width="30" height="30" rx="6" fill="${ink}"/><text x="120" y="54" font-family="sans-serif" font-size="26" fill="${ink}">Rewind visual fixture</text><text x="1100" y="52" font-family="sans-serif" font-size="20" fill="${muted}">UI TEST</text><text x="90" y="270" font-family="sans-serif" font-size="62" font-weight="600" fill="${ink}">${id.includes('museum')?'Art. Everyday.':id.includes('github')?'Build something lasting.':'A place for what matters.'}</text><rect x="90" y="324" width="680" height="14" rx="7" fill="${muted}"/><rect x="90" y="362" width="520" height="14" rx="7" fill="${muted}"/><rect x="90" y="438" width="200" height="56" rx="7" fill="${dark?'#87ad96':'#365f46'}"/><path d="M90 575H1350" stroke="${muted}"/><rect x="90" y="635" width="360" height="240" rx="8" fill="${dark?'#274537':'#e8ece5'}"/><rect x="490" y="635" width="360" height="240" rx="8" fill="${dark?'#203f34':'#f0eee7'}"/><rect x="890" y="635" width="360" height="240" rx="8" fill="${dark?'#365241':'#dde4da'}"/></svg>`});
});
async function screenshot(name){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:resolve(out,name+'.png'),fullPage:true});}
async function noOverflow(label){const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);if(!fits){console.log(label,await page.evaluate(()=>[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,id:el.id,cls:el.className,x:el.getBoundingClientRect().x,right:el.getBoundingClientRect().right})).filter(el=>el.right>innerWidth+1 && el.x>=0).slice(0,16)));await page.screenshot({path:resolve(out,'overflow.png'),fullPage:true});}assert.equal(fits,true,label);}
try {
 await page.goto(base);await page.locator('.card').first().waitFor();await screenshot('archive-grid-desktop');
 if(stage==='after'){
  const heights=await page.evaluate(()=>['.search','#sort','.view-toggle'].map(s=>document.querySelector(s).getBoundingClientRect().height));assert.ok(Math.max(...heights)-Math.min(...heights)<=1,`toolbar heights ${heights}`);
  assert.equal(await page.locator('#search').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
  const contrast=await page.evaluate(()=>{
   const lum=color=>{const values=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return values[0]*.2126+values[1]*.7152+values[2]*.0722;};
   const pairs=[['.card-url','--surface'],['.site-nav-name small','--navigation'],['.filter:not(.active) span','--canvas']];
   return pairs.map(([selector,bg])=>{const foreground=lum(getComputedStyle(document.querySelector(selector)).color),probe=document.createElement('span');probe.style.color=`var(${bg})`;document.body.append(probe);const background=lum(getComputedStyle(probe).color);probe.remove();return {selector,ratio:(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05)};});
  });for(const pair of contrast)assert.ok(pair.ratio>=4.5,`text contrast ${pair.selector} ${pair.ratio}`);
 }
 await page.locator('#list-view').click();await screenshot('archive-list-desktop');await noOverflow('desktop list overflow');
 if(stage==='after'){
  const columns=await page.evaluate(()=>[...document.querySelectorAll('.list-layout .card')].map(card=>['.card-state-row','.card-latest','.next-capture','.card-capture'].map(selector=>Math.round(card.querySelector(selector).getBoundingClientRect().x))));
  for(const row of columns)assert.deepEqual(row,columns[0],'list columns must align even in the error row');
 }
 await page.locator('#grid-view').click();await page.locator('.card-title[data-site="docs"]').click();await page.locator('#compare-mode').click();await screenshot('viewer-desktop');
 await page.locator('#back-to-archive').click();
 for(const width of[1024,768,390,320]){
  await page.setViewportSize({width,height:900});await noOverflow(`grid ${width}`);await screenshot(`archive-grid-${width}`);if(width===390)await page.screenshot({path:resolve(out,'mobile-viewport.png')});
  await page.locator('#list-view').click();await noOverflow(`list ${width}`);await screenshot(`archive-list-${width}`);await page.locator('#grid-view').click();
 }
 if(stage==='after'){
  await page.locator('#mobile-menu').click();await page.waitForFunction(()=>Math.abs(document.querySelector('#sidebar').getBoundingClientRect().x)<1);await page.screenshot({path:resolve(out,'mobile-navigation.png')});assert.equal(await page.locator('#mobile-menu').getAttribute('aria-expanded'),'true');await page.locator('#site-nav [data-site="github"]').click();assert.equal(await page.locator('#mobile-menu').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#viewer').isVisible(),true);
  await page.locator('#mobile-menu').click();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('#sidebar-help').evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await page.locator('#sidebar .brand').evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#mobile-menu').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#mobile-menu').evaluate(el=>el===document.activeElement),true);
  await page.locator('#mobile-menu').click();await page.locator('#sidebar-add').click();assert.equal(await page.locator('#add-dialog').evaluate(d=>d.open),true);await screenshot('add-mobile');await page.locator('#close-dialog').click();await page.waitForFunction(()=>document.querySelector('#mobile-add')===document.activeElement);
  await page.locator('#mobile-search').click();assert.equal(await page.locator('#search').evaluate(el=>el===document.activeElement),true);
 }
 await page.setViewportSize({width:1440,height:1000});await page.locator('#search').fill('not-found-visual-fixture');await screenshot('search-empty');await page.locator('#reset-filters').click();
 offline=true;await page.locator('#connection-banner').waitFor({timeout:8000});await screenshot('offline');offline=false;await page.locator('#reconnect').click();await page.locator('#connection-banner').waitFor({state:'hidden'});
 const original=data;
 if(stage==='after'){
  data=[...original,...Array.from({length:40},(_,i)=>make(`nav-${i}`,`추가 사이트 ${i}`,`site${i}.example.com`,i+1))];await page.reload();await page.locator('#site-nav [data-site="nav-39"]').waitFor();
  const before=await page.locator('#site-nav').evaluate(el=>{el.scrollTop=el.scrollHeight;return el.scrollTop;});assert.ok(before>100);
  await page.locator('[data-favorite="docs"]').click();await page.waitForFunction(()=>document.querySelector('[data-favorite="docs"]').getAttribute('aria-pressed')==='false');assert.ok(Math.abs(await page.locator('#site-nav').evaluate(el=>el.scrollTop)-before)<2,'sidebar scroll survives refresh');data=original;
 }
 data=[];await page.reload();await page.locator('#empty-add').waitFor();await screenshot('empty');data=original;
 hold=true;await page.reload({waitUntil:'domcontentloaded'});await screenshot('loading');hold=false;release?.();await page.locator('.card').first().waitFor();
 assert.deepEqual(errors,[]);console.log(`PASS: ${stage} visual views, overflow at 1440/1024/768/390/320, navigation, states; screenshots ${out}`);
}finally{release?.();await browser.close();}
