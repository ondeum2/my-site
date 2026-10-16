const { SB_URL, SB_KEY, sbHeaders, readBody } = require('./_sb');

const KINDS = ['소모품', '비품', '장비 구입', 'A/S'];
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능해요' });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요. Vercel Storage 연결 후 다시 배포해 주세요.' });
  const b = readBody(req);
  if (b.website) return res.status(200).json({ ok: true }); // 스팸 함정 칸(사람에게는 안 보임)

  const qty = Math.round(Number(b.qty));
  const price = b.price === null || b.price === '' || b.price === undefined ? null : Math.round(Number(b.price));
  const needBy = /^\d{4}-\d{2}-\d{2}$/.test(String(b.need_by || '')) ? b.need_by : null;
  const row = {
    name: clip(b.name, 50),
    dept: clip(b.dept, 50),
    contact: clip(b.contact, 100),
    kind: KINDS.includes(b.kind) ? b.kind : '',
    item: clip(b.item, 200),
    qty: Number.isFinite(qty) && qty >= 1 && qty <= 9999 ? qty : 1,
    price: Number.isFinite(price) && price >= 0 && price <= 2000000000 ? price : null,
    symptom: clip(b.symptom, 1000) || null,
    need_by: needBy,
    consent: b.consent === true,
  };
  if (!row.name || !row.dept || !row.contact) return res.status(400).json({ error: '이름, 부서, 연락처를 적어 주세요' });
  if (!row.kind) return res.status(400).json({ error: '요청 종류를 골라 주세요' });
  if (!row.item) return res.status(400).json({ error: row.kind === 'A/S' ? '고장 난 장비 이름을 적어 주세요' : '품목명을 적어 주세요' });
  if (row.kind === 'A/S' && !row.symptom) return res.status(400).json({ error: '고장 증상을 적어 주세요' });
  if (!row.consent) return res.status(400).json({ error: '개인정보 수집·이용에 동의해 주세요' });

  const r = await fetch(`${SB_URL}/rest/v1/requests`, { method: 'POST', headers: { ...sbHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(row) });
  if (!r.ok) return res.status(500).json({ error: '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
  return res.status(200).json({ ok: true });
};
