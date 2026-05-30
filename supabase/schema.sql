-- 생각보드 Supabase 초기 설정 SQL
-- Supabase Dashboard > SQL Editor에서 그대로 실행하세요.

create extension if not exists pgcrypto;

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  title text not null default '생각보드',
  created_at timestamptz not null default now()
);

create table if not exists public.board_items (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  type text not null check (type in ('photo', 'drawing')),
  image_url text not null,
  uploader_name text default '이름 없는 참여자',
  caption text,
  rotate int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.boards enable row level security;
alter table public.board_items enable row level security;

-- 회의용 MVP: 링크를 가진 사람이 볼 수 있고 올릴 수 있는 공개형 정책입니다.
-- 민감한 사진을 다룰 경우 로그인/비밀번호 정책으로 강화하세요.
drop policy if exists "boards_select_all" on public.boards;
drop policy if exists "boards_insert_all" on public.boards;
drop policy if exists "items_select_all" on public.board_items;
drop policy if exists "items_insert_all" on public.board_items;
drop policy if exists "items_delete_all" on public.board_items;

create policy "boards_select_all" on public.boards for select using (true);
create policy "boards_insert_all" on public.boards for insert with check (true);

create policy "items_select_all" on public.board_items for select using (true);
create policy "items_insert_all" on public.board_items for insert with check (true);
create policy "items_delete_all" on public.board_items for delete using (true);

-- Storage 버킷은 Dashboard > Storage에서 board-images 이름으로 public bucket 생성하세요.
-- 그 다음 Storage policies에서 public insert/select 허용이 필요합니다.
-- 아래 정책은 Supabase SQL Editor에서 storage.objects 접근 권한이 있을 때 실행 가능합니다.

insert into storage.buckets (id, name, public)
values ('board-images', 'board-images', true)
on conflict (id) do nothing;

drop policy if exists "public_read_board_images" on storage.objects;
drop policy if exists "public_upload_board_images" on storage.objects;

create policy "public_read_board_images"
on storage.objects for select
using (bucket_id = 'board-images');

create policy "public_upload_board_images"
on storage.objects for insert
with check (bucket_id = 'board-images');

-- Realtime 설정:
-- Supabase Dashboard > Database > Replication 또는 Realtime 메뉴에서 board_items 테이블을 활성화하세요.
