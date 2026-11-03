-- ============================================================
-- POP · Procedimentos Operacionais Padrão — assinatura eletrônica
-- Rode DEPOIS do supabase_unificado.sql (SQL Editor > cole tudo > Run).
-- Pode rodar de novo sem problema (é idempotente).
--
-- Os textos dos POPs ficam na tabela "registros" (coleções pop_documentos).
-- Aqui ficam só as tabelas que precisam de proteção extra:
--   pop_signatarios  = quem pode assinar (coordenadores). Só administradores alteram.
--   pop_assinaturas  = assinaturas. SÓ INSERE: ninguém edita nem apaga.
-- ============================================================

create extension if not exists pgcrypto;

-- 1) Signatários (coordenadores) ---------------------------------------
create table if not exists public.pop_signatarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  matricula text,
  cargo text not null,
  email text not null,            -- o MESMO e-mail do login no Supabase
  ativo boolean not null default true,
  admin boolean not null default false,  -- admin pode cadastrar/alterar signatários
  created_at timestamptz not null default now()
);
create unique index if not exists pop_signatarios_email_uq on public.pop_signatarios (lower(email));

create or replace function public.pop_eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pop_signatarios
                 where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                   and ativo and admin);
$$;
create or replace function public.pop_sem_signatarios() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.pop_signatarios);
$$;

alter table public.pop_signatarios enable row level security;
drop policy if exists "pop_sig_le" on public.pop_signatarios;
drop policy if exists "pop_sig_ins" on public.pop_signatarios;
drop policy if exists "pop_sig_upd" on public.pop_signatarios;
drop policy if exists "pop_sig_del" on public.pop_signatarios;
create policy "pop_sig_le"  on public.pop_signatarios for select to authenticated using (true);
-- o primeiro cadastro (tabela vazia) vira administrador; depois só administradores mexem
create policy "pop_sig_ins" on public.pop_signatarios for insert to authenticated
  with check (public.pop_eh_admin() or public.pop_sem_signatarios());
create policy "pop_sig_upd" on public.pop_signatarios for update to authenticated
  using (public.pop_eh_admin()) with check (public.pop_eh_admin());
create policy "pop_sig_del" on public.pop_signatarios for delete to authenticated
  using (public.pop_eh_admin());

-- 2) Assinaturas (somente inserção) ------------------------------------
create table if not exists public.pop_assinaturas (
  id uuid primary key default gen_random_uuid(),
  doc_id text not null,           -- id do POP em registros
  doc_codigo text,
  doc_titulo text,
  versao int not null,
  hash text not null,             -- SHA-256 do conteúdo no momento da assinatura
  papel text not null,            -- Elaborador, Revisor, Aprovador...
  nome text not null,
  matricula text,
  cargo text,
  email text not null,
  codigo text not null unique,    -- código de conferência (vai no carimbo e no QR)
  assinado_em timestamptz not null default now()
);
create unique index if not exists pop_assinaturas_uq on public.pop_assinaturas (doc_id, versao, lower(email));
create index if not exists pop_assinaturas_doc_idx on public.pop_assinaturas (doc_id);

-- O servidor preenche nome/matrícula/cargo/e-mail/data: o navegador não consegue forjar.
create or replace function public.pop_assinatura_antes() returns trigger
language plpgsql security definer set search_path = public as $$
declare s record; d jsonb; alfa text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text := ''; i int;
begin
  select * into s from public.pop_signatarios
   where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and ativo limit 1;
  if s.id is null then
    raise exception 'Seu e-mail não está cadastrado como signatário ativo.';
  end if;
  select dados into d from public.registros where id = new.doc_id and colecao = 'pop_documentos';
  if d is null then raise exception 'POP não encontrado.'; end if;
  if coalesce(d ->> 'hash', '') <> new.hash or coalesce((d ->> 'versao')::int, 0) <> new.versao then
    raise exception 'O conteúdo do POP mudou depois do envio para assinatura. Atualize a tela.';
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(d -> 'signatarios', '[]'::jsonb)) x
                 where lower(x ->> 'email') = lower(s.email)) then
    raise exception 'Você não está na lista de signatários deste POP.';
  end if;
  new.nome := s.nome; new.matricula := s.matricula; new.cargo := s.cargo; new.email := s.email;
  new.doc_codigo := d ->> 'codigo'; new.doc_titulo := d ->> 'titulo';
  new.assinado_em := now();
  new.papel := coalesce((select x ->> 'papel' from jsonb_array_elements(d -> 'signatarios') x
                         where lower(x ->> 'email') = lower(s.email) limit 1), new.papel);
  for i in 1..10 loop c := c || substr(alfa, 1 + floor(random() * 32)::int, 1); end loop;
  new.codigo := c;
  return new;
end $$;
drop trigger if exists pop_assinatura_antes on public.pop_assinaturas;
create trigger pop_assinatura_antes before insert on public.pop_assinaturas
  for each row execute function public.pop_assinatura_antes();

alter table public.pop_assinaturas enable row level security;
drop policy if exists "pop_ass_le" on public.pop_assinaturas;
drop policy if exists "pop_ass_ins" on public.pop_assinaturas;
create policy "pop_ass_le"  on public.pop_assinaturas for select to authenticated using (true);
create policy "pop_ass_ins" on public.pop_assinaturas for insert to authenticated
  with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
-- (a checagem roda depois do gatilho, que grava o e-mail do cadastro; não existe policy de update/delete)
revoke update, delete on public.pop_assinaturas from authenticated, anon;

-- 3) Conferência pública (QR Code) -------------------------------------
-- Aceita o código do carimbo (10 caracteres) ou o começo do hash do documento (>= 16).
create or replace function public.pop_verificar(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := lower(trim(coalesce(p_q, ''))); a record; r jsonb; st text; vat int;
begin
  if length(q) < 10 then return jsonb_build_object('encontrado', false); end if;
  select * into a from public.pop_assinaturas
   where lower(codigo) = q or (length(q) >= 16 and hash like q || '%')
   order by assinado_em limit 1;
  if a.id is null then return jsonb_build_object('encontrado', false); end if;
  select dados ->> 'status', (dados ->> 'versao')::int into st, vat
    from public.registros where id = a.doc_id and colecao = 'pop_documentos';
  select jsonb_build_object(
    'encontrado', true,
    'documento', jsonb_build_object('codigo', a.doc_codigo, 'titulo', a.doc_titulo, 'versao', a.versao, 'hash', a.hash),
    'situacao', coalesce(st, 'desconhecida'),
    'versao_atual', vat,
    'assinaturas', coalesce((select jsonb_agg(jsonb_build_object(
        'papel', s.papel, 'nome', s.nome, 'matricula', s.matricula, 'cargo', s.cargo,
        'assinado_em', s.assinado_em, 'codigo', s.codigo) order by s.assinado_em)
      from public.pop_assinaturas s
      where s.doc_id = a.doc_id and s.versao = a.versao and s.hash = a.hash), '[]'::jsonb))
  into r;
  return r;
end $$;
grant execute on function public.pop_verificar(text) to anon, authenticated;
