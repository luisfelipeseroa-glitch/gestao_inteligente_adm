-- ============================================================
-- RH e DP — dados protegidos (avaliações, advertências, desligamentos)
-- Rode DEPOIS do pop.sql (usa a lista de signatários/coordenadores).
-- Pode rodar de novo sem problema.
--
-- Diferente dos outros módulos, estes dados NÃO ficam na tabela "registros"
-- (que todo usuário logado lê). Ficam em rhdp_registros, que só os
-- coordenadores cadastrados em POP > Signatários (ativos) conseguem ler e gravar.
-- Se a lista de signatários ainda estiver vazia, qualquer usuário logado acessa
-- (para você conseguir configurar); cadastre os signatários o quanto antes.
-- ============================================================

create table if not exists public.rhdp_registros (
  id text primary key,
  colecao text not null,
  dados jsonb not null default '{}'::jsonb,
  atualizado_por text,
  updated_at timestamptz not null default now()
);
create index if not exists rhdp_registros_col_idx on public.rhdp_registros (colecao);

create or replace function public.rhdp_pode() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('public.pop_signatarios') is null then return false; end if;
  return not exists (select 1 from public.pop_signatarios)
      or exists (select 1 from public.pop_signatarios
                 where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and ativo);
end $$;

alter table public.rhdp_registros enable row level security;
drop policy if exists "rhdp_todos" on public.rhdp_registros;
create policy "rhdp_todos" on public.rhdp_registros for all to authenticated
  using (public.rhdp_pode()) with check (public.rhdp_pode());
revoke all on public.rhdp_registros from anon;
grant select, insert, update, delete on public.rhdp_registros to authenticated;
notify pgrst, 'reload schema';
