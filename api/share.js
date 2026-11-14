// 참여 링크(/join/:id)를 보냈을 때 보드 제목과 보드 이미지가 미리보기에 나오도록
// index.html의 Open Graph 태그를 보드별 값으로 바꿔서 내려준다.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const setMeta = (html, attr, name, value) =>
  html.replace(new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(")`), (_m, a, b) => a + esc(value) + b);

export default async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = `https://${host}`;
  const id = String(req.query.id || '');
  let html = await fetch(`${origin}/index.html`).then((r) => r.text());

  if (UUID_RE.test(id) && SUPABASE_URL && SUPABASE_KEY) {
    try {
      const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/board-images/${id}/og.png`;
      const [rows, image] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/boards?id=eq.${id}&select=title`, {
          headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}` },
        }).then((r) => r.json()),
        fetch(imageUrl, { method: 'HEAD' }),
      ]);
      const title = Array.isArray(rows) && rows[0] && rows[0].title;
      if (title) {
        const shareTitle = `${title} — 생각보드 참여하기`;
        html = setMeta(html, 'property', 'og:title', shareTitle);
        html = setMeta(html, 'name', 'twitter:title', shareTitle);
        html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)} · 생각보드</title>`);
      }
      if (image.ok) {
        html = setMeta(html, 'property', 'og:image', imageUrl);
        html = setMeta(html, 'name', 'twitter:image', imageUrl);
      }
      html = html.replace('<meta property="og:type"', () => `<meta property="og:url" content="${origin}/join/${id}" />\n    <meta property="og:type"`);
    } catch {
      // 조회에 실패하면 기본 미리보기를 그대로 쓴다
    }
  }

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=60');
  res.status(200).send(html);
}
