// 한 번만 쓰는 표 만들기 통로 — 표가 생기면 이 파일은 지운다. 데이터는 읽지도 보내지도 않는다.
const { Client } = require('pg');
const SQL = `

create table if not exists public.po_vendors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null,
  contact_person text,
  phone text,
  prefer text not null default '' check (prefer in ('', '문서', '문자')),
  memo text,
  updated_at timestamptz
);

create table if not exists public.po_orders (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  order_date date not null default current_date,
  kind text not null check (kind in ('주문', 'A/S')),
  vendor_id bigint references public.po_vendors(id) on delete set null,
  vendor_name text not null,
  manager text,
  phone text,
  address text,
  items jsonb not null default '[]'::jsonb,
  equipment text,
  issue text,
  memo text,
  status text not null default '발주함' check (status in ('발주함', '납품·처리 완료')),
  updated_at timestamptz
);

create table if not exists public.po_settings (
  id int primary key default 1 check (id = 1),
  company text,
  manager text,
  phone text,
  address text,
  updated_at timestamptz
);

alter table public.po_vendors enable row level security;
alter table public.po_orders enable row level security;
alter table public.po_settings enable row level security;
revoke all on public.po_vendors, public.po_orders, public.po_settings from anon, authenticated;
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
