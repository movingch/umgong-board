create extension if not exists pgcrypto;

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  title text not null default '생각보드',
  created_at timestamptz not null default now()
);

create table if not exists public.board_items (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  type text not null check (type in ('photo', 'drawing', 'text')),
  image_url text not null,
  uploader_name text default '이름 없는 참여자',
  caption text,
  rotate int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.boards enable row level security;
alter table public.board_items enable row level security;

create policy "boards_select_all" on public.boards for select using (true);
create policy "boards_insert_all" on public.boards for insert with check (true);
create policy "items_select_all" on public.board_items for select using (true);
create policy "items_insert_all" on public.board_items for insert with check (true);
-- 삭제는 허용하되, 향후 진행자 인증 추가 시 이 정책만 교체하면 됨
create policy "items_delete_all" on public.board_items for delete using (true);

-- ── Storage ──────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('board-images', 'board-images', true)
on conflict (id) do nothing;

create policy "public_read_board_images" on storage.objects for select
  using (bucket_id = 'board-images');

-- 파일 타입 제한 (jpg, png, gif, webp만 허용)
create policy "public_upload_board_images" on storage.objects for insert
  with check (
    bucket_id = 'board-images'
    AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'gif', 'webp')
  );

-- ── Realtime 자동 새로고침 활성화 ────────────────────────
-- 아래 두 줄을 Supabase SQL Editor에서 실행해야 실시간 구독이 동작합니다.
alter publication supabase_realtime add table public.board_items;
alter table public.board_items replica identity full;
