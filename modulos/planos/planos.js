'use strict';
/* Planos de Ação / Contratos (UPA Rocinha)
   Texto, checklist e anexos em "registros" (coleção planos_acao). Assinaturas em plano_assinaturas (sql/planos.sql).
   Assinatura = login + senha + desenho à mão na tela, ligada ao SHA-256 do conteúdo. NÃO é assinatura digital qualificada (ICP-Brasil/gov.br). */
const $ = id => document.getElementById(id);
const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = s => esc(s).replace(/\n/g, '<br>');
const uuid = () => crypto.randomUUID();
const hoje = () => new Date().toLocaleDateString('en-CA');
const fd = d => { if (!d) return ''; const p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(d); };
const dh = iso => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
const pad2 = n => String(n).padStart(2, '0');
const meuEmail = () => { const u = window.UPA && UPA.user(); return ((u && u.email) || '').toLowerCase(); };
const COL = 'planos_acao';
const PAPEIS = ['Elaboração', 'Revisão', 'Aprovação', 'Ciência'];
/* Regra da unidade: ≥2 coordenadores + engenheiro da Gnosis + proprietário da BOSS (ou, na falta dele, 1 representante da empresa) */
const EMPRESAS = ['Gnosis', 'BOSS'];
const PAPEIS_EXT = { Gnosis: ['Engenheiro'], BOSS: ['Proprietário', 'Representante'] };
const slug = t => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ehExt = s => !!s.externo;
function conferirRegra(d) {
  const L = d.signatarios || [], int = L.filter(s => !ehExt(s)), f = [];
  if (int.length < 2) f.push('pelo menos 2 coordenadores (há ' + int.length + ')');
  if (!L.some(s => ehExt(s) && s.empresa === 'Gnosis' && s.papel === 'Engenheiro')) f.push('o engenheiro da Gnosis');
  if (!L.some(s => ehExt(s) && s.empresa === 'BOSS' && (s.papel === 'Proprietário' || s.papel === 'Representante'))) f.push('o proprietário da BOSS (ou 1 representante da empresa)');
  return f;
}
const TIPOS = ['Plano de ação', 'Contrato', 'Plano + contrato'];
const ST = { rascunho: 'Rascunho', em_assinatura: 'Em assinatura', vigente: 'Vigente', obsoleto: 'Obsoleto' };
const PS = { pendente: 'Pendente', andamento: 'Em andamento', feito: 'Feito' };
const C = () => UPA.client();

let view = 'lista', cur = null, docs = [], asg = [], sigs = [], filtro = { st: 'ativos', q: '' };

function notice(t, erro) { const m = $('message'); m.textContent = t || ''; m.className = erro ? 'err' : (t ? 'okm' : ''); if (t) m.scrollIntoView({ block: 'nearest' }); }
function erroTxt(e) {
  const m = (e && (e.message || e.details)) || String(e);
  if (/does not exist|Could not find the table|schema cache|relation/i.test(m)) return 'As tabelas de Planos de Ação ainda não existem. Rode sql/planos.sql no SQL Editor do Supabase (uma vez).';
  if (/row-level security|violates/i.test(m)) return 'Sem permissão para esta ação (regras do banco). ' + m;
  return (window.UPA && UPA.msg) ? UPA.msg(e) : m;
}

/* ---------------- dados ---------------- */
async function carregarDocs() { const r = await UPA.db.list(COL); return r.map(x => ({ ...x.dados, id: x.id })); }
async function salvarDoc(d) {
  d.atualizadoEm = new Date().toISOString(); d.atualizadoPor = meuEmail();
  if (!d.criadoEm) { d.criadoEm = d.atualizadoEm; d.criadoPor = d.atualizadoPor; }
  await UPA.db.put(COL, d.id, d); return d;
}
async function carregarSigs() { const r = await C().from('pop_signatarios').select('nome,cargo,matricula,email,ativo').eq('ativo', true).order('nome'); if (r.error) throw r.error; return r.data || []; }
async function carregarAsg(id) {
  let q = C().from('plano_assinaturas').select('id,plano_id,versao,hash,papel,nome,matricula,cargo,email,codigo,assinado_em,externo,empresa,colhido_por' + (id ? ',traco' : '')).order('assinado_em');
  if (id) q = q.eq('plano_id', id); else q = q.limit(5000);
  const r = await q; if (r.error) throw r.error; return r.data || [];
}

/* ---------------- integridade ---------------- */
function canon(o) {
  if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
  if (o && typeof o === 'object') return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
  return JSON.stringify(o == null ? null : o);
}
async function sha256(data) { const b = await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
/* o que entra no hash: tudo que define o documento (NÃO entra o andamento do checklist) */
const baseHash = d => ({
  titulo: d.titulo, tipo: d.tipo, versao: d.versao, descricao: d.descricao, responsavel: d.responsavel, empresa: d.empresa, numero: d.numero, vigenciaFim: d.vigenciaFim,
  requisitos: d.requisitos, itens: (d.itens || []).map(i => ({ id: i.id, texto: i.texto, resp: i.resp, prazo: i.prazo, grupo: i.grupo || '', freq: i.freq || '' })),
  anexos: (d.anexos || []).map(a => ({ nome: a.nome, sha256: a.sha256 })), signatarios: (d.signatarios || []).map(s => ({ papel: s.papel, email: String(s.email).toLowerCase(), externo: !!s.externo, nome: s.externo ? s.nome : undefined, empresa: s.externo ? s.empresa : undefined }))
});
const hashDoc = d => sha256(canon(baseHash(d)));

function estado(d, a) {
  if (d.status === 'obsoleto') return 'obsoleto';
  if (!d.status || d.status === 'rascunho') return 'rascunho';
  const need = (d.signatarios || []).map(s => String(s.email).toLowerCase());
  const ok = need.length && need.every(e => a.some(x => x.plano_id === d.id && x.versao === d.versao && x.hash === d.hash && String(x.email).toLowerCase() === e));
  return ok ? 'vigente' : 'em_assinatura';
}
const feitas = (d, a) => (d.signatarios || []).filter(s => a.some(x => x.plano_id === d.id && x.versao === d.versao && x.hash === d.hash && String(x.email).toLowerCase() === String(s.email).toLowerCase())).length;
function progresso(d) {
  const it = d.itens || [], p = d.prog || {}; const f = it.filter(i => (p[i.id] || {}).st === 'feito').length;
  return { feitos: f, total: it.length, pct: it.length ? Math.round(100 * f / it.length) : 0 };
}
const atrasado = (d, i) => i.prazo && i.prazo < hoje() && ((d.prog || {})[i.id] || {}).st !== 'feito';

/* ---------------- arquivos ---------------- */
async function anexarArquivos(d, files) {
  const out = [];
  for (const fl of files) {
    if (fl.size > 15 * 1024 * 1024) throw new Error('Arquivo acima de 15 MB: ' + fl.name);
    const sh = await sha256(await fl.arrayBuffer());
    const path = `planos/${d.id}/${uuid().slice(0, 8)}-${fl.name.replace(/[^\w.\-]+/g, '_')}`;
    await UPA.files.upload(path, fl, fl.type); out.push({ nome: fl.name, path, sha256: sh, tamanho: fl.size });
  }
  return out;
}
async function abrirArq(path) { const u = await UPA.files.urls([path]); if (u[path]) window.open(u[path], '_blank', 'noopener'); else notice('Não consegui abrir o arquivo.', true); }

/* ---------------- lista ---------------- */
async function viewLista() {
  docs = await carregarDocs(); asg = await carregarAsg().catch(() => []);
  const q = filtro.q.toLowerCase();
  const L = docs.map(d => ({ d, est: estado(d, asg) })).filter(x => (filtro.st === 'ativos' ? x.est !== 'obsoleto' : filtro.st === 'todos' || x.est === filtro.st) && (!q || (x.d.titulo + ' ' + (x.d.empresa || '') + ' ' + (x.d.requisitos || []).join(' ')).toLowerCase().includes(q)))
    .sort((a, b) => String(b.d.atualizadoEm).localeCompare(String(a.d.atualizadoEm)));
  $('content').innerHTML = `<section class="view"><div class="row-end"><div><h2>Planos de ação e contratos</h2><p class="muted">Guarde o documento, acompanhe o checklist e colha as assinaturas. Planos vigentes ligados ao requisito aparecem sozinhos como evidência em <b>Adequação SUBHUE</b>.</p></div>
  <div class="actions"><button type="button" data-act="novo">+ Novo plano / contrato</button><button type="button" class="secondary" data-act="importar">⇧ Importar modelo (JSON)</button><input type="file" id="impFile" accept=".json,application/json" class="hidden"></div></div>
  <div class="filtro"><label>Situação<select id="fSt">${[['ativos', 'Ativos'], ['todos', 'Todos'], ...Object.entries(ST)].map(([k, v]) => `<option value="${k}"${filtro.st === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label><label>Buscar<input id="fQ" value="${esc(filtro.q)}" placeholder="título, empresa, requisito"></label></div>
  <div class="table-wrap"><table class="lista"><thead><tr><th>Título</th><th>Tipo</th><th>Rev.</th><th>Requisito SUBHUE</th><th>Situação</th><th>Assinaturas</th><th>Checklist</th><th></th></tr></thead><tbody>
  ${L.map(({ d, est }) => { const p = progresso(d); return `<tr><td><b>${esc(d.titulo)}</b>${d.empresa ? `<br><small>${esc(d.empresa)}${d.numero ? ' · ' + esc(d.numero) : ''}</small>` : ''}</td><td>${esc(d.tipo || '')}</td><td>${pad2(d.versao || 1)}</td><td>${esc((d.requisitos || []).join(', '))}</td><td><span class="pill ${est}">${ST[est]}</span></td><td>${d.status && d.status !== 'rascunho' ? feitas(d, asg) + ' de ' + (d.signatarios || []).length : '—'}</td><td>${p.total ? `${p.feitos}/${p.total} (${p.pct}%)` : '—'}</td><td><button type="button" class="small" data-act="abrir" data-id="${esc(d.id)}">Abrir</button></td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">Nenhum plano cadastrado. Clique em “+ Novo plano / contrato”.</td></tr>'}</tbody></table></div></section>`;
}

/* ---------------- editor / detalhe ---------------- */
function novoDoc() {
  return { id: uuid(), titulo: '', tipo: TIPOS[0], descricao: '', responsavel: '', empresa: '', numero: '', vigenciaFim: '', requisitos: ['3.7-2'], versao: 1, status: 'rascunho', itens: [], anexos: [], signatarios: [], prog: {} };
}
function lerForm() {
  if (!cur || cur.status !== 'rascunho' || !$('fTit')) return;
  const v = id => ($(id) ? $(id).value.trim() : '');
  cur.titulo = v('fTit'); cur.tipo = v('fTipo'); cur.descricao = v('fDesc'); cur.responsavel = v('fResp'); cur.empresa = v('fEmp'); cur.numero = v('fNum'); cur.vigenciaFim = v('fVig');
  cur.requisitos = v('fReq').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
  document.querySelectorAll('[data-it]').forEach(r => { const it = cur.itens.find(x => x.id === r.dataset.it); if (it) { it.texto = r.querySelector('[data-f=texto]').value.trim(); it.resp = r.querySelector('[data-f=resp]').value.trim(); it.prazo = r.querySelector('[data-f=prazo]').value; it.grupo = r.querySelector('[data-f=grupo]').value.trim(); it.freq = r.querySelector('[data-f=freq]').value.trim(); } });
}
function viewDoc() {
  const d = cur, est = estado(d, asg), rasc = d.status === 'rascunho', p = progresso(d), eu = meuEmail();
  const barra = `<div class="actions top"><button type="button" class="secondary" data-act="voltar">← Voltar à lista</button>` +
    (rasc ? `<button type="button" data-act="salvar">Salvar</button><button type="button" class="secondary" data-act="relatorio">Relatório de execução (PDF)</button><button type="button" class="secondary" data-act="enviar">Enviar para assinatura</button><button type="button" class="danger" data-act="excluir">Excluir rascunho</button>` :
      `<button type="button" data-act="imprimir">Imprimir / salvar PDF</button><button type="button" data-act="relatorio">Relatório de execução (PDF)</button>` +
      (est === 'em_assinatura' && !asg.some(x => x.versao === d.versao && x.hash === d.hash) ? '<button type="button" class="secondary" data-act="rascunho">Voltar para rascunho</button>' : '') +
      ((est === 'vigente' || est === 'obsoleto') && !docs.some(x => x.origem === d.id) ? '<button type="button" class="secondary" data-act="revisao">Nova revisão</button>' : '')) + `</div>`;
  const disp = !rasc ? 'disabled' : '';
  const dados = `<section class="view"><div class="row-end"><h2>${rasc ? 'Plano / contrato' : esc(d.titulo)} <span class="pill ${est}">${ST[est]}</span></h2><small class="muted">Rev. ${pad2(d.versao)}${d.hash ? ' · integridade ' + esc(d.hash.slice(0, 8)) : ''}</small></div>
  <div class="grid">
   <label class="fld full">Título<input id="fTit" value="${esc(d.titulo)}" ${disp} placeholder="Ex.: Plano de manutenção preventiva predial 2026"></label>
   <label class="fld">Tipo<select id="fTipo" ${disp}>${TIPOS.map(t => `<option${d.tipo === t ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
   <label class="fld">Requisito(s) SUBHUE (ex.: 3.7-2)<input id="fReq" value="${esc((d.requisitos || []).join(', '))}" ${disp}></label>
   <label class="fld">Responsável pelo plano<input id="fResp" value="${esc(d.responsavel)}" ${disp}></label>
   <label class="fld">Empresa contratada (se contrato)<input id="fEmp" value="${esc(d.empresa)}" ${disp}></label>
   <label class="fld">Nº do contrato<input id="fNum" value="${esc(d.numero)}" ${disp}></label>
   <label class="fld">Fim da vigência do contrato<input type="date" id="fVig" value="${esc(d.vigenciaFim)}" ${disp}></label>
   <label class="fld full">Descrição / objetivo<textarea id="fDesc" ${disp}>${esc(d.descricao)}</textarea></label></div>
  ${d.vigenciaFim && d.vigenciaFim < hoje() ? '<div class="alerta">Contrato com vigência vencida em ' + fd(d.vigenciaFim) + '.</div>' : ''}</section>`;
  const anexos = `<section class="view"><h3 style="margin-top:0">Documentos anexados (plano, contrato)</h3>
   ${(d.anexos || []).map((a, n) => `<div class="rw"><a href="#" data-act="abrirArq" data-p="${esc(a.path)}">${esc(a.nome)}</a><small class="muted">SHA-256 ${esc((a.sha256 || '').slice(0, 12))}…</small>${rasc ? `<button type="button" class="small danger" data-act="rmAnexo" data-n="${n}">remover</button>` : ''}</div>`).join('') || '<p class="muted">Nenhum arquivo anexado.</p>'}
   ${rasc ? '<label class="fld">Anexar (PDF, Word, foto)<input type="file" id="fArq" multiple></label>' : '<p class="muted">Após o envio para assinatura os anexos ficam travados (o código do arquivo entra na assinatura).</p>'}</section>`;
  const itens = `<section class="view"><div class="row-end"><h3 style="margin:0">Checklist</h3>${p.total ? `<span class="pill ${p.pct === 100 ? 'ok' : 'warn'}">${p.feitos} de ${p.total} · ${p.pct}%</span>` : ''}</div>
   ${p.total ? `<div class="bar" style="margin:8px 0"><i style="width:${p.pct}%"></i></div>` : ''}
   ${(d.itens || []).map((it, n) => (it.grupo && (n === 0 || (d.itens[n - 1].grupo || '') !== it.grupo) ? `<div class="sec-title">${esc(it.grupo)}</div>` : '') + (rasc ? `<div class="rw obj" data-it="${esc(it.id)}"><label class="fld" style="flex:3">Item ${n + 1}<textarea data-f="texto" rows="2">${esc(it.texto)}</textarea></label><label class="fld">Responsável<input data-f="resp" value="${esc(it.resp)}"></label><label class="fld">Prazo<input type="date" data-f="prazo" value="${esc(it.prazo)}"></label><label class="fld">Grupo<input data-f="grupo" value="${esc(it.grupo || '')}" placeholder="Ex.: Cronograma"></label><label class="fld">Frequência<input data-f="freq" value="${esc(it.freq || '')}"></label><button type="button" class="x small danger" data-act="rmItem" data-id="${esc(it.id)}">✕</button></div>` : linhaItem(d, it, n))).join('') || '<p class="muted">Nenhum item. Adicione os itens do checklist do plano.</p>'}
   ${rasc ? '<div class="actions"><button type="button" class="secondary small" data-act="addItem">+ Item do checklist</button></div>' : ''}</section>`;
  const sg = `<section class="view"><h3 style="margin-top:0">Assinaturas</h3>${rasc ? sigsEdit(d) : sigsPainel(d)}</section>`;
  $('content').innerHTML = barra + dados + anexos + itens + sg;
}
function linhaItem(d, it, n) {
  const g = (d.prog || {})[it.id] || {}, st = g.st || 'pendente', pode = d.status !== 'obsoleto';
  return `<div class="rw obj" style="display:block"><div class="row-end"><div><b>${n + 1}.</b> ${nl(it.texto)}<br><small class="muted">${it.freq ? 'Frequência: ' + esc(it.freq) + ' · ' : ''}${it.resp ? 'Resp.: ' + esc(it.resp) : ''}${it.prazo ? ' · prazo ' + fd(it.prazo) : ''}</small>${atrasado(d, it) ? ' <span class="pill bad">atrasado</span>' : ''}</div>
   <div><select data-prog="${esc(it.id)}" data-k="st" ${pode ? '' : 'disabled'}>${Object.entries(PS).map(([k, v]) => `<option value="${k}"${st === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div></div>
   <div class="grid" style="margin-top:6px"><label class="fld">Data da execução<input type="date" data-prog="${esc(it.id)}" data-k="dataExec" value="${esc(g.dataExec || '')}" ${pode ? '' : 'disabled'}></label><label class="fld">Nº da OS<input data-prog="${esc(it.id)}" data-k="os" value="${esc(g.os || '')}" ${pode ? '' : 'disabled'}></label><label class="fld">Executado por<input data-prog="${esc(it.id)}" data-k="exec" value="${esc(g.exec || '')}" ${pode ? '' : 'disabled'}></label></div>
   <div style="margin-top:2px"><input data-prog="${esc(it.id)}" data-k="obs" value="${esc(g.obs || '')}" placeholder="Observação / como foi feito" ${pode ? '' : 'disabled'}>
   ${(g.evid || []).map((e, k) => `<small><a href="#" data-act="abrirArq" data-p="${esc(e.path)}">${esc(e.nome)}</a>${pode ? ` <a href="#" data-act="rmEvid" data-id="${esc(it.id)}" data-k="${k}">✕</a>` : ''}</small>`).join(' · ')}
   ${pode ? `<label class="fld" style="margin:4px 0 0">Anexar evidência do item<input type="file" data-evid="${esc(it.id)}" multiple></label>` : ''}${g.data ? `<small class="muted">Atualizado em ${fd(g.data)} por ${esc(g.por || '')}</small>` : ''}</div></div>`;
}
function sigsEdit(d) {
  const usados = new Set((d.signatarios || []).map(s => String(s.email).toLowerCase())), falta = conferirRegra(d);
  return `<p class="muted"><b>Regra:</b> pelo menos 2 coordenadores, o engenheiro da Gnosis e o proprietário da BOSS (ou, no lugar dele, 1 representante da empresa). Coordenadores assinam com o próprio login. Os externos não têm login: um coordenador logado colhe a assinatura deles na tela do celular.</p>
  ${falta.length ? `<div class="alerta">Ainda falta: ${falta.map(esc).join('; ')}.</div>` : '<div class="alerta info">Regra de assinantes atendida.</div>'}
  ${(d.signatarios || []).map((s, n) => `<div class="rw"><span><b>${esc(s.papel)}</b> — ${esc(s.nome)} <small class="muted">${s.externo ? esc(s.empresa) + ' · externo' : esc(s.cargo)}</small></span><button type="button" class="small danger" data-act="rmSig" data-n="${n}">remover</button></div>`).join('') || '<p class="muted">Nenhum signatário escolhido.</p>'}
  <h4 style="margin:14px 0 4px">Coordenador (com login)</h4>
  <div class="actions" style="margin-top:4px"><select id="sPap">${PAPEIS.map(x => `<option>${x}</option>`).join('')}</select><select id="sPes"><option value="">Escolher pessoa…</option>${sigs.filter(s => !usados.has(String(s.email).toLowerCase())).map(s => `<option value="${esc(s.email)}">${esc(s.nome)} — ${esc(s.cargo)}</option>`).join('')}</select><button type="button" class="small" data-act="addSig">Adicionar</button></div>
  <h4 style="margin:14px 0 4px">Externo (Gnosis / BOSS)</h4>
  <div class="grid"><label class="fld">Empresa<select id="eEmp">${EMPRESAS.map(x => `<option>${x}</option>`).join('')}</select></label><label class="fld">Papel<select id="ePap"><option>Engenheiro</option><option>Proprietário</option><option>Representante</option></select></label>
  <label class="fld">Nome completo<input id="eNome"></label><label class="fld">Cargo / registro (ex.: Engenheiro civil, CREA…)<input id="eCargo"></label></div>
  <div class="actions" style="margin-top:0"><button type="button" class="small" data-act="addExt">Adicionar externo</button></div>`;
}
function sigsPainel(d) {
  const eu = meuEmail();
  return `<div class="table-wrap"><table><thead><tr><th>Papel</th><th>Signatário</th><th>Situação</th><th>Assinatura</th></tr></thead><tbody>${(d.signatarios || []).map(s => {
    const g = asg.find(x => x.versao === d.versao && x.hash === d.hash && String(x.email).toLowerCase() === String(s.email).toLowerCase());
    const souEu = String(s.email).toLowerCase() === eu, possoColher = sigs.some(x => String(x.email).toLowerCase() === eu);
    return `<tr><td>${esc(s.papel)}</td><td><b>${esc(s.nome)}</b><br><small>${esc(s.cargo)}${s.externo ? ' · ' + esc(s.empresa) : ''}${s.matricula ? ' · mat. ' + esc(s.matricula) : ''}</small></td><td>${g ? `<span class="pill ok">Assinado</span><br><small>${esc(dh(g.assinado_em))} · cód. ${esc(g.codigo)}${g.colhido_por ? '<br>colhida por ' + esc(g.colhido_por) : ''}</small>` : (d.status === 'em_assinatura' && s.externo && possoColher ? `<button type="button" data-act="colher" data-e="${esc(s.email)}">Colher assinatura</button>` : d.status === 'em_assinatura' && !s.externo && souEu ? '<button type="button" data-act="assinar">Assinar agora</button>' : '<span class="pill warn">Pendente</span>')}</td><td>${g && g.traco ? `<img src="${g.traco}" alt="assinatura" style="height:48px;background:#fff;border:1px solid #d4e1f2;border-radius:6px">` : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
}

/* ---------------- assinatura à mão ---------------- */
let traços = 0;
function modal(h) { $('modalBody').innerHTML = h; $('modal').classList.remove('hidden'); }
function fechar() { $('modal').classList.add('hidden'); }
function dlgColher(email) {
  const s = (cur.signatarios || []).find(x => x.email === email); if (!s) return;
  modal(`<h3>Colher assinatura de ${esc(s.nome)}</h3><p>${esc(s.papel)} · ${esc(s.empresa)}${s.cargo ? ' · ' + esc(s.cargo) : ''}<br><b>${esc(cur.titulo)}</b> · revisão ${pad2(cur.versao)}<br><small>Integridade (SHA-256): ${esc(cur.hash.slice(0, 16))}…</small></p>
   <form id="af" data-ext="${esc(email)}"><label class="chk"><span class="c" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="aLi" required style="margin-top:3px;width:auto"> ${esc(s.nome)} declara ter lido o documento e concordar com o seu conteúdo, e assina de próprio punho abaixo.</span></label>
   <label class="fld">Documento de identificação (opcional: CPF ou CREA)<input id="aDoc"></label>
   <label class="fld">Assinatura de ${esc(s.nome)} (entregue o aparelho a ele)<canvas id="sigCv" style="display:block;width:100%;height:170px;background:#fff;border:2px dashed #8aa6c1;border-radius:8px;touch-action:none"></canvas></label>
   <div class="actions" style="margin:4px 0"><button type="button" class="secondary small" data-act="limparTraco">Limpar</button></div>
   <label class="fld">Sua senha (coordenador que está colhendo e responde pelo registro)<input type="password" id="aSenha" autocomplete="current-password" required></label><div id="aErr" class="err" style="min-height:18px"></div>
   <div class="actions"><button type="submit" id="aGo">Registrar assinatura</button><button type="button" class="secondary" data-act="fechar">Cancelar</button></div></form>`);
  prepararCanvas();
}
function dlgAssinar() {
  const eu = meuEmail(), s = (cur.signatarios || []).find(x => String(x.email).toLowerCase() === eu);
  if (!s) { notice('Seu e-mail não está entre os signatários deste plano.', true); return; }
  modal(`<h3>Assinar eletronicamente</h3><p>Você assina como <b>${esc(s.nome)}</b> (${esc(s.cargo)}) no papel de <b>${esc(s.papel)}</b>:</p><p><b>${esc(cur.titulo)}</b> · revisão ${pad2(cur.versao)}<br><small>Integridade (SHA-256): ${esc(cur.hash.slice(0, 16))}…</small></p>
   <form id="af"><label class="chk"><span class="c" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="aLi" required style="margin-top:3px;width:auto"> Li o documento e concordo com o seu conteúdo.</span></label>
   <label class="fld">Desenhe sua assinatura com o dedo (ou mouse)<canvas id="sigCv" style="display:block;width:100%;height:170px;background:#fff;border:2px dashed #8aa6c1;border-radius:8px;touch-action:none"></canvas></label>
   <div class="actions" style="margin:4px 0"><button type="button" class="secondary small" data-act="limparTraco">Limpar</button></div>
   <label class="fld">Digite sua senha para confirmar<input type="password" id="aSenha" autocomplete="current-password" required></label><div id="aErr" class="err" style="min-height:18px"></div>
   <div class="actions"><button type="submit" id="aGo">Confirmar assinatura</button><button type="button" class="secondary" data-act="fechar">Cancelar</button></div></form>`);
  prepararCanvas();
}
function prepararCanvas() {
  const cv = $('sigCv'), r = cv.getBoundingClientRect(), k = Math.max(1, window.devicePixelRatio || 1); traços = 0;
  cv.width = Math.round(r.width * k); cv.height = Math.round(r.height * k);
  const x = cv.getContext('2d'); x.scale(k, k); x.lineWidth = 2.4; x.lineCap = x.lineJoin = 'round'; x.strokeStyle = '#0b2545';
  let desenhando = false, ult = null;
  const pt = e => { const b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  cv.addEventListener('pointerdown', e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); desenhando = true; ult = pt(e); x.beginPath(); x.arc(ult.x, ult.y, 1.1, 0, 6.3); x.fillStyle = '#0b2545'; x.fill(); traços++; });
  cv.addEventListener('pointermove', e => { if (!desenhando) return; e.preventDefault(); const p = pt(e); x.beginPath(); x.moveTo(ult.x, ult.y); x.lineTo(p.x, p.y); x.stroke(); ult = p; traços++; });
  const fim = () => { desenhando = false; }; cv.addEventListener('pointerup', fim); cv.addEventListener('pointercancel', fim);
}
function limparTraco() { const cv = $('sigCv'); if (!cv) return; const x = cv.getContext('2d'); x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height); x.restore(); traços = 0; }
function tracoPng() {
  const cv = $('sigCv'), W = 480, H = Math.round(480 * cv.height / cv.width), o = document.createElement('canvas'); o.width = W; o.height = H;
  const x = o.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(cv, 0, 0, W, H); return o.toDataURL('image/png');
}
async function confirmarAssinatura() {
  const senha = $('aSenha').value, btn = $('aGo'), err = $('aErr'); btn.disabled = true; err.textContent = '';
  try {
    if (traços < 12) throw new Error('Desenhe a assinatura na área pontilhada antes de confirmar.');
    const ext = $('af').dataset.ext, eu = meuEmail(), s = cur.signatarios.find(x => String(x.email).toLowerCase() === (ext || eu).toLowerCase());
    const rl = await C().auth.signInWithPassword({ email: eu, password: senha });
    if (rl.error) throw new Error('Senha incorreta.');
    const h = await hashDoc(cur);
    if (h !== cur.hash) throw new Error('O conteúdo mudou depois do envio para assinatura. Volte para rascunho e reenvie.');
    const r = await C().from('plano_assinaturas').insert({ plano_id: cur.id, versao: cur.versao, hash: cur.hash, papel: s.papel, nome: s.nome, email: ext ? s.email : eu, traco: tracoPng(), externo: !!ext, empresa: ext ? s.empresa : null, documento: ext ? ($('aDoc').value.trim() || null) : null });
    if (r.error) throw r.error;
    fechar(); asg = await carregarAsg(cur.id);
    if (estado(cur, asg) === 'vigente' && cur.status !== 'vigente') {
      cur.status = 'vigente'; cur.publicadoEm = hoje(); await salvarDoc(cur);
      for (const o of (await carregarDocs()).filter(x => x.id !== cur.id && x.origemRaiz === cur.origemRaiz && x.versao < cur.versao && x.status !== 'obsoleto')) { o.status = 'obsoleto'; await salvarDoc(o); }
    }
    docs = await carregarDocs(); viewDoc(); notice('Assinatura registrada.');
  } catch (e) { err.textContent = erroTxt(e); btn.disabled = false; }
}

/* ---------------- impressão ---------------- */
function imprimir() {
  const d = cur, est = estado(d, asg), p = progresso(d), ass = d.signatarios || [];
  const html = `<div class="doc"><div style="text-align:center"><img src="../../assets/logo-upa.png" alt="UPA Rocinha" style="height:60px"></div><h2 style="text-align:center">${esc(d.titulo)}</h2>
  <table class="t kv"><tr><td>Tipo</td><td>${esc(d.tipo)} · revisão ${pad2(d.versao)} · ${ST[est]}</td></tr><tr><td>Requisito SUBHUE</td><td>${esc((d.requisitos || []).join(', '))}</td></tr><tr><td>Responsável</td><td>${esc(d.responsavel)}</td></tr>${d.empresa ? `<tr><td>Contratada</td><td>${esc(d.empresa)}${d.numero ? ' · contrato ' + esc(d.numero) : ''}${d.vigenciaFim ? ' · vigência até ' + fd(d.vigenciaFim) : ''}</td></tr>` : ''}<tr><td>Integridade (SHA-256)</td><td style="word-break:break-all">${esc(d.hash || '')}</td></tr></table>
  ${d.descricao ? `<h3>Objetivo</h3><p>${nl(d.descricao)}</p>` : ''}
  <h3>Checklist (${p.feitos} de ${p.total} concluídos)</h3><table class="t"><thead><tr><th>#</th><th>Item</th><th>Responsável</th><th>Prazo</th><th>Situação</th></tr></thead><tbody>${(d.itens || []).map((it, n) => { const g = (d.prog || {})[it.id] || {}; return `<tr><td>${n + 1}</td><td>${nl(it.texto)}${g.obs ? `<br><small>${esc(g.obs)}</small>` : ''}</td><td>${esc(it.resp)}</td><td>${fd(it.prazo)}</td><td>${PS[g.st || 'pendente']}</td></tr>`; }).join('')}</tbody></table>
  <h3>Documentos anexados</h3><ul>${(d.anexos || []).map(a => `<li>${esc(a.nome)} — SHA-256 ${esc((a.sha256 || '').slice(0, 16))}…</li>`).join('') || '<li>—</li>'}</ul>
  <h3>Assinaturas</h3><table class="t"><thead><tr><th>Papel</th><th>Nome</th><th>Assinatura</th><th>Data · código</th></tr></thead><tbody>${ass.map(s => { const g = asg.find(x => x.versao === d.versao && x.hash === d.hash && String(x.email).toLowerCase() === String(s.email).toLowerCase()); return `<tr><td>${esc(s.papel)}</td><td><b>${esc(s.nome)}</b><br><small>${esc(s.cargo)}${s.externo ? ' · ' + esc(s.empresa) : ''}${s.matricula ? ' · mat. ' + esc(s.matricula) : ''}</small></td><td>${g && g.traco ? `<img src="${g.traco}" style="height:54px">` : '—'}</td><td>${g ? esc(dh(g.assinado_em)) + '<br><small>cód. ' + esc(g.codigo) + (g.colhido_por ? '<br>colhida por ' + esc(g.colhido_por) : '') + '</small>' : 'pendente'}</td></tr>`; }).join('')}</tbody></table>
  <p style="font-size:11px">Assinatura eletrônica com login, senha e assinatura manuscrita na tela, vinculada ao SHA-256 acima. Conferência: módulo Planos de Ação, página verificar.html, com o código de cada assinatura.</p></div>`;
  const r = $('printRoot'); r.innerHTML = html; document.body.classList.add('pv-on');
  Promise.all(Array.from(r.querySelectorAll('img')).map(im => im.complete && im.naturalWidth ? 0 : new Promise(x => { im.onload = im.onerror = () => x(); setTimeout(x, 4000); }))).then(() => setTimeout(() => window.print(), 100));
}

/* ---------------- relatório de execução (imprime o checklist preenchido) ---------------- */
function relatorio() {
  const d = cur, it = d.itens || [], pr = d.prog || {}, p = progresso(d), est = estado(d, asg);
  const atr = it.filter(i => atrasado(d, i)).length, andam = it.filter(i => (pr[i.id] || {}).st === 'andamento').length;
  const grupos = []; it.forEach(i => { const g = i.grupo || 'Itens'; let x = grupos.find(y => y.g === g); if (!x) grupos.push(x = { g, L: [] }); x.L.push(i); });
  const tab = x => `<h3>${esc(x.g)}</h3><table class="t"><thead><tr><th style="width:3%">#</th><th>Item / rotina</th><th>Freq.</th><th>Prazo</th><th>Situação</th><th>Execução</th><th>OS</th><th>Executado por</th><th>Observação</th></tr></thead><tbody>${x.L.map((i, n) => { const g = pr[i.id] || {}; return `<tr><td>${n + 1}</td><td>${nl(i.texto)}${i.resp ? `<br><small>Resp.: ${esc(i.resp)}</small>` : ''}</td><td>${esc(i.freq || '')}</td><td>${fd(i.prazo)}</td><td>${atrasado(d, i) ? '<b>Atrasado</b>' : PS[g.st || 'pendente']}</td><td>${fd(g.dataExec)}</td><td>${esc(g.os || '')}</td><td>${esc(g.exec || '')}</td><td>${esc(g.obs || '')}${(g.evid || []).length ? '<br><small>Evid.: ' + g.evid.map(e => esc(e.nome)).join('; ') + '</small>' : ''}</td></tr>`; }).join('')}</tbody></table>`;
  const html = `<div class="doc"><div style="text-align:center"><img src="../../assets/logo-upa.png" alt="UPA Rocinha" style="height:60px"></div><h2 style="text-align:center">Relatório de execução — ${esc(d.titulo)}</h2>
  <table class="t kv"><tr><td>Unidade</td><td>UPA Rocinha · CNES 6507409</td></tr><tr><td>Documento</td><td>${esc(d.tipo)} · revisão ${pad2(d.versao)} · ${ST[est]}${d.empresa ? ' · ' + esc(d.empresa) : ''}${d.numero ? ' · ' + esc(d.numero) : ''}</td></tr><tr><td>Emitido em</td><td>${fd(hoje())}</td></tr>
  <tr><td>Resumo</td><td>${p.feitos} de ${p.total} itens concluídos (${p.pct}%) · ${andam} em andamento · ${atr} atrasado(s). Meta proposta no plano: preventivas executadas/previstas ≥ 95%.</td></tr></table>
  ${grupos.map(tab).join('')}
  <p style="font-size:9pt;margin-top:10px">Registros: checklist diário, ordens de serviço e relatório mensal conforme seção 10 do plano. Indicadores: preventivas executadas ÷ previstas × 100; OS documentadas ÷ encerradas × 100; demandas vencidas ÷ abertas × 100.</p>
  <table class="t" style="margin-top:26px"><tr>${['Responsável técnico (Gnosis)', 'Gestor UPA Rocinha', 'Representante Boss'].map(x => `<td style="height:70px;vertical-align:bottom;text-align:center;font-size:9pt">________________________________<br>${x}</td>`).join('')}</tr></table></div>`;
  const r = $('printRoot'); r.innerHTML = html; document.body.classList.add('pv-on');
  Promise.all(Array.from(r.querySelectorAll('img')).map(im => im.complete && im.naturalWidth ? 0 : new Promise(x => { im.onload = im.onerror = () => x(); setTimeout(x, 4000); }))).then(() => setTimeout(() => window.print(), 100));
}
async function importar(file) {
  const j = JSON.parse(await file.text()); if (j.schema !== 'gius-plano-importacao' || !Array.isArray(j.planos)) throw new Error('Arquivo inválido: não é um modelo de planos do GIUS.');
  const ex = await carregarDocs(); let n = 0;
  for (const m of j.planos) {
    if (ex.some(x => x.titulo === m.titulo && x.status !== 'obsoleto') && !confirm('Já existe "' + m.titulo + '". Importar mesmo assim?')) continue;
    const d = { ...novoDoc(), ...m, id: uuid(), status: 'rascunho', versao: 1, hash: '', prog: {}, anexos: [] };
    d.itens = (m.itens || []).map(i => ({ id: uuid().slice(0, 8), texto: i.texto, resp: i.resp || '', prazo: i.prazo || '', grupo: i.grupo || '', freq: i.freq || '' }));
    d.signatarios = m.signatarios || []; d.origemRaiz = d.id; await salvarDoc(d); n++;
  }
  notice(n + ' plano(s) importado(s) como rascunho. Anexe o documento e escolha os signatários.'); await viewLista();
}

/* ---------------- ações ---------------- */
async function salvarProg(id, patch, novosEvid) {
  const fresh = (await carregarDocs()).find(x => x.id === cur.id) || cur;
  fresh.prog = { ...(fresh.prog || {}) }; const g = { ...(fresh.prog[id] || {}), ...patch };
  if (novosEvid && novosEvid.length) g.evid = [...(g.evid || []), ...novosEvid];
  g.data = hoje(); g.por = meuEmail(); fresh.prog[id] = g; await salvarDoc(fresh); cur = fresh; docs = docs.map(x => x.id === fresh.id ? fresh : x);
}
const acoes = {
  async novo() { cur = novoDoc(); sigs = await carregarSigs().catch(() => []); view = 'doc'; viewDoc(); },
  async abrir(d) { docs = await carregarDocs(); cur = docs.find(x => x.id === d.id); asg = await carregarAsg(cur.id); sigs = await carregarSigs().catch(() => []); view = 'doc'; viewDoc(); },
  async voltar() { view = 'lista'; cur = null; notice(''); await viewLista(); },
  async salvar() { lerForm(); if (!cur.titulo) { notice('Informe o título.', true); return; } await salvarDoc(cur); notice('Salvo.'); },
  async addItem() { lerForm(); cur.itens.push({ id: uuid().slice(0, 8), texto: '', resp: '', prazo: '' }); viewDoc(); },
  async rmItem(d) { lerForm(); cur.itens = cur.itens.filter(x => x.id !== d.id); viewDoc(); },
  async addSig() {
    lerForm(); const em = $('sPes').value; if (!em) { notice('Escolha a pessoa.', true); return; }
    const s = sigs.find(x => x.email === em); cur.signatarios.push({ papel: $('sPap').value, nome: s.nome, cargo: s.cargo, matricula: s.matricula, email: s.email.toLowerCase() }); viewDoc();
  },
  async addExt() {
    lerForm(); const emp = $('eEmp').value, pap = $('ePap').value, nome = $('eNome').value.trim(), cargo = $('eCargo').value.trim();
    if (!nome) { notice('Informe o nome completo do externo.', true); return; }
    if (!(PAPEIS_EXT[emp] || []).includes(pap)) { notice(emp === 'Gnosis' ? 'Na Gnosis o papel é Engenheiro.' : 'Na BOSS o papel é Proprietário ou Representante.', true); return; }
    const email = `ext-${slug(nome)}-${slug(emp)}@externo.local`; if (cur.signatarios.some(x => x.email === email)) { notice('Esta pessoa já está na lista.', true); return; }
    cur.signatarios.push({ externo: true, papel: pap, nome, cargo, empresa: emp, email }); viewDoc();
  },
  async colher(d) { dlgColher(d.e); },
  async rmSig(d) { lerForm(); cur.signatarios.splice(+d.n, 1); viewDoc(); },
  async rmAnexo(d) { lerForm(); const a = cur.anexos[+d.n]; if (!confirm('Remover ' + a.nome + '?')) return; try { await UPA.files.remove([a.path]); } catch (e) { /* segue */ } cur.anexos.splice(+d.n, 1); await salvarDoc(cur); viewDoc(); },
  async abrirArq(d, b, e) { e.preventDefault(); await abrirArq(d.p); },
  async enviar() {
    lerForm(); if (!cur.titulo) { notice('Informe o título.', true); return; }
    if (!(cur.itens || []).length || cur.itens.some(i => !i.texto)) { notice('Preencha o checklist (nenhum item vazio).', true); return; }
    const falta = conferirRegra(cur); if (falta.length) { notice('Faltam signatários: ' + falta.join('; ') + '.', true); return; }
    if (!(cur.anexos || []).length && !confirm('Nenhum documento anexado. Enviar para assinatura mesmo assim?')) return;
    if (!confirm('Depois de enviar, o conteúdo fica travado para assinatura. Continuar?')) return;
    cur.status = 'em_assinatura'; cur.hash = await hashDoc(cur); cur.enviadoEm = hoje(); cur.origemRaiz = cur.origemRaiz || cur.id;
    await salvarDoc(cur); asg = await carregarAsg(cur.id); docs = await carregarDocs(); viewDoc(); notice('Enviado. Cada signatário abre este plano e clica em “Assinar agora”.');
  },
  async rascunho() { if (!confirm('Voltar para rascunho? Ninguém assinou ainda.')) return; cur.status = 'rascunho'; cur.hash = ''; await salvarDoc(cur); viewDoc(); },
  async excluir() { if (!confirm('Excluir este rascunho?')) return; for (const a of cur.anexos || []) { try { await UPA.files.remove([a.path]); } catch (e) { /* segue */ } } await UPA.db.del(cur.id); await acoes.voltar(); },
  async revisao() {
    const n = JSON.parse(JSON.stringify(cur)); n.id = uuid(); n.versao = cur.versao + 1; n.status = 'rascunho'; n.hash = ''; n.origem = cur.id; n.origemRaiz = cur.origemRaiz || cur.id; n.prog = {};
    delete n.publicadoEm; delete n.enviadoEm; delete n.criadoEm; await salvarDoc(n); docs = await carregarDocs(); cur = docs.find(x => x.id === n.id); asg = []; viewDoc(); notice('Nova revisão criada como rascunho. A anterior segue vigente até esta ser assinada.');
  },
  async imprimir() { imprimir(); },
  async relatorio() { lerForm(); relatorio(); },
  async importar() { $('impFile').click(); },
  async assinar() { dlgAssinar(); },
  async limparTraco() { limparTraco(); },
  async fechar() { fechar(); },
  async rmEvid(d, b, e) { e.preventDefault(); const g = (cur.prog || {})[d.id] || {}, ev = (g.evid || []).slice(); const [x] = ev.splice(+d.k, 1); try { await UPA.files.remove([x.path]); } catch (er) { /* segue */ } await salvarProg(d.id, { evid: ev }); viewDoc(); }
};

function ligar() {
  $('modalClose').onclick = fechar;
  document.body.addEventListener('click', async e => { const b = e.target.closest('[data-act]'); if (!b || !acoes[b.dataset.act]) return; try { await acoes[b.dataset.act](b.dataset, b, e); } catch (err) { notice(erroTxt(err), true); } });
  $('content').addEventListener('input', e => { if (e.target.id === 'fQ') { filtro.q = e.target.value; clearTimeout(ligar._t); ligar._t = setTimeout(viewLista, 250); } });
  $('content').addEventListener('change', async e => {
    const t = e.target;
    try {
      if (t.id === 'impFile') { const f = t.files && t.files[0]; t.value = ''; if (f) await importar(f); }
      else if (t.id === 'fSt') { filtro.st = t.value; await viewLista(); }
      else if (t.id === 'fArq' && cur) { lerForm(); const f = Array.from(t.files || []); t.value = ''; notice('Enviando arquivo…'); cur.anexos.push(...await anexarArquivos(cur, f)); await salvarDoc(cur); viewDoc(); notice('Arquivo anexado.'); }
      else if (t.dataset.prog) { const pt = { [t.dataset.k]: t.value }; if (t.dataset.k === 'st' && t.value === 'feito' && !(((cur.prog || {})[t.dataset.prog] || {}).dataExec)) pt.dataExec = hoje(); await salvarProg(t.dataset.prog, pt); notice('Item atualizado.'); viewDoc(); }
      else if (t.dataset.evid) { const f = Array.from(t.files || []); t.value = ''; notice('Enviando evidência…'); const n = await anexarArquivos(cur, f); await salvarProg(t.dataset.evid, {}, n); viewDoc(); notice('Evidência anexada ao item.'); }
    } catch (err) { notice(erroTxt(err), true); }
  });
  document.body.addEventListener('submit', async e => { e.preventDefault(); if (e.target.id === 'af') { try { await confirmarAssinatura(); } catch (err) { notice(erroTxt(err), true); } } });
  window.addEventListener('afterprint', () => document.body.classList.remove('pv-on'));
}
async function init() {
  try { await UPA.ready(); } catch (e) { notice(UPA.msg(e), true); return; }
  ligar(); try { await viewLista(); } catch (e) { notice(erroTxt(e), true); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
