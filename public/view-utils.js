import {nextScheduledAt,scheduleOf} from './schedule.js';

const MINUTE=60000,DAY=86400000,KST=9*3600000;
function durationWords(milliseconds,seconds=false) {
  let count=seconds ? Math.max(1,Math.round(milliseconds/1000)) : Math.max(1,Math.ceil(milliseconds/MINUTE));
  if(seconds && count<60)return `${count}초`;
  if(seconds)count=Math.floor(count/60);
  const days=Math.floor(count/1440),hours=Math.floor(count%1440/60),minutes=count%60;
  return [days ? `${days}일` : '',hours ? `${hours}시간` : '',minutes ? `${minutes}분` : ''].filter(Boolean).join(' ');
}
export function schedulePresentation(site,now=Date.now()) {
  if(site.paused)return {state:'paused',relative:'보류 중',at:null};
  if(site.capturing)return {state:'busy',relative:site.capture_status==='queued' ? '촬영 대기' : '촬영 중',at:null};
  if(!site.daily)return {state:'manual',relative:'직접 촬영',at:null};
  if(!Number.isFinite(Date.parse(site.last_attempt)))return {state:'due',relative:'곧 촬영 예정',at:null};
  const next=Date.parse(nextScheduledAt(site,now));
  if(next>now)return {state:'future',relative:next-now<=MINUTE ? '1분 이내' : `${durationWords(next-now)} 후`,at:new Date(next).toISOString()};
  const config=scheduleOf(site);
  let due;
  if(config.schedule_mode==='interval')due=Date.parse(site.last_attempt)+config.interval_minutes*MINUTE;
  else {
    const local=new Date(now+KST),[hour,minute]=config.daily_time.split(':').map(Number);
    due=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),hour,minute)-KST;
    if(due>now)due-=DAY;
  }
  return {state:'due',relative:'예정 시각 지남',at:new Date(due).toISOString()};
}
export function comparisonPresentation(left,right) {
  const a=Date.parse(left?.created_at),b=Date.parse(right?.created_at);
  if(!Number.isFinite(a)||!Number.isFinite(b))return {leftLabel:'왼쪽 기록',rightLabel:'오른쪽 기록',gap:'두 기록 비교'};
  if(a===b)return {leftLabel:'왼쪽 기록',rightLabel:'오른쪽 기록',gap:'같은 시각 비교'};
  return {leftLabel:`왼쪽 · ${a<b ? '이전' : '이후'} 기록`,rightLabel:`오른쪽 · ${a<b ? '이후' : '이전'} 기록`,gap:`${durationWords(Math.abs(b-a),true)} 간격 비교`};
}
