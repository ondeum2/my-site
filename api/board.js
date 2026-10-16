// 현황판용 — 연락처·금액·증상은 내보내지 않고, 이름은 가운데를 가린다
const { SB_URL, SB_KEY, sbHeaders, APPROVAL_PRICE } = require('./_sb');

const mask = (name) => {
  const c = [...String(name || '')];
  if (c.length <= 1) return '*';
  if (c.length === 2) return c[0] + '*';
  return c[0] + '*'.repeat(c.length - 2) + c[c.length - 1];
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 가능해요' });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: '현황판을 아직 준비 중이에요.' });
  const r = await fetch(`${SB_URL}/rest/v1/requests?select=created_at,name,dept,kind,item,qty,price,received,arrived&order=created_at.desc&limit=200`, { headers: sbHeaders() });
  if (!r.ok) return res.status(500).json({ error: '불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
  const rows = (await r.json()).map((x) => ({
    created_at: x.created_at,
    name: mask(x.name),
    dept: x.dept,
    kind: x.kind,
    item: x.item,
    qty: x.qty,
    approval: (x.price ?? 0) >= APPROVAL_PRICE,
    received: x.received,
    arrived: x.arrived,
  }));
  return res.status(200).json({ rows });
};
