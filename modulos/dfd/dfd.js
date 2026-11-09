'use strict';
/* DFD — Documento de Formalização de Demanda: importa o PDF preenchido, localiza o fim do documento (linha "Matr.") e propõe a assinatura ali,
   permite ajustar/arrastar, gera o PDF assinado (original preservado), arquiva e baixa. Reaproveita a imagem de assinatura cadastrada em Atestos > Assinatura.
   Coleção dfd_docs; arquivos em anexos/dfd/<id>/. Assinatura em imagem (opcionalmente com carimbo de verificação SHA-256); não é assinatura qualificada ICP-Brasil/gov.br. */
const $ = id => document.getElementById(id);
const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hoje = () => new Date().toLocaleDateString('en-CA');
const fd = d => { if (!d) return ''; const p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(d); };
const semAc = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const C_DOCS = 'dfd_docs', C_ATC = 'atestos_cfg';
const CFG0 = { nome: 'Luis Felipe W. Seroa da Motta', cargo: 'Coordenador Administrativo', unidade: 'UPA 24h Rocinha', cnes: '6507409' };
let view = 'novo', CFG = { ...CFG0 }, SIGURL = '', DOCS = [], sigImg = null, prevUrl = '', prevRel = 0.4;
let pdfBytes = null, pdfName = '', pdfDoc = null, hashOrig = '', marks = [], sigW = 0.28, titulo = '', dataDoc = '';

function notice(t, erro) { const m = $('message'); m.textContent = t || ''; m.className = erro ? 'err' : ''; if (t) m.scrollIntoView({ block: 'nearest' }); }
const VIEWS = [['novo', 'Novo DFD'], ['arq', 'Arquivo'], ['conf', 'Conferir documento']];
function nav() { $('nav').innerHTML = VIEWS.map(v => `<button type="button" data-v="${v[0]}" class="${v[0] === view ? 'active' : ''}">${v[1]}</button>`).join(''); document.querySelectorAll('#nav [data-v]').forEach(b => b.onclick = () => { view = b.dataset.v; render(); }); }
async function sha256(buf) { const h = await crypto.subtle.digest('SHA-256', buf); return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join(''); }
const cod = h => h.slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 45) || 'DFD';
const blobDe = u8 => new Blob([u8], { type: 'application/pdf' });
function baixar(blob, nome) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
const dataHora = d => { const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const imgDe = url => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Não foi possível carregar a imagem.')); i.src = url; });

/* ---------- dados ---------- */
async function carregar() {
  const [cfg, docs] = await Promise.all([UPA.db.list(C_ATC), UPA.db.list(C_DOCS)]);
  const c = cfg.find(r => r.id === 'cfg'); CFG = { ...CFG0, ...(c ? c.dados : {}) };
  DOCS = docs.map(r => r.dados).sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
  SIGURL = ''; if (CFG.sigPath) { try { const u = await UPA.files.urls([CFG.sigPath]); SIGURL = u[CFG.sigPath] || ''; } catch (e) { } }
  sigImg = null; if (SIGURL) { try { const b = await (await fetch(SIGURL)).blob(); sigImg = await imgDe(URL.createObjectURL(b)); } catch (e) { sigImg = null; } }
}

/* ---------- carimbo opcional (assinatura + certificação abaixo) ---------- */
async function montarImagem(comCarimbo, codigo, quando) {
  const im = sigImg;
  if (!comCarimbo) { const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; cv.getContext('2d').drawImage(im, 0, 0); return { blob: await new Promise(r => cv.toBlob(r, 'image/png')), w: cv.width, h: cv.height, url: cv.toDataURL('image/png') }; }
  const W = 1000, sw = 560, sh = Math.round(im.height * sw / im.width);
  const lin = [['Assinado eletronicamente por', 'normal', 30], [CFG.nome.toUpperCase(), 'bold', 36], [CFG.cargo + ' · ' + CFG.unidade + ' · CNES ' + CFG.cnes, 'normal', 28], [quando + ' · Cód. de verificação: ' + codigo, 'normal', 28]];
  const H = sh + 34 + lin.reduce((s, l) => s + l[2] + 10, 0) + 14, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d');
  x.drawImage(im, (W - sw) / 2, 0, sw, sh); let y = sh + 12; x.strokeStyle = '#123e70'; x.lineWidth = 3; x.beginPath(); x.moveTo(70, y); x.lineTo(W - 70, y); x.stroke(); y += 22;
  x.fillStyle = '#123e70'; x.textAlign = 'center'; x.textBaseline = 'top';
  lin.forEach(l => { let f = l[2]; do { x.font = `${l[1] === 'bold' ? 'bold ' : ''}${f}px Arial, Helvetica, sans-serif`; f -= 1; } while (x.measureText(l[0]).width > W - 40 && f > 12); x.fillText(l[0], W / 2, y); y += l[2] + 10; });
  return { blob: await new Promise(r => cv.toBlob(r, 'image/png')), w: W, h: H, url: cv.toDataURL('image/png') };
}
const comCarimbo = () => !!($('ckCar') && $('ckCar').checked);
async function atualizarPrev() { if (!sigImg) return; const p = await montarImagem(comCarimbo(), 'XXXX-XXXX-XXXX-XXXX', dataHora(new Date())); prevUrl = p.url; prevRel = p.h / p.w; marks.forEach(m => { m.el.querySelector('img').src = prevUrl; posMarca(m); }); }

/* ---------- pdf.js ---------- */
async function iniciarPdfJs() {
  if (!window.pdfjsLib) throw new Error('Biblioteca de PDF não carregou (verifique a internet).'); if (window.__pdfWorker) return;
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  try { const t = await (await fetch(base)).text(); pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([t], { type: 'text/javascript' })); } catch (e) { pdfjsLib.GlobalWorkerOptions.workerSrc = base; }
  window.__pdfWorker = true;
}
async function abrirPdf(file) {
  notice('Lendo o PDF…'); await iniciarPdfJs();
  pdfBytes = new Uint8Array(await file.arrayBuffer()); pdfName = file.name; marks = [];
  hashOrig = await sha256(pdfBytes.buffer.slice(0));
  pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
  const box = $('pages'); box.innerHTML = ''; let locPos = null;
  try { const md = await pdfDoc.getMetadata(); titulo = String((md.info && md.info.Title) || '').replace(/\.(docx?|pdf)$/i, '').trim(); } catch (e) { titulo = ''; }
  if (!titulo) titulo = file.name.replace(/\.(pdf|docx?)/gi, '').replace(/^[0-9a-f]{8}-/, '').replace(/[_]+/g, ' ').trim();
  dataDoc = '';
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const pg = await pdfDoc.getPage(n), vp = pg.getViewport({ scale: 1.4 });
    const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height; await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    const w = document.createElement('div'); w.className = 'pg'; w.dataset.n = n; w.innerHTML = `<span class="lbl">Página ${n}/${pdfDoc.numPages}</span>`; w.insertBefore(cv, w.firstChild);
    w.addEventListener('pointerdown', ev => { if (ev.target.closest('.sig')) return; colocar(w, ev); }); box.appendChild(w);
    try {
      const tc = await pg.getTextContent(), v1 = pg.getViewport({ scale: 1 });
      if (!dataDoc) { const all = tc.items.map(i => i.str).join(' '), m = all.match(/DATA\s+(\d{2})\/(\d{2})\/(\d{4})/i) || all.match(/Rio de Janeiro,\s*(\d{2})\/(\d{2})\/(\d{4})/i); if (m) dataDoc = m[3] + '-' + m[2] + '-' + m[1]; }
      if (n === pdfDoc.numPages) { const it = tc.items.filter(i => /^\s*Matr/i.test(i.str)).pop(); if (it) { const [vx, vy] = v1.convertToViewportPoint(it.transform[4], it.transform[5] + (it.height || 10)); locPos = { n, cx: (vx + (it.width || 60) / 2) / v1.width, topo: vy / v1.height, achou: true }; } }
    } catch (e) { }
  }
  const ult = pdfDoc.numPages;
  if (!locPos) locPos = { n: ult, cx: 0.5, topo: 0.82, achou: false };
  $('passo2').classList.remove('hidden'); $('fObj').value = titulo; $('fData').value = dataDoc || hoje();
  if (sigImg) { await atualizarPrev(); const w = pdfPages(locPos.n), bw = sigW, bh = bw * prevRel * (w.clientWidth / w.clientHeight); const m = { id: uuid(), n: locPos.n, fx: Math.max(0, Math.min(1 - bw, locPos.cx - bw / 2)), fy: Math.max(0, locPos.topo - bh - 0.008), el: null }; marks.push(m); desenharMarca(w, m); w.scrollIntoView({ block: 'center' }); }
  atualizarMarcas();
  notice(locPos.achou ? 'Assinatura posicionada acima da linha “Matr.” no fim do documento. Ajuste arrastando, se precisar.' : 'Não achei a linha “Matr.”: posicionei no fim da última página. Arraste para o lugar correto.');
}
const pdfPages = n => document.querySelector(`.pg[data-n="${n}"]`);
function colocar(w, ev) {
  if (!sigImg) { notice('Cadastre a imagem da assinatura em Atestos > Assinatura antes.', true); return; }
  const r = w.getBoundingClientRect(), bw = sigW, bh = bw * prevRel * (r.width / r.height);
  const m = { id: uuid(), n: +w.dataset.n, fx: Math.max(0, Math.min(1 - bw, (ev.clientX - r.left) / r.width - bw / 2)), fy: Math.max(0, Math.min(1 - bh, (ev.clientY - r.top) / r.height - bh / 2)), el: null };
  marks.push(m); desenharMarca(w, m); atualizarMarcas();
}
function desenharMarca(w, m) {
  const el = document.createElement('div'); el.className = 'sig'; el.innerHTML = `<img alt="Assinatura" src="${prevUrl}"><button type="button" class="x" title="Remover" aria-label="Remover">×</button>`; m.el = el; w.appendChild(el); posMarca(m);
  el.querySelector('.x').onclick = e => { e.stopPropagation(); el.remove(); marks = marks.filter(k => k !== m); atualizarMarcas(); };
  el.addEventListener('pointerdown', ev => {
    if (ev.target.closest('.x')) return; ev.preventDefault(); el.setPointerCapture(ev.pointerId);
    const r = w.getBoundingClientRect(), sx = ev.clientX, sy = ev.clientY, fx0 = m.fx, fy0 = m.fy;
    const mv = e => { const bh = sigW * prevRel * r.width / r.height; m.fx = Math.max(0, Math.min(1 - sigW, fx0 + (e.clientX - sx) / r.width)); m.fy = Math.max(0, Math.min(1 - bh, fy0 + (e.clientY - sy) / r.height)); posMarca(m); };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); }; el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
}
function posMarca(m) { m.el.style.left = (m.fx * 100) + '%'; m.el.style.top = (m.fy * 100) + '%'; m.el.style.width = (sigW * 100) + '%'; }
function atualizarMarcas() { const e = $('nMarcas'); if (e) e.textContent = marks.length ? `${marks.length} assinatura(s): ${marks.map(m => 'pág. ' + m.n).join(', ')}.` : 'Nenhuma assinatura posicionada. Clique na página.'; }

/* ---------- gerar PDF assinado ---------- */
async function gerarAssinado(img) {
  const { PDFDocument, degrees } = PDFLib, doc = await PDFDocument.load(pdfBytes.slice(), { ignoreEncryption: true }), png = await doc.embedPng(await img.blob.arrayBuffer()), pages = doc.getPages();
  marks.forEach(m => {
    const pg = pages[m.n - 1], { width: W, height: H } = pg.getSize(), ang = ((pg.getRotation().angle % 360) + 360) % 360, Wd = ang % 180 ? H : W, Hd = ang % 180 ? W : H;
    const bw = sigW * Wd, bh = bw * img.h / img.w, bx = m.fx * Wd, by = m.fy * Hd, dy = by + bh; let u, v;
    if (ang === 0) { u = bx; v = dy; } else if (ang === 90) { u = dy; v = H - bx; } else if (ang === 180) { u = W - bx; v = H - dy; } else { u = W - dy; v = bx; }
    const o = { x: u, y: H - v, width: bw, height: bh }; if (ang) o.rotate = degrees(ang); pg.drawImage(png, o);
  });
  doc.setProducer('Gestão Inteligente UPA Rocinha — DFD'); return await doc.save();
}
async function salvar(e) {
  e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
  if (!pdfBytes) { notice('Importe o PDF do DFD primeiro.', true); return; } if (!marks.length) { notice('Posicione a assinatura (clique na página).', true); return; }
  if (!sigImg) { notice('Cadastre a imagem da assinatura em Atestos > Assinatura.', true); return; } if (!f.objeto.trim()) { notice('Informe o objeto do DFD.', true); return; }
  const btn = $('btnSalvar'); btn.disabled = true;
  try {
    notice('Gerando PDF assinado…'); const id = uuid(), agora = new Date(), codigo = cod(hashOrig), car = comCarimbo();
    const img = await montarImagem(car, codigo, dataHora(agora)), out = await gerarAssinado(img), hashAss = await sha256(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
    const base = `DFD_${slug(f.objeto)}_${(f.dataDoc || hoje()).replace(/-/g, '')}`;
    notice('Arquivando…'); const pO = `dfd/${id}/original.pdf`, pA = `dfd/${id}/assinado.pdf`;
    await UPA.files.upload(pO, blobDe(pdfBytes), 'application/pdf'); await UPA.files.upload(pA, blobDe(out), 'application/pdf');
    const doc = { id, criadoEm: agora.toISOString(), objeto: f.objeto.trim(), numero: f.numero.trim(), dataDoc: f.dataDoc, unidade: f.unidade.trim(), obs: f.obs.trim(), nomeOriginal: pdfName, paginas: pdfDoc.numPages, assinaturas: marks.map(m => m.n), carimbo: car, hashOrig, hashAss, codigo, pathOrig: pO, pathAss: pA, nomeAss: base + '_assinado.pdf', signatario: CFG.nome };
    await UPA.db.put(C_DOCS, id, doc); DOCS.unshift(doc); baixar(blobDe(out), doc.nomeAss);
    pdfBytes = null; marks = []; render(); notice('DFD assinado e arquivado. O download do PDF assinado foi iniciado.');
    $('content').insertAdjacentHTML('afterbegin', `<div class="okbox"><b>✔ DFD arquivado.</b> ${esc(doc.objeto)}.<div class="actions"><button type="button" id="okB">Baixar novamente</button><button type="button" class="secondary" id="okA">Ver no arquivo</button></div></div>`);
    $('okB').onclick = () => baixar(blobDe(out), doc.nomeAss); $('okA').onclick = () => { view = 'arq'; render(); };
  } catch (er) { console.error(er); notice('Erro ao salvar: ' + UPA.msg(er), true); } finally { const b = $('btnSalvar'); if (b) b.disabled = false; }
}

/* ---------- views ---------- */
function viewNovo() {
  $('content').innerHTML = `<section class="view"><h2>Novo DFD</h2>
  ${!sigImg ? '<div class="alert warn"><b>⚠</b><span>Cadastre antes a imagem da sua assinatura em <b>Atestos &gt; Assinatura</b> (a mesma é usada aqui).</span></div>' : ''}
  <form id="nf"><h3>1. Importar o DFD preenchido (PDF)</h3><label class="fld">Arquivo PDF<input type="file" id="pdfIn" accept="application/pdf,.pdf"></label>
  <div id="passo2" class="hidden"><h3>2. Conferir a assinatura</h3><p class="muted">A assinatura é posicionada sozinha acima da linha “Matr.” no fim do documento. Arraste para ajustar, ou clique em outro ponto para incluir mais uma.</p>
  <div class="grid"><label class="fld">Tamanho da assinatura<input type="range" id="sigW" min="12" max="55" value="${Math.round(sigW * 100)}"></label>
  <label class="fld" style="justify-content:end"><span><input type="checkbox" id="ckCar" style="width:auto"> Incluir carimbo de verificação (nome, data/hora e código) abaixo da assinatura</span></label></div>
  <p id="nMarcas" class="muted"></p><div id="pages"></div>
  <h3>3. Dados para o arquivo</h3><div class="grid">
  <label class="fld full">Objeto / especificação da demanda<input name="objeto" id="fObj" required></label>
  <label class="fld">Nº do DFD / processo (opcional)<input name="numero"></label>
  <label class="fld">Data do documento<input type="date" name="dataDoc" id="fData"></label>
  <label class="fld">Unidade requisitante<input name="unidade" value="UPA 24H ROCINHA"></label>
  <label class="fld full">Observações<textarea name="obs"></textarea></label></div>
  <div class="actions"><button type="submit" id="btnSalvar">Assinar, arquivar e baixar PDF</button></div>
  <p class="muted">Assinatura em imagem. Não substitui assinatura digital qualificada (ICP-Brasil/gov.br) caso o processo exija.</p></div></form></section>`;
  $('nf').onsubmit = salvar;
  $('pdfIn').onchange = async ev => { const fl = ev.target.files[0]; if (!fl) return; try { await abrirPdf(fl); } catch (er) { console.error(er); notice('Não consegui abrir o PDF: ' + UPA.msg(er), true); } };
  $('sigW').oninput = ev => { sigW = ev.target.value / 100; marks.forEach(m => { m.fx = Math.min(m.fx, 1 - sigW); posMarca(m); }); };
  $('ckCar').onchange = atualizarPrev;
}
function viewArq() {
  const q = semAc(window.__fq || ''), L = DOCS.filter(d => !q || semAc([d.objeto, d.numero, d.codigo, d.unidade].join(' ')).includes(q));
  $('content').innerHTML = `<section class="view"><h2>Arquivo de DFD</h2><div class="stats"><div class="stat">DFD arquivados<strong>${DOCS.length}</strong></div></div>
  <label class="fld">Busca<input id="fq" value="${esc(window.__fq || '')}" placeholder="objeto, nº, código"></label>
  ${L.length ? `<div class="table-wrap"><table><thead><tr><th>Assinado em</th><th>Objeto</th><th>Nº</th><th>Data do DFD</th><th>Código</th><th></th></tr></thead><tbody>${L.map(d => `<tr><td>${fd(d.criadoEm)}</td><td>${esc(d.objeto)}</td><td>${esc(d.numero || '')}</td><td>${fd(d.dataDoc)}</td><td><code>${esc(d.codigo)}</code></td><td><button type="button" class="small" data-a="ass" data-id="${esc(d.id)}">Baixar assinado</button><button type="button" class="small secondary" data-a="ori" data-id="${esc(d.id)}">Original</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nenhum DFD arquivado.</p>'}</section>`;
  $('fq').oninput = ev => { window.__fq = ev.target.value; clearTimeout(window.__t); window.__t = setTimeout(viewArq, 250); };
  document.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => { const d = DOCS.find(x => x.id === b.dataset.id), p = b.dataset.a === 'ass' ? d.pathAss : d.pathOrig; try { const u = (await UPA.files.urls([p]))[p]; if (!u) throw new Error('Arquivo não encontrado.'); baixar(await (await fetch(u)).blob(), b.dataset.a === 'ass' ? d.nomeAss : (d.nomeOriginal || 'original.pdf')); } catch (er) { notice(UPA.msg(er), true); } });
}
function viewConf() {
  $('content').innerHTML = `<section class="view"><h2>Conferir documento</h2><p class="muted">Envie um PDF para verificar se é idêntico a um DFD arquivado (original ou assinado), pelo código SHA-256 do arquivo.</p><label class="fld">PDF a conferir<input type="file" id="cfIn" accept="application/pdf,.pdf"></label><div id="cfOut"></div></section>`;
  $('cfIn').onchange = async ev => { const f = ev.target.files[0]; if (!f) return; const h = await sha256(await f.arrayBuffer()), a = DOCS.find(d => d.hashAss === h), o = DOCS.find(d => d.hashOrig === h), d = a || o;
    $('cfOut').innerHTML = d ? `<div class="alert ok"><b>✔</b><span>Idêntico ao ${a ? 'PDF assinado' : 'documento original'} arquivado: <b>${esc(d.objeto)}</b> · assinado em ${fd(d.criadoEm)} · código <code>${esc(d.codigo)}</code>.</span></div>` : `<div class="alert bad"><b>⛔</b><span>Este arquivo não corresponde a nenhum DFD arquivado (alterado ou de outra origem).</span></div>`; };
}
function render() { nav(); if (view === 'novo') viewNovo(); else if (view === 'arq') viewArq(); else viewConf(); }
(async function init() { try { await UPA.ready(); await carregar(); render(); } catch (e) { notice(UPA.msg(e), true); } })();
