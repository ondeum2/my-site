// 한 번만 쓰는 표 만들기 통로 — 표가 생기면 이 파일은 지운다. 데이터는 읽지도 보내지도 않는다.
const { Client } = require('pg');
const SQL = `
create table if not exists public.requests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null,
  dept text not null,
  contact text not null,
  kind text not null check (kind in ('소모품', '비품', '장비 구입', 'A/S')),
  item text not null,
  qty integer not null default 1 check (qty between 1 and 9999),
  price integer check (price >= 0),
  symptom text,
  need_by date,
  consent boolean not null default false,
  received boolean not null default false,
  received_at timestamptz,
  arrived boolean not null default false,
  arrived_at timestamptz,
  updated_at timestamptz
);
alter table public.requests enable row level security;
revoke all on public.requests from anon, authenticated;
`;
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능해요' });
  const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!url) return res.status(500).json({ error: '데이터베이스 연결 정보가 없어요. Vercel Storage에서 Supabase를 연결해 주세요.' });
  const client = new Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ''), ssl: { rejectUnauthorized: false } });
  try { await client.connect(); await client.query(SQL); return res.status(200).json({ ok: true }); }
  catch (e) { return res.status(500).json({ error: '표를 만들지 못했어요', detail: String(e.message).slice(0, 200) }); }
  finally { await client.end().catch(() => {}); }
};
