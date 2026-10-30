import {schedulePresentation,comparisonPresentation} from './view-utils.js';
import {mountCalendar} from './calendar.js';
import {mountDiff} from './diff.js';
import {mountRecordTools} from './record-tools.js';
import {validateSchedule,scheduleOf,scheduleLabel,nextScheduledAt,SCHEDULE_TIMEZONE} from './schedule.js';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iconPaths={
 archive:'<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
 rewind:'<path d="M4 10a8 8 0 1 1 2 8M4 4v6h6M12 7v5l3 2"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
 grid:'<rect x="3.5" y="3.5" width="6" height="6" rx="1"/><rect x="14.5" y="3.5" width="6" height="6" rx="1"/><rect x="3.5" y="14.5" width="6" height="6" rx="1"/><rect x="14.5" y="14.5" width="6" height="6" rx="1"/>',
 list:'<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
 camera:'<path d="M8 6l1.5-2h5L16 6h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><circle cx="12" cy="13" r="4"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.8-2.5 2-2.5 3.5M12 17h.01"/>',
 menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
 settings:'<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
 down:'<path d="m6 9 6 6 6-6"/>',right:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
 swap:'<path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/>',
 zoom:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="M10.5 7.5v6m-3-3h6m2.5 5.5 4 4"/>',
 expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
 pause:'<path d="M9 5v14M15 5v14"/>',
};
function icon(name,size=16){return `<svg class="ui-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.archive}</svg>`;}
for(const node of $$('[data-icon]'))node.innerHTML=icon(node.dataset.icon);
let navigationOpen=false;
const mobileNavigation=matchMedia('(max-width:700px)');
function setNavigation(open,restore=false){
 navigationOpen=open && mobileNavigation.matches;
 document.body.classList.toggle('navigation-open',navigationOpen);
 $('#mobile-menu').setAttribute('aria-expanded',String(navigationOpen));
 $('#nav-backdrop').hidden=!navigationOpen;
 $('#sidebar').inert=mobileNavigation.matches && !navigationOpen;
 $('#sidebar').setAttribute('aria-hidden',String(mobileNavigation.matches && !navigationOpen));
 $('#main').inert=navigationOpen;$('.mobile-header').inert=navigationOpen;
 if(navigationOpen)$('#close-navigation').focus();else if(restore && mobileNavigation.matches)$('#mobile-menu').focus();
}
$('#mobile-menu').onclick=()=>setNavigation(!navigationOpen);
$('#close-navigation').onclick=$('#nav-backdrop').onclick=()=>setNavigation(false,true);
$('#mobile-add').onclick=()=>openAdd();
$('#mobile-search').onclick=()=>{if(selected)goHome({focusSearch:true});$('#search').focus();};
$('#sidebar').addEventListener('click',event=>{if(event.target.closest('button:not(#close-navigation),a'))setNavigation(false);});
mobileNavigation.addEventListener('change',()=>setNavigation(false));setNavigation(false);
document.addEventListener('keydown',event=>{
 if(!navigationOpen)return;
 if(event.key==='Escape'){event.preventDefault();setNavigation(false,true);}
 if(event.key==='Tab'){
  const controls=$$('#sidebar a,#sidebar button').filter(el=>!el.disabled && el.getClientRects().length),first=controls[0],last=controls.at(-1);
  if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
 }
});
const modalOrigins=new WeakMap();
function rememberModal(dialog) {
 const trigger=document.activeElement,stage=$('#capture-stage');
 modalOrigins.set(dialog,{trigger,id:trigger?.id,scrollY:window.scrollY,stageTop:stage?.scrollTop||0,stageLeft:stage?.scrollLeft||0});
 dialog.dataset.completed='false';
}
for(const id of ['add-dialog','settings-dialog','inspector-dialog','activity-dialog','record-browser']) {
 const dialog=document.getElementById(id);
 dialog.addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const controls=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex]:not([tabindex="-1"])')].filter(el=>el.getClientRects().length && !el.closest('[hidden]') && !el.closest('details:not([open]) > :not(summary)'));
  const first=controls[0],last=controls.at(-1);
  if(event.shiftKey && (document.activeElement===first || !dialog.contains(document.activeElement))){event.preventDefault();last?.focus();}
  else if(!event.shiftKey && (document.activeElement===last || !dialog.contains(document.activeElement))){event.preventDefault();first?.focus();}
 });
 dialog.addEventListener('close',()=>{
  const origin=modalOrigins.get(dialog);if(!origin || dialog.dataset.completed==='true')return;
  const trigger=(origin.id && document.getElementById(origin.id)) || origin.trigger;
  if(trigger?.isConnected && !trigger.closest('[inert]'))trigger.focus({preventScroll:true});
  if(id==='inspector-dialog') {$('#capture-stage')?.scrollTo(origin.stageLeft,origin.stageTop);window.scrollTo({top:origin.scrollY});}
 });
}
const filterNames={all:'전체',favorite:'즐겨찾기',daily:'자동 기록',manual:'수동 기록',paused:'보류',error:'확인 필요'};
function updateFilterOverflow(reveal=false) {
 const strip=$('.filter-chips');if(!strip)return;
 const selectedFilter=strip.querySelector('[aria-pressed=true]');
 if(reveal && selectedFilter){const left=selectedFilter.offsetLeft-strip.offsetLeft;if(left<strip.scrollLeft)strip.scrollLeft=left;else if(left+selectedFilter.offsetWidth>strip.scrollLeft+strip.clientWidth)strip.scrollLeft=left+selectedFilter.offsetWidth-strip.clientWidth;}
 const more=strip.scrollWidth-strip.clientWidth-strip.scrollLeft>2;
 $('#filter-next').hidden=!more;$('.filter-strip').classList.toggle('has-more',more);
}
$('#filter-next').onclick=()=>{$('.filter-chips').scrollBy({left:Math.max(160,$('.filter-chips').clientWidth*.75),behavior:'smooth'});};
$('.filter-chips').addEventListener('scroll',()=>updateFilterOverflow());
window.addEventListener('resize',()=>requestAnimationFrame(()=>updateFilterOverflow(true)));
$('#clear-search').onclick=()=>{$('#search').value='';syncLocation();renderArchive();$('#search').focus();};
function scheduledRecordMarkup(site) {
 const info=schedulePresentation(pending.has(site.id) && !site.capturing ? {...site,capturing:true,capture_status:'queued'} : site),secondary=info.at ? formattedScheduleTime(info.at,site,true) : info.state==='paused' ? '재개 후 일정 적용' : info.state==='manual' ? '자동 촬영 꺼짐' : info.state==='busy' ? '현재 요청 처리 중' : '첫 촬영 대기';
 return `<span class="next-primary"><small class="next-label">다음 촬영</small><strong data-next-relative>${esc(info.relative)}</strong></span>${info.at ? `<time data-next-exact datetime="${info.at}">${esc(secondary)}</time>` : `<span data-next-exact>${esc(secondary)}</span>`}`;
}
function updateNextCaptureTimes() {
 const now=Date.now();
 for(const container of $$('[data-next-site]')) {
  const site=sites.find(s=>s.id===container.dataset.nextSite);if(!site)continue;
  const info=schedulePresentation(pending.has(site.id) && !site.capturing ? {...site,capturing:true,capture_status:'queued'} : site,now),relative=container.querySelector('[data-next-relative]'),exact=container.querySelector('[data-next-exact]');
  if(relative)relative.textContent=info.relative;
  if(exact && info.at){exact.textContent=formattedScheduleTime(info.at,site,true);exact.dateTime=info.at;exact.title=formattedScheduleTime(info.at,site);}
 }
}
const formatDate = (value, time = true) => new Intl.DateTimeFormat('ko-KR', {year:'numeric', month:'2-digit', day:'2-digit', ...(time ? {hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false} : {})}).format(new Date(value));
const shortTime = value => new Intl.DateTimeFormat('ko-KR', {hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
function compactDate(value) {
  const date = new Date(value), today = new Date(), tomorrow = new Date(); tomorrow.setDate(today.getDate()+1);
  if (localDay(date) === localDay(today)) return `오늘 ${shortTime(date)}`;
  if (localDay(date) === localDay(tomorrow)) return `내일 ${shortTime(date)}`;
  return `${date.getFullYear() === today.getFullYear() ? '' : date.getFullYear()+'.'}${date.getMonth()+1}.${date.getDate()} ${shortTime(date)}`;
}
function pickerDate(value) {
 const date=new Date(value),year=date.getFullYear();
 return `${year===new Date().getFullYear() ? '' : year+'.'}${date.getMonth()+1}.${date.getDate()} ${formatTime(value)}`;
}
const formatTime = value => new Intl.DateTimeFormat('ko-KR', {hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false}).format(new Date(value));
const localDay = value => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const hostName = site => new URL(site.url).hostname;
const formatSize = bytes => bytes < 1024 * 1024 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1024/1024).toFixed(1)} MB`;
const initials = site => `<span class="site-initial" aria-hidden="true">${esc(hostName(site)[0].toUpperCase())}</span>`;
const validModes = ['single','compare','split','diff'];
const pending = new Set();
const refreshWaiters = [];
const timelinePageSize = 12;
let importantOnly = false, changeFilter = 'all';
let groupFilter = '', tagFilter = '';
let timelinePage = 0, compareTarget = 'after', archiveScroll = 0, timelineInitialized = false;
let layout = 'grid', visibleSites = [], settingsSite = null, deletingCapture = null, inspectorSite = null, inspectorZoom = null;
try { layout = localStorage.getItem('rewind-layout') === 'list' ? 'list' : 'grid'; } catch {}
let sites = [], selected = null, previous = '', after = '', mode = 'single', ratio = 50;
let snapshot = '', filter = 'all', timelineDay = '', deleting = null, disconnected = false, loaded = false, refreshing = false, toastTimer;
let sort = 'recent';
try { sort = localStorage.getItem('rewind-sort') || 'recent'; } catch {}
if (![...$('#sort').options].some(o => o.value === sort)) sort = 'recent';
$('#sort').value = sort;

function readLocation() {
  const params = new URLSearchParams(location.search);
  importantOnly = false; changeFilter = 'all';
  selected = params.get('site'); previous = params.get('before') || ''; after = params.get('after') || '';
  mode = validModes.includes(params.get('mode')) ? params.get('mode') : 'single';
  timelineDay = ''; timelinePage = 0; timelineInitialized = false; ratio = 50;
  compareTarget = params.get('target') === 'left' ? 'before' : 'after';
  if (!selected) {
    groupFilter = params.get('group') || ''; tagFilter = params.get('tag') || '';
    $('#search').value = params.get('q') || '';
    filter = ['all','favorite','daily','manual','paused','error'].includes(params.get('filter')) ? params.get('filter') : 'all';
    if (['recent','created','name'].includes(params.get('sort'))) sort = params.get('sort');
    if (['grid','list'].includes(params.get('view'))) layout = params.get('view');
    $('#sort').value = sort;
  }
}
function syncLocation(push = false) {
  const params = new URLSearchParams();
  if (selected) {
    params.set('site', selected);
    if (mode !== 'single') params.set('mode', mode);
    if (after) params.set('after', after);
    if (mode !== 'single' && previous) params.set('before', previous);
    if (mode !== 'single' && compareTarget === 'before') params.set('target','left');
  } else {
    if ($('#search').value.trim()) params.set('q',$('#search').value.trim());
    if (filter !== 'all') params.set('filter',filter);
    if (groupFilter) params.set('group',groupFilter);
    if (tagFilter) params.set('tag',tagFilter);
    if (sort !== 'recent') params.set('sort',sort);
    if (layout !== 'grid') params.set('view',layout);
  }
  const path = params.size ? `/?${params}` : '/';
  if (location.pathname + location.search !== path) history[push ? 'pushState' : 'replaceState'](null, '', path);
}
readLocation();
window.addEventListener('popstate', () => { const wasViewing = !!selected; readLocation(); render(); if (wasViewing && !selected) requestAnimationFrame(() => window.scrollTo({top:archiveScroll})); });

function toast(message) {
  $('#toast').innerHTML = `<span>${esc(message)}</span><button type="button" aria-label="알림 닫기">×</button>`; $('#toast').hidden = false;
  $('#toast button').onclick = () => { clearTimeout(toastTimer); $('#toast').hidden = true; };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4500);
}
async function api(path, method = 'GET', data) {
  const response = await fetch(path, {method, headers:{'Content-Type':'application/json'}, body:data === undefined ? undefined : JSON.stringify(data), signal:AbortSignal.timeout(20000)});
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
  return value;
}
function normalizeInput(value) {
  const text = value.trim();
  if (!text) throw new Error('기록할 웹사이트 주소를 입력해 주세요.');
  let url;
  try { url = new URL(text.includes('://') ? text : `https://${text}`); } catch { throw new Error('주소를 확인해 주세요. 예: https://example.com'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('로그인 정보가 없는 HTTP 또는 HTTPS 주소를 입력해 주세요.');
  url.hash = ''; return url.href;
}
function readScheduleEditor(prefix) {
  const schedule_mode=$(`#${prefix}-schedule-mode`).value;
  if(schedule_mode==='minute_interval') return {schedule_mode:'interval',interval_minutes:validateSchedule({interval_minutes:Number($(`#${prefix}-interval-minutes`).value)},{partial:true}).interval_minutes};
  if (schedule_mode === 'daily_time') return validateSchedule({schedule_mode,daily_time:$(`#${prefix}-daily-time`).value},{partial:true});
  const value=prefix === 'add' && $('#add-interval').value === 'custom' ? $('#add-custom-interval').value : $(`#${prefix}-interval`).value;
  return {schedule_mode,interval_hours:validateSchedule({interval_hours:value.trim() === '' ? NaN : Number(value)},{partial:true}).interval_hours};
}
function updateAddSchedule() {
  const enabled=$('#add-form').elements.frequency.value === 'daily';
  const clock=$('#add-schedule-mode').value === 'daily_time';
  $('#add-schedule-fields').hidden=!enabled;
  const minutes=$('#add-schedule-mode').value==='minute_interval';
  $('#add-minutes-fields').hidden=!minutes;
  $('#add-hours-fields').hidden=clock || minutes; $('#add-clock-fields').hidden=!clock;
  $('#add-custom-fields').hidden=$('#add-interval').value !== 'custom';
  updateAddSummary();
}
for (const selector of ['input[name="frequency"]','#add-schedule-mode','#add-interval']) {
  $$(selector).forEach(input=>input.addEventListener('change',()=>{
    updateAddSchedule();
    if(input.id==='add-interval' && input.value==='custom') $('#add-custom-interval').focus();
  }));
}
$('#add-form').addEventListener('reset',()=>queueMicrotask(updateAddSchedule));
function updateAddSummary() {
 const automatic=$('#add-form').elements.frequency.value==='daily';
 let scheduleText='매 24시간',validSchedule=true;
 try {scheduleText=scheduleLabel({...validateSchedule(readScheduleEditor('add'),{partial:true})});}catch{scheduleText='일정을 확인해 주세요';validSchedule=false;}
 if(validSchedule || !automatic){$('#add-detail-error').hidden=true;for(const input of $$('#add-advanced [aria-invalid=true]'))input.setAttribute('aria-invalid','false');}
 const scope=$('#add-capture-mode').value==='full_page' ? '전체 페이지' : '상단 화면';
 $('#add-settings-summary').textContent=`${automatic ? scheduleText : '수동 기록'} · ${scope}`;
 $('#add-auto-description').textContent=scheduleText;
 $('#add-summary').textContent=`지금 첫 화면 저장 · 이후 ${automatic ? scheduleText+' 자동 촬영' : '필요할 때 직접 촬영'} · ${scope}`;
}
for(const id of ['add-custom-interval','add-interval-minutes','add-daily-time','add-capture-mode'])document.getElementById(id).addEventListener('input',updateAddSummary);
function addScheduleError(error) {
 $('#add-advanced').open=true;$('#add-detail-error').textContent=error.message;$('#add-detail-error').hidden=false;
 const input=$('#add-schedule-mode').value==='daily_time' ? $('#add-daily-time') : $('#add-schedule-mode').value==='minute_interval' ? $('#add-interval-minutes') : $('#add-interval').value==='custom' ? $('#add-custom-interval') : $('#add-interval');
 input.setAttribute('aria-invalid','true');input.focus();
}
function formattedScheduleTime(value,site,compact=false) {
  if(scheduleOf(site).schedule_mode !== 'daily_time') return compact ? compactDate(value) : formatDate(value);
  return new Intl.DateTimeFormat('ko-KR',{timeZone:SCHEDULE_TIMEZONE,...(compact ? {} : {year:'numeric'}),month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))+' (한국 시간)';
}
function compactScheduleText(site) {
  if(site.paused) return '보류 중';
  if(site.capturing) return '촬영 중';
  if(!site.daily) return '직접 촬영';
  const next=nextScheduledAt(site);
  return Date.parse(next)<=Date.now() ? '곧 촬영 예정' : '다음: '+formattedScheduleTime(next,site,true);
}
function updateSettingsSchedule() {
  const clock=$('#settings-schedule-mode').value === 'daily_time';
  const minutes=$('#settings-schedule-mode').value==='minute_interval';
  $('#settings-minutes-fields').hidden=!minutes;
  $('#settings-hours-fields').hidden=clock || minutes; $('#settings-clock-fields').hidden=!clock;
  $('#settings-schedule-help').textContent=clock ? '매일 선택한 시각에 촬영해요. 지정 시각은 한국 시간(서울) 기준이에요.' : minutes ? '마지막 촬영 시도부터 선택한 분이 지나면 촬영해요. 1~43,200분 · 일정은 1분마다 확인해요.' : '마지막 촬영 시도부터 선택한 시간이 지나면 다시 촬영해요. 1~720시간으로 지정할 수 있어요.';
  const site=sites.find(item=>item.id===settingsSite);
  if(!site) return;
  try {
    const draft={...site,...validateSchedule(readScheduleEditor('settings'),{partial:true}),capturing:false};
    $('#settings-schedule-preview').textContent=site.paused ? '보류 상태에서 일정만 저장해요. 기록을 재개하면 적용돼요.' : !site.daily ? '일정을 저장한 뒤 자동 기록을 켜면 적용돼요.' : '저장 후 '+scheduleText(draft);
    $('#settings-schedule-preview').classList.remove('invalid');
  } catch(error) { $('#settings-schedule-preview').textContent=error.message; $('#settings-schedule-preview').classList.add('invalid'); }
}
for(const id of ['settings-schedule-mode','settings-interval','settings-interval-minutes','settings-daily-time']) $(`#${id}`).addEventListener('input',updateSettingsSchedule);

function formError(message = '') {
  $('#form-error').textContent = message; $('#form-error').hidden = !message;
  $('#url').setAttribute('aria-invalid', String(!!message));
}
function openAdd() { const fromNavigation=navigationOpen;setNavigation(false);if(fromNavigation)$('#add-dialog').addEventListener('close',()=>{if(mobileNavigation.matches && $('#add-dialog').dataset.completed!=='true')$('#mobile-add').focus();},{once:true}); rememberModal($('#add-dialog'));formError();$('#add-detail-error').hidden=true;updateAddSchedule(); $('#add-dialog').showModal(); $('#url').focus(); }
$('#add-site').onclick = openAdd; $('#sidebar-add').onclick = openAdd;
$('#close-dialog').onclick = () => $('#add-dialog').close();
$('#url').oninput = () => {
  formError();
  try { $('#url-hint').textContent = `기록할 주소: ${normalizeInput($('#url').value)}`; }
  catch { $('#url-hint').textContent = 'https://는 생략해도 괜찮아요.'; }
};
$('#add-form').onsubmit = async event => {
  event.preventDefault();
  let url;
  try { url = normalizeInput($('#url').value); } catch (error) { formError(error.message); $('#url').focus(); return; }
  const automatic=$('#add-form').elements.frequency.value === 'daily';
  let schedule={};
  if (automatic) {
    try { schedule=readScheduleEditor('add'); }
    catch(error) { addScheduleError(error); return; }
  }
  const existing = sites.find(s => s.url === url);
  if (existing) { $('#add-dialog').dataset.completed='true';$('#add-dialog').close(); selectSite(existing.id); toast('이미 기록 중인 사이트예요. 해당 아카이브를 열었어요.'); return; }
  const button = $('#submit-url'); button.disabled = true; button.textContent = '주소 확인 중…'; formError();
  try {
    const result = await api('/api/sites', 'POST', {url, daily:automatic,...schedule,capture_mode:$('#add-capture-mode').value});
    $('#add-dialog').dataset.completed='true';$('#add-dialog').close(); $('#add-form').reset();$('#add-advanced').open=false; $('#url-hint').textContent = 'https://는 생략해도 괜찮아요.';
    await refresh(true); selectSite(result.id); toast('사이트를 추가했어요. 첫 화면을 촬영하고 있어요.');
  } catch (error) { formError(error.message); }
  finally { button.disabled = false; button.textContent = '사이트 추가하고 첫 화면 저장'; }
};
const openHelp = () => {setNavigation(false);$('#help-dialog').showModal();};
$('#open-help').onclick = openHelp; $('#sidebar-help').onclick = openHelp;
$('#close-help').onclick = $('#help-done').onclick = () => $('#help-dialog').close();
for (const dialog of $$('dialog')) dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
});
function goHome({focusSearch = false} = {}) {
  setNavigation(false);
  const from = selected; selected = null; previous = ''; after = ''; syncLocation(true); render();
  if (focusSearch) $('#search').focus({preventScroll:true});
  requestAnimationFrame(() => {
    window.scrollTo({top:archiveScroll});
    const target = focusSearch ? $('#search') : $(`#archive .card-title[data-site="${CSS.escape(from || '')}"]`) || $('#search');
    target.focus({preventScroll:true});
  });
}
$('#all-sites').onclick = goHome;
$('#search').oninput = () => { syncLocation(); renderArchive(); };
$('#sort').onchange = event => { sort = event.target.value; try { localStorage.setItem('rewind-sort', sort); } catch {} syncLocation(); renderArchive(); };
$$('[data-filter]').forEach(button => button.onclick = () => { filter = button.dataset.filter; syncLocation(); renderArchive(); });
$('#reconnect').onclick = () => refresh(true);
function setLayout(value) {
  layout = value; try { localStorage.setItem('rewind-layout', value); } catch {}
  syncLocation(); renderArchive();
}
$('#grid-view').onclick = () => setLayout('grid');
$('#list-view').onclick = () => setLayout('list');
$('#keyboard-help').onclick = openHelp;
let batchCapturing=false;
$('#capture-visible').onclick = async () => {
  if(batchCapturing)return;
  const targets = visibleSites.filter(site => !site.paused && !site.capturing && !pending.has(site.id));
  if (!targets.length) return;
  batchCapturing=true;targets.forEach(site => pending.add(site.id)); renderArchive();
  let failures = 0;
  for (const site of targets) {
    try { await api(`/api/sites/${site.id}/capture`, 'POST'); }
    catch { failures++; }
  }
  await refresh(true); targets.forEach(site => pending.delete(site.id));batchCapturing=false; renderArchive();
  toast(failures ? `${targets.length-failures}개 촬영 요청 완료 · ${failures}개는 다시 시도해 주세요.` : `${targets.length}개 사이트를 촬영 대기열에 추가했어요.`);
};
async function toggleFavorite(site) {
  try { await api(`/api/sites/${site.id}`, 'PATCH', {favorite:!site.favorite}); await refresh(true); }
  catch (error) { toast(error.message); }
}
function openSettings(site) {
  $('#site-group').value=site.group_name || ''; $('#site-tags').value=(site.tags || []).join(', ');
  $('.organization-settings').open=false;
  $('#group-options').innerHTML=[...new Set(sites.map(s=>s.group_name).filter(Boolean))].sort().map(g=>`<option value="${esc(g)}"></option>`).join('');
  settingsSite = site.id; $('#site-name').value = site.display_name || '';
  $('#site-name').placeholder = site.page_title || site.title;
  $('#site-address').value = site.url; $('#settings-error').hidden = true;
  const config=scheduleOf(site);
  $('#settings-capture-mode').value=site.capture_mode || 'viewport';
  $('#settings-interval-minutes').value=config.interval_minutes;
  $('#settings-schedule-mode').value=config.schedule_mode==='interval' && config.interval_minutes%60!==0 ? 'minute_interval' : config.schedule_mode; $('#settings-interval').value=Math.max(1,Math.ceil(config.interval_hours)); $('#settings-daily-time').value=config.daily_time;
  $('#settings-interval-minutes').setAttribute('aria-invalid','false'); $('#settings-interval').setAttribute('aria-invalid','false'); $('#settings-daily-time').setAttribute('aria-invalid','false');
  updateSettingsSchedule();

  $('#address-settings').open = false; $('#name-count').textContent = `${$('#site-name').value.length} / 100`;
  rememberModal($('#settings-dialog'));$('#settings-dialog').showModal(); $('#site-name').focus();
}
$('#site-name').oninput = () => $('#name-count').textContent = `${$('#site-name').value.length} / 100`;
$('#close-settings').onclick = $('#cancel-settings').onclick = () => $('#settings-dialog').close();
$('#settings-form').onsubmit = async event => {
  event.preventDefault();
  let url;
  try { url = normalizeInput($('#site-address').value); }
  catch(error) { $('#address-settings').open = true; $('#site-address').setAttribute('aria-invalid','true'); $('#settings-error').textContent = error.message; $('#settings-error').hidden = false; $('#site-address').focus(); return; }
  $('#site-address').setAttribute('aria-invalid','false');
  let schedule;
  try { schedule=readScheduleEditor('settings'); }
  catch(error) { const field=$('#settings-schedule-mode').value==='daily_time' ? $('#settings-daily-time') : $('#settings-schedule-mode').value==='minute_interval' ? $('#settings-interval-minutes') : $('#settings-interval'); field.setAttribute('aria-invalid','true'); $('#settings-error').textContent=error.message; $('#settings-error').hidden=false; field.focus(); return; }
  $('#settings-interval-minutes').setAttribute('aria-invalid','false'); $('#settings-interval').setAttribute('aria-invalid','false'); $('#settings-daily-time').setAttribute('aria-invalid','false');
  const tags=$('#site-tags').value.split(',').map(t=>t.trim()).filter(Boolean);
  if(tags.length>20 || tags.some(t=>t.length>30)) { $('.organization-settings').open=true;$('#settings-error').textContent='태그는 최대 20개, 각각 30자 이내로 입력해 주세요.';$('#settings-error').hidden=false;$('#site-tags').focus();return; }
  const button = $('#save-settings'); button.disabled = true;
  try { const changed = sites.find(site => site.id === settingsSite)?.url !== url; await api(`/api/sites/${settingsSite}`, 'PATCH', {display_name:$('#site-name').value,group_name:$('#site-group').value,tags,...schedule,capture_mode:$('#settings-capture-mode').value,...(changed ? {url} : {})}); $('#settings-dialog').close(); await refresh(true); toast(changed ? sites.find(site => site.id === settingsSite)?.paused ? '주소를 저장했어요. 보류 상태는 유지해요.' : '새 주소를 저장하고 촬영을 시작했어요.' : '사이트 설정과 촬영 일정을 저장했어요.'); }
  catch (error) { $('#settings-error').textContent = error.message; $('#settings-error').hidden = false; }
  finally { button.disabled = false; }
};
$('#cancel-delete').onclick = () => $('#delete-dialog').close();
$('#confirm-delete').onclick = async () => {
  const button = $('#confirm-delete'); button.disabled = true; button.textContent = '삭제 중…';
  try {
    const path = deletingCapture ? `/api/sites/${deleting}/captures/${deletingCapture}` : `/api/sites/${deleting}`;
    await api(path, 'DELETE');
    if (!deletingCapture) { selected = null; after = ''; previous = ''; }
    else { after = ''; previous = ''; timelineDay = ''; }
    syncLocation(); $('#delete-dialog').close(); await refresh(true);
    (selected ? $('#viewer-title') : $('#search'))?.focus({preventScroll:true});
    toast(deletingCapture ? '선택한 기록을 삭제했어요.' : '아카이브와 저장된 화면을 삭제했어요.');
  }
  catch (error) { $('#delete-error').textContent = error.message; $('#delete-error').hidden = false; }
  finally { button.disabled = false; button.textContent = deletingCapture ? '이 기록 삭제' : '아카이브 삭제'; }
};
function selectSite(id) {
  setNavigation(false);
  if (!selected) archiveScroll = window.scrollY;
  importantOnly = false; changeFilter='all'; selected = id; previous = ''; after = ''; timelineDay = ''; timelinePage = 0; timelineInitialized = false; compareTarget = 'after'; mode = 'single'; ratio = 50;
  syncLocation(true); render(); window.scrollTo({top:0}); $('#viewer-title')?.focus({preventScroll:true});
}
function status(site) {
  if (site.paused) return {kind:'paused',text:'보류 중'};
  if (pending.has(site.id) && !site.capturing)return {kind:'busy',text:'촬영 요청 중'};
  if (site.capturing) return {kind:'busy', text:site.capture_status === 'queued' ? '촬영 대기 중' : '촬영 중'};
  if (site.error) return {kind:'error', text:/HTTP 403/.test(site.error) ? '접근 거부' : '확인 필요'};
  return {kind:site.daily ? 'daily' : 'manual', text:site.daily ? '자동 기록' : '수동 기록'};
}
function scheduleText(site) {
  if (site.paused) return '자동·일괄 촬영에서 제외돼요';
  if (site.capturing) return site.capture_status === 'queued' ? '앞선 촬영이 끝나면 시작해요' : '화면을 불러와 저장하고 있어요';
  if (!site.daily) return '필요할 때 직접 촬영해요';
  if (!site.last_attempt) return '곧 첫 번째 촬영을 시작해요';
  const next=nextScheduledAt(site);
  return Date.parse(next)<=Date.now() ? '다음 자동 기록: 곧 촬영 예정' : `다음 자동 기록: ${formattedScheduleTime(next,site)}`;
}
function friendlyError(error) {
  if (/HTTP 403/.test(error)) return '이 주소가 서버의 접근을 거부했어요 (403).';
  if (/Timeout|timeout|timed out/i.test(error)) return '사이트 응답이 늦어 촬영을 마치지 못했어요.';
  if (/net::|ENOTFOUND|EAI_AGAIN|ERR_/i.test(error)) return '사이트에 연결하지 못했어요. 주소나 사이트 상태를 확인해 주세요.';
  if (/Executable|브라우저 설치|shared libraries|browserType.launch/i.test(error)) return '촬영 브라우저를 실행하지 못했어요. 서버의 브라우저 설치를 확인해 주세요.';
  return '이번 화면을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.';
}
function render() {
  const current = sites.find(s => s.id === selected);
  if (!current && loaded) { selected = null; syncLocation(); }
  $('#nav-count').textContent = sites.length;
  $('#stat-sites').textContent = sites.length;
  $('#stat-captures').textContent = sites.reduce((n,s) => n+s.captures.length, 0);
  $('#stat-daily').textContent = sites.filter(s => s.daily && !s.paused).length;
  const navScroll=$('#site-nav').scrollTop;
  $('#site-nav').innerHTML = sites.map(s => `<button class="nav-item ${selected === s.id ? 'active' : ''}" data-site="${s.id}" title="${esc(s.title)} · ${esc(hostName(s))} · ${esc(status(s).text)}" aria-label="${esc(s.title)} · ${esc(hostName(s))} · ${esc(status(s).text)}" ${selected === s.id ? 'aria-current="page"' : ''}>${initials(s)}<span class="site-nav-name"><strong>${esc(s.title)}</strong><small>${esc(hostName(s))}</small></span>${s.paused ? `<span class="nav-paused" aria-label="보류 중">${icon('pause',12)}</span>` : s.capturing ? '<span class="mini-spinner" aria-label="촬영 중"></span>' : s.error ? '<span class="nav-warning" aria-label="확인 필요">!</span>' : ''}</button>`).join('');
  $('#site-nav').scrollTop=navScroll;
  $('#all-sites').setAttribute('aria-label',`내 아카이브 · 사이트 ${sites.length}개`);
  if(current)$('#all-sites').removeAttribute('aria-current');else $('#all-sites').setAttribute('aria-current','page');
  $$('#site-nav [data-site]').forEach(el => el.onclick = () => selectSite(el.dataset.site));
  $('#all-sites').classList.toggle('active', !current);
  $('#breadcrumb').innerHTML = current ? `<button class="text-button" id="breadcrumb-home">내 아카이브</button><span aria-hidden="true">/</span><span class="breadcrumb-current">${esc(hostName(current))}</span>` : '내 아카이브';
  if ($('#breadcrumb-home')) $('#breadcrumb-home').onclick = goHome;
  $('#archive-intro').hidden = !!current; $('#archive-stats').hidden = !!current; $('#archive-section').hidden = !!current; $('#viewer').hidden = !current;
  document.body.classList.toggle('viewing-site', !!current);
  document.title = current ? `${current.title} — Rewind` : 'Rewind — 웹의 시간을 기록하세요';
  current ? renderViewer(current) : renderArchive();
}
function resetFilters() { groupFilter='';tagFilter='';filter = 'all'; $('#search').value = ''; syncLocation(); renderArchive(); $('#search').focus(); }
function renderArchive() {
  if (!loaded) return;
  const active = document.activeElement;
  const focusFavorite = active?.dataset.favorite;
  const focusCapture = active?.dataset.captureSite;
  arrangeArchiveToolbar();
  renderOrganizationFilters();
  const query = $('#search').value.trim().toLowerCase();
  const counts = {all:sites.length, favorite:sites.filter(s => s.favorite).length, daily:sites.filter(s => s.daily && !s.paused).length, manual:sites.filter(s => !s.daily && !s.paused).length, paused:sites.filter(s => s.paused).length, error:sites.filter(s => s.error && !s.paused).length};
  for (const [key,value] of Object.entries(counts)) $(`#filter-${key}`).textContent = value;
  $$('[data-filter]').forEach(el => { const active = el.dataset.filter === filter; el.classList.toggle('active',active); el.setAttribute('aria-pressed',String(active)); });
  const list = sites.filter(s => [s.title,s.url,s.group_name,...(s.tags || [])].join(' ').toLowerCase().includes(query) && (!groupFilter || s.group_name===groupFilter) && (!tagFilter || (s.tags || []).includes(tagFilter)) && (filter === 'all' || filter === 'favorite' && s.favorite || filter === 'daily' && s.daily && !s.paused || filter === 'manual' && !s.daily && !s.paused || filter === 'paused' && s.paused || filter === 'error' && s.error && !s.paused));
  list.sort((a,b) => Number(b.favorite || 0)-Number(a.favorite || 0) || (sort === 'name' ? a.title.localeCompare(b.title,'ko') : sort === 'created' ? b.created_at.localeCompare(a.created_at) : (b.captures[0]?.created_at || b.created_at).localeCompare(a.captures[0]?.created_at || a.created_at)));
  $('#heading-count').textContent = list.length; $('#results-count').textContent = query || filter !== 'all' || groupFilter || tagFilter ? `${sites.length}개 중 ${list.length}개` : `${list.length}개의 사이트`;
  $('#archive').setAttribute('aria-busy','false');
  visibleSites = list;
  $('#archive').classList.toggle('list-layout', layout === 'list');
  for (const [id,value] of [['grid-view','grid'],['list-view','list']]) { $(`#${id}`).setAttribute('aria-pressed',String(layout === value)); }
  const available = list.filter(site => !site.paused && !site.capturing && !pending.has(site.id));
  $('#capture-visible').disabled = !available.length || disconnected || batchCapturing;
  $('#capture-visible').innerHTML = icon('camera',16)+`<span class="batch-full">${batchCapturing ? '촬영 요청 중…' : `현재 결과 모두 촬영 (${available.length})`}</span><span class="batch-short" aria-hidden="true">${batchCapturing ? '요청 중…' : `결과 촬영 (${available.length})`}</span>`;
  $('#capture-visible').setAttribute('aria-label',batchCapturing ? '촬영 요청 중' : `현재 결과 모두 촬영 (${available.length})`);
  $('#capture-visible').title = '현재 검색·필터 결과에서 보류·요청·촬영 중인 사이트를 제외해요';
  $('#capture-visible').setAttribute('aria-describedby','batch-scope-help');
  $('#clear-search').hidden=!query;
  $('#query-summary').textContent=`${query ? `검색 ‘${$('#search').value.trim()}’ · ` : ''}${filterNames[filter]}${groupFilter ? ` · 그룹 ${groupFilter}` : ''}${tagFilter ? ` · #${tagFilter}` : ''} · ${list.length}개 결과`;
  $('#batch-scope-help').textContent=`촬영 대상 ${available.length}개 · 보류·요청·촬영 중 ${list.length-available.length}개 제외`;
  requestAnimationFrame(()=>updateFilterOverflow(true));
  if (!list.length) {
    $('#archive').innerHTML = sites.length ? `<div class="empty"><span class="empty-symbol" aria-hidden="true">${icon('search',24)}</span><h3>${query ? '검색 결과가 없어요' : '이 조건에 맞는 사이트가 없어요'}</h3><p>${query ? `‘${esc($('#search').value.trim())}’와 일치하는 이름이나 주소를 찾지 못했어요.` : '다른 필터를 선택해 보세요.'}</p><button class="secondary" id="reset-filters">검색과 필터 초기화</button></div>` : `<div class="empty"><div class="empty-art" aria-hidden="true">${icon('archive',24)}</div><h3>아직 등록한 사이트가 없어요</h3><p>주소를 추가하면 첫 화면을 저장하고<br>원하는 간격으로 자동 촬영을 설정할 수 있어요.</p><button class="primary" id="empty-add">${icon('plus')} 사이트 추가</button><span class="empty-caption">공개 웹사이트 · 상단 화면 또는 전체 페이지 촬영</span></div>`;
    if ($('#empty-add')) $('#empty-add').onclick = openAdd;
    if ($('#reset-filters')) $('#reset-filters').onclick = resetFilters;
    return;
  }
  $('#archive').innerHTML = list.map(s => {
    const state = status(s), latest = s.captures[0];
    return `<article class="card"><div class="card-heading">${initials(s)}<div class="card-identity"><h3><button class="card-title" data-site="${s.id}" title="${esc(s.title)}" aria-label="${esc(s.title)} 기록 보기">${esc(s.title)}</button></h3><span class="card-url" title="${esc(s.url)}">${esc(hostName(s))}</span>${organizationMarkup(s)}</div><button class="favorite-button ${s.favorite ? 'is-favorite' : ''}" data-favorite="${s.id}" aria-label="${esc(s.title)} 즐겨찾기 ${s.favorite ? '해제' : '추가'}" aria-pressed="${!!s.favorite}">${icon('star')}</button></div><button class="card-preview" data-site="${s.id}" aria-label="${esc(s.title)} 기록 보기">${latest ? `<img src="${latest.image}" alt="${esc(s.title)} 최근 기록" loading="lazy">` : `<div class="preview-placeholder ${s.capturing ? 'loading' : ''}">${s.capturing ? '' : icon('archive',24)}<span>${s.paused ? '기록 보류 중' : s.capturing ? '첫 기록을 저장하고 있어요' : s.error ? '아직 저장된 기록이 없어요' : '첫 기록을 기다리고 있어요'}</span></div>`}<span class="preview-open">기록 보기 ${icon('right',14)}</span></button><div class="card-body"><div class="card-state-row"><span class="badge ${state.kind}">${state.kind==='busy' ? '<span class="mini-spinner"></span>' : '<span class="badge-dot"></span>'}${state.text}</span><span class="schedule-cadence">${s.daily ? esc(scheduleLabel(s)) : '직접 촬영'}</span></div><span class="capture-format"><span class="mobile-meta-label">범위</span>${s.capture_mode==='full_page' ? '전체 페이지' : '상단 화면'}</span><div class="card-meta"><div class="card-record-count"><strong>${s.captures.length}</strong><span>개 기록</span></div><div class="card-latest"><span class="meta-label">최근 촬영</span><time ${latest ? `datetime="${latest.created_at}" title="${formatDate(latest.created_at)}"` : ''}>${latest ? compactDate(latest.created_at) : '기록 없음'}</time></div></div>${s.error && !s.paused ? '<p class="card-error">최근 촬영 실패 · 기록에서 원인을 확인하세요.</p>' : ''}<div class="card-bottom"><span class="next-capture" data-next-site="${s.id}" title="${esc(scheduleText(s))}">${scheduledRecordMarkup(s)}</span><div class="card-actions"><button class="secondary small card-open" data-site="${s.id}" aria-label="${esc(s.title)} 기록 보기">기록 보기</button><button class="secondary small card-capture" data-capture-site="${s.id}" aria-label="${esc(s.title)} ${s.paused ? '촬영 보류 중' : s.capturing ? '촬영 중' : '지금 촬영'}" title="${s.paused ? '기록을 재개한 뒤 촬영하세요' : s.capturing ? state.text : '지금 촬영'}" ${s.paused || s.capturing || pending.has(s.id) ? 'disabled' : ''}>${s.capturing || pending.has(s.id) ? '<span class="mini-spinner"></span>' : icon('camera',16)}<span class="card-capture-label">${s.paused ? '보류 중' : s.capturing ? '촬영 중' : pending.has(s.id) ? '요청 중' : '촬영'}</span></button></div></div></div></article>`;
  }).join('');
  if(layout==='list')$('#archive').insertAdjacentHTML('afterbegin','<div class="archive-list-head" aria-hidden="true"><span></span><span>사이트</span><div><span>기록 방식</span><span>촬영 범위</span><span>기록</span><span>최근 촬영</span><span>다음 촬영</span><span>실행</span></div></div>');
  $$('#archive [data-site]').forEach(el => el.onclick = () => selectSite(el.dataset.site));
  $$('[data-capture-site]').forEach(el => el.onclick = () => captureNow(el.dataset.captureSite));
  $$('[data-favorite]').forEach(el => el.onclick = () => { el.disabled = true; toggleFavorite(sites.find(site => site.id === el.dataset.favorite)); });
  if (focusFavorite) $(`[data-favorite="${CSS.escape(focusFavorite)}"]`)?.focus({preventScroll:true});
  if (focusCapture) $(`[data-capture-site="${CSS.escape(focusCapture)}"]`)?.focus({preventScroll:true});
}
async function captureNow(id) {
  if (pending.has(id)) return;
  pending.add(id); render();
  try { await api(`/api/sites/${id}/capture`, 'POST'); await refresh(true); toast('촬영을 요청했어요. 완료되면 새 기록이 표시돼요.'); }
  catch (error) { toast(error.message); }
  finally { pending.delete(id); render(); }
}
function openDelete(site) {
  $('#confirm-delete').textContent = '아카이브 삭제';
  deletingCapture = null; $('#delete-title').textContent = '이 아카이브를 삭제할까요?';
  deleting = site.id; $('#delete-description').textContent = `‘${site.title}’ 사이트와 저장된 ${site.captures.length}개의 화면을 모두 삭제합니다.`;
  $('#delete-error').hidden = true; $('#delete-dialog').showModal();
}
function openRecordDelete(site, record) {
  $('#confirm-delete').textContent = '이 기록 삭제';
  deleting = site.id; deletingCapture = record.id;
  $('#delete-title').textContent = '이 기록만 삭제할까요?';
  $('#delete-description').textContent = `‘${site.title}’의 ${formatDate(record.created_at)} 기록 1개를 삭제합니다. 사이트와 다른 기록은 유지돼요.`;
  $('#delete-error').hidden = true; $('#delete-dialog').showModal();
}
function setMode(next) {
  const site = sites.find(s => s.id === selected);
  if (mode === 'single' && next !== 'single') {
    const index = site.captures.findIndex(record => record.id === after);
    previous = (site.captures[index+1] || site.captures[index-1])?.id || '';
  }
  mode = next; compareTarget = 'after'; ratio = 50; syncLocation(); renderViewer(site);
}
async function togglePause(site) {
  try { await api(`/api/sites/${site.id}`, 'PATCH', {paused:!site.paused}); await refresh(true); toast(site.paused ? '기록을 재개했어요. 기존 자동 기록 설정을 사용해요.' : '기록을 보류했어요. 자동·일괄 촬영에서 제외해요.'); if (selected === site.id) (site.paused ? $('#capture-now') : $('#resume-site'))?.focus({preventScroll:true}); }
  catch (error) { toast(error.message); }
}
function positionTimeline(site,id) {
  if (importantOnly && !site.captures.find(c=>c.id===id)?.important) importantOnly=false;
  if (timelineDay && !site.captures.some(c => c.id === id && localDay(c.created_at) === timelineDay)) timelineDay = '';
  const records = site.captures.filter(c => (!timelineDay || localDay(c.created_at) === timelineDay) && (!importantOnly || c.important) && (changeFilter==='all' || (c.content_change || 'unavailable')===changeFilter));
  timelinePage = Math.floor(Math.max(0,records.findIndex(c => c.id === id))/timelinePageSize);
}
function chooseAfter(id) {
  const site = sites.find(s => s.id === selected);
  const oldAfter = after; after = id;
  if (previous === after && site.captures.length > 1) previous = oldAfter;
  positionTimeline(site,id);
  syncLocation(); renderViewer(site);
  revealTimelineRecord(id);
}
function chooseBefore(id) {
  const site = sites.find(s => s.id === selected), oldBefore = previous;
  previous = id; if (after === id) after = oldBefore;
  positionTimeline(site,id); syncLocation(); renderViewer(site);revealTimelineRecord(id);
}
function revealTimelineRecord(id) {
  const strip = $('.timeline'), active = $(`.moment[data-capture="${CSS.escape(id)}"]`);
  if(!strip || !active)return;
  const bounds=strip.getBoundingClientRect(),record=active.getBoundingClientRect();
  if(getComputedStyle(strip).flexDirection==='column')strip.scrollTop+=record.top-bounds.top-strip.clientHeight/2+record.height/2;
  else strip.scrollTo({left:Math.max(0,strip.scrollLeft+record.left-bounds.left-strip.clientWidth/2+record.width/2),behavior:'instant'});
}
function refineWorkspaceControls(site) {
  for(const [id,name] of [['edit-site','settings'],['favorite-site','star'],['add-from-viewer','plus'],['inspect-image','zoom'],['swap-records','swap'],['schedule-help','help'],['important-record','star'],['important-only','star']]){
    const button=document.getElementById(id);if(!button)continue;
    if(['edit-site','favorite-site','add-from-viewer','schedule-help'].includes(id))button.innerHTML=icon(name);
    else button.innerHTML=icon(name)+'<span>'+esc(button.textContent.replace(/^[⌕◎☆★]\s*/,''))+'</span>';
  }
  const shot=$('#capture-now');if(shot && pending.has(site.id) && !site.capturing)shot.innerHTML='<span class="mini-spinner"></span><span>촬영 요청 중</span>';if(shot && !site.capturing && !site.paused && !pending.has(site.id))shot.innerHTML=icon('camera')+'<span>지금 촬영</span>';
}
function renderViewer(site) {
  const focused = ($('#viewer').contains(document.activeElement) || $('#record-browser').contains(document.activeElement)) ? document.activeElement.id : '';
  const timelineTop = $('.timeline')?.scrollTop || 0;
  const openMenuId = $('#viewer .action-menu[open]')?.id;
  const scrollLeft = $('.timeline')?.scrollLeft || 0;
  const scheduleOpen=$('#viewer-schedule')?.dataset.site===site.id && $('#viewer-schedule').open;
  // The mobile browser reuses the same rail; discard its prior render before rebuilding.
  $('#record-browser-content').replaceChildren();

  const captures = site.captures;
  if (!captures.some(c => c.id === after)) after = captures[0]?.id || '';
  if (!captures.some(c => c.id === previous) || previous === after) previous = captures.find(c => c.id !== after)?.id || '';
  if (captures.length < 2) mode = 'single';
  syncLocation();
  if (!timelineInitialized) { positionTimeline(site, mode !== 'single' && compareTarget === 'before' ? previous : after); timelineInitialized = true; }
  const latest = captures.find(c => c.id === after), old = captures.find(c => c.id === previous);
  const state = status(site), compare = mode !== 'single';
  const options = (id,exclude) => captures.filter(c => c.id !== exclude).map(c => `<option value="${c.id}" ${c.id === id ? 'selected' : ''} title="${formatDate(c.created_at)}">${pickerDate(c.created_at)}</option>`).join('');
  const position = captures.findIndex(c => c.id === after);
  const filteredTimeline = captures.filter(c => (!timelineDay || localDay(c.created_at) === timelineDay) && (!importantOnly || c.important) && (changeFilter==='all' || (c.content_change || 'unavailable')===changeFilter));
  const pageCount = Math.max(1,Math.ceil(filteredTimeline.length/timelinePageSize));
  timelinePage = Math.max(0,Math.min(timelinePage,pageCount-1));
  const timeline = filteredTimeline.slice(timelinePage*timelinePageSize,(timelinePage+1)*timelinePageSize);
  const activeRecord = compare && compareTarget === 'before' ? old : latest;
  const chronology=comparisonPresentation(old,latest),activePosition=captures.findIndex(c=>c.id===activeRecord?.id);
  const targetLabel=compare ? compareTarget==='before' ? chronology.leftLabel : chronology.rightLabel : '선택한 기록';
  const frameWidth=Math.max(latest?.width || 1440,compare ? old?.width || 1440 : 0);
  const frameHeight=Math.max(latest?.height || 1000,compare ? old?.height || 1000 : 0);
  const frameRatio=frameWidth/frameHeight, longCapture=frameRatio<1;
  const totalBytes = captures.reduce((sum,c) => sum+(c.bytes || 0),0);
  $('#viewer').innerHTML = `
    <div class="viewer-navigation"><button class="text-button" id="back-to-archive">← 아카이브로</button><div class="viewer-switch"><select id="site-switch" aria-label="다른 사이트 열기">${sites.map(item => `<option value="${item.id}" ${item.id === site.id ? 'selected' : ''}>${esc(item.title)}</option>`).join('')}</select><button class="secondary small" id="add-from-viewer" aria-label="사이트 추가">＋</button></div></div>
    <div class="viewer-head"><div class="viewer-identity">${initials(site)}<div><div class="viewer-name"><h1 id="viewer-title" tabindex="-1">${esc(site.title)}</h1><button class="text-button edit-name" id="edit-site" aria-label="사이트 설정">✎</button></div><a class="viewer-url" href="${esc(site.url)}" target="_blank" rel="noopener noreferrer">${esc(site.url)} <span aria-hidden="true">↗</span><span class="sr-only"> (새 탭)</span></a></div></div><div class="viewer-actions"><button class="secondary favorite-inline ${site.favorite ? 'is-favorite' : ''}" id="favorite-site" aria-label="즐겨찾기 ${site.favorite ? '해제' : '추가'}" aria-pressed="${!!site.favorite}">${site.favorite ? '★' : '☆'}</button><button class="primary" id="capture-now" ${site.paused || site.capturing || pending.has(site.id) ? 'disabled' : ''}>${site.paused ? '보류 중' : site.capturing ? '<span class="mini-spinner"></span> '+state.text : '◎ 지금 촬영'}</button><details class="action-menu" id="site-menu"><summary class="secondary" id="site-menu-toggle">사이트 관리 ${icon('down',12)}</summary><div class="menu-panel"><button id="show-site-activity">촬영 상태·이력</button><button id="share-link">이 화면 링크 복사</button><button id="pause-site" ${site.capturing ? 'disabled' : ''}>${site.paused ? '기록 재개' : '기록 보류'}</button><hr><button class="danger-menu" id="delete-site" ${site.capturing ? 'disabled' : ''}>아카이브 삭제</button></div></details></div></div>
    <div class="site-meta"><span title="${formatSize(totalBytes)}">${captures.length}개 기록</span><span>${site.capture_mode==='full_page' ? '전체 페이지 촬영' : '상단 화면 촬영'}</span></div>
    ${organizationMarkup(site)}
    <div class="viewer-next next-capture" data-next-site="${site.id}">${scheduledRecordMarkup(site)}</div>
    <details class="viewer-schedule" id="viewer-schedule" data-site="${site.id}" ${scheduleOpen ? 'open' : ''}><summary><span>${site.paused ? '기록 보류' : site.daily ? '자동 기록' : '수동 기록'}${site.daily ? ` · ${esc(scheduleLabel(site))}` : ''} · ${site.capture_mode==='full_page' ? '전체 페이지' : '상단 화면'}</span><span>촬영 설정 ${icon('down',12)}</span></summary><div class="schedule-bar"><label class="schedule" for="daily"><input id="daily" type="checkbox" role="switch" ${site.daily ? 'checked' : ''} ${site.paused ? 'disabled' : ''}><span>${site.paused ? '자동 기록 보류' : '자동 기록'}</span></label><button class="schedule-config secondary small" id="schedule-config" title="${esc(scheduleLabel(site))}${scheduleOf(site).schedule_mode==='daily_time' ? ' · 한국 시간(서울)' : ''}">${esc(scheduleLabel(site))} ${icon('down',12)}</button><span class="schedule-summary" title="${esc(scheduleText(site))}"><span class="desktop-copy">${esc(scheduleText(site))}</span><span class="compact-copy">${esc(compactScheduleText(site))}</span></span><button class="text-button" id="schedule-help" aria-label="자동 기록 방식 안내">ⓘ</button></div></details>
    ${!site.paused && site.recheck?.state === 'running' ? `<div class="recheck-note"><strong>추가 점검 진행 중</strong><span>${site.recheck.next_check_at ? `다음 확인: ${formatDate(site.recheck.next_check_at)}` : '첫 점검 일정 준비 중'} · 종료 상한 ${formatDate(site.recheck.deadline)}</span></div>` : !site.paused && site.recheck?.state === 'not_resolved' ? '<div class="recheck-note unresolved"><strong>추가 점검 종료 · 자동 촬영 미해결</strong><span>정상 화면이 저장되지 않았어요. 사이트 측 접근 허용이나 정상 주소 확인이 필요해요.</span></div>' : ''}
    <div id="capture-feedback" aria-live="polite">${site.paused ? `<div class="pause-banner"><div><strong>기록을 보류하고 있어요</strong><p>자동 촬영과 일괄 촬영에서 제외돼요. 저장된 기록은 계속 볼 수 있어요.</p></div><button class="secondary" id="resume-site">기록 재개</button></div>` : site.capturing ? `<div class="capture-banner"><span class="spinner"></span><div><strong>${site.capture_status === 'queued' ? '촬영 순서를 기다리고 있어요' : '새 기록을 촬영하고 있어요'}</strong><p>${site.capture_status === 'queued' ? '앞선 사이트의 촬영이 끝나면 자동으로 시작해요.' : '사이트를 불러와 화면을 저장해요. 보통 수 초에서 1분 정도 걸려요.'}</p></div></div>` : site.error ? `<div class="error-banner"><div><strong>${friendlyError(site.error)}</strong><p>${/HTTP 403/.test(site.error) ? '브라우저에서 정상적으로 열리는 전체 주소를 확인해 주세요. 직접 캡처한 화면을 가져올 수도 있어요.' : (captures.length ? '저장된 기록은 계속 볼 수 있어요. ' : '')+'다시 촬영하거나 잠시 후 시도해 주세요.'}</p><details><summary>오류 상세 보기</summary><pre>${esc(site.error)}</pre></details></div><div class="error-actions">${/HTTP 403/.test(site.error) ? '<button class="secondary" id="fix-site-address">주소 확인·변경</button>' : '<button class="secondary" id="retry-capture">다시 촬영</button>'}<button class="secondary" id="import-error-image">내 화면 가져오기</button></div></div>` : ''}</div>
    ${latest ? `<div class="viewer-workspace"><div class="compare-toolbar"><div class="viewer-mode" role="group" aria-label="보기 방식"><button id="single-mode" class="${mode === 'single' ? 'active' : ''}" aria-pressed="${mode === 'single'}">단일 화면</button><button id="compare-mode" class="${mode === 'compare' ? 'active' : ''}" aria-pressed="${mode === 'compare'}" ${captures.length < 2 ? 'disabled title="두 번째 기록부터 비교할 수 있어요"' : ''}>슬라이더 비교</button><button id="split-mode" class="${mode === 'split' ? 'active' : ''}" aria-pressed="${mode === 'split'}" ${captures.length < 2 ? 'disabled title="두 번째 기록부터 비교할 수 있어요"' : ''}>나란히 보기</button><button id="diff-mode" class="${mode === 'diff' ? 'active' : ''}" aria-pressed="${mode === 'diff'}" ${captures.length < 2 ? 'disabled title="두 번째 기록부터 비교할 수 있어요"' : ''}>변경 부분</button></div><div class="image-actions">${compare ? `<button class="secondary small swap-button" id="swap-records" aria-label="왼쪽과 오른쪽 기록 바꾸기">${icon('swap')}<span>좌우 교환</span></button>` : ''}<button class="secondary small" id="inspect-image">⌕ 원본 확대</button><details class="action-menu" id="record-menu"><summary class="secondary small" id="record-menu-toggle" aria-label="기록 도구"><span class="record-tool-label">기록 도구</span><span class="record-tool-short" aria-hidden="true">도구</span> ${icon('down',12)}</summary><div class="menu-panel"><div class="menu-caption">${compare ? compareTarget === 'before' ? '왼쪽 기록' : '오른쪽 기록' : '선택한 기록'} · ${formatDate(activeRecord.created_at)}</div><a href="${activeRecord.image}" download="rewind-${hostName(site)}-${activeRecord.created_at.replace(/[:.]/g,'-')}.png">PNG 저장</a><button id="expand-view">화면 전체 보기</button><button id="import-image">화면 가져오기</button><hr><button class="danger-menu" id="delete-record" ${site.capturing ? 'disabled' : ''}>이 기록 삭제</button></div></details></div></div>
    <div class="record-selectors">${compare ? `<div class="record-picker"><button id="target-before" class="record-target" aria-pressed="${compareTarget==='before'}" aria-controls="before-select">${esc(chronology.leftLabel)}</button><label class="sr-only" for="before-select">왼쪽 기록 선택</label><select id="before-select" title="${formatDate(old.created_at)}" aria-label="왼쪽 기록 선택">${options(previous,after)}</select></div>` : ''}<div class="record-picker">${compare ? `<button id="target-after" class="record-target" aria-pressed="${compareTarget==='after'}" aria-controls="after-select">${esc(chronology.rightLabel)}</button>` : '<label for="after-select">조회할 기록</label>'}<select id="after-select" title="${formatDate(latest.created_at)}" aria-label="${compare ? '오른쪽 기록 선택' : '조회할 기록'}">${options(after,compare ? previous : '')}</select></div></div>
    <div class="record-browse-bar"><div class="record-pager"><button class="secondary" id="older-record" aria-label="${esc(targetLabel)}의 이전 기록" ${activePosition>=captures.length-1 ? 'disabled' : ''}>← 이전</button><span ${compare ? 'id="comparison-gap"' : ''}>${compare ? esc(chronology.gap) : `${captures.length-position} / ${captures.length}`}</span><button class="secondary" id="newer-record" aria-label="${esc(targetLabel)}의 다음 기록" ${activePosition<=0 ? 'disabled' : ''}>다음 →</button><button class="secondary" id="latest-record" aria-label="${esc(targetLabel)}을 최신 기록으로" ${activeRecord.id===captures[0].id ? 'disabled' : ''}>최신 기록</button></div><button class="text-button" id="browse-records">전체 기록 ${captures.length}개 보기 ↓</button></div>
    ${mode === 'diff' ? '<div class="diff-controls"><label for="diff-threshold">차이 기준 <select id="diff-threshold"><option value="12">작은 차이도 표시</option><option value="32">보통</option><option value="64">큰 차이만 표시</option></select></label><a class="secondary small" id="download-diff" hidden>비교 PNG 저장</a><p id="diff-summary" role="status"></p></div>' : ''}
    <div style="--capture-ratio:${frameRatio}" class="canvas-wrapper ${longCapture ? 'long-capture' : ''} ${mode === 'split' ? 'split-wrapper' : ''}" id="capture-stage">${mode === 'diff' ? '<canvas id="diff-canvas" role="img" aria-label="변경된 부분을 분홍색으로 강조한 비교 이미지"></canvas>' : mode === 'split' ? `<figure><figcaption>${esc(chronology.leftLabel)} · ${formatDate(old.created_at)}</figcaption><img src="${old.image}" alt="${esc(old.title)} ${formatDate(old.created_at)} 화면"></figure><figure><figcaption>${esc(chronology.rightLabel)} · ${formatDate(latest.created_at)}</figcaption><img src="${latest.image}" alt="${esc(latest.title)} ${formatDate(latest.created_at)} 화면"></figure>` : `<div class="canvas"><img src="${latest.image}" alt="${esc(latest.title)} ${formatDate(latest.created_at)} 화면">${mode === 'compare' ? `<div class="before-image" style="clip-path:inset(0 ${100-ratio}% 0 0)"><img src="${old.image}" alt="${esc(old.title)} ${formatDate(old.created_at)} 왼쪽 기록"></div><div class="divider" style="left:${ratio}%"><span aria-hidden="true">↔</span></div><input id="compare-slider" class="compare-range" type="range" min="0" max="100" value="${ratio}" aria-label="왼쪽 기록 표시 비율" aria-valuetext="왼쪽 기록 ${ratio}%"><span class="image-label before">${esc(chronology.leftLabel)} · ${formatTime(old.created_at)}</span><span class="image-label after">${esc(chronology.rightLabel)} · ${formatTime(latest.created_at)}</span>` : ''}</div>`}</div>
    <div class="viewer-note"><span>${longCapture && mode !== 'diff' ? '이미지 안을 스크롤해서 아래쪽까지 살펴보세요. ' : ''}${mode === 'diff' ? '오른쪽 기록 위에 차이를 표시해요. 광고·애니메이션·위치 이동도 변화로 잡힐 수 있어요.' : mode === 'compare' ? '↔ 슬라이더를 드래그하거나, 선택 후 방향키로 비교하세요.' : mode === 'split' ? '두 기록을 나란히 살펴보세요. 모바일에서는 위아래로 표시돼요.' : captures.length < 2 ? '한 번 더 촬영하면 두 기록을 비교할 수 있어요.' : '기록 선택에서 다른 시점을 열거나, 두 기록을 비교해 보세요.'}</span>${mode === 'compare' ? '<button class="text-button" id="reset-slider">가운데로 맞추기</button>' : ''}</div></div>
    <section class="timeline-section" aria-label="기록 타임라인"><div class="timeline-heading"><h2>기록 <span>${captures.length}</span></h2><div class="timeline-tools"><label for="timeline-date">날짜로 찾기</label><input id="timeline-date" type="date" value="${timelineDay}" min="${localDay(captures.at(-1).created_at)}" max="${localDay(captures[0].created_at)}">${timelineDay ? '<button class="text-button" id="clear-date">전체 보기</button>' : ''}</div></div><div class="timeline-controls"><span class="timeline-hint">${compare ? `${esc(targetLabel)}을 아래 기록으로 바꿔요.` : '아래 기록을 누르면 해당 시점을 열어요.'}</span>${filteredTimeline.length > timelinePageSize ? `<div class="timeline-pagination"><span role="status">${timelinePage*timelinePageSize+1}–${Math.min((timelinePage+1)*timelinePageSize,filteredTimeline.length)} / ${filteredTimeline.length}</span><button class="secondary small" id="timeline-prev" aria-label="이전 기록 묶음" ${timelinePage === 0 ? 'disabled' : ''}>←</button><button class="secondary small" id="timeline-next" aria-label="다음 기록 묶음" ${timelinePage === pageCount-1 ? 'disabled' : ''}>→</button></div>` : ''}</div><div class="timeline">${timeline.length ? timeline.map((c,i) => `<button id="moment-${c.id}" class="moment ${c.id === after ? 'active' : ''} ${compare && c.id === previous ? 'before-selected' : ''}" data-capture="${c.id}" aria-pressed="${c.id === (compare && compareTarget === 'before' ? previous : after)}" aria-label="${formatDate(c.created_at)} ${compare ? compareTarget === 'before' ? '왼쪽' : '오른쪽' : ''} 기록 선택"><div class="moment-image"><img loading="lazy" src="${c.image}" alt="">${c.id === after ? `<span class="moment-selected">${compare ? '오른쪽' : '선택됨'}</span>` : compare && c.id === previous ? '<span class="moment-selected muted">왼쪽</span>' : ''}</div><span class="moment-date">${formatDate(c.created_at,false)}${c.source === 'import' ? ' · 직접 가져옴' : ''}</span><strong>${formatTime(c.created_at)}</strong><span class="moment-title" title="${esc(c.note || c.title)}">${c.important ? '★ ' : ''}${esc(c.note || c.title)}</span></button>`).join('') : '<div class="timeline-empty">조건에 맞는 기록이 없어요. <button class="text-button" id="empty-clear-date">전체 기록 보기</button></div>'}</div></section>` : `<div class="empty viewer-empty"><div class="empty-art" aria-hidden="true"><span>${site.paused ? 'Ⅱ' : site.capturing ? '◷' : '↶'}</span></div><h3>${site.paused ? '아직 저장된 기록이 없어요' : site.capturing ? '첫 기록을 기다리는 중' : '아직 저장된 기록이 없어요'}</h3><p>${site.paused ? '기록을 재개하면 다시 촬영할 수 있어요.' : site.capturing ? '촬영이 끝나면 여기에 화면이 나타나요.<br>다른 사이트를 둘러봐도 촬영은 계속돼요.' : '지금 촬영을 눌러 첫 기록을 남겨보세요.'}</p>${!site.paused && !site.capturing ? '<button class="primary" id="first-capture">◎ 첫 화면 촬영하기</button>' : ''}</div>`}`;
  if($('.viewer-workspace'))$('.viewer-workspace').after($('#viewer-schedule'));
  if($('.viewer-note') && $('#browse-records'))$('.viewer-note').append($('#browse-records'));
  if($('.viewer-next'))$('.site-meta').append($('.viewer-next'));
  $('#back-to-archive').onclick = goHome; $('#add-from-viewer').onclick = openAdd;
  $('#site-switch').onchange = event => selectSite(event.target.value);
  $('#edit-site').onclick = () => openSettings(site);
  $('#favorite-site').onclick = event => { event.currentTarget.disabled = true; toggleFavorite(site); };
  $('#capture-now').onclick = () => captureNow(site.id);
  $('#pause-site').onclick = () => togglePause(site);
  if ($('#resume-site')) $('#resume-site').onclick = () => togglePause(site);
  if ($('#import-error-image')) $('#import-error-image').onclick = () => openImport(site);
  if ($('#fix-site-address')) $('#fix-site-address').onclick = () => {openSettings(site); $('#address-settings').open = true; $('#site-address').focus();};
  if ($('#retry-capture')) $('#retry-capture').onclick = () => captureNow(site.id);
  if ($('#first-capture')) { $('#first-capture').onclick = () => captureNow(site.id); $('#first-capture').insertAdjacentHTML('afterend','<button class="text-button" id="import-empty">직접 캡처한 화면 가져오기</button>'); $('#import-empty').onclick = () => openImport(site); }
  $('#schedule-help').onclick = openHelp;
  $('#schedule-config').onclick = () => { openSettings(site); $('#settings-schedule-mode').focus(); };
  $('#daily').onchange = async event => {
    const input = event.target, value = input.checked; input.disabled = true;
    try { await api(`/api/sites/${site.id}/schedule`, 'PATCH', {daily:value}); await refresh(true); toast(value ? `${scheduleLabel(site)}${scheduleOf(site).schedule_mode==='daily_time' ? ' (한국 시간)' : ''} 자동으로 기록해요.` : '수동 기록으로 바꿨어요. 원할 때 직접 촬영할 수 있어요.'); }
    catch (error) { input.checked = !value; toast(error.message); }
    finally { input.disabled = false; }
  };
  $('#show-site-activity').onclick=()=>openActivity(site.id);
  $('#delete-site').onclick = () => openDelete(site);
  $('#share-link').onclick = async () => {
    syncLocation();
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(location.href);
      else {
        const area = document.createElement('textarea'); area.value = location.href; area.style.cssText = 'position:fixed;left:-9999px'; document.body.append(area); area.select();
        const copied = document.execCommand('copy'); area.remove(); if (!copied) throw new Error('copy failed');
      }
      toast('현재 기록을 여는 링크를 복사했어요.');
    } catch { toast('자동 복사가 지원되지 않아요. 주소창의 링크를 복사해 주세요.'); }
  };
  if (openMenuId) { const menu = document.getElementById(openMenuId); if (menu) menu.open = true; }
  mountChangeTools(site,activeRecord);
  mountCalendar(site,{api,esc,formatDate,localDay,initialDay:timelineDay || (activeRecord ? localDay(activeRecord.created_at) : ''),onDay:day=>{timelineDay=day;timelinePage=0;const current=sites.find(s=>s.id===site.id),record=current.captures.find(c=>localDay(c.created_at)===day);if(record){if(mode!=='single' && compareTarget==='before')chooseBefore(record.id);else chooseAfter(record.id);}else renderViewer(current);},onCapture:id=>{if(mode!=='single' && compareTarget==='before')chooseBefore(id);else chooseAfter(id);if(mobileNavigation.matches && $('#record-browser').open)$('#record-browser').close();},onRetry:()=>captureNow(site.id)});
  if (!latest) { if($('#record-browser').open)$('#record-browser').close(); refineWorkspaceControls(site); if (focused) document.getElementById(focused)?.focus({preventScroll:true}); return; }
  $('#capture-stage').insertAdjacentHTML('beforeend', '<button type="button" class="secondary fullscreen-exit" id="exit-fullscreen">⤢ 전체 화면 닫기</button>');
  $('#exit-fullscreen').onclick = () => document.exitFullscreen();
  $('#inspect-image').onclick = () => openInspector(site);
  $('#import-image').onclick = () => openImport(site);
  $('#delete-record').onclick = () => openRecordDelete(site, activeRecord);
  $('#single-mode').onclick = () => setMode('single'); $('#compare-mode').onclick = () => setMode('compare'); $('#split-mode').onclick = () => setMode('split'); $('#diff-mode').onclick = () => setMode('diff');
  $('#after-select').onchange = event => chooseAfter(event.target.value);
  if ($('#before-select')) $('#before-select').onchange = event => chooseBefore(event.target.value);
  if ($('#swap-records')) $('#swap-records').onclick = () => { [previous,after] = [after,previous]; ratio = 50; syncLocation(); renderViewer(site); };
  function setRatio(value) {
    ratio = Number(value); $('.before-image').style.clipPath = `inset(0 ${100-ratio}% 0 0)`; $('.divider').style.left = `${ratio}%`;
    $('#compare-slider').value = ratio; $('#compare-slider').setAttribute('aria-valuetext',`왼쪽 기록 ${ratio}%`);
  }
  $('#compare-slider')?.addEventListener('input', event => setRatio(event.target.value));
  if ($('#reset-slider')) $('#reset-slider').onclick = () => { setRatio(50); $('#compare-slider').focus(); };
  const chooseTarget=id=>compare && compareTarget==='before' ? chooseBefore(id) : chooseAfter(id);
  $('#older-record').onclick=()=>chooseTarget(captures[activePosition+1].id);
  $('#newer-record').onclick=()=>chooseTarget(captures[activePosition-1].id);
  $('#latest-record').onclick=()=>chooseTarget(captures[0].id);
  $('#browse-records').onclick=openRecordBrowser;
  $('#expand-view').onclick = async () => { try { await $('#capture-stage').requestFullscreen(); } catch { toast('이 브라우저에서는 전체 화면을 지원하지 않아요. PNG 저장으로 원본을 확인할 수 있어요.'); } };
  const importantFilter = document.createElement('button'); importantFilter.id='important-only'; importantFilter.className='secondary small'; importantFilter.textContent='★ 중요 기록만'; importantFilter.setAttribute('aria-pressed',String(importantOnly)); $('.timeline-controls').prepend(importantFilter);
  importantFilter.onclick=()=>{importantOnly=!importantOnly;timelinePage=0;renderViewer(site);$('#important-only')?.focus({preventScroll:true});};
  $('#timeline-date').onchange = event => { timelineDay = event.target.value; timelinePage = 0; renderViewer(site); };
  for (const id of ['clear-date','empty-clear-date']) if ($(`#${id}`)) $(`#${id}`).onclick = () => { timelineDay = ''; if (id === 'empty-clear-date') { importantOnly = false; changeFilter='all'; } timelinePage = 0; renderViewer(site); };
  if ($('#target-before')) $('#target-before').onclick = () => { compareTarget = 'before';positionTimeline(site,previous); syncLocation(); renderViewer(site);revealTimelineRecord(previous); };
  if ($('#target-after')) $('#target-after').onclick = () => { compareTarget = 'after';positionTimeline(site,after); syncLocation(); renderViewer(site);revealTimelineRecord(after); };
  if ($('#timeline-prev')) $('#timeline-prev').onclick = () => { timelinePage--; renderViewer(site); };
  if ($('#timeline-next')) $('#timeline-next').onclick = () => { timelinePage++; renderViewer(site); };
  $$('.moment').forEach(el => el.onclick = () => { if(compare && compareTarget === 'before')chooseBefore(el.dataset.capture);else chooseAfter(el.dataset.capture);if(mobileNavigation.matches && $('#record-browser').open)$('#record-browser').close(); });
  $$('.canvas-wrapper img').forEach(img => img.addEventListener('error', () => { if (!$('.image-load-error')) { const message = document.createElement('p'); message.className = 'image-load-error'; message.textContent = '화면 이미지를 불러오지 못했어요. 페이지를 새로고침해 주세요.'; $('#capture-stage').append(message); } }));
  if (mode === 'diff') mountDiff(old,latest);
  mountRecordTools(site,{activeRecord,recordLabel:targetLabel,api,refresh,toast,render:()=>renderViewer(sites.find(s=>s.id===site.id)),esc,formatDate,localDay});
  arrangeRecordWorkspace();
  if ($('.timeline')) { $('.timeline').scrollLeft = scrollLeft; $('.timeline').scrollTop = timelineTop; }
  refineWorkspaceControls(site);
  if (focused) document.getElementById(focused)?.focus({preventScroll:true});
}
document.addEventListener('click', event => {
  for (const menu of $$('.action-menu[open]')) {
    if (!menu.contains(event.target) || (!$('dialog[open]') && event.target.closest('.menu-panel button,.menu-panel a'))) menu.open = false;
  }
});
for (const dialog of $$('dialog')) dialog.addEventListener('close', () => {
  const menu = $('.action-menu[open]');
  if (menu && (menu.contains(document.activeElement) || document.activeElement === document.body)) { menu.open = false; menu.querySelector('summary').focus({preventScroll:true}); }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || $('dialog[open]')) return;
  const menu = $('.action-menu[open]');
  if (menu) { menu.open = false; menu.querySelector('summary').focus(); event.preventDefault(); }
});
function connectionState(offline) {
  $('#connection-banner').hidden = !offline;
  $('#connection').classList.toggle('offline', offline);
  $('#connection').innerHTML = `<span class="status-dot"></span> ${offline ? '연결 끊김' : '연결됨'}`;
  if (offline && !loaded) {
    $('#connection-banner span').textContent = '서버에 연결할 수 없어요. 서버 실행 상태와 네트워크를 확인해 주세요.';
    $('#archive').innerHTML = '<div class="empty"><h3>아카이브를 불러오지 못했어요</h3><p>연결이 돌아오면 자동으로 다시 불러와요.</p><button class="secondary" id="retry-load">다시 시도</button></div>';
    $('#archive').setAttribute('aria-busy','false'); $('#retry-load').onclick = () => refresh(true);
  }
}
async function refresh(force = false) {
  if (refreshing) { if (force) { await new Promise(resolve => refreshWaiters.push(resolve)); return refresh(true); } return; }
  refreshing = true;
  try {
    const value = await api('/api/sites');
    // Leave fullscreen's DOM intact. Pick up fresh state immediately on exit.
    if (document.fullscreenElement) return;
    for (const site of value.sites) {
      const prior = sites.find(s => s.id === site.id);
      if (prior?.capturing && !site.capturing) {
        if (site.captures.length > prior.captures.length) {
          if (selected === site.id && !$('#record-menu[open]') && (!after || after === prior.captures[0]?.id)) { previous = prior.captures[0]?.id || ''; after = site.captures[0].id; }
          toast(`${hostName(site)}의 새 기록을 저장했어요.`);
        } else if (site.error) toast(`${hostName(site)} 촬영을 완료하지 못했어요. 상세 안내를 확인해 주세요.`);
      }
    }
    const next = JSON.stringify(value); loaded = true;
    if (force || next !== snapshot) { sites = value.sites; snapshot = next; render(); if ($('#settings-dialog').open) updateSettingsSchedule(); }
    connectionState(false);updateNextCaptureTimes();
    if (disconnected) toast('서버에 다시 연결했어요. 기록을 업데이트했어요.');
    disconnected = false;
  } catch (error) { console.error('Rewind refresh:', error); disconnected = true; connectionState(true); }
  finally { refreshing = false; refreshWaiters.splice(0).forEach(resolve => resolve()); }
}
let importSite = null, importImage = null, importGeneration = 0, importSaving = false;
function openImport(site) {
  if (importSaving) { toast('진행 중인 화면 저장이 끝난 뒤 다시 가져와 주세요.'); return; }
  importGeneration++;
  importSite = site; importImage = null;
  $('#import-file').value = ''; $('#import-preview').hidden = true;
  $('#import-size').textContent = ''; $('#import-error').hidden = true;
  $('#import-pause').checked = /HTTP 403/.test(site.error || '');
  $('#import-open-site').href = site.url; $('#save-import').disabled = true;
  $('#import-dialog').showModal();
}
function importError(message) { $('#import-error').textContent = message; $('#import-error').hidden = !message; }
async function prepareImport(file) {
  if (importSaving) return;
  const generation = ++importGeneration;
  importImage = null; $('#save-import').disabled = true; $('#import-preview').hidden = true; importError('');
  if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type)) { importError('PNG, JPG 또는 WebP 스크린샷을 선택해 주세요.'); return; }
  if (file.size > 15*1024*1024) { importError('15 MB 이하의 이미지를 선택해 주세요.'); return; }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    if (generation !== importGeneration || !$('#import-dialog').open) return;
    const canvas = document.createElement('canvas'); canvas.width = 1440; canvas.height = 1000;
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0,0,1440,1000);
    const scale = Math.min(1440/bitmap.width,1000/bitmap.height);
    context.drawImage(bitmap,(1440-bitmap.width*scale)/2,0,bitmap.width*scale,bitmap.height*scale);
    importImage = canvas.toDataURL('image/png');
    $('#import-preview').src = importImage; $('#import-preview').hidden = false;
    $('#import-size').textContent = `원본 ${bitmap.width} × ${bitmap.height} → 1440 × 1000에 비율을 유지해 저장`;
    $('#save-import').disabled = false;
  } catch { if (generation === importGeneration && $('#import-dialog').open) importError('이미지를 읽지 못했어요. 파일을 다시 선택해 주세요.'); }
  finally { bitmap?.close(); }
}
$('#close-import').onclick = () => $('#import-dialog').close();
$('#import-file').onchange = event => prepareImport(event.target.files[0]);
$('#upload-drop').addEventListener('dragover', event => { event.preventDefault(); $('#upload-drop').classList.add('drag-over'); });
$('#upload-drop').addEventListener('dragleave', () => $('#upload-drop').classList.remove('drag-over'));
$('#upload-drop').addEventListener('drop', event => { event.preventDefault(); $('#upload-drop').classList.remove('drag-over'); prepareImport(event.dataTransfer.files[0]); });
document.addEventListener('paste', event => {
  if (!$('#import-dialog').open) return;
  const file = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'))?.getAsFile();
  if (file) { event.preventDefault(); prepareImport(file); }
});
$('#save-import').onclick = async () => {
  if (!importImage || !importSite || importSaving) return;
  const targetSite = importSite, targetImage = importImage;
  importSaving = true; $('#import-file').disabled = true; $('#import-pause').disabled = true;
  const button = $('#save-import'); button.disabled = true; button.textContent = '저장 중…'; importError('');
  try {
    const result = await api(`/api/sites/${targetSite.id}/import`, 'POST', {image:targetImage,pause_daily:$('#import-pause').checked});
    $('#import-dialog').close(); await refresh(true); if (selected === targetSite.id) { after = result.id; compareTarget = 'after'; timelineDay = ''; timelineInitialized = false; syncLocation(); render(); } toast('직접 가져온 화면을 기록했어요.');
  } catch (error) { importError(error.message); }
  finally { importSaving = false; $('#import-file').disabled = false; $('#import-pause').disabled = false; button.disabled = !importImage; button.textContent = '이 화면 기록하기'; }
};

function openInspector(site) {
  inspectorSite = site;
  $('#inspector-title').textContent = site.title;
  $('#inspector-source').innerHTML = site.captures.map(record => `<option value="${record.id}" ${record.id === (mode !== 'single' && compareTarget === 'before' ? previous : after) ? 'selected' : ''}>${formatDate(record.created_at)}</option>`).join('');
  rememberModal($('#inspector-dialog'));$('#inspector-dialog').showModal();
  showInspectorRecord();
}
function showInspectorRecord() {
  const record = inspectorSite?.captures.find(item => item.id === $('#inspector-source').value);
  if (!record) return;
  const image = $('#inspector-image'); image.src = record.image;
  image.alt = `${record.title} · ${formatDate(record.created_at)}`;
  $('#inspector-date').textContent = formatDate(record.created_at);
  $('#inspector-download').href = record.image;
  $('#inspector-download').download = `rewind-${hostName(inspectorSite)}-${record.id}.png`;
  image.onload=()=>setInspectorZoom(inspectorZoom);
  inspectorZoom = null; setInspectorZoom(null);
  $('#inspector-viewport').scrollTo(0,0);
}
function setInspectorZoom(value) {
  const viewport = $('#inspector-viewport'), image = $('#inspector-image');
  const record=inspectorSite?.captures.find(c=>c.id===$('#inspector-source').value);
  const naturalWidth=record?.width || image.naturalWidth || 1440, naturalHeight=record?.height || image.naturalHeight || 1000, aspect=naturalWidth/naturalHeight;
  const oldWidth = image.getBoundingClientRect().width || naturalWidth;
  const centerX = (viewport.scrollLeft + viewport.clientWidth/2)/oldWidth;
  const centerY = (viewport.scrollTop + viewport.clientHeight/2)/(oldWidth/aspect);
  inspectorZoom = value === null ? null : Math.min(3,Math.max(.25,value));
  const width = inspectorZoom === null ? Math.max(16,Math.min(naturalWidth,viewport.clientWidth-32,(viewport.clientHeight-32)*aspect)) : naturalWidth*inspectorZoom;
  image.style.width = `${width}px`;
  $('#zoom-value').textContent = inspectorZoom === null ? '맞춤' : `${Math.round(inspectorZoom*100)}%`;
  $('#zoom-out').disabled = inspectorZoom !== null && inspectorZoom <= .25;
  $('#zoom-in').disabled = inspectorZoom !== null && inspectorZoom >= 3;
  viewport.scrollLeft = Math.max(0,centerX*width-viewport.clientWidth/2);
  viewport.scrollTop = Math.max(0,centerY*(width/aspect)-viewport.clientHeight/2);
}
function zoomStep(direction) {
  const current = inspectorZoom ?? $('#inspector-image').getBoundingClientRect().width/1440;
  const steps = [.25,.5,.75,1,1.25,1.5,2,3];
  setInspectorZoom(direction > 0 ? steps.find(value => value > current+.01) ?? 3 : [...steps].reverse().find(value => value < current-.01) ?? .25);
}
$('#close-inspector').onclick = () => $('#inspector-dialog').close();
$('#inspector-source').onchange = showInspectorRecord;
$('#zoom-in').onclick = () => zoomStep(1);
$('#zoom-out').onclick = () => zoomStep(-1);
$('#zoom-fit').onclick = () => setInspectorZoom(null);
$('#zoom-actual').onclick = () => setInspectorZoom(1);
window.addEventListener('resize', () => { if ($('#inspector-dialog').open && inspectorZoom === null) setInspectorZoom(null); });
const inspectorViewport = $('#inspector-viewport');
let pan = null;
inspectorViewport.addEventListener('pointerdown', event => {
  if (event.pointerType !== 'mouse' || event.button !== 0) return;
  pan = {x:event.clientX,y:event.clientY,left:inspectorViewport.scrollLeft,top:inspectorViewport.scrollTop};
  inspectorViewport.setPointerCapture(event.pointerId); inspectorViewport.classList.add('panning'); event.preventDefault();
});
inspectorViewport.addEventListener('pointermove', event => {
  if (!pan) return;
  inspectorViewport.scrollLeft = pan.left+pan.x-event.clientX;
  inspectorViewport.scrollTop = pan.top+pan.y-event.clientY;
});
for (const name of ['pointerup','pointercancel','lostpointercapture']) inspectorViewport.addEventListener(name, () => { pan = null; inspectorViewport.classList.remove('panning'); });
inspectorViewport.addEventListener('wheel', event => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault(); zoomStep(event.deltaY < 0 ? 1 : -1);
}, {passive:false});
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if ($('dialog[open]') || document.fullscreenElement || event.target.closest('input,select,textarea,button,a,summary,[contenteditable="true"]')) return;
  const key = event.key.toLowerCase();
  if (key === '?') { event.preventDefault(); openHelp(); }
  else if (key === 'n') { event.preventDefault(); openAdd(); }
  else if (key === '/') { event.preventDefault(); if (selected) goHome({focusSearch:true}); $('#search').focus(); }
  else if (selected && ['arrowleft','arrowright','c'].includes(key)) {
    const site = sites.find(item => item.id === selected), position = site?.captures.findIndex(item => item.id === (mode!=='single' && compareTarget==='before' ? previous : after));
    if (!site) return;
    if (key === 'c' && site.captures.length > 1) { event.preventDefault(); setMode(mode === 'single' ? 'compare' : 'single'); }
    else {
      const record = site.captures[position + (key === 'arrowleft' ? 1 : -1)];
      if (record) { event.preventDefault(); if(mode!=='single' && compareTarget==='before')chooseBefore(record.id);else chooseAfter(record.id); }
    }
  }
});

await refresh(true);
setInterval(() => { if (!document.hidden) refresh(); }, 2500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) refresh(true); });

// Classification is metadata only: filtering never starts captures or rewrites records.
function organizationMarkup(site) {
  const labels=[site.group_name,...(site.tags || []).map(tag=>'#'+tag)].filter(Boolean);
  return labels.length ? `<span class="site-classification" title="${esc(labels.join(' · '))}">${labels.slice(0,3).map(label=>`<span>${esc(label)}</span>`).join('')}${labels.length>3 ? `<span>+${labels.length-3}</span>` : ''}</span>` : '';
}
function renderOrganizationFilters() {
  for (const [id,values,current,label] of [
    ['group-filter',sites.map(s=>s.group_name).filter(Boolean),groupFilter,'모든 그룹'],
    ['tag-filter',sites.flatMap(s=>s.tags || []),tagFilter,'모든 태그']
  ]) {
    const options=[...new Set([...values,...(current ? [current] : [])])].sort((a,b)=>a.localeCompare(b,'ko'));
    const select=$('#'+id);
    select.innerHTML=`<option value="">${label}</option>`+options.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
    select.value=current;
  }
  $('#clear-organization').hidden=!groupFilter && !tagFilter;
  $('.organization-filters').hidden=!groupFilter && !tagFilter && !sites.some(s=>s.group_name || s.tags?.length);
}
$('#group-filter').onchange=event=>{groupFilter=event.target.value;syncLocation();renderArchive();};
$('#tag-filter').onchange=event=>{tagFilter=event.target.value;syncLocation();renderArchive();};
$('#clear-organization').onclick=()=>{groupFilter='';tagFilter='';syncLocation();renderArchive();$('#group-filter').focus();};

function mountChangeTools(site, activeRecord) {
  const names={changed:'본문 변경 후보',unchanged:'본문 동일',new:'첫 분석 기록',unavailable:'분석 없음'};
  if ($('.timeline-controls')) {
    const label=document.createElement('label');label.className='change-filter';
    label.innerHTML=`변경 찾기 <select id="change-filter" aria-label="기록 변경 필터"><option value="all">모든 기록</option>${Object.entries(names).map(([value,name])=>`<option value="${value}">${name} (${site.captures.filter(c=>(c.content_change || 'unavailable')===value).length})</option>`).join('')}</select>`;
    $('.timeline-controls').append(label);$('#change-filter').value=changeFilter;
    $('#change-filter').onchange=event=>{changeFilter=event.target.value;timelinePage=0;renderViewer(site);$('#change-filter')?.focus({preventScroll:true});};
  }
  if (!activeRecord || !$('.viewer-note')) return;
  const kind=activeRecord.content_change || 'unavailable';
  const baseline=site.captures.find(c=>c.id===activeRecord.compared_capture_id);
  const panel=document.createElement('details');panel.className='content-analysis';
  panel.innerHTML=`<summary><span class="analysis-state ${kind==='changed' ? 'changed' : ''}">${esc(names[kind] || names.unavailable)}</span><span>본문 분석 안내</span></summary><p>${esc(activeRecord.content_summary || '이 기록에는 비교할 본문 텍스트 정보가 없어요. 새로 촬영한 기록부터 분석해요.')}</p>${baseline ? `<p>비교 기준: ${esc(formatDate(baseline.created_at))}</p><button class="secondary small" id="compare-content-baseline">기준 기록과 비교</button>` : activeRecord.compared_capture_id ? '<p>비교 기준 기록이 삭제되어 현재 열 수 없어요. 촬영 당시 분석 결과는 유지해요.</p>' : ''}${activeRecord.content_excerpt ? `<blockquote>${esc(activeRecord.content_excerpt)}</blockquote>` : ''}<p class="form-note">촬영 시 렌더링된 본문 텍스트를 비교해요. 스크린샷 범위 밖의 본문도 포함될 수 있어요. 광고·시각·동적 문구도 후보에 포함될 수 있어요. 이미지 변화나 실제 의미의 변화까지 판단하지는 않아요. 기존 기록과 직접 가져온 이미지는 분석하지 않아요.</p>`;
  $('.viewer-note').after(panel);
  if ($('#compare-content-baseline')) $('#compare-content-baseline').onclick=()=>{previous=baseline.id;after=activeRecord.id;mode='compare';compareTarget='after';syncLocation();renderViewer(site);$('#capture-stage')?.scrollIntoView({block:'nearest'});};
  for (const moment of $$('.moment')) {
    const record=site.captures.find(c=>c.id===moment.dataset.capture);
    if(record?.content_change==='changed') {const tag=document.createElement('span');tag.className='moment-change';tag.textContent='본문 변경 후보';moment.append(tag);}
  }
}

let activityGeneration=0, activityOffset=0, activityRows=[];
function openActivity(siteId='') {
  const fromNavigation=navigationOpen;
  setNavigation(false);
  if(fromNavigation) $('#activity-dialog').addEventListener('close',()=>{if(mobileNavigation.matches && $('#activity-dialog').dataset.completed!=='true')$('#mobile-menu').focus();},{once:true});
  $('#activity-site').innerHTML='<option value="">모든 사이트</option>'+sites.map(s=>`<option value="${s.id}">${esc(s.title)}</option>`).join('');
  $('#activity-site').value=siteId;rememberModal($('#activity-dialog'));$('#activity-dialog').showModal();$('#close-activity').focus();loadActivity();
}
$('#open-activity').onclick=()=>openActivity();
$('#close-activity').onclick=()=>$('#activity-dialog').close();
$('#activity-dialog').addEventListener('close',()=>{activityGeneration++;});
$('#activity-status').onchange=$('#activity-site').onchange=()=>loadActivity();
$('#refresh-activity').onclick=()=>loadActivity();
$('#activity-more').onclick=()=>loadActivity(true);
async function loadActivity(append=false) {
  const generation=++activityGeneration;
  if(!append) {activityRows=[];activityOffset=0;$('#activity-results').innerHTML='<p role="status">촬영 이력을 불러오는 중…</p>';}
  $('#activity-more').disabled=true;$('#activity-results').setAttribute('aria-busy','true');
  const params=new URLSearchParams({limit:'50',offset:String(activityOffset),status:$('#activity-status').value});
  if($('#activity-site').value)params.set('site_id',$('#activity-site').value);
  try {
    const result=await api('/api/attempts?'+params);
    if(generation!==activityGeneration || !$('#activity-dialog').open)return;
    const seen=new Set(activityRows.map(row=>row.id));
    activityRows.push(...(result.attempts || []).filter(row=>!seen.has(row.id)));activityOffset=result.next_offset ?? activityRows.length;
    const queue=result.queued || [];
    $('#activity-results').innerHTML=(queue.length ? `<div class="activity-queue">대기 중 ${queue.length}개 · ${queue.map(item=>esc(item.site_title)).join(', ')}</div>` : '')+(activityRows.length ? `<ol class="activity-list">${activityRows.map(attempt=>{
      const site=sites.find(s=>s.id===attempt.site_id), busy=site?.capturing || pending.has(attempt.site_id);
      return `<li><div class="attempt-heading"><strong>${esc(attempt.site_title || site?.title || '삭제된 사이트')}</strong><span class="badge ${attempt.status==='failed' ? 'error' : attempt.status==='running' ? 'busy' : 'daily'}">${({success:'저장 완료',failed:'촬영 실패',running:'촬영 중'})[attempt.status] || esc(attempt.status)}</span></div><time datetime="${esc(attempt.started_at)}">${esc(formatDate(attempt.started_at))}</time>${attempt.finished_at ? `<span class="attempt-duration"> · ${Math.max(0,Math.round((Date.parse(attempt.finished_at)-Date.parse(attempt.started_at))/1000))}초</span>` : ''}${attempt.error ? `<p class="attempt-error">${esc(friendlyError(attempt.error))}</p><details><summary>원인 상세</summary><p class="attempt-raw">${esc(attempt.error)}</p></details>` : ''}<div class="attempt-actions">${attempt.capture_id && site?.captures.some(c=>c.id===attempt.capture_id) ? `<button class="secondary small" data-attempt-record="${attempt.capture_id}" data-attempt-site="${attempt.site_id}">저장된 기록 보기</button>` : ''}${attempt.status==='failed' && site ? `<button class="secondary small" data-attempt-retry="${site.id}" ${site.paused || busy ? 'disabled' : ''}>${site.paused ? '보류 중' : busy ? '촬영 진행 중' : '다시 촬영'}</button>` : ''}</div></li>`;
    }).join('')}</ol>` : '<div class="activity-empty">이 조건에 맞는 촬영 이력이 없어요.</div>');
    $('#activity-more').hidden=!result.has_more;
    $$('[data-attempt-retry]').forEach(button=>button.onclick=async()=>{
      const id=button.dataset.attemptRetry;
      $$(`[data-attempt-retry="${CSS.escape(id)}"]`).forEach(b=>{b.disabled=true;b.textContent='촬영 요청 중';});
      await captureNow(id);if($('#activity-dialog').open)await loadActivity();
    });
    $$('[data-attempt-record]').forEach(button=>button.onclick=()=>{
      $('#activity-dialog').dataset.completed='true';$('#activity-dialog').close();selectSite(button.dataset.attemptSite);chooseAfter(button.dataset.attemptRecord);
    });
  } catch(error) {
    if(generation===activityGeneration) {$('#activity-results').innerHTML=`<p class="error-text" role="alert">${esc(error.message)}</p><p>새로고침으로 다시 시도하세요.</p>`;$('#activity-more').hidden=true;}
  } finally {
    if(generation===activityGeneration){$('#activity-results').setAttribute('aria-busy','false');$('#activity-more').disabled=false;}
  }
}


function arrangeRecordWorkspace() {
  const workspace=$('.viewer-workspace'),timeline=$('.timeline-section');
  if(!workspace || !timeline)return;
  const layout=document.createElement('div');layout.className='viewer-layout';
  const primary=document.createElement('div');primary.className='viewer-primary';
  const rail=document.createElement('aside');rail.className='viewer-rail';rail.setAttribute('aria-label','기록 탐색과 촬영 설정');
  workspace.before(layout);layout.append(primary,rail);primary.append(workspace);
  for(const selector of ['.record-metadata','.content-analysis']) {const node=$(selector);if(node)primary.append(node);}
  rail.append(timeline);
  for(const selector of ['#record-calendar','#viewer-schedule']) {const node=$(selector);if(node)rail.append(node);}
  const trigger=$('#browse-records');
  trigger.className='secondary small record-browser-trigger';const count=sites.find(s=>s.id===selected)?.captures.length || 0;
  trigger.innerHTML=`<span class="record-trigger-full">기록 선택 (${count})</span><span class="record-trigger-short" aria-hidden="true">기록 ${count}</span>`;trigger.setAttribute('aria-label',`기록 ${count}개 탐색`);
  trigger.setAttribute('aria-haspopup',mobileNavigation.matches?'dialog':'false');
  trigger.setAttribute('aria-controls',mobileNavigation.matches?'record-browser':'timeline-heading');
  $('.timeline-heading').id='timeline-heading';
  $('.image-actions').prepend(trigger);
  if($('#record-browser').open)$('#record-browser-content').append(rail);
}
function openRecordBrowser() {
  if(mobileNavigation.matches) {
    const rail=$('.viewer-rail');if(!rail)return;
    rememberModal($('#record-browser'));$('#record-browser-content').append(rail);
    $('#record-browser').showModal();$('#close-records').focus();revealTimelineRecord(mode!=='single' && compareTarget==='before' ? previous : after);
  } else {
    const heading=$('.timeline-heading');heading.tabIndex=-1;heading.focus({preventScroll:true});
    if(!matchMedia('(min-width:1100px)').matches)heading.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});
  }
}
$('#close-records').onclick=()=>$('#record-browser').close();
$('#record-browser').addEventListener('close',()=>{
  const rail=$('#record-browser .viewer-rail');if(rail && $('.viewer-layout'))$('.viewer-layout').append(rail);
});
mobileNavigation.addEventListener('change',()=>{if($('#record-browser').open)$('#record-browser').close();});

function arrangeArchiveToolbar() {
  const button=$('#capture-visible'),parent=mobileNavigation.matches ? $('.section-tools') : $('.archive-filters');
  if(button.parentElement!==parent)parent.append(button);
}
mobileNavigation.addEventListener('change',arrangeArchiveToolbar);
