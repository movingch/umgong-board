import type { SupabaseClient } from '@supabase/supabase-js';

const FONT = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif';

function renderOgImage(title: string): Promise<Blob | null> {
  const W = 1200, H = 630;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return Promise.resolve(null);

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#c8973d');
  bg.addColorStop(1, '#a97028');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(60,34,10,.28)';
  for (let i = 0; i < 1400; i++) g.fillRect((i * 7919) % W, (i * 104729) % H, 3, 3);

  const card = (cx: number, cy: number, w: number, h: number, deg: number, color: string) => {
    g.save();
    g.translate(cx, cy);
    g.rotate((deg * Math.PI) / 180);
    g.shadowColor = 'rgba(40,22,8,.45)';
    g.shadowBlur = 30;
    g.shadowOffsetY = 14;
    g.fillStyle = '#fffaf0';
    g.fillRect(-w / 2, -h / 2, w, h);
    g.shadowColor = 'transparent';
    g.fillStyle = color;
    g.fillRect(-w / 2 + 14, -h / 2 + 14, w - 28, h - 70);
    g.fillStyle = 'rgba(250,225,140,.9)';
    g.fillRect(-45, -h / 2 - 14, 90, 30);
    g.restore();
  };
  card(150, 170, 230, 250, -8, '#e8746b');
  card(1050, 170, 230, 250, 7, '#6fb1e8');
  card(140, 480, 220, 220, 6, '#8fcf7a');
  card(1060, 470, 220, 220, -6, '#b48be8');

  g.save();
  g.shadowColor = 'rgba(30,15,5,.5)';
  g.shadowBlur = 50;
  g.shadowOffsetY = 20;
  g.fillStyle = '#fffaf0';
  g.beginPath();
  g.roundRect(210, 90, 780, 450, 48);
  g.fill();
  g.restore();

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#1a1008';
  g.beginPath();
  g.roundRect(W / 2 - 80, 122, 160, 48, 24);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `800 26px ${FONT}`;
  g.fillText('생각보드', W / 2, 147);

  // 제목: 한 줄에 안 들어가면 글자를 줄이고, 그래도 넘치면 두 줄로 나눈다
  const maxW = 700;
  let size = 92;
  g.fillStyle = '#1a1008';
  const fits = (text: string) => { g.font = `900 ${size}px ${FONT}`; return g.measureText(text).width <= maxW; };
  while (size > 56 && !fits(title)) size -= 4;
  let lines = [title];
  if (!fits(title)) {
    const chars = [...title];
    let cut = chars.length;
    while (cut > 1 && !fits(chars.slice(0, cut).join(''))) cut--;
    let rest = chars.slice(cut).join('').trim();
    if (!fits(rest)) {
      const r = [...rest];
      while (r.length > 1 && !fits(`${r.join('')}…`)) r.pop();
      rest = `${r.join('')}…`;
    }
    lines = [chars.slice(0, cut).join('').trim(), rest];
  }
  g.font = `900 ${size}px ${FONT}`;
  const lineH = size * 1.15;
  const startY = 290 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => g.fillText(line, W / 2, startY + i * lineH));

  g.fillStyle = '#6b5236';
  g.font = `600 30px ${FONT}`;
  g.fillText('사진·낙서·글을 보드에 붙여 보세요', W / 2, 400);

  g.fillStyle = '#1a1008';
  g.beginPath();
  g.roundRect(W / 2 - 170, 436, 340, 72, 36);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `800 32px ${FONT}`;
  g.fillText('눌러서 참여하기', W / 2, 473);

  return new Promise((resolve) => cv.toBlob((b) => resolve(b), 'image/png'));
}

// 보드마다 한 번만 만들어 저장한다 (참여 링크 미리보기용)
export async function ensureBoardOgImage(supabase: SupabaseClient, bucket: string, boardId: string, title: string) {
  const path = `${boardId}/og.png`;
  const url = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (head.ok) return;
    const blob = await renderOgImage(title);
    if (!blob) return;
    await supabase.storage.from(bucket).upload(path, blob, { cacheControl: '3600', upsert: false, contentType: 'image/png' });
  } catch {
    // 미리보기 이미지는 없어도 기본 이미지로 대체된다
  }
}
