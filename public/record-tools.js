// Selection is kept across timeline pages and background refreshes, scoped to one site.
let selectionSite = null, selecting = false, chosen = new Set(), rangeStart = '', rangeEnd = '';
const $ = selector => document.querySelector(selector);

function dialog(id, html) {
  let element = document.getElementById(id);
  if (!element) {
    element = document.createElement('dialog'); element.id = id;
    element.innerHTML = html; document.body.append(element);
  }
  return element;
}

export function mountRecordTools(site, {activeRecord, recordLabel, api, refresh, toast, render, esc, formatDate, localDay}) {
  if (activeRecord) {
    const metadata = document.createElement('div'); metadata.className = 'record-metadata';
    metadata.innerHTML = `<div class="record-metadata-actions"><span class="record-target-label">${esc(recordLabel)} · ${esc(formatDate(activeRecord.created_at))}<small class="capture-size"> · ${activeRecord.width || 1440} × ${activeRecord.height || 1000}${activeRecord.truncated ? ' · 높이 제한으로 일부 잘림' : ''}</small></span><button class="secondary small" id="important-record" aria-pressed="${!!activeRecord.important}">${activeRecord.important ? '★ 중요 기록' : '☆ 중요 표시'}</button><button class="secondary small" id="edit-record-note">${activeRecord.note ? '메모 수정' : '메모 추가'}</button></div>${activeRecord.note ? `<p class="record-note">${esc(activeRecord.note)}</p>` : ''}`;
    $('.viewer-note').after(metadata);
    $('#important-record').onclick = async event => {
      const button = event.currentTarget; button.disabled = true;
      try { await api(`/api/sites/${site.id}/captures/${activeRecord.id}`,'PATCH',{important:!activeRecord.important}); await refresh(true); toast(activeRecord.important ? '중요 표시를 해제했어요.' : '중요 기록으로 표시했어요.'); $('#important-record')?.focus({preventScroll:true}); }
      catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    };
    $('#edit-record-note').onclick = () => {
      const modal = dialog('record-note-dialog',`<form id="record-note-form"><div class="dialog-top"><h2 id="record-note-title">기록 메모</h2><button type="button" class="icon-button" id="close-record-note" aria-label="닫기">×</button></div><p id="record-note-target"></p><label class="field-label" for="record-note-input">이 기록에 남길 메모</label><textarea id="record-note-input" maxlength="1000" rows="6" placeholder="예: 홈페이지 리뉴얼 전 화면" aria-describedby="record-note-count"></textarea><p id="record-note-count" class="field-counter"></p><p id="record-note-error" class="error-text" role="alert" hidden></p><div class="dialog-actions"><button type="button" class="secondary" id="cancel-record-note">취소</button><button type="submit" class="primary" id="save-record-note">메모 저장</button></div></form>`);
      modal.setAttribute('aria-labelledby','record-note-title');
      $('#record-note-target').textContent = `${site.title} · ${formatDate(activeRecord.created_at)}`;
      const input = $('#record-note-input'), button = $('#save-record-note');
      input.value = activeRecord.note || ''; input.disabled = false; button.disabled = false;
      $('#record-note-error').hidden = true;
      input.oninput = () => { $('#record-note-count').textContent = `${input.value.length} / 1,000`; }; input.oninput();
      function close() {
        if (button.disabled) return;
        if (input.value !== (activeRecord.note || '') && !window.confirm('저장하지 않은 메모를 닫을까요?')) return;
        modal.close(); $('#edit-record-note')?.focus({preventScroll:true});
      }
      $('#close-record-note').onclick = close; $('#cancel-record-note').onclick = close;
      modal.oncancel = event => { event.preventDefault(); close(); };
      $('#record-note-form').onsubmit = async event => {
        event.preventDefault(); button.disabled = true; input.disabled = true;
        try { await api(`/api/sites/${site.id}/captures/${activeRecord.id}`,'PATCH',{note:input.value}); modal.close(); await refresh(true); toast(input.value.trim() ? '메모를 저장했어요.' : '메모를 지웠어요.'); $('#edit-record-note')?.focus({preventScroll:true}); }
        catch (error) { $('#record-note-error').textContent = error.message; $('#record-note-error').hidden = false; }
        finally { button.disabled = false; input.disabled = false; }
      };
      modal.showModal(); input.focus();
    };
  }
  if (selectionSite !== site.id) {
    selectionSite = site.id; selecting = false; chosen.clear(); rangeStart = ''; rangeEnd = '';
  }
  chosen = new Set([...chosen].filter(id => site.captures.some(c => c.id === id)));
  const tools = $('.timeline-controls');
  if (!tools) return;
  const toggle = document.createElement('button');
  toggle.id = 'select-records'; toggle.className = 'secondary small';
  toggle.textContent = selecting ? '선택 끝내기' : '여러 기록 선택';
  toggle.setAttribute('aria-pressed',String(selecting));
  tools.prepend(toggle);
  toggle.onclick = () => { selecting = !selecting; if (!selecting) chosen.clear(); render(); $('#select-records')?.focus({preventScroll:true}); };
  if (!selecting) return;
  const bar = document.createElement('div'); bar.className = 'selection-bar';
  bar.innerHTML = `<div class="selection-actions"><strong id="selection-count" role="status"></strong><button class="secondary small" id="select-page">현재 목록 선택</button><button class="text-button" id="clear-selection">선택 해제</button><button class="secondary small selection-delete" id="delete-selected">선택 삭제</button></div><div class="selection-range"><label>시작일 <input type="date" id="range-start" value="${rangeStart}"></label><span aria-hidden="true">~</span><label>종료일 <input type="date" id="range-end" value="${rangeEnd}"></label><button class="secondary small" id="select-range">기간 선택</button></div><p class="form-note">선택은 페이지를 넘겨도 유지돼요. 한 번에 최대 500개 · 기간은 이 기기의 날짜 기준이에요.</p>`;
  tools.after(bar);
  function update() {
    $('#selection-count').textContent = `${chosen.size}개 선택`;
    $('#delete-selected').disabled = !chosen.size || !!site.capturing;
    $('#delete-selected').title = site.capturing ? '촬영이 끝난 뒤 삭제할 수 있어요.' : '';
    for (const box of document.querySelectorAll('.record-checkbox')) {
      box.checked = chosen.has(box.value);
      box.closest('.moment-item').classList.toggle('is-chosen',box.checked);
      const card = box.closest('.moment-item').querySelector('.moment');
      card.setAttribute('aria-pressed',String(box.checked));
    }
  }
  function add(records) {
    const ids = new Set([...chosen,...records.map(c => c.id)]);
    if (ids.size > 500) { toast('한 번에 최대 500개를 선택할 수 있어요.'); return; }
    chosen = ids; update();
  }
  for (const card of document.querySelectorAll('.moment')) {
    const wrapper = document.createElement('div'); wrapper.className = 'moment-item';
    card.before(wrapper); wrapper.append(card);
    const label = document.createElement('label'); label.className = 'record-check-label';
    const record = site.captures.find(c => c.id === card.dataset.capture);
    label.innerHTML = `<input class="record-checkbox" type="checkbox" value="${esc(record.id)}" aria-label="${esc(formatDate(record.created_at))} 삭제 대상 선택"><span>선택</span>`;
    wrapper.prepend(label);
    const box = label.querySelector('input'); box.id = `select-${record.id}`;
    box.onchange = () => {
      if (box.checked && chosen.size >= 500) { box.checked = false; toast('한 번에 최대 500개를 선택할 수 있어요.'); return; }
      if (box.checked) chosen.add(box.value); else chosen.delete(box.value); update();
    };
    card.onclick = () => { box.checked = !box.checked; box.onchange(); };
    card.setAttribute('aria-label',`${formatDate(record.created_at)} 삭제 대상 선택`);
  }
  $('#select-page').onclick = () => add([...document.querySelectorAll('.moment')].map(el => site.captures.find(c => c.id === el.dataset.capture)));
  $('#clear-selection').onclick = () => { chosen.clear(); update(); };
  $('#range-start').onchange = event => { rangeStart = event.target.value; };
  $('#range-end').onchange = event => { rangeEnd = event.target.value; };
  $('#select-range').onclick = () => {
    if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) { toast('시작일과 종료일을 올바르게 지정해 주세요.'); return; }
    const records = site.captures.filter(c => localDay(c.created_at) >= rangeStart && localDay(c.created_at) <= rangeEnd);
    if (!records.length) return toast('해당 기간에 저장된 기록이 없어요.');
    add(records);
  };
  $('#delete-selected').onclick = () => {
    const ids = [...chosen], records = site.captures.filter(c => chosen.has(c.id));
    const modal = dialog('bulk-delete-dialog',`<h2 id="bulk-delete-title">선택한 기록을 삭제할까요?</h2><p id="bulk-delete-description"></p><p class="error-text">삭제한 기록과 메모는 복구할 수 없어요.</p><p class="error-text" id="bulk-delete-error" role="alert" hidden></p><div class="dialog-actions"><button class="secondary" id="cancel-bulk-delete" autofocus>취소</button><button class="danger" id="confirm-bulk-delete">선택 삭제</button></div>`);
    modal.setAttribute('aria-labelledby','bulk-delete-title');
    const important = records.filter(c => c.important).length;
    $('#bulk-delete-description').textContent = `‘${site.title}’에서 ${ids.length}개의 기록을 삭제합니다.${important ? ` 중요 표시한 기록 ${important}개도 포함돼요.` : ''} 사이트는 유지돼요.`;
    $('#bulk-delete-error').hidden = true;
    const button = $('#confirm-bulk-delete'); button.disabled = false; button.textContent = `${ids.length}개 삭제`;
    $('#cancel-bulk-delete').onclick = () => modal.close();
    modal.oncancel = event => { if (button.disabled) event.preventDefault(); };
    button.onclick = async () => {
      button.disabled = true; $('#cancel-bulk-delete').disabled = true; button.textContent = '삭제 중…';
      try {
        await api(`/api/sites/${site.id}/captures/delete`,'POST',{ids});
        chosen.clear(); modal.close(); await refresh(true); toast(`${ids.length}개의 기록을 삭제했어요.`);
        $('#select-records')?.focus({preventScroll:true});
      } catch (error) { $('#bulk-delete-error').textContent = error.message; $('#bulk-delete-error').hidden = false; }
      finally { button.disabled = false; $('#cancel-bulk-delete').disabled = false; button.textContent = `${ids.length}개 삭제`; }
    };
    modal.showModal();
  };
  update();
}
