-- UPA Fluxo – esquema do Supabase
-- Cole no SQL Editor do Supabase e execute uma vez.

create table if not exists public.registros (
  id uuid primary key,
  colecao text not null,
  dados jsonb not null default '{}'::jsonb,
  atualizado_por text,
  updated_at timestamptz not null default now()
);

create index if not exists registros_colecao_idx on public.registros (colecao);

alter table public.registros enable row level security;

-- Somente usuários autenticados (equipe) leem e gravam.
drop policy if exists "equipe le" on public.registros;
drop policy if exists "equipe insere" on public.registros;
drop policy if exists "equipe atualiza" on public.registros;
drop policy if exists "equipe exclui" on public.registros;

create policy "equipe le" on public.registros for select to authenticated using (true);
create policy "equipe insere" on public.registros for insert to authenticated with check (true);
create policy "equipe atualiza" on public.registros for update to authenticated using (true) with check (true);
create policy "equipe exclui" on public.registros for delete to authenticated using (true);
