-- Execute este arquivo no Supabase > SQL Editor > New query > Run.
-- O painel será compartilhado entre as contas que você cadastrar no Auth do Supabase.

create table if not exists public.netplace_dashboard (
  id text primary key,
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint netplace_dashboard_singleton check (id = 'principal')
);

alter table public.netplace_dashboard enable row level security;
revoke all on public.netplace_dashboard from public, anon;
grant select, insert, update on public.netplace_dashboard to authenticated;

drop policy if exists "Equipe autenticada pode acessar o painel" on public.netplace_dashboard;
create policy "Equipe autenticada pode acessar o painel"
on public.netplace_dashboard
for all
to authenticated
using (true)
with check (true);

insert into public.netplace_dashboard (id, content)
values ('principal', '{}'::jsonb)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('netplace-media', 'netplace-media', false, 6291456, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
set public = false,
    file_size_limit = 6291456,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

drop policy if exists "Equipe pode ver imagens Netplace" on storage.objects;
create policy "Equipe pode ver imagens Netplace"
on storage.objects for select to authenticated
using (bucket_id = 'netplace-media');

drop policy if exists "Equipe pode enviar imagens Netplace" on storage.objects;
create policy "Equipe pode enviar imagens Netplace"
on storage.objects for insert to authenticated
with check (bucket_id = 'netplace-media');

drop policy if exists "Equipe pode atualizar imagens Netplace" on storage.objects;
create policy "Equipe pode atualizar imagens Netplace"
on storage.objects for update to authenticated
using (bucket_id = 'netplace-media')
with check (bucket_id = 'netplace-media');

drop policy if exists "Equipe pode remover imagens Netplace" on storage.objects;
create policy "Equipe pode remover imagens Netplace"
on storage.objects for delete to authenticated
using (bucket_id = 'netplace-media');
