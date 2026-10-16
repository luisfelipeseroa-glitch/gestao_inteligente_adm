-- ============================================================
-- UPA Rocinha — Gestão Inteligente | Banco único (Supabase)
-- Cole TUDO no SQL Editor do projeto e clique em Run (uma vez).
-- Pode rodar de novo sem problema (é idempotente).
-- ============================================================

-- 1) Tabela geral de registros (cada módulo usa uma "colecao")
--    Manutenção: manut_relatorios
--    Central:    central_empresas, central_chamados, central_anexos, central_assinaturas
--    Fluxo:      fisc, visitas, modelos, conf, prazos, servicos, ind, lanc
create table if not exists public.registros (
  id text primary key,
  colecao text not null,
  dados jsonb not null default '{}'::jsonb,
  atualizado_por text,
  updated_at timestamptz not null default now()
);
create index if not exists registros_colecao_idx on public.registros (colecao);

alter table public.registros enable row level security;
drop policy if exists "equipe le" on public.registros;
drop policy if exists "equipe insere" on public.registros;
drop policy if exists "equipe atualiza" on public.registros;
drop policy if exists "equipe exclui" on public.registros;
create policy "equipe le"       on public.registros for select to authenticated using (true);
create policy "equipe insere"   on public.registros for insert to authenticated with check (true);
create policy "equipe atualiza" on public.registros for update to authenticated using (true) with check (true);
create policy "equipe exclui"   on public.registros for delete to authenticated using (true);

-- 2) Armazenamento de arquivos (fotos e PDFs de evidência) — bucket PRIVADO
insert into storage.buckets (id, name, public)
values ('anexos', 'anexos', false)
on conflict (id) do nothing;

drop policy if exists "anexos le" on storage.objects;
drop policy if exists "anexos insere" on storage.objects;
drop policy if exists "anexos atualiza" on storage.objects;
drop policy if exists "anexos exclui" on storage.objects;
create policy "anexos le"       on storage.objects for select to authenticated using (bucket_id = 'anexos');
create policy "anexos insere"   on storage.objects for insert to authenticated with check (bucket_id = 'anexos');
create policy "anexos atualiza" on storage.objects for update to authenticated using (bucket_id = 'anexos') with check (bucket_id = 'anexos');
create policy "anexos exclui"   on storage.objects for delete to authenticated using (bucket_id = 'anexos');
