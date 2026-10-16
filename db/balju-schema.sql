-- 발주서 도우미 표 (Supabase)
-- 보통은 클로드가 일회용 통로로 실행한다. 막힐 때만 Supabase SQL Editor에 붙여 넣고 Run.

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
-- 정책은 만들지 않는다: 브라우저(공개 키)로는 접근 불가, 서버(/api)만 접근
