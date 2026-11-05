'use strict';
/* Plano de Adequação SUBHUE: cada não conformidade do relatório vira um item com ação, responsável, prazo, status e evidências (anexos).
   Dados-base em subhue-dados.js; o que a unidade preenche fica em registros (coleção subhue_acoes, id = subhue-<sub>-<req>). */
const $ = id => document.getElementById(id);
const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hoje = () => new Date().toLocaleDateString('en-CA');
const fd = d => { if (!d) return ''; const p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(d); };
const semAc = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const D = window.SUBHUE, COL = 'subhue_acoes';
const STATUS = ['Não iniciado', 'Em andamento', 'Aguardando evidência', 'Concluído'];
const chave = i => `${i.s}-${i.r}`;
const subNome = s => (D.subs.find(x => x[0] === s) || [s, s])[1];
let ACOES = {}, view = 'painel', fil = { s: '', st: '', q: '', resp: '' }, aberto = null;
function notice(t, erro) { const m = $('message'); m.textContent = t || ''; m.className = erro ? 'err' : ''; if (t) m.scrollIntoView({ block: 'nearest' }); }
async function carregar() { const rows = await UPA.db.list(COL); ACOES = {}; rows.forEach(r => { ACOES[r.id.replace(/^subhue-/, '')] = r.dados; }); }
const ac = i => ACOES[chave(i)] || {};
const st = i => ac(i).status || 'Não iniciado';
const atrasado = i => { const a = ac(i); return a.prazo && a.status !== 'Concluído' && a.prazo < hoje(); };
async function salvar(i, o) { const d = { ...ac(i), ...o, atualizadoEm: new Date().toISOString() }; await UPA.db.put(COL, 'subhue-' + chave(i), d); ACOES[chave(i)] = d; return d; }
const badge = s => `<span class="badge ${s === 'Concluído' ? 'ok' : s === 'Não iniciado' ? 'bad' : 'warn'}">${esc(s)}</span>`;
const prio = i => { const sub = D.subs.find(x => x[0] === i.s); return sub ? sub[2] : 100; };

const VIEWS = [['painel', 'Painel'], ['itens', 'Não conformidades'], ['rel', 'Relatório de resposta'], ['sobre', 'Sobre a visita']];
function nav() { $('nav').innerHTML = VIEWS.map(v => `<button type="button" data-v="${v[0]}" class="${v[0] === view ? 'active' : ''}">${v[1]}</button>`).join(''); }

/* ---------- Painel ---------- */
function viewPainel() {
  const I = D.itens, n = k => I.filter(i => st(i) === k).length, atr = I.filter(atrasado), semResp = I.filter(i => !ac(i).resp && st(i) !== 'Concluído').length;
  const pct = Math.round(n('Concluído') / I.length * 100);
  const porSub = D.subs.map(s => { const L = I.filter(i => i.s === s[0]); return { s, L, c: L.filter(i => st(i) === 'Concluído').length }; }).filter(x => x.L.length).sort((a, b) => a.s[2] - b.s[2]);
  const prox = I.filter(i => ac(i).prazo && st(i) !== 'Concluído' && ac(i).prazo >= hoje()).sort((a, b) => ac(a).prazo.localeCompare(ac(b).prazo)).slice(0, 6);
  $('content').innerHTML = `<section class="view"><h2>Painel de adequação</h2>
  <div class="stats"><div class="stat">Não conformidades<strong>${I.length}</strong></div><div class="stat"><span>Concluídas</span><strong>${n('Concluído')} (${pct}%)</strong></div><div class="stat warn">Em andamento / aguardando evidência<strong>${n('Em andamento') + n('Aguardando evidência')}</strong></div><div class="stat bad">Não iniciadas<strong>${n('Não iniciado')}</strong></div></div>
  <div class="stats"><div class="stat bad">Prazo vencido<strong>${atr.length}</strong></div><div class="stat warn">Sem responsável<strong>${semResp}</strong></div></div>
  ${atr.length ? `<div class="alert bad"><b>⛔</b><span>Prazo vencido: ${atr.slice(0, 5).map(i => esc(i.s + ' req. ' + i.r)).join(', ')}${atr.length > 5 ? ' e mais ' + (atr.length - 5) : ''}.</span></div>` : ''}
  <h3>Progresso por subseção (da menor para a maior conformidade na visita)</h3><div class="box2">${porSub.map(x => `<div class="barrow"><span>${esc(x.s[0] + ' ' + x.s[1].split(' (')[0])} <small>(visita: ${x.s[2]}% · Core ${x.s[3]}%)</small></span><div class="bar"><i style="width:${x.c / x.L.length * 100}%;background:#12805c"></i></div><b>${x.c}/${x.L.length}</b></div>`).join('')}</div>
  <h3>Próximos prazos</h3>${prox.length ? `<div class="table-wrap"><table><tbody>${prox.map(i => `<tr><td>${fd(ac(i).prazo)}</td><td>${esc(i.s)} req. ${esc(i.r)} — ${esc(i.t)}</td><td>${esc(ac(i).resp || 'sem responsável')}</td><td><button type="button" class="small" data-act="abrir" data-k="${esc(chave(i))}">Abrir</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nenhum prazo cadastrado ainda. Abra uma não conformidade e informe responsável e prazo.</p>'}
  <p class="muted">Dica: comece pelas subseções com menor conformidade e pelos itens obrigatórios (Core). O relatório da Subhue não marca quais requisitos são Core; confira no checklist da Subhue.</p></section>`;
}

/* ---------- Lista ---------- */
function viewItens() {
  const q = semAc(fil.q), resp = Array.from(new Set(Object.values(ACOES).map(a => a.resp).filter(Boolean))).sort();
  const L = D.itens.filter(i => (!fil.s || i.s === fil.s) && (!fil.st || (fil.st === 'atrasado' ? atrasado(i) : st(i) === fil.st)) && (!fil.resp || ac(i).resp === fil.resp) && (!q || semAc([i.t, i.a, i.g, ac(i).resp, ac(i).acao].join(' ')).indexOf(q) >= 0)).sort((a, b) => prio(a) - prio(b) || a.s.localeCompare(b.s) || a.r - b.r);
  $('content').innerHTML = `<section class="view"><h2>Não conformidades (${L.length} de ${D.itens.length})</h2>
  <div class="filtro"><label>Subseção<select id="fS"><option value="">Todas</option>${D.subs.filter(s => D.itens.some(i => i.s === s[0])).map(s => `<option value="${s[0]}"${fil.s === s[0] ? ' selected' : ''}>${esc(s[0] + ' ' + s[1].split(' (')[0])}</option>`).join('')}</select></label>
  <label>Situação<select id="fSt"><option value="">Todas</option>${STATUS.map(s => `<option${fil.st === s ? ' selected' : ''}>${s}</option>`).join('')}<option value="atrasado"${fil.st === 'atrasado' ? ' selected' : ''}>Prazo vencido</option></select></label>
  <label>Responsável<select id="fR"><option value="">Todos</option>${resp.map(r => `<option${fil.resp === r ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
  <label>Buscar<input type="search" id="fQ" value="${esc(fil.q)}" placeholder="tema, achado, ação"></label></div>
  <div id="detalhe"></div>
  <div class="table-wrap"><table><thead><tr><th>Sub.</th><th>Req.</th><th>Tema</th><th>Situação</th><th>Responsável</th><th>Prazo</th><th>Evid.</th><th></th></tr></thead><tbody>${L.map(i => `<tr${atrasado(i) ? ' style="background:#fdecea"' : ''}><td>${esc(i.s)}</td><td>${i.r || '—'}</td><td>${esc(i.t)}</td><td>${badge(st(i))}</td><td>${esc(ac(i).resp || '')}</td><td>${fd(ac(i).prazo)}${atrasado(i) ? ' ⛔' : ''}</td><td>${(ac(i).anexos || []).length || ''}</td><td><button type="button" class="small" data-act="abrir" data-k="${esc(chave(i))}">Abrir</button></td></tr>`).join('') || '<tr><td colspan="8">Nada encontrado.</td></tr>'}</tbody></table></div></section>`;
  if (aberto) detalhe(aberto);
}
const LINKS = [[/POP/, 'pop', 'Abrir módulo POP'], [/EPI/, 'epi', 'Abrir Entrega de EPI'], [/Manuten|Central/, 'central', 'Abrir Central de Serviços']];
function detalhe(k) {
  const i = D.itens.find(x => chave(x) === k); if (!i) return; aberto = k; const a = ac(i);
  const links = LINKS.filter(l => l[0].test(i.aj || '')).map(l => `<button type="button" class="small secondary" data-act="ir" data-h="${l[1]}">${l[2]}</button>`).join(' ');
  const box = $('detalhe'); if (!box) return;
  box.innerHTML = `<div class="box2" style="border-left:4px solid #1c5fa8"><h3 style="margin-top:0">${esc(i.s)} · Requisito ${i.r || '—'} — ${esc(i.t)}</h3><p class="muted">${esc(subNome(i.s))}</p>
  <p><b>Achado:</b> ${esc(i.a)}</p>${i.g ? `<p><b>Sugestão de melhoria (Subhue):</b> ${esc(i.g)}</p>` : '<p class="muted"><b>Sugestão de melhoria:</b> não informada no relatório.</p>'}${i.d ? `<p><b>Documento de referência:</b> ${esc(i.d)}</p>` : ''}<p><b>Legislação:</b> ${esc(i.l)}</p>${i.aj ? `<p><b>No sistema da unidade:</b> ${esc(i.aj)} ${links}</p>` : ''}
  <form id="itemForm" data-k="${esc(k)}"><div class="grid">
  <label class="fld">Situação<select name="status">${STATUS.map(s => `<option${(a.status || 'Não iniciado') === s ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
  <label class="fld">Responsável<input name="resp" value="${esc(a.resp || '')}" placeholder="nome e setor"></label>
  <label class="fld">Prazo<input type="date" name="prazo" value="${esc(a.prazo || '')}"></label>
  <label class="fld">Data de conclusão<input type="date" name="conclusao" value="${esc(a.conclusao || '')}"></label>
  <label class="fld full">Ação adotada / planejada<textarea name="acao">${esc(a.acao || '')}</textarea></label>
  <label class="fld full">Evidência (descreva o documento: nº do POP, data da ata, local do arquivo…)<textarea name="evidencia">${esc(a.evidencia || '')}</textarea></label>
  <label class="fld full">Anexar evidências (PDF, foto, planilha)<input type="file" id="anexos" multiple></label></div>
  ${(a.anexos || []).length ? `<p class="muted">Anexos: ${a.anexos.map((x, n) => `<a href="#" data-act="abrirAnexo" data-n="${n}">${esc(x.nome)}</a> <button type="button" class="small danger" data-act="rmAnexo" data-n="${n}">remover</button>`).join(' · ')}</p>` : ''}
  <div class="actions"><button type="submit">Salvar</button><button type="button" class="secondary" data-act="fechar">Fechar</button></div></form></div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function salvarItem(f) {
  const i = D.itens.find(x => chave(x) === f.dataset.k), g = new FormData(f), o = {};
  ['status', 'resp', 'prazo', 'conclusao', 'acao', 'evidencia'].forEach(n => { o[n] = String(g.get(n) || '').trim(); });
  if (o.status === 'Concluído' && !o.conclusao) o.conclusao = hoje();
  if (o.status === 'Concluído' && !o.evidencia && !(ac(i).anexos || []).length && !($('anexos').files || []).length && !confirm('Marcar como concluído sem evidência (descrição ou anexo)? A Subhue pede comprovação.')) return;
  const files = Array.from($('anexos').files || []), lista = (ac(i).anexos || []).slice();
  for (const fl of files) { if (fl.size > 12 * 1024 * 1024) throw new Error('Arquivo acima de 12 MB: ' + fl.name); const path = `subhue/${chave(i)}/${crypto.randomUUID().slice(0, 8)}-${fl.name.replace(/[^\w.\-]+/g, '_')}`; await UPA.files.upload(path, fl, fl.type); lista.push({ path, nome: fl.name, tam: fl.size, em: hoje() }); }
  o.anexos = lista; await salvar(i, o); notice('Salvo.'); aberto = null; await render();
}

/* ---------- Relatório de resposta ---------- */
function viewRel() {
  const subs = D.subs.filter(s => D.itens.some(i => i.s === s[0]));
  $('content').innerHTML = `<section class="view"><h2>Relatório de resposta à SUBHUE</h2><p class="muted">Gera o documento com cada não conformidade, a ação adotada, responsável, prazo, situação e as evidências anexadas. Imprima ou salve em PDF.</p>
  <div class="filtro"><label>Subseção<select id="rS"><option value="">Todas</option>${subs.map(s => `<option value="${s[0]}">${esc(s[0] + ' ' + s[1].split(' (')[0])}</option>`).join('')}</select></label><label>Situação<select id="rSt"><option value="">Todas</option>${STATUS.map(s => `<option>${s}</option>`).join('')}</select></label></div>
  <div class="actions"><button type="button" data-act="relPrint">Imprimir / PDF</button><button type="button" class="secondary" data-act="relXlsx">⬇ Baixar planilha (Excel)</button></div></section>`;
}
const filtroRel = () => { const s = $('rS') ? $('rS').value : '', t = $('rSt') ? $('rSt').value : ''; return D.itens.filter(i => (!s || i.s === s) && (!t || st(i) === t)).sort((a, b) => a.s.localeCompare(b.s) || a.r - b.r); };
function relPrint() {
  const L = filtroRel(), c = L.filter(i => st(i) === 'Concluído').length;
  const html = `<div class="logos" style="justify-content:center"><img src="../../assets/logo-upa.png" alt="UPA Rocinha" style="height:62px"></div><h2 style="text-align:center">Plano de Adequação — resposta ao Relatório de Visitas (Mapeamento de Processos Assistenciais · DQE/SUBHUE)</h2>
  <table class="t kv"><tr><td>Unidade</td><td>UPA Rocinha · CNES 6507409</td></tr><tr><td>Visita</td><td>${D.visita} · ${esc(D.equipe)}</td></tr><tr><td>Emitido em</td><td>${fd(hoje())}</td></tr><tr><td>Situação</td><td>${c} de ${L.length} não conformidades concluídas</td></tr></table>
  ${L.map(i => { const a = ac(i); return `<table class="t" style="margin-top:8px;page-break-inside:avoid"><tr><td colspan="2" style="background:#e8eef6"><b>${esc(i.s)} · Requisito ${i.r || '—'} — ${esc(i.t)}</b></td></tr><tr><td style="width:22%">Achado</td><td>${esc(i.a)}</td></tr>${i.g ? `<tr><td>Sugestão da Subhue</td><td>${esc(i.g)}</td></tr>` : ''}<tr><td>Ação adotada / planejada</td><td>${esc(a.acao || '—')}</td></tr><tr><td>Responsável · prazo</td><td>${esc(a.resp || '—')} · ${fd(a.prazo) || '—'}</td></tr><tr><td>Situação</td><td>${esc(st(i))}${a.conclusao ? ' em ' + fd(a.conclusao) : ''}</td></tr><tr><td>Evidências</td><td>${esc(a.evidencia || '')}${(a.anexos || []).length ? '<br>Anexos: ' + a.anexos.map(x => esc(x.nome)).join('; ') : ''}${!a.evidencia && !(a.anexos || []).length ? '—' : ''}</td></tr></table>`; }).join('')}
  <div class="assin"><div>Luis Felipe W. Seroa da Motta<br>Coordenador Administrativo<br>CNES 6507409</div><div>Direção / Gestão da unidade</div></div>`;
  const r = $('printRoot'); r.innerHTML = `<div class="doc">${html}</div>`; r.classList.remove('hidden'); setTimeout(() => { window.print(); r.classList.add('hidden'); }, 150);
}
function relXlsx() {
  if (typeof XLSX === 'undefined') { notice('Biblioteca de planilhas não carregou.', true); return; }
  const rows = filtroRel().map(i => { const a = ac(i); return { Subseção: i.s, 'Nome da subseção': subNome(i.s), Requisito: i.r || '', Tema: i.t, Achado: i.a, 'Sugestão da Subhue': i.g, 'Documento de referência': i.d, Legislação: i.l, Situação: st(i), Responsável: a.resp || '', Prazo: fd(a.prazo), Conclusão: fd(a.conclusao), 'Ação': a.acao || '', Evidência: a.evidencia || '', Anexos: (a.anexos || []).map(x => x.nome).join('; ') }; });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Plano de adequação'); XLSX.writeFile(wb, `plano_adequacao_subhue_${hoje()}.xlsx`);
}

/* ---------- Sobre ---------- */
function viewSobre() {
  const g = D.geral;
  $('content').innerHTML = `<section class="view"><h2>Sobre a visita</h2><p class="muted">Relatório de Visitas — Mapeamento de Processos Assistenciais (DQE/SUBHUE). Visita em ${D.visita}. Equipe: ${esc(D.equipe)}.</p>
  <div class="stats"><div class="stat">Requisitos avaliados<strong>${g.req}</strong></div><div class="stat">Conformes<strong>${g.conf} (${g.pct}%)</strong></div><div class="stat bad">Não conformes<strong>${g.req - g.conf}</strong></div><div class="stat warn">Conformidade nos itens Core<strong>${g.corePct}%</strong></div></div>
  <h3>Conformidade por subseção na visita</h3><div class="table-wrap"><table><thead><tr><th>Subseção</th><th>Geral</th><th>Itens Core</th><th>Não conformidades</th></tr></thead><tbody>${D.subs.map(s => `<tr><td>${esc(s[0] + ' ' + s[1])}</td><td>${s[2]}%</td><td>${s[3]}%</td><td>${D.itens.filter(i => i.s === s[0]).length}</td></tr>`).join('')}</tbody></table></div>
  <p class="muted">A subseção 3.5 não consta no relatório. Conclusão da Subhue: a causa mais frequente é a ausência de formalização documental de práticas já realizadas, além de fragilidade no monitoramento por indicadores e lacunas nos registros de capacitação.</p></section>`;
}

const acoes = {
  async abrir(d) { if (view !== 'itens') { view = 'itens'; await render(); } aberto = d.k; detalhe(d.k); },
  async fechar() { aberto = null; const b = $('detalhe'); if (b) b.innerHTML = ''; },
  async ir(d) { try { window.parent.location.hash = '#' + d.h; } catch (e) { notice('Abra a aba correspondente no menu.', true); } },
  async abrirAnexo(d, b, e) { e.preventDefault(); const i = D.itens.find(x => chave(x) === aberto), a = ac(i).anexos[+d.n], u = await UPA.files.urls([a.path]); window.open(u[a.path], '_blank', 'noopener'); },
  async rmAnexo(d) { if (!confirm('Remover este anexo?')) return; const i = D.itens.find(x => chave(x) === aberto), a = ac(i).anexos[+d.n]; try { await UPA.files.remove([a.path]); } catch (e) { /* segue */ } await salvar(i, { anexos: ac(i).anexos.filter((_, n) => n !== +d.n) }); detalhe(aberto); },
  async relPrint() { relPrint(); }, async relXlsx() { relXlsx(); }
};
async function render() {
  nav();
  try { if (view === 'painel') viewPainel(); else if (view === 'itens') viewItens(); else if (view === 'rel') viewRel(); else viewSobre(); } catch (e) { notice(UPA.msg(e), true); }
}
function ligar() {
  $('nav').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; view = b.dataset.v; aberto = null; notice(''); render(); });
  const c = $('content');
  c.addEventListener('click', async e => { const b = e.target.closest('[data-act]'); if (!b) return; try { await acoes[b.dataset.act](b.dataset, b, e); } catch (err) { notice(UPA.msg(err), true); } });
  c.addEventListener('change', e => { const t = e.target; if (t.id === 'fS') { fil.s = t.value; render(); } else if (t.id === 'fSt') { fil.st = t.value; render(); } else if (t.id === 'fR') { fil.resp = t.value; render(); } });
  c.addEventListener('input', e => { if (e.target.id === 'fQ') { fil.q = e.target.value; clearTimeout(ligar.t); ligar.t = setTimeout(() => { const p = e.target.selectionStart; render(); const n = $('fQ'); if (n) { n.focus(); n.setSelectionRange(p, p); } }, 300); } });
  c.addEventListener('submit', async e => { e.preventDefault(); if (e.target.id === 'itemForm') { try { await salvarItem(e.target); } catch (err) { notice(UPA.msg(err), true); } } });
}
(async function () { try { await UPA.ready(); } catch (e) { notice(UPA.msg(e), true); return; } ligar(); try { await carregar(); } catch (e) { notice(UPA.msg(e), true); } await render(); })();
