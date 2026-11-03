'use strict';
/* POP — Procedimentos Operacionais Padrão (UPA Rocinha)
   Textos em "registros" (coleção pop_documentos). Assinaturas e signatários em tabelas próprias (sql/pop.sql). */
const $ = id => document.getElementById(id);
const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = s => esc(s).replace(/\n/g, '<br>');
const uuid = () => crypto.randomUUID();
const hoje = () => new Date().toLocaleDateString('en-CA');
const fd = d => { if (!d) return ''; const p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(d); };
const dh = iso => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
const pad2 = n => String(n).padStart(2, '0');
const meuEmail = () => { const u = window.UPA && UPA.user(); return ((u && u.email) || '').toLowerCase(); };
const COL = 'pop_documentos';
const PAPEIS = ['Elaboração/Revisão', 'Aprovação Simples', 'Aprovação Final'];
const ST = { rascunho: 'Rascunho', em_assinatura: 'Em assinatura', vigente: 'Vigente', obsoleto: 'Obsoleto' };
const CARGOS = ['Coordenador Administrativo', 'Coordenador Médico', 'Coordenador de Enfermagem', 'Coordenador Assistencial', 'RH Focal', 'Responsável Técnico', 'Diretor(a)'];

let view = 'lista', cur = null, asg = [], sigs = [], docs = [], previa = false, filtro = { st: 'ativos', q: '' }, temaSel = null, saveT = null, sujo = false, integ = null;

function notice(t, erro) { const m = $('message'); m.textContent = t || ''; m.className = erro ? 'err' : (t ? 'okm' : ''); if (t) m.scrollIntoView({ block: 'nearest' }); }
function erroTxt(e) {
  const m = (e && (e.message || e.details)) || String(e);
  if (/does not exist|Could not find the table|schema cache|pop_verificar|relation/i.test(m)) return 'As tabelas do POP ainda não existem no Supabase. Rode o arquivo sql/pop.sql no SQL Editor (uma vez).';
  if (/row-level security|violates/i.test(m)) return 'Sem permissão para esta ação (regras do banco). ' + m;
  return (window.UPA && UPA.msg) ? UPA.msg(e) : m;
}
const C = () => UPA.client();

/* ---------------- dados ---------------- */
async function carregarDocs() { const r = await UPA.db.list(COL); return r.map(x => ({ ...x.dados, id: x.id })); }
async function salvarDoc(d) {
  d.atualizadoEm = new Date().toISOString(); d.atualizadoPor = meuEmail();
  if (!d.criadoEm) { d.criadoEm = d.atualizadoEm; d.criadoPor = d.atualizadoPor; }
  await UPA.db.put(COL, d.id, d); return d;
}
async function carregarSigs() { const r = await C().from('pop_signatarios').select('*').order('nome'); if (r.error) throw r.error; return r.data || []; }
async function carregarAsg(docId) {
  let q = C().from('pop_assinaturas').select('*').order('assinado_em'); if (docId) q = q.eq('doc_id', docId);
  const r = await q; if (r.error) throw r.error; return r.data || [];
}

/* ---------------- integridade (hash) ---------------- */
function canon(o) {
  if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
  if (o && typeof o === 'object') return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
  return JSON.stringify(o == null ? null : o);
}
async function sha256(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
const baseHash = d => ({ codigo: d.codigo, titulo: d.titulo, versao: d.versao, area: d.area, responsavel: d.responsavel, elaboradoEm: d.elaboradoEm, conteudo: d.conteudo, signatarios: (d.signatarios || []).map(s => ({ papel: s.papel, email: String(s.email).toLowerCase(), nome: s.nome, matricula: s.matricula || '', cargo: s.cargo })) });
const hashDoc = d => sha256(canon(baseHash(d)));

function estado(d, a) {
  if (d.status === 'obsoleto') return 'obsoleto';
  if (!d.status || d.status === 'rascunho') return 'rascunho';
  const need = (d.signatarios || []).map(s => String(s.email).toLowerCase());
  const ok = need.length && need.every(e => a.some(x => x.doc_id === d.id && x.versao === d.versao && x.hash === d.hash && String(x.email).toLowerCase() === e));
  return ok ? 'vigente' : 'em_assinatura';
}
async function checarIntegridade(d, a) {
  if (!d.hash) return { ok: true };
  const h = await hashDoc(d);
  if (h !== d.hash) return { ok: false, motivo: 'O texto atual do POP é diferente do que foi enviado para assinatura.' };
  const ruim = a.filter(x => x.versao === d.versao && x.hash !== h);
  if (ruim.length) return { ok: false, motivo: 'Há assinaturas feitas sobre outro conteúdo.' };
  return { ok: true };
}

/* ---------------- normalização do conteúdo ---------------- */
function normalizar(c) {
  c = c || {};
  const L = x => Array.isArray(x) ? x.map(v => String(v == null ? '' : v)).filter(s => s.trim()) : [];
  const R = (x, f) => Array.isArray(x) ? x.map(o => Object.fromEntries(f.map(k => [k, String((o && o[k]) || '')]))).filter(o => f.some(k => o[k].trim())) : [];
  const S = x => String(x == null ? '' : x);
  return {
    introducao: S(c.introducao), objetivo: L(c.objetivo), abrangencia: S(c.abrangencia),
    definicoes: R(c.definicoes, ['termo', 'definicao']), principios: L(c.principios),
    responsabilidades: R(c.responsabilidades, ['funcao', 'atribuicao']),
    fluxos: (Array.isArray(c.fluxos) ? c.fluxos : []).map(f => ({ titulo: S(f && f.titulo), introducao: S(f && f.introducao), etapas: R(f && f.etapas, ['titulo', 'descricao']) })).filter(f => f.titulo || f.etapas.length),
    documentacao: L(c.documentacao), situacoes: R(c.situacoes, ['situacao', 'conduta']), fluxo_resumido: S(c.fluxo_resumido),
    checklist: L(c.checklist), formularios: L(c.formularios), referencias: L(c.referencias), observacao: S(c.observacao)
  };
}
function proxCodigo(area) {
  let max = 0; docs.forEach(d => { const m = /(\d+)\s*$/.exec(d.codigo || ''); if (m) max = Math.max(max, +m[1]); });
  return 'POP.' + area + '.' + String(max + 1).padStart(3, '0');
}

/* ---------------- documento (layout do modelo POP.ADM.033) ---------------- */
function qrSvg(texto) {
  try { if (typeof qrcode !== 'function') return ''; const q = qrcode(0, 'M'); q.addData(texto); q.make(); return q.createSvgTag({ cellSize: 2, margin: 0, scalable: true }); } catch (e) { return ''; }
}
const urlVerif = d => new URL('verificar.html?c=' + (d.hash || '').slice(0, 20), location.href).href;
function buildDoc(d, a, integr) {
  const c = d.conteudo || normalizar({}), est = estado(d, a), ver = pad2(d.versao || 1);
  const meus = a.filter(x => x.versao === d.versao && x.hash === d.hash);
  const bul = arr => arr.map(x => `<p class="b">● ${nl(x)}</p>`).join('');
  const band = t => `<div class="band">${esc(t)}</div>`;
  const par = s => String(s || '').split(/\n{2,}/).filter(x => x.trim()).map(x => `<p>${nl(x.trim())}</p>`).join('');
  const sec = (t, h) => h ? band(t) + h : '';
  const tbl = (heads, rows, cols) => `<table class="t"${cols ? ' style="table-layout:fixed"' : ''}>${cols ? '<colgroup>' + cols.map(w => `<col${w ? ` style="width:${w}"` : ''}>`).join('') + '</colgroup>' : ''}<thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.join('')}</tr>`).join('')}</tbody></table>`;
  const slotCell = papel => {
    const s = (d.signatarios || []).find(x => x.papel === papel);
    if (!s) return '<td class="ap"><div class="na">NA</div></td>';
    const g = meus.find(x => String(x.email).toLowerCase() === String(s.email).toLowerCase());
    const stamp = g ? `<div class="stamp">Assinado eletronicamente por<br><b>${esc(g.nome)}</b><br>${g.matricula ? 'Mat. ' + esc(g.matricula) + ' · ' : ''}${esc(dh(g.assinado_em))}<br>Cód. ${esc(g.codigo)}</div>` : `<div class="stamp pend">Aguardando assinatura</div>`;
    return `<td class="ap">${stamp}<div class="ln"></div><b>${esc(s.nome)}</b><br><b>${esc(s.cargo)}</b></td>`;
  };
  const pub = est === 'vigente' ? fd(d.publicadoEm) : 'NA';
  const qr = d.hash ? qrSvg(urlVerif(d)) : '';
  const wmTxt = integr && integr.ok === false ? 'ALTERADO APÓS ASSINATURA' : est === 'rascunho' ? 'MINUTA · SEM VALIDADE' : est === 'em_assinatura' ? 'AGUARDANDO ASSINATURAS' : est === 'obsoleto' ? 'OBSOLETO' : '';
  const head = `<table class="h1"><tr><td class="logo" rowspan="3"><img src="${esc(UPA.LOGO)}" alt=""></td><td class="blue" colspan="2">PROCEDIMENTO OPERACIONAL PADRÃO</td></tr><tr><td class="lab">POP</td><td>${esc(d.titulo)}</td></tr><tr><td class="lab">UNIDADE</td><td>UPA 24H ROCINHA</td></tr></table>
    <table class="h2"><tr><td>Padrão n°: ${esc(d.codigo)}</td><td>Elaborado em: ${fd(d.elaboradoEm)}</td><td>N° Revisão: ${ver}</td><td>Versão: ${ver}</td></tr><tr><td colspan="3">Responsável: ${esc(d.responsavel)}</td><td>${d.hash ? 'Integridade: ' + esc(d.hash.slice(0, 8).toUpperCase()) : 'Minuta'}</td></tr></table>`;
  const aprov = `<table class="ap-t"><thead><tr><th>Revisado em:</th><th>Elaboração/Revisão por:</th><th>Aprovação Simples por:</th><th>Aprovação Final por:</th><th>Publicado em:</th></tr></thead><tbody><tr><td class="ap"><div class="na">${d.versao > 1 ? fd(d.elaboradoEm) : 'NA'}</div></td>${PAPEIS.map(slotCell).join('')}<td class="ap"><b>${esc(pub)}</b>${qr ? `<div class="qr">${qr}</div><small>Conferir autenticidade<br>pelo QR Code</small>` : ''}</td></tr></tbody></table>`;
  let corpo = aprov;
  corpo += sec('Introdução', par(c.introducao));
  corpo += sec('Objetivo', bul(c.objetivo));
  corpo += sec('Abrangência', par(c.abrangencia));
  corpo += sec('Definições', bul(c.definicoes.map(x => x.termo + (x.definicao ? ' – ' + x.definicao : ''))));
  corpo += sec('Princípios e regras de conduta', bul(c.principios));
  corpo += sec('Responsabilidades', c.responsabilidades.length ? tbl(['Responsável', 'Atribuições'], c.responsabilidades.map(x => [`<td>${nl(x.funcao)}</td>`, `<td>${nl(x.atribuicao)}</td>`])) : '');
  (c.fluxos || []).forEach(f => { corpo += band(f.titulo || 'Fluxo') + (f.introducao ? par(f.introducao) : '') + f.etapas.map((e, i) => `<p class="st"><b>${i + 1}. ${esc(String(e.titulo || '').replace(/\.$/, ''))}.</b> ${nl(e.descricao)}</p>`).join(''); });
  corpo += sec('Documentação mínima para apuração', bul(c.documentacao));
  corpo += sec('Situações críticas e controles', c.situacoes.length ? tbl(['Situação', 'Conduta'], c.situacoes.map(x => [`<td>${nl(x.situacao)}</td>`, `<td>${nl(x.conduta)}</td>`])) : '');
  corpo += sec('Fluxo resumido', c.fluxo_resumido ? `<p class="caps">${nl(c.fluxo_resumido)}</p>` : '');
  corpo += sec('Checklist operacional', c.checklist.length ? tbl(['Verificação', 'OK', 'Observações'], c.checklist.map(x => [`<td>${nl(x)}</td>`, '<td class="ck">☐</td>', '<td></td>']), [null, '16mm', '34%']) : '');
  corpo += sec('Formulários e documentos relacionados', bul(c.formularios));
  corpo += sec('Referências', bul(c.referencias));
  corpo += sec('Observação importante', par(c.observacao));
  if (meus.length) corpo += `<div class="nota">Assinaturas eletrônicas registradas no sistema Gestão Inteligente UPA Rocinha (login individual e confirmação por senha). Para conferir, leia o QR Code do quadro de aprovações ou use o código impresso em cada carimbo. SHA-256 do conteúdo: ${esc(d.hash)}.</div>`;
  const foot = `Cópia não controlada quando impressa ou transmitida eletronicamente<br>Propriedade UPA ROCINHA.`;
  return `<div class="doc">${wmTxt ? `<div class="wm">${esc(wmTxt)}</div>` : ''}<table class="pg"><thead><tr><td>${head}</td></tr></thead><tbody><tr><td>${corpo}</td></tr></tbody><tfoot><tr><td><div class="pf">${foot}</div></td></tr></tfoot></table></div>`;
}

/* ---------------- editor ---------------- */
const getP = (o, p) => p.split('.').reduce((a, k) => a == null ? a : a[k], o);
const setP = (o, p, v) => { const ks = p.split('.'), l = ks.pop(); ks.reduce((a, k) => a[k], o)[l] = v; };
const ta = (p, v, r) => `<textarea data-p="${p}" rows="${r || 2}">${esc(v)}</textarea>`;
function listaStr(p, arr) {
  return arr.map((v, i) => `<div class="rw"><textarea data-p="${p}.${i}" rows="2">${esc(v)}</textarea><button type="button" class="x" data-act="del" data-p="${p}.${i}" title="Remover">✕</button></div>`).join('') + `<button type="button" class="secondary small" data-act="add" data-p="${p}" data-t="">+ Adicionar</button>`;
}
function listaObj(p, arr, f) {
  return arr.map((o, i) => `<div class="rw obj">${f.map(([k, l]) => `<label class="fld">${l}${ta(p + '.' + i + '.' + k, o[k], 2)}</label>`).join('')}<button type="button" class="x" data-act="del" data-p="${p}.${i}" title="Remover">✕</button></div>`).join('') +
    `<button type="button" class="secondary small" data-act="add" data-p="${p}" data-t='${esc(JSON.stringify(Object.fromEntries(f.map(x => [x[0], '']))))}'>+ Adicionar</button>`;
}
function editorSecoes(c) {
  const blk = (t, h, dica) => `<details class="blk" open><summary>${t}</summary>${dica ? `<p class="muted">${dica}</p>` : ''}${h}</details>`;
  const fl = c.fluxos.map((f, i) => `<div class="fluxo"><label class="fld">Título do fluxo<input data-p="conteudo.fluxos.${i}.titulo" value="${esc(f.titulo)}"></label><label class="fld">Introdução do fluxo (opcional)${ta('conteudo.fluxos.' + i + '.introducao', f.introducao, 2)}</label>` +
    f.etapas.map((e, j) => `<div class="rw obj"><label class="fld">Etapa ${j + 1} – título<input data-p="conteudo.fluxos.${i}.etapas.${j}.titulo" value="${esc(e.titulo)}"></label><label class="fld">Descrição${ta('conteudo.fluxos.' + i + '.etapas.' + j + '.descricao', e.descricao, 3)}</label><span class="mv"><button type="button" class="secondary small" data-act="up" data-p="conteudo.fluxos.${i}.etapas.${j}" title="Subir">↑</button><button type="button" class="secondary small" data-act="down" data-p="conteudo.fluxos.${i}.etapas.${j}" title="Descer">↓</button><button type="button" class="x" data-act="del" data-p="conteudo.fluxos.${i}.etapas.${j}" title="Remover">✕</button></span></div>`).join('') +
    `<div class="actions"><button type="button" class="secondary small" data-act="add" data-p="conteudo.fluxos.${i}.etapas" data-t='{"titulo":"","descricao":""}'>+ Etapa</button><button type="button" class="danger small" data-act="del" data-p="conteudo.fluxos.${i}">Remover este fluxo</button></div></div>`).join('');
  return blk('Introdução', ta('conteudo.introducao', c.introducao, 5), 'Contexto: por que este POP existe. Separe parágrafos com uma linha em branco.') +
    blk('Objetivo', listaStr('conteudo.objetivo', c.objetivo)) +
    blk('Abrangência', ta('conteudo.abrangencia', c.abrangencia, 3)) +
    blk('Definições', listaObj('conteudo.definicoes', c.definicoes, [['termo', 'Termo'], ['definicao', 'Definição']])) +
    blk('Princípios e regras de conduta (opcional)', listaStr('conteudo.principios', c.principios)) +
    blk('Responsabilidades', listaObj('conteudo.responsabilidades', c.responsabilidades, [['funcao', 'Responsável'], ['atribuicao', 'Atribuições']])) +
    blk('Fluxos e etapas', fl + `<button type="button" class="secondary small" data-act="add" data-p="conteudo.fluxos" data-t='{"titulo":"Novo fluxo","introducao":"","etapas":[{"titulo":"","descricao":""}]}'>+ Novo fluxo</button>`, 'As etapas saem numeradas no documento.') +
    blk('Documentação mínima (opcional)', listaStr('conteudo.documentacao', c.documentacao)) +
    blk('Situações críticas e controles', listaObj('conteudo.situacoes', c.situacoes, [['situacao', 'Situação'], ['conduta', 'Conduta']])) +
    blk('Fluxo resumido', ta('conteudo.fluxo_resumido', c.fluxo_resumido, 3)) +
    blk('Checklist operacional', listaStr('conteudo.checklist', c.checklist), 'Cada item vira uma linha com caixa ☐ para marcar.') +
    blk('Formulários e documentos relacionados', listaStr('conteudo.formularios', c.formularios)) +
    blk('Referências', listaStr('conteudo.referencias', c.referencias)) +
    blk('Observação importante', ta('conteudo.observacao', c.observacao, 4));
}
function slotsHtml(d, ro) {
  const ativos = sigs.filter(s => s.ativo);
  return PAPEIS.map((p, i) => `<label class="fld">${p}${i === 0 ? ' *' : ''}<select data-slot="${esc(p)}"${ro ? ' disabled' : ''}><option value="">${i === 0 ? 'Escolha o signatário' : 'NA (não se aplica)'}</option>${ativos.map(s => `<option value="${esc(s.email)}"${(d.slots || {})[p] && d.slots[p].toLowerCase() === s.email.toLowerCase() ? ' selected' : ''}>${esc(s.nome)} — ${esc(s.cargo)}</option>`).join('')}</select></label>`).join('');
}
function painelAssinaturas(d) {
  const est = estado(d, asg), eu = meuEmail();
  const linhas = (d.signatarios || []).map(s => {
    const g = asg.find(x => x.versao === d.versao && x.hash === d.hash && String(x.email).toLowerCase() === s.email.toLowerCase());
    const souEu = s.email.toLowerCase() === eu;
    return `<tr><td>${esc(s.papel)}</td><td><b>${esc(s.nome)}</b><br><small>${esc(s.cargo)}${s.matricula ? ' · mat. ' + esc(s.matricula) : ''}</small></td><td>${g ? `<span class="pill ok">Assinado</span><br><small>${esc(dh(g.assinado_em))} · cód. ${esc(g.codigo)}</small>` : (d.status === 'em_assinatura' && souEu ? `<button type="button" data-act="assinar">Assinar agora</button>` : '<span class="pill warn">Pendente</span>')}</td></tr>`;
  }).join('');
  const aviso = integ && !integ.ok ? `<div class="alerta">⚠ ${esc(integ.motivo)} Gere uma nova revisão para corrigir.</div>` : '';
  return `<section class="view"><h3>Assinaturas eletrônicas</h3>${aviso}<div class="table-wrap"><table class="lista"><thead><tr><th>Papel</th><th>Signatário</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody></table></div><p class="muted">Cada pessoa assina com o próprio login e confirma com a senha. O sistema grava nome, matrícula, data/hora e um código que também aparece no QR Code do documento.${est === 'em_assinatura' && !(d.signatarios || []).some(s => s.email.toLowerCase() === eu) ? ' Seu e-mail (' + esc(eu) + ') não está entre os signatários deste POP.' : ''}</p></section>`;
}
async function viewDoc() {
  const d = cur, est = estado(d, asg), rasc = est === 'rascunho';
  const barra = `<div class="actions top"><button type="button" class="secondary" data-act="voltar">← Voltar à lista</button>` +
    (rasc ? `<button type="button" data-act="salvar">Salvar</button><button type="button" class="secondary" data-act="previa">${previa ? 'Voltar a editar' : 'Pré-visualizar'}</button><button type="button" data-act="enviar">Enviar para assinatura</button><button type="button" class="danger" data-act="excluir">Excluir rascunho</button>` :
      `<button type="button" data-act="imprimir">Imprimir / salvar PDF</button>` +
      (est === 'em_assinatura' && !asg.some(x => x.versao === d.versao && x.hash === d.hash) ? '<button type="button" class="secondary" data-act="reabrir">Voltar para rascunho</button>' : '') +
      ((est === 'vigente' || est === 'obsoleto') && !docs.some(x => x.codigo === d.codigo && x.versao > d.versao) ? '<button type="button" class="secondary" data-act="revisao">Criar nova revisão</button>' : '')) +
    `<span class="pill ${est}">${ST[est]}</span><small id="saveInfo" class="muted"></small></div>`;
  let corpo;
  if (rasc && !previa) {
    corpo = `<section class="view"><h2>${esc(d.codigo)} — dados do POP</h2><div class="grid"><label class="fld">Título<input data-p="titulo" value="${esc(d.titulo)}"></label><label class="fld">Código<input data-p="codigo" value="${esc(d.codigo)}"></label><label class="fld">Responsável (cabeçalho)<input data-p="responsavel" value="${esc(d.responsavel)}"></label><label class="fld">Elaborado em<input type="date" data-p="elaboradoEm" value="${esc(d.elaboradoEm)}"></label></div>
      <h3>Quem assina</h3>${sigs.filter(s => s.ativo).length ? '' : '<p class="alerta">Nenhum signatário cadastrado. Vá em "Signatários" e cadastre os coordenadores.</p>'}<div class="grid">${slotsHtml(d)}</div></section>
      <section class="view"><h2>Conteúdo</h2><p class="muted">Revise tudo antes de enviar para assinatura. Depois do envio o texto fica travado.</p>${editorSecoes(d.conteudo)}</section>`;
  } else {
    corpo = (rasc ? '' : painelAssinaturas(d)) + `<div class="sheet">${buildDoc(d, asg, integ)}</div>`;
  }
  $('content').innerHTML = barra + corpo;
}

/* ---------------- lista ---------------- */
async function viewLista() {
  [docs, sigs] = await Promise.all([carregarDocs(), carregarSigs().catch(() => [])]);
  const todas = await carregarAsg().catch(() => []); asg = todas;
  const eu = meuEmail();
  const linhas = docs.map(d => { const a = todas.filter(x => x.doc_id === d.id); return { d, est: estado(d, a), a }; })
    .filter(x => filtro.st === 'ativos' ? x.est !== 'obsoleto' : filtro.st === 'todos' ? true : x.est === filtro.st)
    .filter(x => !filtro.q || (x.d.titulo + ' ' + x.d.codigo).toLowerCase().includes(filtro.q.toLowerCase()))
    .sort((a, b) => String(b.d.atualizadoEm || '').localeCompare(String(a.d.atualizadoEm || '')));
  const aguardando = docs.filter(d => estado(d, todas.filter(x => x.doc_id === d.id)) === 'em_assinatura' && (d.signatarios || []).some(s => s.email.toLowerCase() === eu) && !todas.some(x => x.doc_id === d.id && x.versao === d.versao && x.hash === d.hash && String(x.email).toLowerCase() === eu)).length;
  $('content').innerHTML = `<section class="view"><h2>POPs da unidade</h2>${aguardando ? `<div class="alerta info">Você tem <b>${aguardando}</b> POP(s) aguardando a sua assinatura.</div>` : ''}
    <div class="actions"><button type="button" data-act="novo">+ Novo POP</button><select id="fSt"><option value="ativos">Em uso (sem obsoletos)</option><option value="todos">Todos</option>${Object.keys(ST).map(k => `<option value="${k}">${ST[k]}</option>`).join('')}</select><input id="fQ" type="search" placeholder="Buscar por título ou código" value="${esc(filtro.q)}" style="max-width:280px"></div>
    <div class="table-wrap"><table class="lista"><thead><tr><th>Código</th><th>Título</th><th>Rev.</th><th>Situação</th><th>Assinaturas</th><th>Atualizado</th><th></th></tr></thead><tbody>${linhas.length ? linhas.map(({ d, est, a }) => { const nec = (d.signatarios || []).length, ok = a.filter(x => x.versao === d.versao && x.hash === d.hash).length; return `<tr><td><b>${esc(d.codigo)}</b></td><td>${esc(d.titulo)}</td><td>${pad2(d.versao || 1)}</td><td><span class="pill ${est}">${ST[est]}</span></td><td>${nec ? ok + ' de ' + nec : '—'}</td><td>${esc(fd(String(d.atualizadoEm || '').slice(0, 10)))}</td><td><button type="button" class="small" data-act="abrir" data-id="${esc(d.id)}">Abrir</button></td></tr>`; }).join('') : '<tr><td colspan="7" class="muted">Nenhum POP ainda. Clique em "+ Novo POP".</td></tr>'}</tbody></table></div></section>`;
  $('fSt').value = filtro.st;
}

/* ---------------- novo POP (questionário) ---------------- */
function campo(q, v) {
  const id = 'q_' + q.k, val = esc(v != null ? v : (q.def || ''));
  return `<label class="fld${q.t === 'textarea' ? ' full' : ''}">${esc(q.l)}${q.t === 'textarea' ? `<textarea id="${id}" name="${esc(q.k)}" rows="${q.big ? 6 : 3}" placeholder="${esc(q.ph || '')}">${val}</textarea>` : `<input id="${id}" name="${esc(q.k)}" value="${val}" placeholder="${esc(q.ph || '')}">`}</label>`;
}
function viewNovo() {
  const t = temaSel;
  $('content').innerHTML = `<section class="view"><h2>Novo POP</h2><p class="muted">1) Escolha o tema. 2) Responda ao questionário. 3) A IA monta o POP completo no modelo da unidade, você revisa, envia para assinatura e imprime.</p>
    <div class="temas">${POP_TEMAS.map(x => `<button type="button" class="tema${t && t.id === x.id ? ' on' : ''}" data-act="tema" data-id="${x.id}"><b>${esc(x.nome)}</b><small>${esc(x.desc)}</small></button>`).join('')}</div></section>` +
    (t ? `<section class="view"><h2>Questionário: ${esc(t.nome)}</h2><form id="qf"><div class="grid"><label class="fld">Título do POP<input name="__titulo" value="${esc(t.id === 'livre' ? '' : t.nome)}" required></label><label class="fld">Área (define o código)<select name="__area">${POP_AREAS.map(a => `<option value="${a[0]}"${a[0] === t.area ? ' selected' : ''}>${a[0]} · ${a[1]}</option>`).join('')}</select></label>${POP_COMUNS.slice(0, 1).map(q => campo(q)).join('')}</div>
    <div class="grid">${t.q.map(q => campo(q)).join('')}${POP_COMUNS.slice(1).map(q => campo(q)).join('')}${POP_FINAIS.map(q => campo(q)).join('')}</div>
    <div class="chk"><label class="c"><input type="checkbox" name="__ia" checked> Usar IA para escrever o POP (se a função do Supabase não responder, uso o modelo-padrão)</label></div>
    <div class="actions"><button type="submit" id="qGo">Gerar POP</button><span id="qSt" class="muted"></span></div></form></section>` : '');
  if (t) $('qf').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function gerarIA(nome, rot) {
  const r = await C().functions.invoke('pop-gerar', { body: { tema: nome, respostas: rot } });
  if (r.error) { let det = ''; try { const j = await r.error.context.json(); det = j.erro || ''; } catch (e) { } throw new Error(det || r.error.message || 'Falha ao chamar a função.'); }
  if (!r.data || !r.data.conteudo) throw new Error((r.data && r.data.erro) || 'A IA não devolveu conteúdo.');
  return normalizar(r.data.conteudo);
}
async function criarPOP(form) {
  const fdt = new FormData(form), resp = {}; fdt.forEach((v, k) => { resp[k] = String(v).trim(); });
  const t = temaSel, nome = (t.id === 'livre' && resp.tema_livre) ? resp.tema_livre : t.nome;
  const rot = {}; [...POP_COMUNS, ...t.q, ...POP_FINAIS].forEach(q => { if (resp[q.k]) rot[q.l] = resp[q.k]; });
  rot['Título pretendido'] = resp.__titulo;
  const st = $('qSt'), btn = $('qGo'); btn.disabled = true;
  let conteudo, aviso = '';
  if (fdt.get('__ia')) {
    st.textContent = 'A IA está escrevendo o POP… (pode levar até 1 minuto)';
    try { conteudo = await gerarIA(nome, rot); } catch (e) { aviso = 'Não consegui usar a IA (' + erroTxt(e) + '). Gerei com o modelo-padrão: complete e revise as seções.'; }
  }
  if (!conteudo) conteudo = normalizar(popConteudoBase(t, resp));
  try { docs = await carregarDocs(); } catch (e) { }
  const d = { id: uuid(), codigo: proxCodigo(resp.__area), titulo: resp.__titulo || nome, tema: t.id, area: resp.__area, responsavel: (resp.responsavel || 'COORDENAÇÃO ADMINISTRATIVA').toUpperCase(), elaboradoEm: hoje(), versao: 1, status: 'rascunho', respostas: resp, conteudo, slots: {}, signatarios: [], hash: null };
  const meu = sigs.find(s => s.ativo && s.email.toLowerCase() === meuEmail()); if (meu) d.slots[PAPEIS[0]] = meu.email;
  await salvarDoc(d); docs.push(d);
  cur = d; asg = []; integ = null; previa = false; view = 'doc'; await render();
  notice(aviso || 'POP gerado. Revise cada seção, escolha quem assina e envie para assinatura.', !!aviso);
}

/* ---------------- signatários ---------------- */
let edSig = null;
async function viewSignatarios() {
  sigs = await carregarSigs();
  const eu = meuEmail(), admin = sigs.some(s => s.ativo && s.admin && s.email.toLowerCase() === eu), vazia = sigs.length === 0, pode = admin || vazia;
  const f = edSig || { nome: '', matricula: '', cargo: '', email: '', ativo: true, admin: vazia };
  $('content').innerHTML = `<section class="view"><h2>Signatários (coordenadores)</h2><p class="muted">Só quem está nesta lista pode assinar POPs. O e-mail precisa ser o <b>mesmo e-mail do login</b> da pessoa no sistema. ${vazia ? '<b>O primeiro cadastro vira administrador</b> (cadastre você primeiro).' : pode ? 'Você é administrador e pode alterar a lista.' : 'Somente administradores podem alterar a lista.'}</p>
    <div class="table-wrap"><table class="lista"><thead><tr><th>Nome</th><th>Cargo</th><th>Matrícula</th><th>E-mail de login</th><th>Situação</th><th></th></tr></thead><tbody>${sigs.length ? sigs.map(s => `<tr><td><b>${esc(s.nome)}</b></td><td>${esc(s.cargo)}</td><td>${esc(s.matricula)}</td><td>${esc(s.email)}</td><td>${s.ativo ? '<span class="pill ok">Ativo</span>' : '<span class="pill">Inativo</span>'}${s.admin ? ' <span class="pill warn">Admin</span>' : ''}</td><td>${pode ? `<button type="button" class="small secondary" data-act="edsig" data-id="${s.id}">Editar</button> <button type="button" class="small danger" data-act="delsig" data-id="${s.id}">Excluir</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="6" class="muted">Nenhum signatário cadastrado.</td></tr>'}</tbody></table></div>
    <p class="muted">Seu login: <b>${esc(eu)}</b> — ${sigs.some(s => s.ativo && s.email.toLowerCase() === eu) ? 'você está cadastrado como signatário.' : 'você ainda não é signatário.'}</p></section>` +
    (pode ? `<section class="view"><h3>${edSig && edSig.id ? 'Editar signatário' : 'Novo signatário'}</h3><form id="sf"><div class="grid"><label class="fld">Nome completo<input name="nome" required value="${esc(f.nome)}"></label><label class="fld">Cargo<input name="cargo" required list="cargos" value="${esc(f.cargo)}"><datalist id="cargos">${CARGOS.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label><label class="fld">Matrícula<input name="matricula" value="${esc(f.matricula)}"></label><label class="fld">E-mail de login<input name="email" type="email" required value="${esc(f.email)}"></label></div>
    <div class="chk"><label class="c"><input type="checkbox" name="ativo"${f.ativo ? ' checked' : ''}> Ativo</label><label class="c"><input type="checkbox" name="admin"${f.admin ? ' checked' : ''}> Administrador (pode alterar esta lista)</label></div><div class="actions"><button type="submit">Salvar signatário</button>${edSig ? '<button type="button" class="secondary" data-act="cancsig">Cancelar</button>' : ''}</div></form></section>` : '');
}

/* ---------------- assinatura ---------------- */
function modal(h) { $('modalBody').innerHTML = h; $('modal').classList.remove('hidden'); }
function fechar() { $('modal').classList.add('hidden'); }
function dlgAssinar() {
  const eu = meuEmail(), s = (cur.signatarios || []).find(x => x.email.toLowerCase() === eu);
  if (!s) { notice('Seu e-mail não está entre os signatários deste POP.', true); return; }
  modal(`<h3>Assinar eletronicamente</h3><p>Você assina como <b>${esc(s.nome)}</b> (${esc(s.cargo)}${s.matricula ? ', matrícula ' + esc(s.matricula) : ''}) no papel de <b>${esc(s.papel)}</b>:</p><p><b>${esc(cur.codigo)}</b> — ${esc(cur.titulo)} · revisão ${pad2(cur.versao)}<br><small>Integridade (SHA-256): ${esc(cur.hash.slice(0, 16))}…</small></p>
    <form id="af"><label class="chk"><span class="c" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="aLi" required style="margin-top:3px;width:auto"> Li o documento e concordo com o seu conteúdo.</span></label><label class="fld">Digite sua senha para confirmar<input type="password" id="aSenha" autocomplete="current-password" required></label><div id="aErr" class="err" style="min-height:18px"></div><div class="actions"><button type="submit" id="aGo">Confirmar assinatura</button><button type="button" class="secondary" data-act="fechar">Cancelar</button></div></form>`);
  setTimeout(() => $('aSenha') && $('aSenha').focus(), 50);
}
async function confirmarAssinatura() {
  const senha = $('aSenha').value, btn = $('aGo'), err = $('aErr'); btn.disabled = true; err.textContent = '';
  try {
    const eu = meuEmail(), s = cur.signatarios.find(x => x.email.toLowerCase() === eu);
    const rl = await C().auth.signInWithPassword({ email: eu, password: senha });
    if (rl.error) throw new Error('Senha incorreta.');
    const h = await hashDoc(cur);
    if (h !== cur.hash) throw new Error('O conteúdo do POP mudou depois do envio para assinatura. Volte para rascunho e reenvie.');
    const r = await C().from('pop_assinaturas').insert({ doc_id: cur.id, versao: cur.versao, hash: cur.hash, papel: s.papel, nome: s.nome, email: eu });
    if (r.error) throw r.error;
    fechar(); asg = await carregarAsg(cur.id);
    if (estado(cur, asg) === 'vigente' && cur.status !== 'vigente') {
      cur.status = 'vigente'; cur.publicadoEm = hoje(); await salvarDoc(cur);
      const antigos = (await carregarDocs()).filter(x => x.codigo === cur.codigo && x.versao < cur.versao && x.status !== 'obsoleto');
      for (const o of antigos) { o.status = 'obsoleto'; await salvarDoc(o); }
    }
    integ = await checarIntegridade(cur, asg); await render();
    notice('Assinatura registrada.');
  } catch (e) { err.textContent = erroTxt(e); btn.disabled = false; }
}

/* ---------------- ações ---------------- */
function lerSlots() { const m = {}; document.querySelectorAll('select[data-slot]').forEach(s => { if (s.value) m[s.dataset.slot] = s.value; }); return m; }
async function salvarAgora(silencioso) {
  if (!cur || estado(cur, asg) !== 'rascunho') return;
  clearTimeout(saveT); cur.slots = { ...cur.slots, ...lerSlots() };
  await salvarDoc(cur); sujo = false;
  const i = $('saveInfo'); if (i) i.textContent = 'Salvo às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (!silencioso) notice('Rascunho salvo.');
}
function agendar() { sujo = true; clearTimeout(saveT); saveT = setTimeout(() => salvarAgora(true).catch(e => notice(erroTxt(e), true)), 1800); const i = $('saveInfo'); if (i) i.textContent = 'Alterações não salvas…'; }
async function abrirDoc(id) {
  [sigs, asg] = await Promise.all([carregarSigs().catch(() => []), carregarAsg(id).catch(() => [])]);
  if (!docs.length) docs = await carregarDocs();
  cur = docs.find(d => d.id === id); if (!cur) throw new Error('POP não encontrado.');
  cur.conteudo = normalizar(cur.conteudo); cur.slots = cur.slots || {}; previa = false;
  integ = await checarIntegridade(cur, asg); view = 'doc'; await render();
}
const acoes = {
  async novo() { temaSel = null; view = 'novo'; await render(); },
  async tema(ds) { temaSel = POP_TEMAS.find(t => t.id === ds.id); viewNovo(); },
  async abrir(ds) { await abrirDoc(ds.id); },
  async voltar() { await salvarAgora(true); cur = null; view = 'lista'; await render(); },
  async salvar() { await salvarAgora(false); },
  async previa() { await salvarAgora(true); previa = !previa; await render(); },
  async excluir() { if (!confirm('Excluir este rascunho definitivamente?')) return; await UPA.db.del(cur.id); docs = docs.filter(d => d.id !== cur.id); cur = null; view = 'lista'; await render(); notice('Rascunho excluído.'); },
  async add(ds) { const arr = getP(cur, ds.p); arr.push(ds.t ? JSON.parse(ds.t) : ''); await salvarAgora(true); await render(); },
  async del(ds) { const ks = ds.p.split('.'), i = +ks.pop(); getP(cur, ks.join('.')).splice(i, 1); await salvarAgora(true); await render(); },
  async up(ds) { const ks = ds.p.split('.'), i = +ks.pop(), a = getP(cur, ks.join('.')); if (i > 0) { [a[i - 1], a[i]] = [a[i], a[i - 1]]; await salvarAgora(true); await render(); } },
  async down(ds) { const ks = ds.p.split('.'), i = +ks.pop(), a = getP(cur, ks.join('.')); if (i < a.length - 1) { [a[i + 1], a[i]] = [a[i], a[i + 1]]; await salvarAgora(true); await render(); } },
  async enviar() {
    cur.slots = { ...cur.slots, ...lerSlots() };
    const falta = []; if (!String(cur.titulo).trim()) falta.push('título'); if (!cur.slots[PAPEIS[0]]) falta.push('signatário de Elaboração/Revisão');
    if (!cur.conteudo.fluxos.some(f => f.etapas.length)) falta.push('ao menos um fluxo com etapas');
    const emails = Object.values(cur.slots).map(e => e.toLowerCase()); if (new Set(emails).size !== emails.length) falta.push('cada pessoa só pode ocupar um papel');
    if (falta.length) { notice('Falta: ' + falta.join('; ') + '.', true); return; }
    if (!confirm('Enviar para assinatura? O texto ficará travado. Para mudar depois será preciso voltar para rascunho (se ninguém assinou) ou criar nova revisão.')) return;
    cur.signatarios = PAPEIS.filter(p => cur.slots[p]).map(p => { const s = sigs.find(x => x.email.toLowerCase() === cur.slots[p].toLowerCase()); return { papel: p, email: s.email, nome: s.nome, matricula: s.matricula || '', cargo: s.cargo }; });
    cur.hash = await hashDoc(cur); cur.status = 'em_assinatura'; cur.congeladoEm = new Date().toISOString();
    await salvarDoc(cur); asg = await carregarAsg(cur.id); integ = await checarIntegridade(cur, asg); previa = false; await render();
    notice('Enviado para assinatura. Cada signatário deve entrar com o próprio login e clicar em "Assinar agora".');
  },
  async reabrir() { if (!confirm('Voltar para rascunho? (só é possível enquanto ninguém assinou)')) return; cur.status = 'rascunho'; cur.hash = null; await salvarDoc(cur); integ = null; await render(); },
  async revisao() {
    const n = JSON.parse(JSON.stringify(cur)); Object.assign(n, { id: uuid(), versao: cur.versao + 1, status: 'rascunho', hash: null, origem: cur.id, elaboradoEm: hoje(), publicadoEm: null, congeladoEm: null, criadoEm: null, signatarios: [] });
    await salvarDoc(n); docs.push(n); cur = n; asg = []; integ = null; previa = false; await render(); notice('Nova revisão criada como rascunho. A revisão anterior fica vigente até esta ser assinada.');
  },
  async assinar() { dlgAssinar(); },
  async imprimir() { $('printRoot').innerHTML = buildDoc(cur, asg, integ); document.body.classList.add('pv-on'); setTimeout(() => { window.print(); }, 150); },
  async fechar() { fechar(); },
  async edsig(ds) { edSig = sigs.find(s => s.id === ds.id) || null; await render(); },
  async cancsig() { edSig = null; await render(); },
  async delsig(ds) { if (!confirm('Excluir este signatário? (assinaturas já feitas continuam registradas)')) return; const r = await C().from('pop_signatarios').delete().eq('id', ds.id); if (r.error) throw r.error; await render(); }
};

/* ---------------- navegação ---------------- */
const VIEWS = [['lista', 'POPs'], ['novo', '+ Novo POP'], ['signatarios', 'Signatários']];
async function render() {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.v === (view === 'doc' ? 'lista' : view)));
  try {
    if (view === 'lista') await viewLista(); else if (view === 'novo') { if (!sigs.length) sigs = await carregarSigs().catch(() => []); viewNovo(); } else if (view === 'signatarios') await viewSignatarios(); else if (view === 'doc') await viewDoc();
  } catch (e) { notice(erroTxt(e), true); }
}
function ligar() {
  $('nav').innerHTML = VIEWS.map(v => `<button type="button" data-v="${v[0]}">${v[1]}</button>`).join('');
  $('nav').addEventListener('click', async e => { const b = e.target.closest('button[data-v]'); if (!b) return; await salvarAgora(true).catch(() => { }); view = b.dataset.v; cur = null; notice(''); if (view === 'novo') temaSel = null; await render(); });
  $('modalClose').onclick = fechar;
  document.body.addEventListener('click', async e => { const b = e.target.closest('[data-act]'); if (!b || !acoes[b.dataset.act]) return; try { await acoes[b.dataset.act](b.dataset, b, e); } catch (err) { notice(erroTxt(err), true); } });
  $('content').addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.p && cur) { setP(cur, t.dataset.p, t.value); agendar(); } else if (t.dataset.slot && cur) agendar();
    else if (t.id === 'fQ') { filtro.q = t.value; clearTimeout(ligar._t); ligar._t = setTimeout(render, 250); }
  });
  $('content').addEventListener('change', async e => { const t = e.target; if (t.id === 'fSt') { filtro.st = t.value; await render(); } else if (t.dataset.slot && cur) { cur.slots = { ...cur.slots, ...lerSlots() }; agendar(); } });
  document.body.addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target;
    try {
      if (f.id === 'qf') await criarPOP(f);
      else if (f.id === 'af') await confirmarAssinatura();
      else if (f.id === 'sf') {
        const fd_ = new FormData(f), o = { nome: String(fd_.get('nome')).trim(), cargo: String(fd_.get('cargo')).trim(), matricula: String(fd_.get('matricula')).trim(), email: String(fd_.get('email')).trim().toLowerCase(), ativo: !!fd_.get('ativo'), admin: !!fd_.get('admin') };
        const r = edSig && edSig.id ? await C().from('pop_signatarios').update(o).eq('id', edSig.id) : await C().from('pop_signatarios').insert(o);
        if (r.error) throw r.error; edSig = null; await render(); notice('Signatário salvo.');
      }
    } catch (err) { notice(erroTxt(err), true); const b = f.querySelector('button[type=submit]'); if (b) b.disabled = false; }
  });
  window.addEventListener('afterprint', () => document.body.classList.remove('pv-on'));
  window.addEventListener('beforeunload', e => { if (sujo) { e.preventDefault(); e.returnValue = ''; } });
}
async function init() {
  try { await UPA.ready(); } catch (e) { notice(UPA.msg(e), true); return; }
  ligar(); await render();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
