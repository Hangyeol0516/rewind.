import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function normalizeUrl(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 2048) throw new Error('올바른 웹사이트 주소를 입력해 주세요.');
  const url = new URL(input.includes('://') ? input.trim() : `https://${input.trim()}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('로그인 정보가 없는 HTTP 또는 HTTPS 주소만 사용할 수 있어요.');
  url.hash = '';
  return url.href;
}

export function isPublicIp(address) {
  const ip = address.toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18,19].includes(b)));
  }
  // Only global unicast IPv6; mapped IPv4 and local ranges are excluded.
  return isIP(ip) === 6 && /^[23][0-9a-f]{3}:/.test(ip) && !ip.startsWith('2001:db8:');
}

export async function assertPublicUrl(input) {
  const url = new URL(normalizeUrl(input));
  if (url.port && !['80','443'].includes(url.port)) throw new Error('일반 웹 포트(80, 443)만 지원해요.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const results = isIP(host) ? [{address: host}] : await lookup(host, {all: true});
  if (!results.length || results.some(({address}) => !isPublicIp(address))) throw new Error('내부 네트워크 주소는 촬영할 수 없어요.');
  return url.href;
}
