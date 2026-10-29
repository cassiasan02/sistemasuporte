-- Execute no Supabase > SQL Editor > New query > Run.
-- Isto permite que qualquer pessoa com o link leia o conteúdo e as imagens do painel.
-- O painel continua sem permissão de escrita para visitantes.

grant select on public.netplace_dashboard to anon;

drop policy if exists "Visitantes podem visualizar painel Netplace" on public.netplace_dashboard;
create policy "Visitantes podem visualizar painel Netplace"
on public.netplace_dashboard
for select
to anon
using (id = 'principal');

drop policy if exists "Visitantes podem visualizar imagens Netplace" on storage.objects;
create policy "Visitantes podem visualizar imagens Netplace"
on storage.objects
for select
to anon
using (bucket_id = 'netplace-media');