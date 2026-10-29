import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import(process.env.REWIND_PUBLIC_DIR
  ? new URL('file://' + process.env.REWIND_PUBLIC_DIR + '/view-utils.js')
  : new URL('../public/view-utils.js', import.meta.url));
const {schedulePresentation, comparisonPresentation} = module;
const NOW = Date.parse('2026-10-29T03:00:00.000Z'); // Noon in Seoul.
const minute = 60_000, hour = 60 * minute, day = 24 * hour;
const iso = value => new Date(value).toISOString();
const automatic = overrides => ({daily:1, paused:0, capturing:false,
  schedule_mode:'interval', interval_minutes:60, last_attempt:iso(NOW), ...overrides});
const record = value => ({created_at:typeof value === 'number' ? iso(value) : value});

test('schedule state precedence prevents paused, busy, and manual next-time claims', () => {
  assert.deepEqual(schedulePresentation(automatic({paused:1, capturing:true, daily:0}), NOW),
    {state:'paused', relative:'보류 중', at:null});
  assert.deepEqual(schedulePresentation(automatic({capturing:true, capture_status:'queued', daily:0}), NOW),
    {state:'busy', relative:'촬영 대기', at:null});
  assert.deepEqual(schedulePresentation(automatic({capturing:true, capture_status:'capturing'}), NOW),
    {state:'busy', relative:'촬영 중', at:null});
  assert.deepEqual(schedulePresentation(automatic({daily:0}), NOW),
    {state:'manual', relative:'직접 촬영', at:null});
});

test('first automatic attempt has no fabricated scheduled timestamp', () => {
  for (const last_attempt of [null, undefined, 'invalid']) {
    assert.deepEqual(schedulePresentation(automatic({last_attempt}), NOW),
      {state:'due', relative:'곧 촬영 예정', at:null});
  }
});

test('overdue interval preserves its true deadline, including failed attempts', () => {
  const at = NOW - 20 * minute;
  for (const error of [null, 'HTTP 403']) {
    assert.deepEqual(schedulePresentation(automatic({last_attempt:iso(at-hour), error}), NOW),
      {state:'due', relative:'예정 시각 지남', at:iso(at)});
  }
  assert.deepEqual(schedulePresentation(automatic({last_attempt:iso(NOW-hour)}), NOW),
    {state:'due', relative:'예정 시각 지남', at:iso(NOW)});
});

test('future intervals describe minutes, hours and days without zero-minute claims', () => {
  const cases = [
    [30_000, '1분 이내'], [minute, '1분 이내'], [8*minute, '8분 후'],
    [80*minute, '1시간 20분 후'], [27*hour, '1일 3시간 후'],
  ];
  for (const [remaining, relative] of cases) {
    const site = automatic({interval_minutes:2880, last_attempt:iso(NOW+remaining-2*day)});
    assert.deepEqual(schedulePresentation(site, NOW), {state:'future', relative, at:iso(NOW+remaining)});
  }
  for (const remaining of [1, 59_999, 60_001]) {
    const result = schedulePresentation(automatic({last_attempt:iso(NOW+remaining-hour)}), NOW);
    assert.equal(result.state, 'future');
    assert.doesNotMatch(result.relative, /(^|\s)0분/);
  }
});

test('minute interval and legacy hour interval use the configured attempt cadence', () => {
  assert.deepEqual(schedulePresentation(automatic({interval_minutes:5}), NOW),
    {state:'future', relative:'5분 후', at:iso(NOW+5*minute)});
  const legacy = automatic({interval_hours:3});
  delete legacy.interval_minutes;
  assert.deepEqual(schedulePresentation(legacy, NOW),
    {state:'future', relative:'3시간 후', at:iso(NOW+3*hour)});
});

test('daily clock uses the most recent due Seoul slot instead of a clamped now', () => {
  const site = automatic({schedule_mode:'daily_time', daily_time:'09:00',
    last_attempt:'2026-10-28T00:00:00.000Z'});
  assert.deepEqual(schedulePresentation(site, NOW),
    {state:'due', relative:'예정 시각 지남', at:'2026-10-29T00:00:00.000Z'});
  assert.deepEqual(schedulePresentation({...site, last_attempt:'2026-10-29T00:00:00.000Z'}, NOW),
    {state:'future', relative:'21시간 후', at:'2026-10-30T00:00:00.000Z'});
});

test('daily clocks before their slot, at Seoul midnight, and after a failed slot', () => {
  const before = Date.parse('2026-10-28T23:52:00.000Z');
  const site = automatic({schedule_mode:'daily_time', daily_time:'09:00',
    last_attempt:'2026-10-28T00:00:00.000Z'});
  assert.deepEqual(schedulePresentation(site, before),
    {state:'future', relative:'8분 후', at:'2026-10-29T00:00:00.000Z'});
  const midnight = Date.parse('2026-10-28T15:00:00.000Z');
  assert.deepEqual(schedulePresentation({...site, daily_time:'00:00'}, midnight),
    {state:'due', relative:'예정 시각 지남', at:iso(midnight)});
  const failed = {...site, last_attempt:'2026-10-29T00:02:00.000Z', error:'Timeout'};
  assert.equal(schedulePresentation(failed, NOW).at, '2026-10-30T00:00:00.000Z');
});

test('daily presentation respects a future last attempt as the scheduler does', () => {
  const result = schedulePresentation(automatic({schedule_mode:'daily_time', daily_time:'09:00',
    last_attempt:'2026-10-31T03:00:00.000Z'}), NOW);
  assert.equal(result.state, 'future');
  assert.equal(result.at, '2026-11-01T00:00:00.000Z');
});

test('comparison labels follow chronology and update when the positions swap', () => {
  const earlier = record(NOW-15*minute), later = record(NOW);
  assert.deepEqual(comparisonPresentation(earlier, later), {
    leftLabel:'왼쪽 · 이전 기록', rightLabel:'오른쪽 · 이후 기록', gap:'15분 간격 비교',
  });
  assert.deepEqual(comparisonPresentation(later, earlier), {
    leftLabel:'왼쪽 · 이후 기록', rightLabel:'오른쪽 · 이전 기록', gap:'15분 간격 비교',
  });
});

test('comparison intervals retain useful seconds, minutes, hours and days', () => {
  for (const [distance, gap] of [
    [15_000, '15초 간격 비교'], [90*minute, '1시간 30분 간격 비교'],
    [2*day, '2일 간격 비교'],
  ]) {
    assert.equal(comparisonPresentation(record(NOW-distance), record(NOW)).gap, gap);
  }
});

test('equal or missing comparison timestamps never imply a time direction', () => {
  assert.deepEqual(comparisonPresentation(record(NOW), record(NOW)),
    {leftLabel:'왼쪽 기록', rightLabel:'오른쪽 기록', gap:'같은 시각 비교'});
  for (const invalid of [undefined, null, {}, record('invalid')]) {
    assert.deepEqual(comparisonPresentation(invalid, record(NOW)),
      {leftLabel:'왼쪽 기록', rightLabel:'오른쪽 기록', gap:'두 기록 비교'});
    assert.deepEqual(comparisonPresentation(record(NOW), invalid),
      {leftLabel:'왼쪽 기록', rightLabel:'오른쪽 기록', gap:'두 기록 비교'});
  }
});
