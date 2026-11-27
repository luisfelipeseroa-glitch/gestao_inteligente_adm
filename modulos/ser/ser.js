'use strict';
/* SER · Vagas — lê a planilha do Google (aba SER_Solicitacoes) pelo webhook do Apps Script e mostra como planilha.
   A URL e o token ficam guardados no banco do portal (coleção ser_cfg), só para quem está logado. */
const $ = id => document.getElementById(id);
const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COL = 'ser_cfg', CFG_ID = 'ser-cfg', LS = 'ser_cfg_local';
const ATIVAS = ['pend', 'fila', 'aguar', 'res'];
const NOMES = { pend: 'Pendente', fila: 'Em fila', aguar: 'Aguardando confirmação', res: 'Reservado', int: 'Internado', canc: 'Cancelada', saiu: 'Saiu da lista' };
const PRIO = { pend: 0, fila: 1, aguar: 2, res: 3, int: 4, canc: 5, saiu: 6 };
const FIXAS = ['BAM', 'ID da solicitação', 'Leito', 'Tipo', 'Inserção no SER', '1ª conferência', 'Última conferência', 'Situação atual'];
let CFG = null, LINHAS = [], CAB = [], ULTIMA = '', LIDO = '', fil = 'ativas', q = '', ord = 'situacao', timer = null, carregando = false;

function notice(t, erro) { const m = $('message'); m.textContent = t || ''; m.className = erro ? 'err' : ''; }
const letra = n => { let s = ''; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const ts = s => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/); return m ? new Date(+m[3], m[2] - 1, +m[1], +m[4], +m[5]).getTime() : 0; };
function cls(s) {
  s = String(s || '').toLowerCase();
  if (s.indexOf('pendente') >= 0) return 'pend';
  if (s.indexOf('em fila') >= 0) return 'fila';
  if (s.indexOf('aguard') >= 0) return 'aguar';
  if (s.indexOf('reserv') >= 0) return 'res';
  if (s.indexOf('intern') >= 0) return 'int';
  if (s.indexOf('cancel') >= 0) return 'canc';
  return 'saiu';
}
function modelar(linhas) {
  return linhas.map(r => {
    const mud = [];
    for (let k = 8; k < r.length; k += 2) if (r[k] || r[k + 1]) mud.push({ q: r[k] || '', t: r[k + 1] || '' });
    return { bam: r[0] || '', id: r[1] || '', leito: r[2] || '', tipo: r[3] || '', ins: r[4] || '', prim: r[5] || '', ult: r[6] || '', sit: r[7] || '', c: cls(r[7]), mud };
  });
}
const detectado = q => /\(detectado\)/i.test(q || '');
const limpaQ = q => String(q || '').replace(/\s*\(detectado\)\s*/i, '');

/* ---------- configuração (URL + token) ---------- */
async function carregarCfg() {
  try {
    const rows = await UPA.db.list(COL);
    const r = rows.find(x => x.id === CFG_ID);
    if (r && r.dados && r.dados.url) { CFG = r.dados; try { localStorage.setItem(LS, JSON.stringify(CFG)); } catch (e) {} return; }
  } catch (e) { /* sem banco: tenta o cache local */ }
  try { const l = JSON.parse(localStorage.getItem(LS) || 'null'); if (l && l.url) CFG = l; } catch (e) {}
}
async function salvarCfg(url, token) {
  CFG = { url: url.trim(), token: token.trim() };
  try { localStorage.setItem(LS, JSON.stringify(CFG)); } catch (e) {}
  try { await UPA.db.put(COL, CFG_ID, CFG); } catch (e) { notice('Salvo só neste aparelho (o banco não respondeu): ' + UPA.msg(e), true); return; }
  notice('Configuração salva para todos os aparelhos.');
}
function painelCfg() {
  return `<div class="ser-cfg"><h3>Ligar à planilha do SER</h3>
  <p class="muted">Cole o endereço do Apps Script (termina em <b>/exec</b>) e o mesmo token usado no monitor. Fica guardado no banco do portal (só quem faz login enxerga).</p>
  <label>Endereço do Apps Script<input id="cfgUrl" type="url" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(CFG ? CFG.url : '')}"></label>
  <label>Token<input id="cfgTok" type="password" autocomplete="off" value="${esc(CFG ? CFG.token : '')}"></label>
  <div class="ac"><button type="button" id="cfgSalvar">Salvar e carregar</button>${CFG ? '<button type="button" class="secondary" id="cfgFechar">Cancelar</button>' : ''}</div></div>`;
}

/* ---------- leitura da planilha ---------- */
async function carregar(manual) {
  if (carregando || !CFG) return;
  carregando = true;
  const bt = $('btAtualizar'); if (bt) { bt.disabled = true; bt.textContent = '↻ Lendo…'; }
  try {
    const u = CFG.url + (CFG.url.indexOf('?') >= 0 ? '&' : '?') + 'acao=ler&token=' + encodeURIComponent(CFG.token) + '&_=' + Date.now();
    const r = await fetch(u, { redirect: 'follow' });
    const txt = await r.text();
    let j;
    try { j = JSON.parse(txt); } catch (e) { throw new Error('O endereço não respondeu como esperado. Confira se a implantação está como "App da Web" com acesso "Qualquer pessoa" e se a URL termina em /exec.'); }
    if (j.ok === false) throw new Error(j.erro === 'negado' ? 'Token incorreto.' : (j.erro || 'Erro na planilha.'));
    CAB = j.cabecalho || FIXAS; LINHAS = modelar(j.linhas || []); ULTIMA = j.ultima || ''; LIDO = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (manual) notice('');
    else if ($('message').className === 'err') notice('');
  } catch (e) {
    notice(UPA.msg ? UPA.msg(e) : e.message, true);
    if (/Failed to fetch|NetworkError|Load failed/i.test(String(e.message))) notice('Não consegui falar com o Google (internet ou endereço incorreto).', true);
  }
  carregando = false;
  desenhar();
}

/* ---------- desenho ---------- */
function visiveis() {
  const t = q.trim().toLowerCase();
  let L = LINHAS.filter(r => (fil === 'todas' ? true : fil === 'ativas' ? ATIVAS.indexOf(r.c) >= 0 : r.c === fil) &&
    (!t || [r.id, r.bam, r.leito, r.sit, r.tipo].join(' ').toLowerCase().indexOf(t) >= 0));
  if (ord === 'situacao') L.sort((a, b) => (PRIO[a.c] - PRIO[b.c]) || (ts(b.ins) - ts(a.ins)));
  else if (ord === 'recentes') L.sort((a, b) => ts(b.ins) - ts(a.ins));
  else L.sort((a, b) => Number(b.id) - Number(a.id));
  return L;
}
function chips() {
  const n = k => LINHAS.filter(r => r.c === k).length;
  const ch = (k, rot, num, extra) => `<button type="button" class="ser-chip ${extra || ''} ${fil === k ? 'on' : ''}" data-f="${k}">${rot}<b>${num}</b></button>`;
  return ch('ativas', 'Ativas', LINHAS.filter(r => ATIVAS.indexOf(r.c) >= 0).length) +
    ['pend', 'fila', 'aguar', 'res', 'int', 'canc', 'saiu'].map(k => ch(k, NOMES[k], n(k), k === 'pend' && n(k) ? 'pend' : '')).join('') +
    ch('todas', 'Todas', LINHAS.length);
}
function aviso() {
  const ref = ts(ULTIMA) || Math.max.apply(null, LINHAS.map(r => ts(r.ult)).concat([0]));
  if (!ref) return LINHAS.length ? '' : '<div class="ser-alert info">Ainda não há solicitações na planilha. Assim que o monitor rodar uma conferência, elas aparecem aqui.</div>';
  const min = Math.round((Date.now() - ref) / 60000);
  const quando = new Date(ref).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  if (min > 45) return `<div class="ser-alert bad"><b>⚠</b><span>O monitor não atualiza a planilha há ${min >= 120 ? Math.floor(min / 60) + ' h' : min + ' min'} (última conferência: ${quando}). Verifique o computador do monitor, a janela do navegador e se o SER está logado.</span></div>`;
  return '';
}
function desenhar() {
  const c = $('content');
  if (!CFG) { c.innerHTML = painelCfg(); ligarCfg(); return; }
  const nM = Math.max.apply(null, LINHAS.map(r => r.mud.length).concat([0]));
  const L = visiveis();
  const nomes = FIXAS.concat(Array.from({ length: nM * 2 }, (_, i) => CAB[8 + i] || 'Mudança ' + (Math.floor(i / 2) + 1) + (i % 2 ? ' · situação' : ' · data/hora')));
  const ncol = nomes.length;
  const head = `<thead><tr class="letras"><th class="n"></th>${nomes.map((_, i) => `<th class="${i === 0 ? 'bam' : i === 1 ? 'idc' : ''}">${letra(i)}</th>`).join('')}</tr>
    <tr class="nomes"><th class="n">#</th>${nomes.map((n, i) => `<th class="${i === 0 ? 'bam' : i === 1 ? 'idc' : ''}">${esc(n)}</th>`).join('')}</tr></thead>`;
  const body = L.map((r, i) => {
    let t = `<tr class="${r.c === 'pend' ? 'pend' : ''}"><td class="n"><button type="button" data-d="${esc(r.id)}" title="Ver linha do tempo">${i + 1}</button></td>
      <td class="bam" contenteditable="true" spellcheck="false" data-b="${esc(r.id)}" data-v="${esc(r.bam)}">${esc(r.bam)}</td><td class="idc">${esc(r.id)}</td><td>${esc(r.leito)}</td><td>${esc(r.tipo)}</td><td>${esc(r.ins)}</td><td>${esc(r.prim)}</td><td>${esc(r.ult)}</td>
      <td><span class="sit ${r.c}">${esc(r.sit || '—')}</span></td>`;
    for (let k = 0; k < nM; k++) {
      const m = r.mud[k];
      t += m ? `<td class="mud ${detectado(m.q) ? 'det' : ''}" title="${detectado(m.q) ? 'Horário da detecção pelo monitor (não foi possível ler o horário exato do SER)' : 'Horário registrado no SER'}">${esc(limpaQ(m.q))}${detectado(m.q) ? ' ~' : ''}</td><td class="mud">${esc(m.t)}</td>` : '<td class="mud"></td><td class="mud"></td>';
    }
    return t + '</tr>';
  }).join('');
  const hoje = new Date().toLocaleDateString('pt-BR');
  c.innerHTML = `${aviso()}
  <div class="ser-top"><input type="search" id="busca" placeholder="Buscar ID, BAM, leito…" value="${esc(q)}">
    <select id="ordem" aria-label="Ordenar"><option value="situacao" ${ord === 'situacao' ? 'selected' : ''}>Ordenar: situação (pendências primeiro)</option><option value="recentes" ${ord === 'recentes' ? 'selected' : ''}>Ordenar: mais recentes</option><option value="id" ${ord === 'id' ? 'selected' : ''}>Ordenar: ID</option></select>
    <span class="sp"></span><button type="button" id="btAtualizar">↻ Atualizar</button><button type="button" class="secondary" id="btExcel">⇩ Excel</button><button type="button" class="secondary" id="btCfg">⚙</button></div>
  <div class="ser-chips">${chips()}</div>
  <p class="ser-status"><span>Lido às ${esc(LIDO)} de ${hoje} · atualiza sozinho a cada 5 min</span><span>${L.length} de ${LINHAS.length} linhas</span><span>~ = horário da detecção pelo monitor</span></p>
  <div class="ser-wrap">${L.length ? `<table class="ser">${head}<tbody>${body}</tbody></table>` : '<div class="ser-vazio">Nenhuma solicitação neste filtro.</div>'}</div>
  <div id="cfgBox"></div>`;
  ligar();
}
function ligar() {
  document.querySelectorAll('.ser-chip').forEach(b => b.onclick = () => { fil = b.dataset.f; desenhar(); });
  $('busca').oninput = e => { q = e.target.value; const p = e.target.selectionStart; desenhar(); const b = $('busca'); b.focus(); try { b.setSelectionRange(p, p); } catch (x) {} };
  $('ordem').onchange = e => { ord = e.target.value; desenhar(); };
  $('btAtualizar').onclick = () => carregar(true);
  $('btExcel').onclick = exportar;
  $('btCfg').onclick = () => { $('cfgBox').innerHTML = painelCfg(); ligarCfg(); $('cfgBox').scrollIntoView({ block: 'nearest' }); };
  document.querySelectorAll('[data-d]').forEach(b => b.onclick = () => detalhe(b.dataset.d));
  document.querySelectorAll('td.bam').forEach(td => {
    td.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); td.blur(); } if (e.key === 'Escape') { td.textContent = td.dataset.v; td.blur(); } };
    td.onblur = () => salvarBam(td);
  });
}
function ligarCfg() {
  const s = $('cfgSalvar'); if (!s) return;
  s.onclick = async () => {
    const u = $('cfgUrl').value, t = $('cfgTok').value;
    if (!/^https:\/\/script\.google\.com\//.test(u.trim())) { notice('O endereço deve começar com https://script.google.com/', true); return; }
    if (!t.trim()) { notice('Informe o token.', true); return; }
    await salvarCfg(u, t); await carregar(true);
  };
  const f = $('cfgFechar'); if (f) f.onclick = () => { $('cfgBox').innerHTML = ''; };
}

/* ---------- BAM (preenchida aqui ou direto na planilha) ---------- */
async function salvarBam(td) {
  const novo = td.textContent.trim(), antigo = td.dataset.v || '';
  if (novo === antigo) return;
  const id = td.dataset.b;
  td.style.opacity = '.5';
  try {
    const r = await fetch(CFG.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: CFG.token, acao: 'bam', id, bam: novo }) });
    const t = (await r.text()).trim();
    if (t !== 'ok') throw new Error(t || 'sem resposta');
    td.dataset.v = novo; const L = LINHAS.find(x => x.id === id); if (L) L.bam = novo;
    notice('BAM gravada na planilha.');
  } catch (e) {
    td.textContent = antigo; notice('Não consegui gravar a BAM: ' + e.message, true);
  }
  td.style.opacity = '';
}

/* ---------- linha do tempo ---------- */
function detalhe(id) {
  const r = LINHAS.find(x => x.id === id); if (!r) return;
  const itens = [`<li><b>Inserida no SER</b><small>${esc(r.ins || '—')}</small></li>`].concat(r.mud.map(m => `<li class="${detectado(m.q) ? 'det' : ''}"><b>${esc(m.t)}</b><small>${esc(limpaQ(m.q))}${detectado(m.q) ? ' (horário da detecção)' : ''}</small></li>`));
  $('detalhe').innerHTML = `<div class="dt-h"><h3>Solicitação ${esc(r.id)}</h3><button type="button" id="dtFechar">Fechar</button></div><div class="dt-b">
  <dl class="dt-g"><dt>BAM</dt><dd>${esc(r.bam || '—')}</dd><dt>Leito</dt><dd>${esc(r.leito || '—')}</dd><dt>Tipo</dt><dd>${esc(r.tipo || '—')}</dd><dt>Situação atual</dt><dd><span class="sit ${r.c}">${esc(r.sit || '—')}</span></dd><dt>1ª conferência</dt><dd>${esc(r.prim || '—')}</dd><dt>Última conferência</dt><dd>${esc(r.ult || '—')}</dd></dl>
  <h4 style="margin:0 0 10px">Linha do tempo</h4><ul class="tl">${itens.join('')}</ul></div>`;
  $('dtFechar').onclick = () => $('detalhe').close();
  $('detalhe').showModal();
}

/* ---------- Excel ---------- */
function exportar() {
  if (typeof XLSX === 'undefined') { notice('Biblioteca de planilhas não carregou.', true); return; }
  const nM = Math.max.apply(null, LINHAS.map(r => r.mud.length).concat([0]));
  const cab = FIXAS.concat(Array.from({ length: nM * 2 }, (_, i) => CAB[8 + i] || 'Mudança ' + (Math.floor(i / 2) + 1) + (i % 2 ? ' · situação' : ' · data/hora')));
  const linhas = visiveis().map(r => {
    const a = [r.bam, r.id, r.leito, r.tipo, r.ins, r.prim, r.ult, r.sit];
    for (let k = 0; k < nM; k++) { const m = r.mud[k]; a.push(m ? m.q : '', m ? m.t : ''); }
    return a;
  });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cab].concat(linhas)), 'SER');
  XLSX.writeFile(wb, 'ser_solicitacoes_' + new Date().toLocaleDateString('en-CA') + '.xlsx');
}

/* ---------- início ---------- */
(async function () {
  try { await UPA.ready(); } catch (e) { notice(UPA.msg ? UPA.msg(e) : e.message, true); return; }
  await carregarCfg();
  if (!CFG) { desenhar(); return; }
  $('content').innerHTML = '<p class="muted">Lendo a planilha…</p>';
  await carregar(true);
  timer = setInterval(() => { if (!document.hidden && !document.activeElement.isContentEditable && document.activeElement.id !== 'busca') carregar(false); }, 300000);
})();
