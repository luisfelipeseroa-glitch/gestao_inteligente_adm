'use strict';
/* Atestos: importa PDF, posiciona a assinatura (imagem + certificação abaixo), gera o PDF atestado,
   arquiva original + atestado, lança comprovante na Central de Serviços e evidência no plano SUBHUE.
   Coleções: atestos_docs (arquivo), atestos_cfg (assinatura/signatário). Arquivos no bucket 'anexos' em atestos/<id>/…
   Assinatura = imagem + carimbo com código de verificação (SHA-256). NÃO é assinatura digital qualificada (ICP-Brasil/gov.br). */
const $ = id => document.getElementById(id);
const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hoje = () => new Date().toLocaleDateString('en-CA');
const fd = d => { if (!d) return ''; const p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(d); };
const C_DOCS = 'atestos_docs', C_CFG = 'atestos_cfg';
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const CFG0 = { nome: 'Luis Felipe W. Seroa da Motta', cargo: 'Coordenador Administrativo', unidade: 'UPA 24h Rocinha', cnes: '6507409' };
let view = 'novo', CFG = { ...CFG0 }, SIGURL = '', DOCS = [], EMPRESAS = [];
let pdfBytes = null, pdfName = '', pdfDoc = null, hashOrig = '', marks = [], sigW = 0.3, sigImg = null, pdfPages = [];
let ultimo = null;

function notice(t, erro) { const m = $('message'); m.textContent = t || ''; m.className = erro ? 'err' : ''; if (t) m.scrollIntoView({ block: 'nearest' }); }
const VIEWS = [['novo', 'Novo atesto'], ['arq', 'Arquivo'], ['assin', 'Assinatura'], ['conf', 'Conferir documento']];
function nav() { $('nav').innerHTML = VIEWS.map(v => `<button type="button" data-v="${v[0]}" class="${v[0] === view ? 'active' : ''}">${v[1]}</button>`).join(''); document.querySelectorAll('#nav [data-v]').forEach(b => b.onclick = () => { view = b.dataset.v; render(); }); }

/* ---------- util ---------- */
async function sha256(buf) { const h = await crypto.subtle.digest('SHA-256', buf); return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join(''); }
const cod = h => h.slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'doc';
const blobDe = (u8, t) => new Blob([u8], { type: t || 'application/pdf' });
function baixar(blob, nome) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
const dataHora = d => { const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
function imgDe(url) { return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('Não foi possível carregar a imagem.')); i.src = url; }); }

/* ---------- dados ---------- */
async function carregar() {
  const [cfg, docs, emp] = await Promise.all([UPA.db.list(C_CFG), UPA.db.list(C_DOCS), UPA.db.list('central_empresas').catch(() => [])]);
  const c = cfg.find(r => r.id === 'cfg');
  CFG = { ...CFG0, ...(c ? c.dados : {}) };
  DOCS = docs.map(r => r.dados).sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
  EMPRESAS = emp.map(r => r.dados).filter(e => e && e.name);
  SIGURL = '';
  if (CFG.sigPath) { try { const u = await UPA.files.urls([CFG.sigPath]); SIGURL = u[CFG.sigPath] || ''; } catch (e) { SIGURL = ''; } }
}

/* ---------- imagem da assinatura ---------- */
async function limparFundo(file) {
  const url = URL.createObjectURL(file);
  try {
    const im = await imgDe(url);
    const sc = Math.min(1, 1400 / im.width), w = Math.round(im.width * sc), h = Math.round(im.height * sc);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'); x.drawImage(im, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h), p = d.data; let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let i = 0; i < p.length; i += 4) {
      const lum = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      let a = Math.max(0, Math.min(255, (235 - lum) * 255 / 150)); if (p[i + 3] < 255) a = Math.min(a, p[i + 3]);
      p[i + 3] = a;
      if (a > 25) { const k = (i / 4), px = k % w, py = (k - px) / w; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
    }
    x.putImageData(d, 0, 0);
    if (x1 <= x0 || y1 <= y0) throw new Error('Não encontrei traço de assinatura na imagem.');
    const m = 6; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
    const out = document.createElement('canvas'); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1; out.getContext('2d').drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return await new Promise(r => out.toBlob(r, 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- carimbo: assinatura + certificação abaixo (um PNG transparente) ---------- */
async function montarCarimbo(codigo, quando) {
  const W = 1000, im = sigImg, sw = 560, sh = Math.round(im.height * sw / im.width);
  const lin = [
    ['Atestado eletronicamente por', 'normal', 30],
    [CFG.nome.toUpperCase(), 'bold', 36],
    [CFG.cargo + ' · ' + CFG.unidade + ' · CNES ' + CFG.cnes, 'normal', 28],
    [quando + ' · Cód. de verificação: ' + codigo, 'normal', 28]
  ];
  const H = sh + 34 + lin.reduce((s, l) => s + l[2] + 10, 0) + 14;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d');
  x.drawImage(im, (W - sw) / 2, 0, sw, sh);
  let y = sh + 12; x.strokeStyle = '#123e70'; x.lineWidth = 3; x.beginPath(); x.moveTo(70, y); x.lineTo(W - 70, y); x.stroke(); y += 22;
  x.fillStyle = '#123e70'; x.textAlign = 'center'; x.textBaseline = 'top';
  lin.forEach(l => { let f = l[2]; do { x.font = `${l[1] === 'bold' ? 'bold ' : ''}${f}px Arial, Helvetica, sans-serif`; f -= 1; } while (x.measureText(l[0]).width > W - 40 && f > 12); x.fillText(l[0], W / 2, y); y += l[2] + 10; });
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  return { blob, w: W, h: H, url: cv.toDataURL('image/png') };
}

/* ---------- pdf.js ---------- */
async function iniciarPdfJs() {
  if (!window.pdfjsLib) throw new Error('Biblioteca de PDF não carregou (verifique a internet).');
  if (window.__pdfWorker) return;
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  try { const t = await (await fetch(base)).text(); pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([t], { type: 'text/javascript' })); } catch (e) { pdfjsLib.GlobalWorkerOptions.workerSrc = base; }
  window.__pdfWorker = true;
}
async function abrirPdf(file) {
  notice('Lendo o PDF…');
  await iniciarPdfJs();
  pdfBytes = new Uint8Array(await file.arrayBuffer()); pdfName = file.name; marks = []; ultimo = null;
  hashOrig = await sha256(pdfBytes.buffer.slice(0));
  pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
  pdfPages = [];
  const box = $('pages'); box.innerHTML = '';
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const pg = await pdfDoc.getPage(n), vp = pg.getViewport({ scale: 1.4 });
    const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    const w = document.createElement('div'); w.className = 'pg'; w.dataset.n = n; w.innerHTML = `<span class="lbl">Página ${n}/${pdfDoc.numPages}</span>`; w.insertBefore(cv, w.firstChild);
    w.addEventListener('pointerdown', ev => { if (ev.target.closest('.sig')) return; colocar(w, ev); });
    box.appendChild(w); pdfPages.push(w);
  }
  notice(`PDF carregado (${pdfDoc.numPages} página(s)). Clique no local da página onde a assinatura deve ficar.`);
  $('passo2').classList.remove('hidden'); atualizarMarcas();
}
function colocar(w, ev) {
  if (!sigImg) { notice('Cadastre a imagem da assinatura na aba "Assinatura" antes.', true); return; }
  const r = w.getBoundingClientRect(), cv = w.querySelector('canvas');
  const m = { id: uuid(), n: +w.dataset.n, fx: 0, fy: 0, el: null };
  const bw = sigW * r.width, bh = bw * sigRel();
  m.fx = Math.max(0, Math.min(1 - sigW, (ev.clientX - r.left - bw / 2) / r.width)); m.fy = Math.max(0, Math.min(1 - bh / r.height, (ev.clientY - r.top - bh / 2) / r.height));
  marks.push(m); desenharMarca(w, m); atualizarMarcas();
}
const sigRel = () => (prevCarimbo ? prevCarimbo.h / prevCarimbo.w : 0.5);
function desenharMarca(w, m) {
  const el = document.createElement('div'); el.className = 'sig'; el.innerHTML = `<img alt="Assinatura"><button type="button" class="x" title="Remover" aria-label="Remover">×</button>`;
  el.querySelector('img').src = prevCarimbo.url; m.el = el; w.appendChild(el); posMarca(w, m);
  el.querySelector('.x').onclick = e => { e.stopPropagation(); el.remove(); marks = marks.filter(k => k !== m); atualizarMarcas(); };
  el.addEventListener('pointerdown', ev => {
    if (ev.target.closest('.x')) return; ev.preventDefault(); el.setPointerCapture(ev.pointerId);
    const r = w.getBoundingClientRect(), sx = ev.clientX, sy = ev.clientY, fx0 = m.fx, fy0 = m.fy;
    const mv = e => { const bh = (sigW * r.width) * sigRel() / r.height; m.fx = Math.max(0, Math.min(1 - sigW, fx0 + (e.clientX - sx) / r.width)); m.fy = Math.max(0, Math.min(1 - bh, fy0 + (e.clientY - sy) / r.height)); posMarca(w, m); };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
}
function posMarca(w, m) { const el = m.el; el.style.left = (m.fx * 100) + '%'; el.style.top = (m.fy * 100) + '%'; el.style.width = (sigW * 100) + '%'; }
function atualizarMarcas() { const e = $('nMarcas'); if (e) e.textContent = marks.length ? `${marks.length} assinatura(s) posicionada(s): ${marks.map(m => 'pág. ' + m.n).join(', ')}.` : 'Nenhuma assinatura posicionada ainda.'; }
let prevCarimbo = null;

/* ---------- gerar PDF atestado ---------- */
async function gerarAtestado(quando, codigo) {
  const { PDFDocument, degrees } = PDFLib;
  const doc = await PDFDocument.load(pdfBytes.slice(), { ignoreEncryption: true });
  const car = await montarCarimbo(codigo, quando);
  const png = await doc.embedPng(await car.blob.arrayBuffer());
  const pages = doc.getPages();
  marks.forEach(m => {
    const pg = pages[m.n - 1], { width: W, height: H } = pg.getSize(), ang = ((pg.getRotation().angle % 360) + 360) % 360;
    const Wd = ang % 180 ? H : W, Hd = ang % 180 ? W : H;
    const bw = sigW * Wd, bh = bw * car.h / car.w, bx = m.fx * Wd, by = m.fy * Hd, dy = by + bh;
    let u, v;
    if (ang === 0) { u = bx; v = dy; } else if (ang === 90) { u = dy; v = H - bx; } else if (ang === 180) { u = W - bx; v = H - dy; } else { u = W - dy; v = bx; }
    const opts = { x: u, y: H - v, width: bw, height: bh };
    if (ang) opts.rotate = degrees(ang);
    pg.drawImage(png, opts);
  });
  doc.setProducer('Gestão Inteligente UPA Rocinha — Atestos'); doc.setSubject('Documento atestado eletronicamente — cód. ' + codigo);
  return await doc.save();
}

/* ---------- salvar ---------- */
async function salvarAtesto(e) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  if (!pdfBytes) { notice('Importe o PDF primeiro.', true); return; }
  if (!marks.length) { notice('Clique na página para posicionar a assinatura (pelo menos uma).', true); return; }
  if (!f.empresa.trim() || !f.servico.trim()) { notice('Informe empresa e serviço.', true); return; }
  if (!sigImg) { notice('Cadastre a imagem da assinatura na aba "Assinatura".', true); return; }
  const btn = $('btnSalvar'); btn.disabled = true;
  try {
    notice('Gerando PDF atestado…');
    const id = uuid(), agora = new Date(), quando = dataHora(agora), codigo = cod(hashOrig);
    const out = await gerarAtestado(quando, codigo), hashAss = await sha256(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
    const base = `Atesto_${slug(f.empresa)}_${slug(f.competencia || f.dataServico)}_${id.slice(0, 6)}`;
    notice('Arquivando…');
    const pO = `atestos/${id}/original.pdf`, pA = `atestos/${id}/atestado.pdf`;
    await UPA.files.upload(pO, blobDe(pdfBytes), 'application/pdf');
    await UPA.files.upload(pA, blobDe(out), 'application/pdf');
    const doc = {
      id, criadoEm: agora.toISOString(), empresa: f.empresa.trim(), servico: f.servico.trim(), competencia: f.competencia, dataServico: f.dataServico, nf: f.nf.trim(), valor: f.valor, obs: f.obs.trim(),
      nomeOriginal: pdfName, paginas: pdfDoc.numPages, assinaturas: marks.map(m => m.n), hashOrig, hashAss, codigo, pathOrig: pO, pathAss: pA, nomeAss: base + '.pdf', signatario: CFG.nome, tamAss: out.byteLength
    };
    const extra = [];
    if (f.central) { try { const r = await lancarCentral(doc, out); doc.chamadoId = r.chamadoId; doc.anexoId = r.anexoId; extra.push('comprovante lançado na Central de Serviços'); } catch (er) { extra.push('⚠ Central: ' + UPA.msg(er)); } }
    const sel = Array.from($('subItens').selectedOptions).map(o => o.value);
    if (sel.length) { try { await lancarSubhue(doc, out, sel); doc.subhue = sel; extra.push('evidência anexada a ' + sel.length + ' item(ns) do plano SUBHUE'); } catch (er) { extra.push('⚠ SUBHUE: ' + UPA.msg(er)); } }
    await UPA.db.put(C_DOCS, id, doc); DOCS.unshift(doc);
    baixar(blobDe(out), base + '.pdf');
    ultimo = doc;
    notice('Atesto salvo e arquivado' + (extra.length ? ' · ' + extra.join(' · ') : '') + '. O download do PDF atestado foi iniciado.', extra.some(x => x.startsWith('⚠')));
    pdfBytes = null; marks = []; render();
    $('content').insertAdjacentHTML('afterbegin', `<div class="okbox"><b>✔ Atesto ${esc(doc.codigo)} arquivado.</b> Empresa: ${esc(doc.empresa)} · ${esc(doc.servico)}.<div class="actions"><button type="button" id="okBaixar">Baixar novamente</button><button type="button" class="secondary" id="okArq">Ver no arquivo</button></div></div>`);
    $('okBaixar').onclick = () => baixar(blobDe(out), base + '.pdf'); $('okArq').onclick = () => { view = 'arq'; render(); };
  } catch (er) { console.error(er); notice('Erro ao salvar: ' + UPA.msg(er), true); }
  finally { const b = $('btnSalvar'); if (b) b.disabled = false; }
}

async function lancarCentral(doc, out) {
  let emp = EMPRESAS.find(e => e.name.trim().toLowerCase() === doc.empresa.trim().toLowerCase());
  if (!emp) { emp = { id: uuid(), name: doc.empresa, cnpj: '', specialty: '', contact: '', email: '', technical: '' }; await UPA.db.put('central_empresas', emp.id, emp); EMPRESAS.push(emp); }
  const cid = uuid(), aid = uuid(), data = doc.dataServico || hoje();
  const call = {
    id: cid, opened: data, performed: data, company: emp.id, sector: 'Administração', asset: doc.servico.slice(0, 80), type: 'Outro', priority: 'Rotina', execution: 'Realizado',
    attestation: 'Disponível na UPA', custodian: '', reference: doc.nf || ('Atesto ' + doc.codigo), due: '',
    description: `Comprovante de serviço — ${doc.servico}${doc.competencia ? ' (competência ' + doc.competencia + ')' : ''}. Documento atestado eletronicamente por ${doc.signatario} em ${dataHora(new Date(doc.criadoEm))}. Cód. de verificação ${doc.codigo}.`,
    notes: [doc.nf ? 'NF/Doc: ' + doc.nf : '', doc.valor ? 'Valor: R$ ' + doc.valor : '', doc.obs].filter(Boolean).join(' · '), updated: new Date().toISOString(), origem: 'atestos:' + doc.id
  };
  await UPA.db.put('central_chamados', cid, call);
  const path = 'central/' + aid;
  await UPA.files.upload(path, blobDe(out), 'application/pdf');
  await UPA.db.put('central_anexos', aid, { id: aid, callId: cid, name: doc.nomeAss, type: 'application/pdf', size: out.byteLength, path });
  return { chamadoId: cid, anexoId: aid };
}
async function lancarSubhue(doc, out, chaves) {
  const rows = await UPA.db.list('subhue_acoes'), mapa = {}; rows.forEach(r => { mapa[r.id] = r.dados; });
  for (const k of chaves) {
    const id = 'subhue-' + k, path = `subhue/${k}/atesto-${doc.id.slice(0, 8)}.pdf`;
    await UPA.files.upload(path, blobDe(out), 'application/pdf');
    const d = { ...(mapa[id] || {}) }; d.anexos = (d.anexos || []).concat([{ path, nome: `Atesto ${doc.empresa} — ${doc.servico}`.slice(0, 90) + '.pdf', tam: out.byteLength, em: new Date().toISOString() }]);
    d.atualizadoEm = new Date().toISOString(); await UPA.db.put('subhue_acoes', id, d);
  }
}

/* ---------- views ---------- */
function viewNovo() {
  const semSig = !sigImg;
  const emps = Array.from(new Set(EMPRESAS.map(e => e.name).concat(DOCS.map(d => d.empresa)))).sort((a, b) => a.localeCompare(b));
  const itens = (window.SUBHUE ? SUBHUE.itens : []).map(i => `<option value="${esc(i.s + '-' + i.r)}">${esc(i.s)} req. ${esc(i.r)} — ${esc(String(i.t || '').slice(0, 90))}</option>`).join('');
  $('content').innerHTML = `<section class="view"><h2>Novo atesto</h2>
  ${semSig ? '<div class="alert warn"><b>⚠</b><span>Antes de começar, cadastre a imagem da sua assinatura na aba <b>Assinatura</b>.</span></div>' : ''}
  <form id="nf"><h3>1. Importar o documento (PDF)</h3>
  <label class="fld">Arquivo PDF recebido para atesto<input type="file" id="pdfIn" accept="application/pdf,.pdf"></label>
  <div id="passo2" class="hidden"><h3>2. Marcar onde assina</h3>
  <p class="muted">Clique na página no local da assinatura (a certificação entra logo abaixo, no mesmo bloco). Arraste para ajustar; use × para remover. Pode marcar em várias páginas.</p>
  <label class="fld" style="max-width:320px">Tamanho da assinatura <input type="range" id="sigW" min="15" max="60" value="${Math.round(sigW * 100)}"></label>
  <p id="nMarcas" class="muted"></p><div id="pages"></div></div>
  <h3>3. Dados do serviço</h3><div class="grid">
  <label class="fld">Empresa<input name="empresa" list="dlEmp" required autocomplete="off"><datalist id="dlEmp">${emps.map(e => `<option value="${esc(e)}">`).join('')}</datalist></label>
  <label class="fld">Serviço prestado<input name="servico" required placeholder="Ex.: Manutenção preventiva de ar-condicionado"></label>
  <label class="fld">Data de execução<input type="date" name="dataServico" value="${hoje()}"></label>
  <label class="fld">Competência (mês)<input type="month" name="competencia" value="${hoje().slice(0, 7)}"></label>
  <label class="fld">Nº da NF / documento<input name="nf"></label>
  <label class="fld">Valor (R$, opcional)<input name="valor" inputmode="decimal"></label>
  <label class="fld full">Observações<textarea name="obs"></textarea></label></div>
  <h3>4. Para onde vai</h3>
  <label class="c" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="central" value="1" checked style="width:auto;margin:0"> Lançar comprovante de serviço na Central de Serviços (com o PDF atestado anexado)</label>
  <label class="fld">Anexar como evidência no plano SUBHUE (opcional — Ctrl/⌘ para vários)<select id="subItens" multiple size="5">${itens}</select></label>
  <div class="actions"><button type="submit" id="btnSalvar">Salvar, arquivar e baixar PDF atestado</button></div>
  <p class="muted">A assinatura é uma imagem acompanhada de carimbo com data/hora e código de verificação (SHA-256 do documento original). Não substitui assinatura digital qualificada (ICP-Brasil/gov.br), caso a empresa ou o órgão exija.</p></form></section>`;
  $('nf').onsubmit = salvarAtesto;
  $('pdfIn').onchange = async ev => { const f = ev.target.files[0]; if (!f) return; try { await abrirPdf(f); } catch (er) { notice('Não consegui abrir o PDF: ' + UPA.msg(er), true); } };
  $('sigW').oninput = ev => { sigW = ev.target.value / 100; marks.forEach(m => { m.fx = Math.min(m.fx, 1 - sigW); posMarca(null, m); }); };
}
async function viewArq() {
  const q = (window.__fq || '').toLowerCase(), fe = window.__fe || '', fm = window.__fm || '';
  const emps = Array.from(new Set(DOCS.map(d => d.empresa))).sort();
  const L = DOCS.filter(d => (!fe || d.empresa === fe) && (!fm || d.competencia === fm) && (!q || [d.empresa, d.servico, d.nf, d.codigo, d.obs].join(' ').toLowerCase().includes(q)));
  $('content').innerHTML = `<section class="view"><h2>Arquivo de atestos</h2>
  <div class="stats"><div class="stat">Atestos arquivados<strong>${DOCS.length}</strong></div><div class="stat ok">No mês atual<strong>${DOCS.filter(d => (d.criadoEm || '').slice(0, 7) === hoje().slice(0, 7)).length}</strong></div></div>
  <div class="grid"><label class="fld">Busca<input id="fq" value="${esc(window.__fq || '')}" placeholder="empresa, serviço, NF, código"></label>
  <label class="fld">Empresa<select id="fe"><option value="">Todas</option>${emps.map(e => `<option${e === fe ? ' selected' : ''}>${esc(e)}</option>`).join('')}</select></label>
  <label class="fld">Competência<input type="month" id="fm" value="${esc(fm)}"></label></div>
  ${L.length ? `<div class="table-wrap"><table><thead><tr><th>Atestado em</th><th>Empresa</th><th>Serviço</th><th>Comp.</th><th>NF</th><th>Código</th><th>Destino</th><th></th></tr></thead><tbody>${L.map(d => `<tr><td>${fd(d.criadoEm)}</td><td>${esc(d.empresa)}</td><td>${esc(d.servico)}</td><td>${esc(d.competencia || '')}</td><td>${esc(d.nf || '')}</td><td><code>${esc(d.codigo)}</code></td><td>${d.chamadoId ? '<span class="pill ok">Central</span> ' : ''}${(d.subhue || []).length ? `<span class="pill ok">SUBHUE ${d.subhue.length}</span>` : ''}</td><td><button type="button" class="small" data-a="ass" data-id="${esc(d.id)}">Baixar atestado</button><button type="button" class="small secondary" data-a="ori" data-id="${esc(d.id)}">Original</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nenhum atesto encontrado.</p>'}</section>`;
  $('fq').oninput = ev => { window.__fq = ev.target.value; clearTimeout(window.__t); window.__t = setTimeout(viewArq, 250); };
  $('fe').onchange = ev => { window.__fe = ev.target.value; viewArq(); }; $('fm').onchange = ev => { window.__fm = ev.target.value; viewArq(); };
  document.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
    const d = DOCS.find(x => x.id === b.dataset.id), p = b.dataset.a === 'ass' ? d.pathAss : d.pathOrig;
    try { const u = (await UPA.files.urls([p]))[p]; if (!u) throw new Error('Arquivo não encontrado.'); const bl = await (await fetch(u)).blob(); baixar(bl, b.dataset.a === 'ass' ? (d.nomeAss || 'atestado.pdf') : (d.nomeOriginal || 'original.pdf')); } catch (er) { notice(UPA.msg(er), true); }
  });
}
async function viewAssin() {
  $('content').innerHTML = `<section class="view"><h2>Assinatura e signatário</h2>
  <p class="muted">Cadastre uma vez a imagem da assinatura (foto ou digitalização em fundo claro). O fundo branco é removido automaticamente. A imagem fica guardada em área privada do sistema — não vai para o repositório público.</p>
  <div class="two"><div><h3>Imagem atual</h3>${SIGURL ? `<div class="chk-bg"><img src="${esc(SIGURL)}" alt="Assinatura cadastrada"></div>` : '<p class="muted">Nenhuma imagem cadastrada.</p>'}
  <label class="fld">Enviar nova imagem<input type="file" id="sigIn" accept="image/*"></label><div id="sigPrev"></div></div>
  <div><h3>Dados do carimbo</h3><form id="cf"><label class="fld">Nome do signatário<input name="nome" value="${esc(CFG.nome)}"></label><label class="fld">Cargo<input name="cargo" value="${esc(CFG.cargo)}"></label><label class="fld">Unidade<input name="unidade" value="${esc(CFG.unidade)}"></label><label class="fld">CNES<input name="cnes" value="${esc(CFG.cnes)}"></label><div class="actions"><button type="submit">Salvar dados</button></div></form>
  <div class="alert warn"><b>ℹ</b><span>O sistema usa um único login: quem entra consegue usar a assinatura. Mantenha o acesso restrito a você.</span></div></div></div></section>`;
  let novo = null;
  $('sigIn').onchange = async ev => { const f = ev.target.files[0]; if (!f) return; try { novo = await limparFundo(f); $('sigPrev').innerHTML = `<p>Prévia (fundo removido):</p><div class="chk-bg"><img id="pv" alt="Prévia"></div><div class="actions"><button type="button" id="sigSave">Usar esta assinatura</button></div>`; $('pv').src = URL.createObjectURL(novo);
    $('sigSave').onclick = async () => { try { await UPA.files.upload('atestos/assinatura.png', novo, 'image/png'); CFG.sigPath = 'atestos/assinatura.png'; await UPA.db.put(C_CFG, 'cfg', CFG); await carregar(); await prepararAssinatura(); notice('Assinatura cadastrada.'); viewAssin(); } catch (er) { notice(UPA.msg(er), true); } }; } catch (er) { notice(UPA.msg(er), true); } };
  $('cf').onsubmit = async ev => { ev.preventDefault(); Object.assign(CFG, Object.fromEntries(new FormData(ev.target))); try { await UPA.db.put(C_CFG, 'cfg', CFG); await prepararAssinatura(); notice('Dados salvos.'); } catch (er) { notice(UPA.msg(er), true); } };
}
function viewConf() {
  $('content').innerHTML = `<section class="view"><h2>Conferir documento</h2><p class="muted">Envie um PDF para verificar se ele é idêntico a um atesto arquivado (original ou atestado). A comparação usa o código SHA-256 do arquivo.</p>
  <label class="fld">PDF a conferir<input type="file" id="cfIn" accept="application/pdf,.pdf"></label><div id="cfOut"></div>
  <h3>Ou busque pelo código</h3><label class="fld" style="max-width:340px">Código de verificação<input id="cfCod" placeholder="XXXX-XXXX-XXXX-XXXX"></label><div id="cfOut2"></div></section>`;
  const mostra = (d, tipo) => `<div class="alert ok"><b>✔</b><span>Autêntico${tipo ? ' (' + tipo + ')' : ''}: atesto de <b>${esc(d.empresa)}</b> — ${esc(d.servico)} · atestado em ${fd(d.criadoEm)} por ${esc(d.signatario || '')} · código <code>${esc(d.codigo)}</code>.</span></div>`;
  $('cfIn').onchange = async ev => { const f = ev.target.files[0]; if (!f) return; const h = await sha256(await f.arrayBuffer()); const a = DOCS.find(d => d.hashAss === h), o = DOCS.find(d => d.hashOrig === h);
    $('cfOut').innerHTML = a ? mostra(a, 'PDF atestado') : o ? mostra(o, 'documento original, ainda sem assinatura') : `<div class="alert bad"><b>⛔</b><span>Este arquivo não corresponde a nenhum atesto arquivado (alterado ou de outra origem). SHA-256: <code>${h.slice(0, 16)}…</code></span></div>`; };
  $('cfCod').oninput = ev => { const c = ev.target.value.trim().toUpperCase(); const d = c.length >= 8 ? DOCS.find(x => x.codigo === c || x.codigo.replace(/-/g, '') === c.replace(/-/g, '')) : null; $('cfOut2').innerHTML = c.length >= 8 ? (d ? mostra(d, '') : '<div class="alert bad"><b>⛔</b><span>Código não encontrado no arquivo.</span></div>') : ''; };
}
async function prepararAssinatura() {
  sigImg = null; prevCarimbo = null;
  if (!SIGURL) return;
  try { const r = await fetch(SIGURL); const b = await r.blob(); sigImg = await imgDe(URL.createObjectURL(b)); prevCarimbo = await montarCarimbo('XXXX-XXXX-XXXX-XXXX', dataHora(new Date())); } catch (e) { sigImg = null; }
}
function render() { nav(); if (view === 'novo') viewNovo(); else if (view === 'arq') viewArq(); else if (view === 'assin') viewAssin(); else viewConf(); }
(async function init() {
  try { await UPA.ready(); await carregar(); await prepararAssinatura(); render(); } catch (e) { notice(UPA.msg(e), true); }
})();
