export function monthRange(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0,4)) < 1970) throw new Error('올바른 연월을 선택해 주세요.');
  const [year,index]=month.split('-').map(Number);
  return {from:new Date(year,index-1,1).toISOString(),to:new Date(year,index,1).toISOString()};
}
export function monthCells(month) {
  monthRange(month);
  const [year,index]=month.split('-').map(Number), offset=new Date(year,index-1,1).getDay(), count=new Date(year,index,0).getDate();
  return Array.from({length:42},(_,i)=>i>=offset && i<offset+count ? `${month}-${String(i-offset+1).padStart(2,'0')}` : null);
}
let state={site:null,open:false,month:'',day:''};
const cache=new Map();

export function mountCalendar(site,{api,esc,formatDate,localDay,onDay,onCapture,onRetry,initialDay}) {
  if(state.site!==site.id) state={site:site.id,open:false,month:(initialDay || localDay(Date.now())).slice(0,7),day:initialDay || localDay(Date.now())};
  const details=document.createElement('details'); details.id='record-calendar';details.className='record-calendar';details.open=state.open;
  details.innerHTML=`<summary>기록 달력 <span>저장한 기록 · 촬영 실패 이력</span></summary><div class="calendar-content"><div class="calendar-navigation"><button class="secondary small" id="calendar-prev" aria-label="이전 달">←</button><label class="sr-only" for="calendar-month">조회할 달</label><input type="month" id="calendar-month" value="${state.month}" min="1970-01"><button class="secondary small" id="calendar-next" aria-label="다음 달">→</button><button class="text-button" id="calendar-today">오늘</button></div><p class="calendar-legend"><span>● 저장한 기록</span><span>▲ 촬영 실패</span><span>◷ 촬영 중</span></p><div id="calendar-status" role="status"></div><div class="calendar-grid" id="calendar-grid" aria-label="촬영 날짜"></div><div class="calendar-day-events" id="calendar-day-events"></div><p class="form-note">날짜는 이 기기 기준이에요. 실패 이력은 기능 추가 이후부터 누적하며, 이전 실패는 마지막으로 확인된 건만 표시해요.</p></div>`;
  const timeline=document.querySelector('.timeline-section');
  if(timeline) timeline.before(details);else document.querySelector('#viewer').append(details);
  const $=selector=>details.querySelector(selector);
  const signature=`${site.captures.length}:${site.last_attempt}:${site.error}:${site.capturing}`;
  let revision=0, events=[];
  function renderDays(focusDay=false) {
    const weekdays=['일','월','화','수','목','금','토'];
    const grouped=new Map();for(const event of events) {const day=localDay(event.at);if(!grouped.has(day))grouped.set(day,[]);grouped.get(day).push(event);}
    $('#calendar-grid').innerHTML=weekdays.map(label=>`<span class="calendar-weekday">${label}</span>`).join('')+monthCells(state.month).map(day=>{
      if(!day)return '<span class="calendar-blank" aria-hidden="true"></span>';
      const entries=grouped.get(day)||[],count=entries.filter(e=>e.type==='capture').length,failed=entries.filter(e=>e.type==='failed').length,running=entries.some(e=>e.type==='running');
      return `<button class="calendar-day ${day===localDay(Date.now()) ? 'is-today' : ''}" id="calendar-day-${day}" data-day="${day}" aria-pressed="${day===state.day}" aria-label="${day}, 저장 ${count}개, 실패 ${failed}회${running ? ', 촬영 중' : ''}"><span>${Number(day.slice(-2))}</span><span class="calendar-marks">${count ? `<i class="saved">● ${count}</i>` : ''}${failed ? `<i class="failed">▲ ${failed}</i>` : ''}${running ? '<i>◷</i>' : ''}</span></button>`;
    }).join('');
    for(const button of details.querySelectorAll('[data-day]')) button.onclick=()=>{
      state.day=button.dataset.day;renderDays(true);onDay(state.day);
    };
    const entries=grouped.get(state.day)||[];
    $('#calendar-day-events').innerHTML=`<h3>${esc(state.day)} <span>${entries.length}건</span></h3>${entries.length ? `<ul>${entries.map(event=>event.type==='capture' ? `<li><button class="calendar-record" data-record="${esc(event.id)}"><img src="${esc(event.image)}" alt="" loading="lazy"><span><strong>${esc(formatDate(event.at))}</strong><small>${event.source==='import' ? '직접 가져옴' : event.capture_mode==='full_page' ? '전체 페이지' : '상단 화면'}${event.important ? ' · ★ 중요' : ''}</small></span><span aria-hidden="true">↗</span></button></li>` : `<li class="calendar-attempt ${event.type==='failed' ? 'failed' : ''}"><strong>${esc(formatDate(event.at))} · ${event.type==='failed' ? '촬영 실패' : '촬영 중'}</strong>${event.error ? `<p>${esc(event.error)}</p>` : ''}</li>`).join('')}</ul>` : '<p class="form-note">이 날짜에는 저장된 기록이나 촬영 시도 이력이 없어요.</p>'}${entries.some(e=>e.type==='failed') ? `<button id="calendar-retry" class="secondary small" ${site.paused || site.capturing ? 'disabled' : ''}>${site.paused ? '기록 보류 중' : site.capturing ? '촬영 중' : '지금 다시 촬영'}</button>` : ''}`;
    for(const button of details.querySelectorAll('[data-record]')) button.onclick=()=>onCapture(button.dataset.record);
    if($('#calendar-retry'))$('#calendar-retry').onclick=onRetry;
    if(focusDay)$(`#calendar-day-${state.day}`)?.focus({preventScroll:true});
  }
  async function load() {
    const current=++revision, month=state.month;
    $('#calendar-status').textContent='기록을 불러오고 있어요…';
    $('#calendar-grid').innerHTML='';$('#calendar-day-events').innerHTML='';
    try {
      const range=monthRange(month),key=`${site.id}:${month}`,stored=cache.get(key);
      let value;
      if(stored && stored.signature===signature && Date.now()-stored.at<5000)value=stored.value;
      else {
        value=await api(`/api/sites/${site.id}/history?${new URLSearchParams(range)}`);
        if(cache.size>=12)cache.delete(cache.keys().next().value);
        cache.set(key,{value,signature,at:Date.now()});
      }
      if(!details.isConnected || current!==revision)return;
      events=value.events || [];$('#calendar-status').textContent=events.length ? '' : '이 달에는 기록이 없어요.';
      renderDays();
    }catch(error){if(details.isConnected && current===revision){$('#calendar-status').textContent=error.message;$('#calendar-status').insertAdjacentHTML('beforeend',' <button id="calendar-reload" class="text-button">다시 불러오기</button>');$('#calendar-reload').onclick=load;}}
  }
  function changeMonth(month) {
    try {monthRange(month);}catch{return;}
    state.month=month;state.day=`${month}-01`;$('#calendar-month').value=month;load();
  }
  $('#calendar-month').onchange=event=>changeMonth(event.target.value);
  function shift(amount){const [year,index]=state.month.split('-').map(Number),date=new Date(year,index-1+amount,1);changeMonth(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`);}
  $('#calendar-prev').onclick=()=>shift(-1);$('#calendar-next').onclick=()=>shift(1);
  $('#calendar-today').onclick=()=>{state.day=localDay(Date.now());state.month=state.day.slice(0,7);$('#calendar-month').value=state.month;load();};
  details.ontoggle=()=>{state.open=details.open;if(details.open)load();else revision++;};
  if(state.open)load();
}
