// 발주서 도우미 서버 — 비밀번호 확인 후 Supabase에 저장·조회한다.
// 키와 비밀번호는 Vercel 환경변수에서만 읽는다.
const crypto = require('node:crypto');

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const sbHeaders = () => ({
  apikey: SB_KEY,
  ...(String(SB_KEY).startsWith('eyJ') ? { Authorization: `Bearer ${SB_KEY}` } : {}),
  'Content-Type': 'application/json',
});
const same = (a, b) => {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

const KINDS = ['주문', 'A/S'];
const STATUSES = ['발주함', '납품·처리 완료'];
const PREFERS = ['', '문서', '문자'];
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

async function sb(path, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: { ...sbHeaders(), ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    console.error('supabase', method, path.split('?')[0], r.status, detail.slice(0, 300));
    throw Object.assign(new Error('저장소에서 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.'), { status: 500 });
  }
  return r.status === 204 ? null : r.json();
}

function cleanVendor(b) {
  const row = {
    name: clip(b.name, 60),
    contact_person: clip(b.contact_person, 40),
    phone: clip(b.phone, 40),
    prefer: PREFERS.includes(b.prefer) ? b.prefer : '',
    prepaid: b.prepaid === true,
    memo: clip(b.memo, 300),
    // 업체 카탈로그: 이 업체가 가진 품목·규격
    catalog: (Array.isArray(b.catalog) ? b.catalog : []).slice(0, 500)
      .map((i) => ({ name: clip(i && i.name, 100), spec: clip(i && i.spec, 100) }))
      .filter((i) => i.name),
  };
  if (!row.name) throw bad('업체 이름을 적어 주세요.');
  return row;
}

function cleanOrder(b) {
  if (!KINDS.includes(b.kind)) throw bad('주문인지 A/S인지 골라 주세요.');
  if (!isDate(b.order_date)) throw bad('발주일을 확인해 주세요.');
  const vid = Number(b.vendor_id);
  const row = {
    kind: b.kind,
    order_date: b.order_date,
    vendor_id: Number.isInteger(vid) && vid > 0 ? vid : null,
    vendor_name: clip(b.vendor_name, 60),
    farm_name: clip(b.farm_name, 60),
    manager: clip(b.manager, 40),
    phone: clip(b.phone, 40),
    address: clip(b.address, 200),
    memo: clip(b.memo, 1000),
    items: [],
    equipment: '',
    issue: '',
  };
  if (!row.vendor_name) throw bad('받는 업체를 골라 주세요.');
  if (row.kind === '주문') {
    row.items = (Array.isArray(b.items) ? b.items : []).slice(0, 50)
      .map((i) => ({ name: clip(i && i.name, 100), spec: clip(i && i.spec, 100), qty: clip(i && i.qty, 30) }))
      .filter((i) => i.name);
    if (!row.items.length) throw bad('품목을 하나 이상 적어 주세요.');
  } else {
    row.equipment = clip(b.equipment, 100);
    row.issue = clip(b.issue, 1000);
    if (!row.equipment || !row.issue) throw bad('장비명과 고장 내용을 적어 주세요.');
  }
  return row;
}

const one = (rows) => {
  if (!Array.isArray(rows) || !rows.length) throw Object.assign(new Error('찾지 못했어요. 새로고침해 주세요.'), { status: 404 });
  return rows[0];
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  // 발주서 전용 비밀번호가 있으면 그것을, 없으면 기존 관리자 비밀번호를 쓴다
  const pass = process.env.BALJU_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!pass) return res.status(500).json({ error: 'Vercel 환경변수에 BALJU_PASSWORD를 넣고 Redeploy 해 주세요.' });
  if (!same(req.headers['x-admin-password'] || '', pass)) return res.status(401).json({ error: '비밀번호가 맞지 않아요.' });

  const type = String((req.query && req.query.type) || '');
  if (type === 'ping') return res.status(200).json({ ok: true });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요. Vercel Storage 연결 후 다시 배포해 주세요.' });

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const id = Number(req.query && req.query.id);
  const needId = () => { if (!Number.isInteger(id) || id <= 0) throw bad('잘못된 요청이에요.'); };
  const rep = 'return=representation';
  const now = () => new Date().toISOString();

  try {
    if (req.method === 'GET' && type === 'all') {
      const [orders, vendors, settings] = await Promise.all([
        sb('po_orders?select=*&order=order_date.desc,id.desc&limit=1000'),
        sb('po_vendors?select=*&order=name.asc'),
        sb('po_settings?select=*&id=eq.1'),
      ]);
      return res.status(200).json({ orders, vendors, settings: settings[0] || {} });
    }

    if (type === 'orders') {
      if (req.method === 'POST') {
        return res.status(200).json({ row: one(await sb('po_orders', { method: 'POST', body: cleanOrder(b), prefer: rep })) });
      }
      if (req.method === 'PATCH') {
        needId();
        // 상태만 바꾸기 or 내용 전체 고치기
        const onlyStatus = Object.keys(b).length === 1 && 'status' in b;
        if (onlyStatus && !STATUSES.includes(b.status)) throw bad('잘못된 상태예요.');
        const patch = onlyStatus ? { status: b.status } : cleanOrder(b);
        patch.updated_at = now();
        return res.status(200).json({ row: one(await sb(`po_orders?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: rep })) });
      }
    }

    if (type === 'vendors') {
      if (req.method === 'POST') {
        return res.status(200).json({ row: one(await sb('po_vendors', { method: 'POST', body: cleanVendor(b), prefer: rep })) });
      }
      if (req.method === 'PATCH') {
        needId();
        const patch = { ...cleanVendor(b), updated_at: now() };
        return res.status(200).json({ row: one(await sb(`po_vendors?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: rep })) });
      }
      if (req.method === 'DELETE') {
        needId();
        await sb(`po_vendors?id=eq.${id}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }
    }

    if (type === 'settings' && req.method === 'PUT') {
      // 우리 회사(농장) 정보는 최대 5곳
      const farms = (Array.isArray(b.farms) ? b.farms : []).slice(0, 5)
        .map((x) => ({ name: clip(x && x.name, 60), manager: clip(x && x.manager, 40), phone: clip(x && x.phone, 40), address: clip(x && x.address, 200) }))
        .filter((x) => x.name);
      const row = { id: 1, farms, updated_at: now() };
      const saved = await sb('po_settings?on_conflict=id', { method: 'POST', body: row, prefer: `resolution=merge-duplicates,${rep}` });
      return res.status(200).json({ row: one(saved) });
    }

    return res.status(405).json({ error: '지원하지 않는 요청이에요.' });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.status ? e.message : '문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.' });
  }
};
