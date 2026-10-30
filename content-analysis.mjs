import {createHash} from 'node:crypto';

export function validateOrganization(input) {
 const result = {};
 if (input.tags !== undefined) {
  if (!Array.isArray(input.tags) || input.tags.length > 20 || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 30)) throw new Error('태그는 비어 있지 않은 30자 이내 이름으로 최대 20개까지 지정해 주세요.');
  result.tags = [...new Set(input.tags.map(tag => tag.trim()))];
 }
 if (input.group_name !== undefined) {
  if (typeof input.group_name !== 'string' || input.group_name.trim().length > 60) throw new Error('그룹 이름은 60자 이내로 입력해 주세요.');
  result.group_name = input.group_name.trim();
 }
 return result;
}

export function parseTags(value) {
 try { const tags = JSON.parse(value); return Array.isArray(tags) ? tags.filter(tag => typeof tag === 'string') : []; }
 catch { return []; }
}

export function normalizeContent(text) {
 return typeof text === 'string' ? text.normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/gu,' ').trim() : '';
}

// This compares rendered text only. Layout, images, ads, and dynamic text need
// human review; no result here claims that a pixel change is meaningful.
export function analyzeContent(content, previous = null, url = '') {
 const text = normalizeContent(content?.text);
 const available = !!text && !content?.truncated;
 const hash = available ? createHash('sha256').update(text).digest('hex') : null;
 const result = {
  content_hash:hash, content_excerpt:available ? text.slice(0,240) : null,
  content_scope:content?.scope || null, content_url:url || null,
  content_change:'unavailable', content_summary:'본문 텍스트를 분석할 수 없는 기록이에요.',
  compared_capture_id:previous?.id || null,
 };
 if (!available) return result;
 if (!previous) return {...result,content_change:'new',content_summary:'처음 분석한 본문 텍스트예요.'};
 if (!previous.content_hash) return {...result,content_summary:'직전 기록에 본문 분석이 없어 변경을 비교할 수 없어요.'};
 if (previous.content_scope !== result.content_scope || previous.content_url !== result.content_url) return {...result,content_summary:'주소 또는 분석 범위가 달라 본문 변경을 비교할 수 없어요.'};
 const changed = previous.content_hash !== hash;
 return {...result,content_change:changed ? 'changed' : 'unchanged',content_summary:changed ? '직전 기록과 본문 텍스트가 달라요. 광고·시각 등 자동 갱신도 포함될 수 있어요.' : '직전 기록과 정규화한 본문 텍스트가 같아요. 이미지·배치 변화는 별도로 확인해 주세요.'};
}
