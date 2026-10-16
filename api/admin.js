const crypto = require('node:crypto');
const { SB_URL, SB_KEY, sbHeaders, readBody } = require('./_sb');

const same = (a, b) => {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};
const FIELDS = ['received', 'arrived'];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) return res.status(500).json({ error: 'Vercel 환경변수에 ADMIN_PASSWORD를 넣고 Redeploy 해 주세요.' });
  if (!same(req.headers['x-admin-password'] || '', pass)) return res.status(401).json({ error: '비밀번호가 맞지 않아요.' });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요.' });

  if (req.method === 'GET') {
    const r = await fetch(`${SB_URL}/rest/v1/requests?select=*&order=created_at.desc&limit=500`, { headers: sbHeaders() });
    if (!r.ok) return res.status(500).json({ error: '불러오지 못했어요.' });
    return res.status(200).json({ rows: await r.json() });
  }
  if (req.method === 'PATCH') {
    const b = readBody(req);
    const id = Number(b.id);
    if (!Number.isInteger(id) || !FIELDS.includes(b.field) || typeof b.value !== 'boolean') return res.status(400).json({ error: '잘못된 요청이에요.' });
    const now = new Date().toISOString();
    const patch = { [b.field]: b.value, [`${b.field}_at`]: b.value ? now : null, updated_at: now };
    // 도착을 체크하면 접수도 함께, 접수를 풀면 도착도 함께 푼다
    if (b.field === 'arrived' && b.value) Object.assign(patch, { received: true });
    if (b.field === 'received' && !b.value) Object.assign(patch, { arrived: false, arrived_at: null });
    const r = await fetch(`${SB_URL}/rest/v1/requests?id=eq.${id}`, {
      method: 'PATCH', headers: { ...sbHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(patch),
    });
    if (!r.ok) return res.status(500).json({ error: '바꾸지 못했어요.' });
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
};
