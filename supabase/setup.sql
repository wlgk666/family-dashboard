-- 우리집 더그아웃: Supabase 초기 설정
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여 넣고 Run 을 누르세요. 한 번만 하면 돼요.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.docs (
  family     text        not null,
  col        text        not null,
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (family, col, id)
);

-- 요청 헤더 x-family-key(가족 비밀번호)의 sha256 값. 이 값과 같은 family 행만 보이고 고칠 수 있어요.
create or replace function public.req_family() returns text
language sql stable as $$
  select encode(extensions.digest(coalesce(current_setting('request.headers', true)::json ->> 'x-family-key', ''), 'sha256'), 'hex')
$$;

alter table public.docs enable row level security;

drop policy if exists family_rows on public.docs;
create policy family_rows on public.docs
  for all to anon, authenticated
  using (family = public.req_family())
  with check (family = public.req_family());

grant select, insert, update, delete on public.docs to anon, authenticated;
