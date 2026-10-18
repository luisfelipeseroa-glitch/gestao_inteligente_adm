-- GESTÃO DE RH no banco único (rode DEPOIS do supabase_unificado.sql)

-- =====================================================================
-- GestãoSaúde RH — Esquema do banco (Supabase / PostgreSQL)
-- Como usar: Supabase → SQL Editor → New query → cole tudo → Run.
-- Pode rodar mais de uma vez sem quebrar (usa "if not exists").
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- TABELAS
-- ---------------------------------------------------------------------
create table if not exists public.profissionais (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  matricula text unique,
  cargo text default 'outro',
  cargo_descricao text,            -- texto original do cargo (ex.: "000854-TECNICO DE ENFERMAGEM")
  coordenacao text default 'NENHUMA',
  conselho_tipo text default 'NENHUM',
  conselho_numero text,
  setor text,
  telefone text,
  email text,
  tipo_plantao_padrao text default 'sem_padrao',
  tipo_contratacao text default 'contratado',
  data_admissao date,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.plantoes (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid references public.profissionais(id) on delete cascade, -- nulo = RPA
  profissional_nome text,
  data date not null,
  hora_inicio text,
  hora_fim text,
  tipo text,
  rpa boolean not null default false,
  cargo text,
  valor numeric,
  observacao text,
  created_at timestamptz not null default now()
);
create index if not exists plantoes_data_idx on public.plantoes(data);
create index if not exists plantoes_prof_idx on public.plantoes(profissional_id);

create table if not exists public.solicitacoes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  matricula text,
  titulo text,
  descricao text,
  data_inicio date,
  data_fim date,
  profissional_envolvido text,
  horas numeric,
  valor numeric,
  status text not null default 'pendente_gestor',
  anexo_url text,
  assinatura_solicitante_url text,
  assinatura_gestor_url text,
  assinatura_rh_url text,
  observacao_gestor text,
  observacao_rh text,
  aprovado_gestor_por text,
  data_aprovacao_gestor timestamptz,
  aprovado_rh_por text,
  data_aprovacao_rh timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists solicitacoes_mat_idx on public.solicitacoes(matricula);

create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  matricula text not null,
  tipo text,
  titulo text,
  mensagem text,
  lida boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notificacoes_mat_idx on public.notificacoes(matricula);

create table if not exists public.comunicados (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  conteudo text not null,
  prioridade text not null default 'normal',
  ativo boolean not null default true,
  autor text,
  created_at timestamptz not null default now()
);

create table if not exists public.documentos (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid references public.profissionais(id) on delete cascade,
  profissional_nome text,
  tipo text default 'outro',
  numero text,
  data_vencimento date,
  observacao text,
  arquivo_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.ferias (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid references public.profissionais(id) on delete cascade,
  profissional_nome text,
  tipo text default 'ferias',
  data_inicio date,
  data_fim date,
  dias integer,
  observacao text,
  created_at timestamptz not null default now()
);

-- Perfis dos usuários da área de gestão (ligados ao login do Supabase)
create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nome text,
  papel text not null default 'user',   -- 'admin' ou 'user'
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- cria perfil para usuários que já existiam
insert into public.perfis (id, email, nome)
select id, email, coalesce(raw_user_meta_data->>'full_name', email) from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- SEGURANÇA (RLS)
-- Usuários logados (coordenadores/RH) têm acesso total às tabelas.
-- O público (portal do colaborador) NÃO acessa as tabelas diretamente:
-- só pelas funções "portal_*" abaixo, que devolvem apenas os dados
-- da própria matrícula.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profissionais','plantoes','solicitacoes','notificacoes','comunicados','documentos','ferias'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "gestao_total" on public.%I', t);
    execute format('create policy "gestao_total" on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

alter table public.perfis enable row level security;
drop policy if exists "perfis_leitura" on public.perfis;
create policy "perfis_leitura" on public.perfis for select to authenticated using (true);
drop policy if exists "perfis_admin_altera" on public.perfis;
create policy "perfis_admin_altera" on public.perfis for update to authenticated
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.papel = 'admin'))
  with check (true);
revoke all on public.perfis from anon;

-- ---------------------------------------------------------------------
-- FUNÇÕES DO PORTAL DO COLABORADOR (acesso por matrícula, sem login)
-- ---------------------------------------------------------------------
create or replace function public.portal_dados(p_matricula text)
returns json language plpgsql security definer set search_path = public as $$
declare v public.profissionais%rowtype;
begin
  select * into v from public.profissionais where matricula = trim(p_matricula) limit 1;
  if not found then return json_build_object('erro', 'nao_encontrado'); end if;
  if not v.ativo then return json_build_object('erro', 'inativo'); end if;
  return json_build_object(
    'profissional', json_build_object(
      'id', v.id, 'nome', v.nome, 'matricula', v.matricula, 'cargo', v.cargo,
      'cargo_descricao', v.cargo_descricao, 'coordenacao', v.coordenacao, 'setor', v.setor),
    'solicitacoes', coalesce((select json_agg(s) from (
        select * from public.solicitacoes where matricula = v.matricula
        order by created_at desc limit 50) s), '[]'::json),
    'plantoes', coalesce((select json_agg(p) from (
        select * from public.plantoes where profissional_id::text = v.id::text
        order by data desc limit 500) p), '[]'::json),
    'comunicados', coalesce((select json_agg(c) from (
        select id, titulo, conteudo, prioridade, autor, created_at from public.comunicados
        where ativo order by created_at desc limit 20) c), '[]'::json),
    'notificacoes', coalesce((select json_agg(n) from (
        select * from public.notificacoes where matricula = v.matricula
        order by created_at desc limit 30) n), '[]'::json)
  );
end $$;

create or replace function public.portal_cadastro(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_mat text := nullif(trim(p->>'matricula'), '');
begin
  if coalesce(trim(p->>'nome'), '') = '' or v_mat is null then
    raise exception 'Nome e matrícula são obrigatórios';
  end if;
  if exists (select 1 from public.profissionais where matricula = v_mat) then
    return 'ja_existe';
  end if;
  insert into public.profissionais (nome, matricula, telefone, email, cargo, tipo_contratacao, ativo)
  values (trim(p->>'nome'), v_mat, trim(p->>'telefone'), trim(p->>'email'),
          coalesce(p->>'cargo', 'outro'), coalesce(p->>'tipo_contratacao', 'contratado'), true);
  return 'ok';
end $$;

create or replace function public.portal_nova_solicitacao(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_mat text := nullif(trim(p->>'matricula'), '');
begin
  if v_mat is null or not exists (select 1 from public.profissionais where matricula = v_mat and ativo) then
    raise exception 'Matrícula inválida';
  end if;
  if (p->>'tipo') not in ('troca','problema_ponto','atestado','plantao_rpa','ferias','bh','bh_casa','plantao_extra','horas_extras') then
    raise exception 'Tipo inválido';
  end if;
  insert into public.solicitacoes (tipo, matricula, titulo, descricao, data_inicio, data_fim,
    profissional_envolvido, horas, valor, status, anexo_url, assinatura_solicitante_url)
  values (p->>'tipo', v_mat, p->>'titulo', p->>'descricao',
    nullif(p->>'data_inicio', '')::date, nullif(p->>'data_fim', '')::date,
    p->>'profissional_envolvido', nullif(p->>'horas', '')::numeric, nullif(p->>'valor', '')::numeric,
    'pendente_gestor', p->>'anexo_url', p->>'assinatura_solicitante_url')
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.portal_marcar_lida(p_matricula text, p_id uuid default null)
returns void language sql security definer set search_path = public as $$
  update public.notificacoes set lida = true
  where matricula::text = trim(p_matricula) and (p_id is null or id::text = p_id::text);
$$;

grant execute on function public.portal_dados(text) to anon, authenticated;
grant execute on function public.portal_cadastro(jsonb) to anon, authenticated;
grant execute on function public.portal_nova_solicitacao(jsonb) to anon, authenticated;
grant execute on function public.portal_marcar_lida(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- ARQUIVOS (atestados, assinaturas, documentos)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('arquivos', 'arquivos', true)
on conflict (id) do nothing;

drop policy if exists "arquivos_upload" on storage.objects;
create policy "arquivos_upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'arquivos');
drop policy if exists "arquivos_leitura" on storage.objects;
create policy "arquivos_leitura" on storage.objects for select to anon, authenticated
  using (bucket_id = 'arquivos');
drop policy if exists "arquivos_altera" on storage.objects;
create policy "arquivos_altera" on storage.objects for update to authenticated
  using (bucket_id = 'arquivos');
drop policy if exists "arquivos_apaga" on storage.objects;
create policy "arquivos_apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'arquivos');

-- ---------------------------------------------------------------------
-- DEPOIS de criar seu usuário em Authentication → Users, rode:
--   update public.perfis set papel = 'admin' where email = 'luisfelipeseroa@gmail.com';
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Seu cadastro de profissional e seu acesso de administrador no RH
-- ---------------------------------------------------------------------
insert into public.profissionais (nome, matricula, cargo, coordenacao, telefone, setor, ativo)
select 'LUIS FELIPE WANG SEROA DA MOTTA', '10344', 'coordenador_administrativo', 'ADM', '21965438005', 'ADMINISTRAÇÃO', true
where not exists (select 1 from public.profissionais where matricula = '10344');

update public.perfis set papel = 'admin' where email = 'coord.adm.uparocinha@institutognosis.org.br';
notify pgrst, 'reload schema';
