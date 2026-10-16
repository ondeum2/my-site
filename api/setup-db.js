// 한 번만 쓰는 표 고치기 통로 — 칸이 생기면 이 파일은 지운다. 데이터는 읽지도 보내지도 않는다.
const { Client } = require('pg');
const SQL = `
alter table public.po_vendors add column if not exists catalog jsonb not null default '[]'::jsonb;
alter table public.po_vendors add column if not exists prepaid boolean not null default false;
alter table public.po_orders add column if not exists farm_name text;
alter table public.po_settings add column if not exists farms jsonb not null default '[]'::jsonb;
notify pgrst, 'reload schema';
`;
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능해요' });
  const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!url) return res.status(500).json({ error: '데이터베이스 연결 정보가 없어요.' });
  const client = new Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ''), ssl: { rejectUnauthorized: false } });
  try { await client.connect(); await client.query(SQL); return res.status(200).json({ ok: true }); }
  catch (e) { return res.status(500).json({ error: '표를 고치지 못했어요', detail: String(e.message).slice(0, 200) }); }
  finally { await client.end().catch(() => {}); }
};
