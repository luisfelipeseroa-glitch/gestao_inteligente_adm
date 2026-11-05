'use strict';
/* Guarda de pertences de pacientes.
   Fluxo: etiqueta com QR (lote pré-impresso ou criada no cadastro) → acautelamento (nome, BAM, sala, itens) → leitura do QR mostra os dados
   → colaborador solicita liberação → gestor autoriza (nome + PIN) → entrega: foto do documento, dados do familiar, assinatura na tela → Liberado.
   Coleções: pertences (um registro por etiqueta; id pert-0001), pertences_cfg (id cfg: salas e gestores com PIN em hash).
   Arquivos: bucket anexos em pertences/<id>/… (fotos dos itens, documento, assinatura). Dados mínimos: sem informação clínica. */
const $ = id => document.getElementById(id);
const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dh = ts => ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const semAc = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const col = 'pertences', C_CFG = 'pertences_cfg', QR_P = 'PERT:';
const S = { LIVRE: 'Etiqueta livre', GUARD: 'Guardado', SOL: 'Liberação solicitada', AUT: 'Autorizado', LIB: 'Liberado' };
const cls = s => ({ [S.GUARD]: 'g', [S.SOL]: 's', [S.AUT]: 'a', [S.LIB]: 'l' }[s] || '');
const PARENT = ['Próprio paciente', 'Pai / mãe', 'Filho(a)', 'Cônjuge / companheiro(a)', 'Irmão(ã)', 'Outro familiar', 'Responsável legal', 'Outro'];
const DOCS = ['RG', 'CPF', 'CNH', 'Passaporte', 'Outro'];
const CFG0 = { salas: ['Sala da Coordenação ADM (caixa de pertences)'], gestores: [] };
let view = 'lista', LIST = [], CFG = { ...CFG0 }, curId = null, stream = null, qrTimer = null, f = { q: '', st: '' }, ultimoPend = null;
let fotosNovas = [], docFoto = null, sigBlob = null;

function notice(t, erro) { const m = $('message'); m.textContent = t || ''; m.className = erro ? 'err' : ''; if (t) m.scrollIntoView({ block: 'nearest' }); }
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem('pert_' + k) || ''; localStorage.setItem('pert_' + k, v); } catch (e) { return ''; } };
const meuEmail = () => { try { return (UPA.user() || {}).email || null; } catch (e) { return null; } };
const sha = async t => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))).map(b => b.toString(16).padStart(2, '0')).join('');
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');

/* ---------- dados ---------- */
async function carregar() {
  const [l, c] = await Promise.all([UPA.db.list(col), UPA.db.list(C_CFG)]);
  LIST = l.map(r => r.dados).sort((a, b) => String(b.numero).localeCompare(String(a.numero)));
  const cf = c.find(r => r.id === 'cfg'); CFG = { ...CFG0, ...(cf ? cf.dados : {}) };
}
const pend = () => LIST.filter(p => p.status === S.SOL);
const get = id => LIST.find(p => p.id === id);
async function salvar(p, ev) {
  if (ev) { p.log = (p.log || []).concat([{ ts: new Date().toISOString(), por: meuEmail(), ...ev }]); }
  p.atualizadoEm = new Date().toISOString(); await UPA.db.put(col, p.id, p);
  const i = LIST.findIndex(x => x.id === p.id); if (i >= 0) LIST[i] = p; else LIST.unshift(p);
}
/* número sequencial sem repetir: o id é a chave primária; se duas pessoas criarem juntas, a segunda tenta o próximo */
async function criarEtiquetas(n) {
  for (let t = 0; t < 10; t++) {
    const max = LIST.reduce((m, p) => Math.max(m, parseInt(String(p.numero).replace(/\D/g, ''), 10) || 0), 0) + t * n;
    const agora = new Date().toISOString(), rows = [], docs = [];
    for (let i = 1; i <= n; i++) { const k = max + i, numero = 'P-' + String(k).padStart(4, '0'), d = { id: 'pert-' + String(k).padStart(4, '0'), numero, token: token(), status: S.LIVRE, criadoEm: agora, log: [] }; docs.push(d); rows.push({ id: d.id, colecao: col, dados: d, atualizado_por: meuEmail(), updated_at: agora }); }
    const r = await UPA.client().from('registros').insert(rows);
    if (!r.error) { LIST = docs.concat(LIST); LIST.sort((a, b) => String(b.numero).localeCompare(String(a.numero))); return docs; }
    if (!/duplicate|23505|already exists|unique/i.test((r.error.code + ' ' + r.error.message) || '')) throw r.error;
    await carregar();
  }
  throw new Error('Não consegui reservar numeração. Tente novamente.');
}

/* ---------- navegação ---------- */
const VIEWS = [['lista', 'Pertences'], ['ler', 'Ler QR'], ['pend', 'Pendentes de liberação'], ['novo', 'Novo acautelamento'], ['etq', 'Etiquetas'], ['cfg', 'Configurações']];
function nav() { $('nav').innerHTML = VIEWS.map(v => { const n = v[0] === 'pend' ? pend().length : 0; return `<button type="button" data-v="${v[0]}" class="${v[0] === view || (view === 'det' && v[0] === 'lista') ? 'active' : ''}">${v[1]}${n ? ` <span class="st s">${n}</span>` : ''}</button>`; }).join(''); document.querySelectorAll('#nav [data-v]').forEach(b => b.onclick = () => { pararCam(); if (b.dataset.v === 'novo') curId = null; view = b.dataset.v; render(); }); }
const abrir = id => { pararCam(); curId = id; view = 'det'; render(); };

/* ---------- câmera / QR ---------- */
function pararCam() { if (qrTimer) { clearInterval(qrTimer); qrTimer = null; } if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }
async function lerQR(aoLer) {
  if (typeof jsQR === 'undefined') { notice('Leitor de QR não carregou (verifique a internet).', true); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { notice('Este navegador não permite usar a câmera (é preciso HTTPS).', true); return; }
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false }); } catch (e) { notice('Não consegui acessar a câmera: ' + e.message, true); return; }
  const v = $('vid'); v.srcObject = stream; await v.play(); $('camBox').classList.remove('hidden');
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true }); let oc = false;
  qrTimer = setInterval(() => { if (oc || !v.videoWidth) return; oc = true; try { const w = Math.min(1280, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth); cv.width = w; cv.height = h; cx.drawImage(v, 0, 0, w, h); const r = jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' }); if (r && r.data) { const t = String(r.data).trim(); if (t.indexOf(QR_P) === 0) { const p = LIST.find(x => x.token === t.slice(QR_P.length).toLowerCase()); pararCam(); if (p) aoLer(p); else notice('Etiqueta não encontrada neste sistema.', true); } } } catch (e) { } oc = false; }, 250);
}
const qrSvg = t => { const q = qrcode(0, 'M'); q.addData(t); q.make(); const n = q.getModuleCount(); let d = ''; for (let r = 0; r < n; r++)for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + c + ',' + r + 'h1v1h-1z'; return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><path d="${d}" fill="#000"/></svg>`; };

/* ---------- lista ---------- */
function viewLista() {
  const q = semAc(f.q), L = LIST.filter(p => p.status !== S.LIVRE || f.st === S.LIVRE).filter(p => (!f.st || p.status === f.st) && (!q || semAc([p.numero, p.paciente, p.bam, p.sala].join(' ')).includes(q)));
  const gu = LIST.filter(p => p.status === S.GUARD || p.status === S.SOL || p.status === S.AUT), antigos = gu.filter(p => (Date.now() - new Date(p.guardadoEm || p.criadoEm)) / 864e5 > 30).length;
  $('content').innerHTML = `<section class="view"><h2>Pertences acautelados</h2>
  ${pend().length ? `<div class="alerta-pend"><b>🔔 ${pend().length} solicitação(ões) de liberação aguardando autorização.</b> <button type="button" class="small" id="vaiPend">Ver</button></div>` : ''}
  <div class="stats"><div class="stat ok">Guardados agora<strong>${gu.length}</strong></div><div class="stat warn">Há mais de 30 dias<strong>${antigos}</strong></div><div class="stat">Etiquetas livres<strong>${LIST.filter(p => p.status === S.LIVRE).length}</strong></div></div>
  <div class="grid"><label class="fld">Busca<input id="fq" value="${esc(f.q)}" placeholder="número, paciente, BAM, sala"></label><label class="fld">Situação<select id="fst"><option value="">Todas (exceto livres)</option>${Object.values(S).map(s => `<option${f.st === s ? ' selected' : ''}>${s}</option>`).join('')}</select></label></div>
  ${L.length ? `<div class="table-wrap"><table><thead><tr><th>Nº</th><th>Paciente</th><th>BAM</th><th>Sala</th><th>Acautelado em</th><th>Situação</th><th></th></tr></thead><tbody>${L.map(p => `<tr><td><b>${esc(p.numero)}</b></td><td>${esc(p.paciente || '—')}</td><td>${esc(p.bam || '')}</td><td>${esc(p.sala || '')}</td><td>${dh(p.guardadoEm)}</td><td><span class="st ${cls(p.status)}">${esc(p.status)}</span></td><td><button type="button" class="small" data-a="${esc(p.id)}">Abrir</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nada encontrado.</p>'}</section>`;
  $('fq').oninput = e => { f.q = e.target.value; clearTimeout(window.__t); window.__t = setTimeout(viewLista, 250); };
  $('fst').onchange = e => { f.st = e.target.value; viewLista(); };
  document.querySelectorAll('[data-a]').forEach(b => b.onclick = () => abrir(b.dataset.a));
  const v = $('vaiPend'); if (v) v.onclick = () => { view = 'pend'; render(); };
}

/* ---------- ler QR ---------- */
function viewLer() {
  $('content').innerHTML = `<section class="view"><h2>Ler QR da etiqueta</h2><p class="muted">Aponte a câmera para a etiqueta do saco/envelope. Aparecem paciente, BAM, sala e a situação.</p>
  <div class="actions"><button type="button" id="bLer">📷 Ligar câmera</button></div><div class="cam hidden" id="camBox"><video id="vid" playsinline muted></video></div>
  <h3>Ou digite o número</h3><div class="grid"><label class="fld">Nº da etiqueta<input id="num" placeholder="P-0012 ou 12"></label></div><div class="actions"><button type="button" class="secondary" id="bNum">Buscar</button></div></section>`;
  $('bLer').onclick = () => lerQR(p => abrir(p.id));
  $('bNum').onclick = () => { const n = parseInt($('num').value.replace(/\D/g, ''), 10); const p = LIST.find(x => parseInt(String(x.numero).replace(/\D/g, ''), 10) === n); if (p) abrir(p.id); else notice('Número não encontrado.', true); };
}

/* ---------- cadastro (acautelamento) ---------- */
async function comprimir(file, max = 1280) {
  const url = URL.createObjectURL(file);
  try { const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Imagem inválida')); i.src = url; }); const sc = Math.min(1, max / Math.max(im.width, im.height)), cv = document.createElement('canvas'); cv.width = Math.round(im.width * sc); cv.height = Math.round(im.height * sc); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); return await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.72)); } finally { URL.revokeObjectURL(url); }
}
function formAcautelar(p, novo) {
  const salas = CFG.salas.length ? CFG.salas : CFG0.salas;
  return `<form id="af"><div class="grid"><label class="fld">Nome do paciente<input name="paciente" required value="${esc(p.paciente || '')}" autocomplete="off"></label>
  <label class="fld">Nº do BAM<input name="bam" required value="${esc(p.bam || '')}" inputmode="numeric"></label>
  <label class="fld">Sala / local onde ficam guardados<input name="sala" list="dlSala" required value="${esc(p.sala || salas[0])}"><datalist id="dlSala">${salas.map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
  <label class="fld">Acautelado por (colaborador)<input name="por" required value="${esc(p.guardadoPor || ls('quem'))}"></label>
  <label class="fld full">Itens no envelope (descreva com detalhes: valores, aparelhos, joias, documentos…)<textarea name="itens" required>${esc(p.itens || '')}</textarea></label>
  <label class="fld full">Foto dos itens (opcional)<input type="file" id="fFotos" accept="image/*" capture="environment" multiple></label></div>
  <div class="actions"><button type="submit">${novo ? 'Guardar e gerar etiqueta' : 'Salvar'}</button><button type="button" class="secondary" id="afCanc">Cancelar</button></div></form>`;
}
async function salvarAcaut(e, p) {
  e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); ls('quem', d.por.trim()); const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
  try {
    const fotos = (p.fotos || []).slice(), files = $('fFotos').files;
    for (let i = 0; i < files.length && fotos.length < 6; i++) { const b = await comprimir(files[i]), path = `pertences/${p.id}/item-${Date.now().toString(36)}-${i}.jpg`; await UPA.files.upload(path, b, 'image/jpeg'); fotos.push(path); }
    const primeira = p.status === S.LIVRE;
    Object.assign(p, { paciente: d.paciente.trim(), bam: d.bam.trim(), sala: d.sala.trim(), itens: d.itens.trim(), guardadoPor: d.por.trim(), fotos }); if (primeira) { p.status = S.GUARD; p.guardadoEm = new Date().toISOString(); }
    if (!CFG.salas.includes(p.sala)) { CFG.salas = CFG.salas.concat([p.sala]); await UPA.db.put(C_CFG, 'cfg', CFG); }
    await salvar(p, { tipo: primeira ? 'Acautelado' : 'Dados editados', quem: d.por.trim() });
    notice(primeira ? 'Pertences acautelados. Cole a etiqueta no saco/envelope.' : 'Dados salvos.'); abrir(p.id);
  } catch (er) { notice(UPA.msg(er), true); btn.disabled = false; }
}
async function viewNovo() {
  $('content').innerHTML = `<section class="view"><h2>Novo acautelamento</h2><div class="actions"><button type="button" id="bEtq">📷 Ler etiqueta já colada no envelope</button><button type="button" class="secondary" id="bAuto">Usar a próxima etiqueta livre</button></div><div class="cam hidden" id="camBox"><video id="vid" playsinline muted></video></div><p class="muted">Se você pré-imprimiu um lote, leia a etiqueta colada no envelope. Sem etiqueta pré-impressa, crie uma agora (ela é gerada com o cadastro).</p>
  <div class="actions"><button type="button" class="secondary" id="bNova">Criar nova etiqueta e cadastrar</button></div></section>`;
  $('bEtq').onclick = () => lerQR(p => { if (p.status !== S.LIVRE) { notice('Esta etiqueta já está em uso (' + p.numero + ').', true); abrir(p.id); } else abrir(p.id); });
  $('bAuto').onclick = () => { const l = LIST.filter(p => p.status === S.LIVRE).sort((a, b) => String(a.numero).localeCompare(String(b.numero)))[0]; if (l) abrir(l.id); else notice('Não há etiqueta livre. Gere um lote na aba Etiquetas ou crie uma nova.', true); };
  $('bNova').onclick = async () => { try { const [d] = await criarEtiquetas(1); abrir(d.id); } catch (e) { notice(UPA.msg(e), true); } };
}

/* ---------- detalhe ---------- */
async function urls(paths) { try { return paths.length ? await UPA.files.urls(paths) : {}; } catch (e) { return {}; } }
async function viewDet() {
  const p = get(curId); if (!p) { view = 'lista'; return render(); }
  if (p.status === S.LIVRE) {
    $('content').innerHTML = `<section class="view"><h2>Etiqueta <span class="big-n">${esc(p.numero)}</span> <span class="st">livre</span></h2><p class="muted">Cadastre o que está no envelope.</p>${formAcautelar(p, true)}</section>`;
    $('af').onsubmit = e => salvarAcaut(e, p); $('afCanc').onclick = () => { view = 'lista'; render(); }; return;
  }
  const U = await urls([...(p.fotos || []), p.docPath, p.assinPath].filter(Boolean));
  const ult = (p.log || []).slice().reverse();
  let acao = '';
  if (p.status === S.GUARD) acao = `<h3>Liberação</h3><form id="sf"><div class="grid"><label class="fld">Quem está solicitando (colaborador)<input name="quem" required value="${esc(ls('quem'))}"></label><label class="fld">Motivo / quem está pedindo os bens<input name="motivo" placeholder="Ex.: familiar na recepção, alta do paciente"></label></div><div class="actions"><button type="submit">Solicitar liberação ao gestor</button></div></form>`;
  if (p.status === S.SOL) acao = `<div class="alerta-pend"><b>Solicitação em ${dh(p.solicitacao.ts)}</b> por ${esc(p.solicitacao.quem)}${p.solicitacao.motivo ? ' — ' + esc(p.solicitacao.motivo) : ''}.<br>Aguardando autorização do gestor.</div>${blocoAutorizar(p)}`;
  if (p.status === S.AUT) acao = `<div class="alerta-pend" style="background:#dbeafe;border-color:#7aa6dc"><b>Liberação autorizada</b> por ${esc(p.autorizacao.por)} em ${dh(p.autorizacao.ts)}. Faça a entrega abaixo.</div>${formEntrega(p)}`;
  if (p.status === S.LIB) acao = `<h3>Entrega</h3><table class="hdrbox"><tr><td><b>Retirado por</b> ${esc(p.entrega.nome)} (${esc(p.entrega.parentesco)})</td><td><b>Documento</b> ${esc(p.entrega.docTipo)} ${esc(p.entrega.docNum)}</td></tr><tr><td><b>Telefone</b> ${esc(p.entrega.tel || '—')}</td><td><b>Entregue em</b> ${dh(p.entrega.ts)} por ${esc(p.entrega.por)}</td></tr></table><div class="fotos">${p.docPath && U[p.docPath] ? `<img src="${esc(U[p.docPath])}" alt="Documento">` : ''}${p.assinPath && U[p.assinPath] ? `<img src="${esc(U[p.assinPath])}" alt="Assinatura" style="background:#fff">` : ''}</div><div class="actions"><button type="button" id="bTermo">Imprimir termo de entrega</button></div>`;
  $('content').innerHTML = `<section class="view"><div class="actions"><button type="button" class="secondary" id="bVolta">← Lista</button></div>
  <h2>Pertences <span class="big-n">${esc(p.numero)}</span> <span class="st ${cls(p.status)}">${esc(p.status)}</span></h2>
  <table class="hdrbox"><tr><td><b>Paciente</b> ${esc(p.paciente)}</td><td><b>BAM</b> ${esc(p.bam)}</td></tr><tr><td colspan="2"><b>Sala / local:</b> ${esc(p.sala)}</td></tr><tr><td colspan="2"><b>Itens:</b> ${esc(p.itens).replace(/\n/g, '<br>')}</td></tr><tr><td colspan="2"><b>Acautelado por</b> ${esc(p.guardadoPor)} em ${dh(p.guardadoEm)}</td></tr></table>
  ${(p.fotos || []).length ? `<div class="fotos">${p.fotos.map(x => U[x] ? `<img src="${esc(U[x])}" alt="Foto dos itens">` : '').join('')}</div>` : ''}
  ${p.status !== S.LIB ? '<div class="actions"><button type="button" class="secondary" id="bEdit">Editar dados / itens</button><button type="button" class="secondary" id="bEtq1">Imprimir etiqueta</button></div>' : ''}
  ${acao}
  <h3>Histórico</h3><div class="table-wrap"><table><tbody>${ult.map(l => `<tr><td>${dh(l.ts)}</td><td>${esc(l.tipo)}</td><td>${esc(l.quem || l.por || '')}${l.obs ? ' — ' + esc(l.obs) : ''}</td></tr>`).join('')}</tbody></table></div></section>`;
  $('bVolta').onclick = () => { view = 'lista'; render(); };
  if ($('bEdit')) $('bEdit').onclick = () => { $('content').innerHTML = `<section class="view"><h2>Editar ${esc(p.numero)}</h2>${formAcautelar(p, false)}</section>`; $('af').onsubmit = e => salvarAcaut(e, p); $('afCanc').onclick = () => abrir(p.id); };
  if ($('bEtq1')) $('bEtq1').onclick = () => imprimirEtiquetas([p]);
  if ($('bTermo')) $('bTermo').onclick = () => imprimirTermo(p, U);
  if ($('sf')) $('sf').onsubmit = e => solicitar(e, p);
  if ($('azf')) { $('azf').onsubmit = e => autorizar(e, p); $('bNega').onclick = () => negar(p); }
  if ($('ef')) iniciarEntrega(p);
}
async function solicitar(e, p) {
  e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); ls('quem', d.quem.trim());
  try {
    p.status = S.SOL; p.solicitacao = { ts: new Date().toISOString(), quem: d.quem.trim(), motivo: d.motivo.trim() }; await salvar(p, { tipo: 'Liberação solicitada', quem: d.quem.trim(), obs: d.motivo.trim() });
    notificar(p); notice('Solicitação enviada ao gestor. Aguarde a autorização.'); abrir(p.id);
  } catch (er) { notice(UPA.msg(er), true); }
}
async function notificar(p) {
  const para = CFG.gestores.map(g => g.email).filter(Boolean); if (!para.length) return;
  try { await UPA.client().functions.invoke('notificar-pertences', { body: { para, assunto: `Liberação de pertences ${p.numero} aguardando autorização`, texto: `Solicitação de liberação do envelope ${p.numero} feita por ${p.solicitacao.quem} em ${dh(p.solicitacao.ts)}.\nAbra Gestão Inteligente > Guarda de pertences > Pendentes de liberação para autorizar ou negar.` } }); } catch (e) { }
}
function blocoAutorizar(p) {
  if (!CFG.gestores.length) return '<div class="alert warn"><b>⚠</b><span>Nenhum gestor autorizador cadastrado. Cadastre em Configurações (nome e PIN).</span></div>';
  return `<form id="azf"><div class="grid"><label class="fld">Gestor autorizador<select name="g">${CFG.gestores.map((g, i) => `<option value="${i}">${esc(g.nome)}</option>`).join('')}</select></label><label class="fld">PIN<input name="pin" type="password" inputmode="numeric" required autocomplete="off"></label><label class="fld full">Observação / motivo da negativa (opcional)<input name="obs"></label></div><div class="actions"><button type="submit">Autorizar liberação</button><button type="button" class="danger" id="bNega">Negar</button></div></form>`;
}
async function validarPin() { const g = CFG.gestores[+document.querySelector('#azf [name=g]').value], pin = document.querySelector('#azf [name=pin]').value; if (!g || !pin || (await sha(g.salt + pin)) !== g.hash) { notice('PIN incorreto.', true); return null; } return g; }
async function autorizar(e, p) {
  e.preventDefault(); const g = await validarPin(); if (!g) return; const obs = e.target.obs.value.trim();
  try { p.status = S.AUT; p.autorizacao = { ts: new Date().toISOString(), por: g.nome }; await salvar(p, { tipo: 'Liberação autorizada', quem: g.nome, obs }); notice('Liberação autorizada.'); abrir(p.id); } catch (er) { notice(UPA.msg(er), true); }
}
async function negar(p) {
  const g = await validarPin(); if (!g) return; const obs = document.querySelector('#azf [name=obs]').value.trim();
  try { p.status = S.GUARD; p.solicitacao = null; await salvar(p, { tipo: 'Liberação negada', quem: g.nome, obs }); notice('Solicitação negada. Pertences continuam guardados.'); abrir(p.id); } catch (er) { notice(UPA.msg(er), true); }
}

/* ---------- entrega ---------- */
function formEntrega(p) {
  docFoto = null; sigBlob = null;
  return `<h3>Entrega ao familiar / responsável</h3><form id="ef"><div class="grid">
  <label class="fld">Nome completo de quem retira<input name="nome" required autocomplete="off"></label>
  <label class="fld">Grau de parentesco<select name="parentesco">${PARENT.map(x => `<option>${x}</option>`).join('')}</select></label>
  <label class="fld">Tipo de documento<select name="docTipo">${DOCS.map(x => `<option>${x}</option>`).join('')}</select></label>
  <label class="fld">Nº do documento<input name="docNum" required></label>
  <label class="fld">Telefone<input name="tel" inputmode="tel"></label>
  <label class="fld">Entregue por (colaborador)<input name="por" required value="${esc(ls('quem'))}"></label>
  <label class="fld full">Foto do documento de quem retira<input type="file" id="fDoc" accept="image/*" capture="environment"></label></div>
  <p><img id="pvDoc" alt="" style="max-height:140px;border-radius:8px" class="hidden"></p>
  <label class="chk" style="display:flex;gap:8px;align-items:center;font-size:.9rem"><input type="checkbox" name="conf" required style="width:auto;margin:0"> Conferi os itens com quem está retirando e todos foram entregues conforme descrição acima.</label>
  <h4>Assinatura de quem retira</h4><canvas class="assin" id="sig"></canvas><div class="actions"><button type="button" class="secondary small" id="sigLimpa">Limpar assinatura</button></div>
  <div class="actions"><button type="submit">Finalizar entrega</button></div></form>`;
}
function iniciarEntrega(p) {
  const cv = $('sig'), r = cv.getBoundingClientRect(); cv.width = Math.round(r.width * 2); cv.height = Math.round(r.height * 2); const x = cv.getContext('2d'); x.scale(2, 2); x.lineWidth = 2.4; x.lineCap = 'round'; x.strokeStyle = '#0a2a8a'; let d = false, last = null, tem = false;
  const pt = ev => { const b = cv.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top]; };
  cv.onpointerdown = ev => { d = true; last = pt(ev); cv.setPointerCapture(ev.pointerId); ev.preventDefault(); };
  cv.onpointermove = ev => { if (!d) return; const q = pt(ev); x.beginPath(); x.moveTo(last[0], last[1]); x.lineTo(q[0], q[1]); x.stroke(); last = q; tem = true; };
  cv.onpointerup = cv.onpointercancel = () => { d = false; };
  $('sigLimpa').onclick = () => { x.clearRect(0, 0, cv.width, cv.height); tem = false; };
  $('fDoc').onchange = async ev => { const fl = ev.target.files[0]; if (!fl) return; docFoto = await comprimir(fl, 1400); const i = $('pvDoc'); i.src = URL.createObjectURL(docFoto); i.classList.remove('hidden'); };
  $('ef').onsubmit = async e => {
    e.preventDefault(); const dd = Object.fromEntries(new FormData(e.target));
    if (!docFoto) { notice('Tire a foto do documento.', true); return; } if (!tem) { notice('Colha a assinatura de quem retira.', true); return; }
    const btn = e.target.querySelector('[type=submit]'); btn.disabled = true; ls('quem', dd.por.trim());
    try {
      const sb = await new Promise(res => cv.toBlob(res, 'image/png')); const pd = `pertences/${p.id}/documento.jpg`, ps = `pertences/${p.id}/assinatura.png`;
      await UPA.files.upload(pd, docFoto, 'image/jpeg'); await UPA.files.upload(ps, sb, 'image/png');
      p.docPath = pd; p.assinPath = ps; p.entrega = { ts: new Date().toISOString(), nome: dd.nome.trim(), parentesco: dd.parentesco, docTipo: dd.docTipo, docNum: dd.docNum.trim(), tel: (dd.tel || '').trim(), por: dd.por.trim() }; p.status = S.LIB;
      await salvar(p, { tipo: 'Entregue', quem: dd.por.trim(), obs: 'Retirado por ' + dd.nome.trim() }); notice('Entrega finalizada e registrada.'); abrir(p.id);
    } catch (er) { notice(UPA.msg(er), true); btn.disabled = false; }
  };
}

/* ---------- pendentes ---------- */
function viewPend() {
  const L = pend().sort((a, b) => a.solicitacao.ts.localeCompare(b.solicitacao.ts));
  $('content').innerHTML = `<section class="view"><h2>Pendentes de liberação</h2>${L.length ? `<div class="table-wrap"><table><thead><tr><th>Nº</th><th>Paciente</th><th>BAM</th><th>Solicitado por</th><th>Quando</th><th></th></tr></thead><tbody>${L.map(p => `<tr><td><b>${esc(p.numero)}</b></td><td>${esc(p.paciente)}</td><td>${esc(p.bam)}</td><td>${esc(p.solicitacao.quem)}${p.solicitacao.motivo ? '<br><small>' + esc(p.solicitacao.motivo) + '</small>' : ''}</td><td>${dh(p.solicitacao.ts)}</td><td><button type="button" class="small" data-a="${esc(p.id)}">Analisar</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nenhuma solicitação pendente.</p>'}
  <p class="muted">Esta tela se atualiza sozinha e avisa (som e notificação do navegador) quando chega uma nova solicitação.</p></section>`;
  document.querySelectorAll('[data-a]').forEach(b => b.onclick = () => abrir(b.dataset.a));
}

/* ---------- etiquetas e impressão ---------- */
const css = '<style>.lista-etq{display:grid;grid-template-columns:repeat(3,62mm);font-size:0}.etq{width:62mm;height:36mm;border:.3mm dashed #777;padding:2mm;display:flex;gap:2mm;align-items:center;break-inside:avoid;font-size:8pt;overflow:hidden;box-sizing:border-box}.etq .q{width:27mm;height:27mm;flex:0 0 27mm}.etq .q svg{width:100%;height:100%;display:block}.etq .t{font-size:6.5pt;font-weight:bold;text-transform:uppercase;color:#333}.etq .n{font-size:15pt;font-weight:800;margin:1mm 0}.etq .u{font-size:6.5pt}</style>';
const aguardar = root => Promise.all(Array.from(root.querySelectorAll('img')).map(im => im.complete && im.naturalWidth ? 0 : new Promise(r => { im.onload = im.onerror = () => r(); setTimeout(r, 4000); })));
async function imprimirHtml(h) { const root = $('printRoot'); root.innerHTML = `<div class="doc">${h}</div>`; root.classList.remove('hidden'); await aguardar(root); setTimeout(() => { window.print(); root.classList.add('hidden'); }, 100); }
function imprimirEtiquetas(L) {
  if (typeof qrcode === 'undefined') { notice('Gerador de QR não carregou (verifique a internet).', true); return; }
  imprimirHtml(css + `<div class="lista-etq">${L.map(p => `<div class="etq"><div class="q">${qrSvg(QR_P + p.token)}</div><div><div class="t">Pertences de paciente</div><div class="n">${esc(p.numero)}</div><div class="u">UPA 24h Rocinha<br>Leia o QR para consultar</div></div></div>`).join('')}</div>`);
}
const logoSus = () => `<img src="../../assets/logo-sus.png" alt="SUS" style="height:56px" onerror="this.outerHTML='<span style=&quot;font:800 22pt Arial,sans-serif;color:#0b5ea8;letter-spacing:2px&quot;>SUS</span>'">`;
function imprimirTermo(p, U) {
  imprimirHtml(`<div class="logos"><img src="../../assets/logo-gnosis.jpg" alt="Instituto Gnosis" style="height:60px">${logoSus()}</div><h2 style="text-align:center">TERMO DE ENTREGA DE PERTENCES DE PACIENTE</h2>
  <table class="hdrbox"><tr><td><b>Unidade:</b> UPA 24h Rocinha · CNES 6507409</td><td><b>Envelope nº:</b> ${esc(p.numero)}</td></tr><tr><td><b>Paciente:</b> ${esc(p.paciente)}</td><td><b>BAM:</b> ${esc(p.bam)}</td></tr><tr><td colspan="2"><b>Local de guarda:</b> ${esc(p.sala)}</td></tr><tr><td colspan="2"><b>Itens acautelados:</b> ${esc(p.itens).replace(/\n/g, '<br>')}</td></tr><tr><td colspan="2"><b>Acautelado por</b> ${esc(p.guardadoPor)} em ${dh(p.guardadoEm)}</td></tr></table>
  <p style="text-align:justify;font-size:10.5pt">Eu, <b>${esc(p.entrega.nome)}</b>, ${esc(p.entrega.docTipo)} nº ${esc(p.entrega.docNum)}, ${esc(p.entrega.parentesco.toLowerCase())}${p.entrega.tel ? ', telefone ' + esc(p.entrega.tel) : ''}, declaro que recebi em ${dh(p.entrega.ts)} os pertences acima descritos, conferidos na minha presença, e que nada mais tenho a reclamar quanto a eles.</p>
  <p style="font-size:9.5pt"><b>Liberação autorizada por</b> ${esc(p.autorizacao.por)} em ${dh(p.autorizacao.ts)}. <b>Entregue por</b> ${esc(p.entrega.por)}.</p>
  <div style="display:flex;gap:10mm;align-items:flex-end;margin-top:10mm">${U[p.assinPath] ? `<div style="flex:1;text-align:center"><img src="${esc(U[p.assinPath])}" alt="" style="max-height:30mm;max-width:100%"><div style="border-top:1px solid #000;padding-top:3px">${esc(p.entrega.nome)}</div></div>` : ''}${U[p.docPath] ? `<div style="flex:1;text-align:center"><img src="${esc(U[p.docPath])}" alt="" style="max-height:55mm;max-width:100%"><div style="font-size:8pt">Documento apresentado</div></div>` : ''}</div>
  <p class="nota">Registro eletrônico no sistema Gestão Inteligente UPA Rocinha. Assinatura colhida em tela e foto do documento arquivadas com data e hora.</p>`);
}
function viewEtq() {
  const livres = LIST.filter(p => p.status === S.LIVRE).sort((a, b) => String(a.numero).localeCompare(String(b.numero)));
  $('content').innerHTML = `<section class="view"><h2>Etiquetas com QR</h2><p class="muted">Gere um lote numerado, imprima (A4, 21 etiquetas por folha, escala 100%) e cole nos sacos/envelopes. Depois, leia a etiqueta e cadastre o conteúdo.</p>
  <div class="grid"><label class="fld">Quantidade de etiquetas novas<input type="number" id="qtd" min="1" max="63" value="21"></label></div><div class="actions"><button type="button" id="bGera">Gerar e imprimir lote</button></div>
  <div class="stats"><div class="stat">Etiquetas livres (impressas e ainda sem uso)<strong>${livres.length}</strong></div></div>
  ${livres.length ? `<div class="actions"><button type="button" class="secondary" id="bReimp">Reimprimir as ${livres.length} livres</button></div><p class="muted">Livres: ${livres.map(p => esc(p.numero)).join(', ')}</p>` : ''}</section>`;
  $('bGera').onclick = async () => { const n = Math.max(1, Math.min(63, parseInt($('qtd').value, 10) || 21)); try { const d = await criarEtiquetas(n); notice(n + ' etiquetas geradas (' + d[0].numero + ' a ' + d[d.length - 1].numero + ').'); imprimirEtiquetas(d); } catch (e) { notice(UPA.msg(e), true); } };
  if ($('bReimp')) $('bReimp').onclick = () => imprimirEtiquetas(livres);
}

/* ---------- configurações ---------- */
function viewCfg() {
  $('content').innerHTML = `<section class="view"><h2>Configurações</h2><h3>Gestores que podem autorizar liberações</h3>
  ${CFG.gestores.length ? `<div class="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail (aviso)</th></tr></thead><tbody>${CFG.gestores.map(g => `<tr><td>${esc(g.nome)}</td><td>${esc(g.email || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nenhum gestor cadastrado ainda.</p>'}
  <form id="gf"><div class="grid"><label class="fld">Nome do gestor<input name="nome" required></label><label class="fld">E-mail para aviso<input name="email" type="email"></label><label class="fld">PIN (4 a 8 números)<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" required></label>
  ${CFG.gestores.length ? `<label class="fld">PIN de um gestor já cadastrado (para autorizar este cadastro)<input name="pinAdm" type="password" inputmode="numeric" required></label><label class="fld">Gestor que confirma<select name="adm">${CFG.gestores.map((g, i) => `<option value="${i}">${esc(g.nome)}</option>`).join('')}</select></label>` : ''}</div><div class="actions"><button type="submit">Cadastrar / atualizar gestor</button></div></form>
  <p class="muted">O PIN é guardado só em formato criptografado (hash). Para trocar o PIN de um gestor, cadastre o mesmo nome novamente. A autorização de liberação exige nome + PIN, porque o sistema usa um único login.</p>
  <h3>Salas / locais de guarda</h3><form id="sf2"><label class="fld"><textarea name="salas">${esc(CFG.salas.join('\n'))}</textarea></label><div class="actions"><button type="submit">Salvar salas (uma por linha)</button></div></form></section>`;
  $('gf').onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    try {
      if (CFG.gestores.length) { const a = CFG.gestores[+d.adm]; if (!a || (await sha(a.salt + d.pinAdm)) !== a.hash) { notice('PIN do gestor confirmante incorreto.', true); return; } }
      const salt = token(), g = { nome: d.nome.trim(), email: (d.email || '').trim(), salt, hash: await sha(salt + d.pin) }, i = CFG.gestores.findIndex(x => semAc(x.nome) === semAc(g.nome));
      if (i >= 0) CFG.gestores[i] = g; else CFG.gestores.push(g); await UPA.db.put(C_CFG, 'cfg', CFG); notice('Gestor salvo.'); viewCfg();
    } catch (er) { notice(UPA.msg(er), true); }
  };
  $('sf2').onsubmit = async e => { e.preventDefault(); CFG.salas = e.target.salas.value.split('\n').map(s => s.trim()).filter(Boolean); try { await UPA.db.put(C_CFG, 'cfg', CFG); notice('Salas salvas.'); } catch (er) { notice(UPA.msg(er), true); } };
}

/* ---------- aviso de novas solicitações ---------- */
function bip() { try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(); o.frequency.value = 880; o.connect(a.destination); o.start(); setTimeout(() => { o.stop(); a.close(); }, 350); } catch (e) { } }
async function vigiar() {
  try {
    const antes = new Set(pend().map(p => p.id)); await carregar(); const novas = pend().filter(p => !antes.has(p.id));
    if (ultimoPend !== null && novas.length) { bip(); notice('🔔 Nova solicitação de liberação: ' + novas.map(p => p.numero).join(', ')); try { if (window.Notification && Notification.permission === 'granted') new Notification('Liberação de pertences', { body: 'Envelope ' + novas[0].numero + ' aguardando autorização' }); } catch (e) { } }
    ultimoPend = pend().length; nav(); if (view === 'pend') viewPend(); else if (view === 'lista') viewLista();
  } catch (e) { }
}

function render() { nav(); ({ lista: viewLista, ler: viewLer, pend: viewPend, novo: viewNovo, etq: viewEtq, cfg: viewCfg, det: viewDet })[view](); }
(async function init() {
  try { await UPA.ready(); await carregar(); ultimoPend = pend().length; render(); try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) { } setInterval(() => { if (!document.hidden && !stream && !document.querySelector('#af,#ef,#azf:focus-within,#sf')) vigiar(); }, 20000); } catch (e) { notice(UPA.msg(e), true); }
})();
