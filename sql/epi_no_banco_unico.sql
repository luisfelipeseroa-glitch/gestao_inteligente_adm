-- ENTREGA DE EPI no banco único (rode DEPOIS do supabase_unificado.sql)

-- =====================================================================
--  ENTREGA DE EPI COM RECONHECIMENTO FACIAL - UPA ROCINHA
--  Rode este arquivo UMA vez no Supabase: menu "SQL Editor" > New query
--  > cole tudo > Run.
-- =====================================================================

-- ---------- TABELAS ----------

create table if not exists public.funcionarios (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  matricula        text,
  funcao           text,
  setor            text,
  unidade          text default 'UPA Rocinha',
  descritores      jsonb,          -- dados do rosto (biometria). Apagados ao desligar.
  foto             text,           -- miniatura do cadastro
  consentimento_em timestamptz,    -- quando o funcionario concordou (LGPD)
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now()
);

create table if not exists public.epis (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  ca        text,
  criado_em timestamptz not null default now()
);

create table if not exists public.entregas (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id),
  ts             timestamptz not null default now(),   -- horario do SERVIDOR
  resp_entrega   text,
  metodo         text not null check (metodo in ('facial','manual')),
  distancia      real,
  motivo         text,
  foto           text,
  itens          jsonb not null,                        -- [{nome, ca, qtd}]
  criado_por     uuid default auth.uid()
);

create index if not exists entregas_func_ts_idx on public.entregas (funcionario_id, ts desc);
create index if not exists entregas_ts_idx      on public.entregas (ts desc);

-- ---------- SEGURANCA (RLS): so usuarios logados acessam ----------

alter table public.funcionarios enable row level security;
alter table public.epis         enable row level security;
alter table public.entregas     enable row level security;

drop policy if exists func_select on public.funcionarios;
drop policy if exists func_insert on public.funcionarios;
drop policy if exists func_update on public.funcionarios;
create policy func_select on public.funcionarios for select to authenticated using (true);
create policy func_insert on public.funcionarios for insert to authenticated with check (true);
create policy func_update on public.funcionarios for update to authenticated using (true) with check (true);

drop policy if exists epis_all on public.epis;
create policy epis_all on public.epis for all to authenticated using (true) with check (true);

-- Entregas: somente consultar e registrar. Ninguem altera nem apaga pelo app
-- (garante que o historico nao seja adulterado).
drop policy if exists ent_select on public.entregas;
drop policy if exists ent_insert on public.entregas;
create policy ent_select on public.entregas for select to authenticated using (true);
create policy ent_insert on public.entregas for insert to authenticated with check (true);

-- ---------- PERMISSOES ----------

revoke all on public.funcionarios from anon;
revoke all on public.epis         from anon;
revoke all on public.entregas     from anon;

grant select, insert, update         on public.funcionarios to authenticated;
grant select, insert, update, delete on public.epis         to authenticated;
grant select, insert                 on public.entregas     to authenticated;

-- ---------- ITENS DE EPI INICIAIS (so se a tabela estiver vazia) ----------

insert into public.epis (nome)
select n from unnest(array[
  'Luva de procedimento',
  'Máscara cirúrgica',
  'Máscara PFF2/N95',
  'Óculos de proteção',
  'Protetor facial (face shield)',
  'Avental descartável',
  'Capote impermeável',
  'Gorro',
  'Propé'
]) as n
where not exists (select 1 from public.epis);

-- =====================================================================
--  QR CODE DO CRACHA - rode UMA vez no Supabase (SQL Editor > New query)
--  Pode rodar de novo sem problema.
-- =====================================================================

-- 1) Cada funcionario passa a ter um codigo secreto (gerado automaticamente)
alter table public.funcionarios add column if not exists qr_token text;

-- 2) Quem ja esta cadastrado recebe o codigo agora
update public.funcionarios
   set qr_token = replace(gen_random_uuid()::text, '-', '')
 where qr_token is null;

-- 3) Novos cadastros recebem o codigo sozinhos
alter table public.funcionarios
  alter column qr_token set default replace(gen_random_uuid()::text, '-', '');
alter table public.funcionarios alter column qr_token set not null;

create unique index if not exists funcionarios_qr_token_key
  on public.funcionarios (qr_token);

-- 4) Permite registrar entregas pelo metodo 'qr'
alter table public.entregas drop constraint if exists entregas_metodo_check;
alter table public.entregas
  add constraint entregas_metodo_check check (metodo in ('facial','manual','qr'));
