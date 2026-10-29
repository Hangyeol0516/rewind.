// Per-pixel RGB distance after compositing transparency onto white.
// The result measures image differences, not the meaning of page content.
export function calculateDiff(before, after, threshold = 32) {
  if (before.length !== after.length || before.length % 4) throw new Error('두 이미지의 크기가 같아야 해요.');
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) throw new Error('차이 기준이 올바르지 않아요.');
  const overlay = new Uint8ClampedArray(after.length);
  let changed = 0;
  for (let i = 0; i < after.length; i += 4) {
    let distance = 0;
    for (let c = 0; c < 3; c++) {
      const a = before[i+c] * before[i+3]/255 + 255-before[i+3];
      const b = after[i+c] * after[i+3]/255 + 255-after[i+3];
      distance = Math.max(distance,Math.abs(a-b));
    }
    if (distance > threshold) {
      changed++;
      overlay[i] = 224; overlay[i+1] = 39; overlay[i+2] = 110; overlay[i+3] = 160;
    }
  }
  return {overlay,changed,total:after.length/4};
}

let threshold = 32;
const cache = new Map();
async function pixels(url) {
  if (cache.has(url)) return cache.get(url);
  const image = new Image(); image.src = url; await image.decode();
  const result = {image};
  if (cache.size >= 2) cache.delete(cache.keys().next().value);
  cache.set(url,result); return result;
}

export function mountDiff(before, after) {
  const canvas = document.getElementById('diff-canvas');
  if (!canvas) return;
  const summary = document.getElementById('diff-summary'), select = document.getElementById('diff-threshold'), download = document.getElementById('download-diff');
  select.value = String(threshold);
  let revision = 0;
  async function draw() {
    const current = ++revision, limit = threshold;
    summary.textContent = '두 기록의 변경 부분을 계산하고 있어요…'; summary.dataset.ready = 'false';
    download.hidden = true; canvas.hidden = true;
    try {
      const [left,right] = await Promise.all([pixels(before.image),pixels(after.image)]);
      if (!canvas.isConnected || revision !== current) return;
      canvas.width = Math.max(left.image.naturalWidth,right.image.naturalWidth);
      canvas.height = Math.max(left.image.naturalHeight,right.image.naturalHeight);
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(right.image,0,0);
      context.fillStyle = 'rgba(255,255,255,0.35)'; context.fillRect(0,0,canvas.width,canvas.height);
      const scratch = [0,1,2].map(()=>document.createElement('canvas'));
      const result = {changed:0,total:canvas.width*canvas.height};
      // Compare narrow strips so tall pages do not require several full RGBA copies.
      for(let y=0;y<canvas.height;y+=256) {
        if (!canvas.isConnected || revision !== current) return;
        const height=Math.min(256,canvas.height-y);
        for(const layer of scratch) {layer.width=canvas.width;layer.height=height;}
        const inputs=[left,right].map((entry,index)=>{
          const ctx=scratch[index].getContext('2d',{willReadFrequently:true});
          ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,height);ctx.drawImage(entry.image,0,-y);
          return ctx.getImageData(0,0,canvas.width,height).data;
        });
        const strip=calculateDiff(inputs[0],inputs[1],limit);result.changed+=strip.changed;
        scratch[2].getContext('2d').putImageData(new ImageData(strip.overlay,canvas.width,height),0,0);
        context.drawImage(scratch[2],0,y);
        if(y%2048===0) await new Promise(resolve=>setTimeout(resolve,0));
      }
      if (!canvas.isConnected || revision !== current) return;
      canvas.hidden = false;
      const percent = result.changed/result.total*100, percentage = percent < 0.01 ? '0.01% 미만' : `${percent.toFixed(2)}%`;
      summary.textContent = result.changed ? `분홍색: 변경 픽셀 ${percentage} · ${result.changed.toLocaleString('ko-KR')}개` : '현재 기준에서 두 화면의 차이가 없어요.';
      if(left.image.naturalHeight!==right.image.naturalHeight || left.image.naturalWidth!==right.image.naturalWidth) summary.textContent+=' · 상단을 맞추고 빈 공간은 흰색으로 비교했어요.';
      summary.dataset.ready = 'true';
      download.href = canvas.toDataURL('image/png');
      download.download = `rewind-changes-${before.created_at.slice(0,10)}-${after.created_at.slice(0,10)}.png`;
      download.hidden = false;
    } catch (error) {
      if (!canvas.isConnected || revision !== current) return;
      summary.textContent = `변경 부분을 표시하지 못했어요. ${error.message}`; summary.dataset.ready = 'error';
    }
  }
  select.onchange = () => { threshold = Number(select.value); draw(); };
  draw();
}
