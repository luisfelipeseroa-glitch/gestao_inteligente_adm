'use strict';
/* Treinamentos e capacitações locais: cadastro do curso, escolha dos participantes (colaboradores já cadastrados no EPI/funcionarios)
   e presença assinada por QR do crachá (EPIUPA:<token>) ou reconhecimento facial (face-api, mesmos descritores do EPI).
   Coleções: treinamentos (curso + lista de participantes), treinamentos_pres (1 registro por participante: id tp-<curso>-<func>,
   evita conflito quando vários aparelhos assinam ao mesmo tempo). */
const $ = id => document.getElementById(id);
const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hoje = () => new Date().toLocaleDateString('en-CA');
const fd = d => { if (!d) return ''; const p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(d); };
const hm = ts => new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const semAc = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const C_T = 'treinamentos', C_P = 'treinamentos_pres', QR_PREFIXO = 'EPIUPA:';
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/', LIMIAR = 0.5, MARGEM = 0.04;
const TIPOS = ['Treinamento', 'Capacitação', 'Reunião educativa', 'Orientação / DDS', 'Simulado / exercício prático'];
const durTxt = m => { m = +m || 0; const h = Math.floor(m / 60), r = m % 60; return (h ? h + 'h' : '') + (r ? (h ? String(r).padStart(2, '0') : r + 'min') : (h ? '' : '0min')); };
const fimTxt = t => { if (!t.hora) return ''; const [h, m] = t.hora.split(':').map(Number), tot = h * 60 + m + (+t.duracao || 0); return String(Math.floor(tot / 60) % 24).padStart(2, '0') + ':' + String(tot % 60).padStart(2, '0'); };

let view = 'lista', FUNCS = [], TREIN = [], PRES = {}, atual = null, filtro = { q: '', st: '' }, modelosOk = false, stream = null, facing = 'user', qrTimer = null, pendente = null, rapido = false;

function notice(t, erro) { const m = $('message'); m.textContent = t || ''; m.className = erro ? 'err' : ''; if (t) m.scrollIntoView({ block: 'nearest' }); }
const VIEWS = [['lista', 'Treinamentos'], ['novo', 'Novo treinamento'], ['rel', 'Frequência por colaborador']];
function nav() { $('nav').innerHTML = VIEWS.map(v => `<button type="button" data-v="${v[0]}" class="${v[0] === view || (view === 'det' && v[0] === 'lista') ? 'active' : ''}">${v[1]}</button>`).join(''); document.querySelectorAll('#nav [data-v]').forEach(b => b.onclick = () => { pararCam(); if (b.dataset.v === 'novo') atual = null; view = b.dataset.v; render(); }); }

/* ---------- dados ---------- */
async function carregar() {
  const cl = UPA.client();
  const [f, t, p] = await Promise.all([
    cl.from('funcionarios').select('id,nome,matricula,funcao,setor,ativo,descritores,foto,qr_token').order('nome'),
    UPA.db.list(C_T), UPA.db.list(C_P)]);
  if (f.error) throw f.error;
  FUNCS = f.data || [];
  TREIN = t.map(r => r.dados).sort((a, b) => (b.data + (b.hora || '')).localeCompare(a.data + (a.hora || '')));
  PRES = {}; p.forEach(r => { const d = r.dados; (PRES[d.tid] = PRES[d.tid] || []).push(d); });
}
const ativos = () => FUNCS.filter(f => f.ativo);
const presDe = t => PRES[t.id] || [];
const assinou = (t, fid) => presDe(t).find(p => p.fid === fid);
const salvarT = async t => { t.atualizadoEm = new Date().toISOString(); await UPA.db.put(C_T, t.id, t); const i = TREIN.findIndex(x => x.id === t.id); if (i >= 0) TREIN[i] = t; else TREIN.unshift(t); };
function statusT(t) { if (t.status === 'Cancelado') return 'Cancelado'; if (t.status === 'Concluído') return 'Concluído'; return t.data < hoje() ? 'Realizado (pendente de conclusão)' : 'Programado'; }
const badgeT = t => { const s = statusT(t); return `<span class="badge ${s === 'Concluído' ? 'ok' : s === 'Cancelado' ? 'bad' : 'warn'}">${esc(s)}</span>`; };

/* ---------- lista ---------- */
function viewLista() {
  const q = semAc(filtro.q);
  const L = TREIN.filter(t => (!filtro.st || statusT(t).startsWith(filtro.st)) && (!q || semAc([t.tema, t.instrutor, t.local, t.tipo].join(' ')).includes(q)));
  const mes = hoje().slice(0, 7), doMes = TREIN.filter(t => t.data.slice(0, 7) === mes && t.status !== 'Cancelado');
  const horas = TREIN.filter(t => t.data.slice(0, 4) === hoje().slice(0, 4) && t.status !== 'Cancelado').reduce((s, t) => s + (+t.duracao || 0) * presDe(t).length, 0);
  $('content').innerHTML = `<section class="view"><h2>Treinamentos e capacitações</h2>
  <div class="stats"><div class="stat">Cadastrados<strong>${TREIN.length}</strong></div><div class="stat ok">No mês<strong>${doMes.length}</strong></div><div class="stat">Horas-participante no ano<strong>${Math.round(horas / 60)}h</strong></div></div>
  <div class="actions"><button type="button" id="bNovo">+ Novo treinamento</button></div>
  <div class="grid"><label class="fld">Busca<input id="fq" value="${esc(filtro.q)}" placeholder="tema, instrutor, local"></label>
  <label class="fld">Situação<select id="fst"><option value="">Todas</option>${['Programado', 'Realizado', 'Concluído', 'Cancelado'].map(s => `<option${filtro.st === s ? ' selected' : ''}>${s}</option>`).join('')}</select></label></div>
  ${L.length ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Tema</th><th>Instrutor</th><th>Duração</th><th>Presença</th><th>Situação</th><th></th></tr></thead><tbody>${L.map(t => `<tr><td>${fd(t.data)}<br><small>${esc(t.hora || '')}</small></td><td><b>${esc(t.tema)}</b><br><small>${esc(t.tipo || '')}${t.local ? ' · ' + esc(t.local) : ''}</small></td><td>${esc(t.instrutor)}</td><td>${durTxt(t.duracao)}</td><td>${presDe(t).length}/${(t.participantes || []).length}</td><td>${badgeT(t)}</td><td><button type="button" class="small" data-abrir="${esc(t.id)}">Abrir</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nenhum treinamento cadastrado ainda.</p>'}</section>`;
  $('bNovo').onclick = () => { atual = null; view = 'novo'; render(); };
  $('fq').oninput = e => { filtro.q = e.target.value; clearTimeout(window.__t); window.__t = setTimeout(viewLista, 250); };
  $('fst').onchange = e => { filtro.st = e.target.value; viewLista(); };
  document.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () => { atual = TREIN.find(t => t.id === b.dataset.abrir); view = 'det'; render(); });
}

/* ---------- cadastro ---------- */
function viewNovo() {
  const t = atual || { id: '', tipo: TIPOS[0], tema: '', instrutor: '', cargoInstrutor: '', data: hoje(), hora: '08:00', duracao: 60, local: 'UPA Rocinha', conteudo: '', objetivo: '', participantes: [], status: 'Programado' };
  const sel = new Set((t.participantes || []).map(p => p.id));
  const setores = Array.from(new Set(ativos().map(f => f.setor).filter(Boolean))).sort();
  $('content').innerHTML = `<section class="view"><h2>${atual ? 'Editar treinamento' : 'Novo treinamento'}</h2>
  <form id="tf"><div class="grid">
  <label class="fld">Tipo<select name="tipo">${TIPOS.map(x => `<option${x === t.tipo ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
  <label class="fld full">Tema / nome do curso<input name="tema" required value="${esc(t.tema)}"></label>
  <label class="fld">Responsável por ministrar<input name="instrutor" list="dlInst" required value="${esc(t.instrutor)}" autocomplete="off"><datalist id="dlInst">${ativos().map(f => `<option value="${esc(f.nome)}">`).join('')}</datalist></label>
  <label class="fld">Cargo / formação do instrutor<input name="cargoInstrutor" value="${esc(t.cargoInstrutor || '')}"></label>
  <label class="fld">Data<input type="date" name="data" required value="${esc(t.data)}"></label>
  <label class="fld">Hora de início<input type="time" name="hora" required value="${esc(t.hora)}"></label>
  <label class="fld">Duração — horas<input type="number" name="h" min="0" max="24" value="${Math.floor((+t.duracao || 0) / 60)}"></label>
  <label class="fld">Duração — minutos<input type="number" name="m" min="0" max="59" step="5" value="${(+t.duracao || 0) % 60}"></label>
  <label class="fld">Local<input name="local" value="${esc(t.local || '')}"></label>
  <label class="fld full">Conteúdo programático<textarea name="conteudo">${esc(t.conteudo || '')}</textarea></label>
  <label class="fld full">Objetivo / observações<textarea name="objetivo">${esc(t.objetivo || '')}</textarea></label></div>
  <h3>Participantes <span id="nSel" class="pill"></span></h3>
  <div class="grid"><label class="fld">Buscar colaborador<input id="pq" placeholder="nome, matrícula, função"></label><label class="fld">Setor<select id="ps"><option value="">Todos</option>${setores.map(s => `<option>${esc(s)}</option>`).join('')}</select></label></div>
  <div class="actions"><button type="button" class="secondary small" id="pTodos">Marcar todos os visíveis</button><button type="button" class="secondary small" id="pNenhum">Limpar marcados</button></div>
  <div class="chips" id="chips"></div>
  <div class="actions"><button type="submit">Salvar treinamento</button><button type="button" class="secondary" id="tCanc">Cancelar</button></div></form></section>`;
  const desenhar = () => {
    const q = semAc($('pq').value), s = $('ps').value;
    const L = ativos().filter(f => (!s || f.setor === s) && (!q || semAc([f.nome, f.matricula, f.funcao, f.setor].join(' ')).includes(q)));
    $('chips').innerHTML = L.map(f => `<label class="chip${sel.has(f.id) ? ' on' : ''}"><input type="checkbox" data-id="${esc(f.id)}"${sel.has(f.id) ? ' checked' : ''}><span>${esc(f.nome)}<small>${esc(f.matricula || '')} · ${esc(f.funcao || '')}${f.setor ? ' · ' + esc(f.setor) : ''}</small></span></label>`).join('') || '<span class="muted">Nenhum colaborador encontrado.</span>';
    $('chips').querySelectorAll('input').forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.id) : sel.delete(c.dataset.id); c.closest('.chip').classList.toggle('on', c.checked); cont(); });
    cont(); desenhar.vis = L;
  };
  const cont = () => { $('nSel').textContent = sel.size + ' selecionado(s)'; };
  $('pq').oninput = desenhar; $('ps').onchange = desenhar;
  $('pTodos').onclick = () => { (desenhar.vis || []).forEach(f => sel.add(f.id)); desenhar(); };
  $('pNenhum').onclick = () => { sel.clear(); desenhar(); };
  $('tCanc').onclick = () => { view = atual ? 'det' : 'lista'; render(); };
  desenhar();
  $('tf').onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    const dur = (+f.h || 0) * 60 + (+f.m || 0);
    if (dur <= 0) { notice('Informe a duração do treinamento.', true); return; }
    if (!sel.size) { notice('Marque ao menos um participante.', true); return; }
    const novo = { ...t, id: t.id || uuid(), tipo: f.tipo, tema: f.tema.trim(), instrutor: f.instrutor.trim(), cargoInstrutor: f.cargoInstrutor.trim(), data: f.data, hora: f.hora, duracao: dur, local: f.local.trim(), conteudo: f.conteudo.trim(), objetivo: f.objetivo.trim(), criadoEm: t.criadoEm || new Date().toISOString() };
    // mantém quem já assinou mesmo que desmarcado
    const jaAss = new Set(presDe(t).map(p => p.fid)); jaAss.forEach(id => sel.add(id));
    novo.participantes = FUNCS.filter(x => sel.has(x.id)).map(x => ({ id: x.id, nome: x.nome, matricula: x.matricula || '', funcao: x.funcao || '', setor: x.setor || '' }));
    try { await salvarT(novo); atual = novo; view = 'det'; notice('Treinamento salvo.'); render(); } catch (er) { notice(UPA.msg(er), true); }
  };
}

/* ---------- câmera, QR e facial ---------- */
function pararCam() { if (qrTimer) { clearInterval(qrTimer); qrTimer = null; } if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } pendente = null; }
async function ligarCam() {
  pararCam(); const v = $('vid');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { notice('Este navegador não permite usar a câmera (é preciso HTTPS).', true); return false; }
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false }); v.srcObject = stream; await v.play(); v.style.transform = facing === 'user' ? 'scaleX(-1)' : 'none'; $('camBox').classList.remove('hidden'); return true; }
  catch (e) { notice('Não consegui acessar a câmera: ' + e.message, true); return false; }
}
function foto(v) { const w = 240, h = Math.round(v.videoHeight * w / v.videoWidth) || 180, c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); if (facing === 'user') { x.translate(w, 0); x.scale(-1, 1); } x.drawImage(v, 0, 0, w, h); return c.toDataURL('image/jpeg', 0.6); }
async function modelos() {
  if (modelosOk) return true;
  if (typeof faceapi === 'undefined') { notice('Biblioteca facial não carregou (verifique a internet).', true); return false; }
  try { notice('Carregando reconhecimento facial…'); await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL), faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL), faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)]); modelosOk = true; notice(''); return true; }
  catch (e) { notice('Erro ao carregar modelos faciais (verifique a internet).', true); return false; }
}
function identificar(desc, cand) {
  const por = [];
  cand.forEach(f => { if (!Array.isArray(f.descritores)) return; let m = 9; f.descritores.forEach(s => { const d = faceapi.euclideanDistance(desc, new Float32Array(s)); if (d < m) m = d; }); por.push({ f, d: m }); });
  return por.sort((a, b) => a.d - b.d);
}
const msgRes = (h, no) => { $('res').innerHTML = `<div class="res${no ? ' no' : ''}">${h}</div>`; };
function mostrarConf(f, metodo, dist, foto0, sub) {
  const t = atual;
  if (assinou(t, f.id)) { msgRes(`<b>${esc(f.nome)}</b> já registrou presença neste treinamento.`, true); return; }
  const naLista = (t.participantes || []).some(p => p.id === f.id);
  pendente = { f, metodo, dist, foto: foto0 };
  if (rapido && naLista) { confirmar(); return; }
  msgRes(`<img src="${esc(f.foto || foto0 || '')}" alt=""><div style="flex:1"><b>${esc(f.nome)}</b><br><span class="muted">${esc(f.matricula || '')} · ${esc(f.funcao || '')} · ${esc(sub)}</span>${naLista ? '' : '<br><b style="color:#845200">⚠ Não estava na lista de participantes — será incluído.</b>'}</div><button type="button" id="bConf">Confirmar presença</button><button type="button" class="secondary" id="bNeg">Não é a pessoa</button>`);
  $('bConf').onclick = confirmar; $('bNeg').onclick = () => { pendente = null; $('res').innerHTML = ''; };
}
async function confirmar() {
  const p = pendente; if (!p) return; pendente = null;
  const t = atual, f = p.f;
  try {
    const reg = { tid: t.id, fid: f.id, nome: f.nome, matricula: f.matricula || '', funcao: f.funcao || '', ts: new Date().toISOString(), metodo: p.metodo, dist: p.dist == null ? null : Math.round(p.dist * 1000) / 1000, foto: p.foto || '' };
    await UPA.db.put(C_P, `tp-${t.id}-${f.id}`, reg); (PRES[t.id] = PRES[t.id] || []).push(reg);
    if (!(t.participantes || []).some(x => x.id === f.id)) { t.participantes = (t.participantes || []).concat([{ id: f.id, nome: f.nome, matricula: f.matricula || '', funcao: f.funcao || '', setor: f.setor || '' }]); await salvarT(t); }
    msgRes(`✔ Presença de <b>${esc(f.nome)}</b> registrada (${p.metodo === 'qr' ? 'QR do crachá' : 'reconhecimento facial'}).`); desenharPres(); setTimeout(() => { if ($('res') && !pendente) $('res').innerHTML = ''; }, 2500);
  } catch (e) { notice(UPA.msg(e), true); }
}
async function modoQR() {
  if (typeof jsQR === 'undefined') { notice('Leitor de QR não carregou (verifique a internet).', true); return; }
  if (!(await ligarCam())) return;
  const v = $('vid'), cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true }); let ocupado = false, pausa = 0;
  msgRes('Aponte a câmera para o QR do crachá…'); $('res').firstChild.className = 'res';
  qrTimer = setInterval(() => {
    if (ocupado || !v.videoWidth || pendente || Date.now() < pausa) return; ocupado = true;
    try {
      const w = Math.min(1280, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth); cv.width = w; cv.height = h; cx.drawImage(v, 0, 0, w, h);
      const r = jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      if (r && r.data) {
        pausa = Date.now() + 2500; const tx = String(r.data).trim();
        if (tx.indexOf(QR_PREFIXO) !== 0) msgRes('Este QR não é de um crachá do app.', true);
        else { const tk = tx.slice(QR_PREFIXO.length).toLowerCase(), f = ativos().find(x => x.qr_token && x.qr_token === tk); if (!f) msgRes('Crachá não reconhecido ou colaborador inativo.', true); else mostrarConf(f, 'qr', null, foto(v), 'crachá lido — confira o rosto com a foto'); }
      }
    } catch (e) { }
    ocupado = false;
  }, 250);
}
async function modoFacial() {
  if (!(await modelos())) return; if (!(await ligarCam())) return;
  msgRes('Posicione o rosto e clique em “Reconhecer rosto”.'); $('res').firstChild.className = 'res'; $('bRec').classList.remove('hidden');
}
async function reconhecer() {
  const v = $('vid'); if (!stream) return; $('bRec').disabled = true; msgRes('Analisando…'); $('res').firstChild.className = 'res';
  try {
    const det = await faceapi.detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })).withFaceLandmarks().withFaceDescriptor();
    if (!det) { msgRes('Nenhum rosto encontrado. Aproxime-se e olhe para a câmera.', true); return; }
    const f0 = foto(v), por = identificar(det.descriptor, ativos()), b = por[0], s = por[1];
    if (!b || b.d > LIMIAR) { msgRes('Rosto não reconhecido. Tente de novo com boa iluminação ou use o QR do crachá.', true); return; }
    if (s && s.d < LIMIAR && (s.d - b.d) < MARGEM) { msgRes('Resultado incerto (rosto parecido com mais de um cadastro). Tente de novo ou use o QR.', true); return; }
    mostrarConf(b.f, 'facial', b.d, f0, 'semelhança ' + Math.max(0, Math.round((1 - b.d) * 100)) + '%');
  } catch (e) { msgRes('Erro: ' + esc(e.message || e), true); } finally { const b = $('bRec'); if (b) b.disabled = false; }
}

/* ---------- detalhe ---------- */
function desenharPres() {
  const t = atual, box = $('presBox'); if (!box) return;
  const part = t.participantes || [], n = part.filter(p => assinou(t, p.id)).length;
  $('presCont').textContent = `${n}/${part.length} presentes`;
  box.innerHTML = part.map(p => { const a = assinou(t, p.id); return `<div class="p${a ? ' ok' : ''}">${a && a.foto ? `<img src="${esc(a.foto)}" alt="">` : '<span style="width:38px;text-align:center">' + (a ? '✔' : '○') + '</span>'}<div><b>${esc(p.nome)}</b><br><small>${esc(p.matricula)} · ${esc(p.funcao)}${a ? '<br>' + hm(a.ts) + ' · ' + (a.metodo === 'qr' ? 'QR' : 'facial') : '<br>aguardando'}</small></div></div>`; }).join('');
}
function viewDet() {
  const t = atual; if (!t) { view = 'lista'; return render(); }
  const cancel = t.status === 'Cancelado';
  $('content').innerHTML = `<section class="view"><h2>${esc(t.tema)} ${badgeT(t)}</h2>
  <table class="hdrbox"><tr><td><b>Tipo</b> ${esc(t.tipo)}</td><td><b>Data</b> ${fd(t.data)} · ${esc(t.hora)} às ${fimTxt(t)} (${durTxt(t.duracao)})</td></tr><tr><td><b>Instrutor</b> ${esc(t.instrutor)}${t.cargoInstrutor ? ' — ' + esc(t.cargoInstrutor) : ''}</td><td><b>Local</b> ${esc(t.local || '—')}</td></tr>${t.conteudo ? `<tr><td colspan="2"><b>Conteúdo</b> ${esc(t.conteudo)}</td></tr>` : ''}</table>
  <div class="actions"><button type="button" class="secondary" id="bEd">Editar / participantes</button><button type="button" id="bPrint">Imprimir lista de presença</button><button type="button" class="secondary" id="bXls">Excel</button>${cancel ? '' : `<button type="button" class="secondary" id="bConc">${t.status === 'Concluído' ? 'Reabrir' : 'Marcar como concluído'}</button><button type="button" class="danger" id="bCanc">Cancelar treinamento</button>`}<button type="button" class="secondary" id="bVolta">← Lista</button></div>
  ${cancel ? '<div class="alert bad"><b>⛔</b><span>Treinamento cancelado. Presenças não são registradas.</span></div>' : `
  <h3>Assinar presença</h3><p class="muted">O colaborador assina lendo o QR do crachá ou pelo rosto. A câmera fica ligada para o próximo.</p>
  <div class="actions"><button type="button" id="bQR">📷 Ler QR do crachá</button><button type="button" id="bFac">🙂 Reconhecimento facial</button><button type="button" class="secondary hidden" id="bRec">Reconhecer rosto</button><button type="button" class="secondary" id="bTroca">Trocar câmera</button><button type="button" class="secondary" id="bParar">Parar câmera</button></div>
  <label class="chk" style="display:flex;gap:8px;align-items:center;font-size:.88rem"><input type="checkbox" id="ckRap" style="width:auto;margin:0"${rapido ? ' checked' : ''}> Modo rápido: registrar direto ao ler (sem confirmar cada pessoa)</label>
  <div class="cam hidden" id="camBox"><video id="vid" playsinline muted></video></div><div id="res"></div>`}
  <h3>Participantes <span class="pill" id="presCont"></span></h3><div class="pres" id="presBox"></div></section>`;
  desenharPres();
  $('bVolta').onclick = () => { pararCam(); view = 'lista'; render(); };
  $('bEd').onclick = () => { pararCam(); view = 'novo'; render(); };
  $('bPrint').onclick = () => imprimir(t); $('bXls').onclick = () => excel(t);
  if (!cancel) {
    $('bQR').onclick = () => { $('bRec').classList.add('hidden'); modoQR(); }; $('bFac').onclick = modoFacial; $('bRec').onclick = reconhecer; $('bParar').onclick = () => { pararCam(); $('camBox').classList.add('hidden'); $('res').innerHTML = ''; $('bRec').classList.add('hidden'); };
    $('bTroca').onclick = async () => { facing = facing === 'user' ? 'environment' : 'user'; if (stream) await ligarCam(); };
    $('ckRap').onchange = e => { rapido = e.target.checked; };
    $('bConc').onclick = async () => { t.status = t.status === 'Concluído' ? 'Programado' : 'Concluído'; try { await salvarT(t); render(); } catch (e) { notice(UPA.msg(e), true); } };
    $('bCanc').onclick = async () => { if (!confirm('Cancelar este treinamento? As presenças já registradas continuam guardadas.')) return; pararCam(); t.status = 'Cancelado'; try { await salvarT(t); render(); } catch (e) { notice(UPA.msg(e), true); } };
  }
}

/* ---------- impressão e Excel ---------- */
const logoSus = () => `<img src="../../assets/logo-sus.png" alt="SUS" style="height:56px" onerror="this.outerHTML='<span style=&quot;font:800 22pt Arial,sans-serif;color:#0b5ea8;letter-spacing:2px&quot;>SUS</span>'">`;
const aguardarImgs = root => Promise.all(Array.from(root.querySelectorAll('img')).map(im => im.complete && im.naturalWidth ? 0 : new Promise(r => { im.onload = im.onerror = () => r(); setTimeout(r, 4000); })));
async function imprimir(t) {
  const part = t.participantes || [];
  const html = `<div class="logos"><img src="../../assets/logo-gnosis.jpg" alt="Instituto Gnosis" style="height:60px">${logoSus()}</div>
  <h2 style="text-align:center;margin:6px 0 10px">LISTA DE PRESENÇA — ${esc(t.tipo.toUpperCase())}</h2>
  <table class="hdrbox"><tr><td colspan="2"><b>Unidade:</b> UPA 24h Rocinha · CNES 6507409</td></tr><tr><td colspan="2"><b>Tema:</b> ${esc(t.tema)}</td></tr>
  <tr><td><b>Data:</b> ${fd(t.data)}</td><td><b>Horário:</b> ${esc(t.hora)} às ${fimTxt(t)} · <b>Carga horária:</b> ${durTxt(t.duracao)}</td></tr>
  <tr><td><b>Instrutor:</b> ${esc(t.instrutor)}</td><td><b>Local:</b> ${esc(t.local || '')}</td></tr>${t.conteudo ? `<tr><td colspan="2"><b>Conteúdo programático:</b> ${esc(t.conteudo)}</td></tr>` : ''}</table>
  <table class="pl"><thead><tr><th style="width:6%">Nº</th><th>Nome</th><th style="width:13%">Matrícula</th><th style="width:20%">Função</th><th style="width:30%">Assinatura / registro de presença</th></tr></thead><tbody>
  ${part.map((p, i) => { const a = assinou(t, p.id); return `<tr style="height:11mm"><td>${i + 1}</td><td>${esc(p.nome)}</td><td>${esc(p.matricula)}</td><td>${esc(p.funcao)}</td><td>${a ? `${a.foto ? `<img src="${esc(a.foto)}" alt="" style="float:left;margin-right:5px">` : ''}<small>Presença registrada por ${a.metodo === 'qr' ? 'QR do crachá' : 'reconhecimento facial'} em ${new Date(a.ts).toLocaleString('pt-BR')}</small>` : ''}</td></tr>`; }).join('')}</tbody></table>
  <p class="nota">Presença registrada eletronicamente no sistema Gestão Inteligente UPA Rocinha, por leitura do QR do crachá individual ou reconhecimento facial, com data e hora. Linhas em branco: assinatura manual.</p>
  <div class="assin"><div>${esc(t.instrutor)}<br>Instrutor${t.cargoInstrutor ? ' — ' + esc(t.cargoInstrutor) : ''}</div><div>Luis Felipe W. Seroa da Motta<br>Coordenador Administrativo · CNES 6507409</div></div>`;
  const root = $('printRoot'); root.innerHTML = `<div class="doc">${html}</div>`; root.classList.remove('hidden');
  await aguardarImgs(root); setTimeout(() => { window.print(); root.classList.add('hidden'); }, 100);
}
function baixarXlsx(linhas, nome, aba) { if (typeof XLSX === 'undefined') { notice('Biblioteca de Excel não carregou.', true); return; } const ws = XLSX.utils.aoa_to_sheet(linhas); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, aba); XLSX.writeFile(wb, nome); }
function excel(t) {
  const L = [['Tema', t.tema], ['Data', fd(t.data)], ['Hora', t.hora], ['Duração', durTxt(t.duracao)], ['Instrutor', t.instrutor], ['Local', t.local || ''], [], ['Nº', 'Nome', 'Matrícula', 'Função', 'Presença', 'Método', 'Data/hora']];
  (t.participantes || []).forEach((p, i) => { const a = assinou(t, p.id); L.push([i + 1, p.nome, p.matricula, p.funcao, a ? 'Presente' : 'Ausente', a ? (a.metodo === 'qr' ? 'QR' : 'Facial') : '', a ? new Date(a.ts).toLocaleString('pt-BR') : '']); });
  baixarXlsx(L, 'Presenca_' + semAc(t.tema).replace(/[^a-z0-9]+/g, '_').slice(0, 30) + '.xlsx', 'Presença');
}

/* ---------- frequência por colaborador ---------- */
function viewRel() {
  const ano = window.__ano || hoje().slice(0, 4), T = TREIN.filter(t => t.data.slice(0, 4) === ano && t.status !== 'Cancelado');
  const linhas = ativos().map(f => { const conv = T.filter(t => (t.participantes || []).some(p => p.id === f.id)), pres = conv.filter(t => assinou(t, f.id)); return { f, conv: conv.length, pres: pres.length, min: pres.reduce((s, t) => s + (+t.duracao || 0), 0), falt: conv.filter(t => !assinou(t, f.id) && t.data < hoje()).map(t => t.tema) }; });
  linhas.sort((a, b) => b.min - a.min || a.f.nome.localeCompare(b.f.nome));
  const sem = linhas.filter(l => !l.pres).length;
  $('content').innerHTML = `<section class="view"><h2>Frequência por colaborador</h2><div class="grid"><label class="fld">Ano<input type="number" id="ano" value="${esc(ano)}" min="2020" max="2100"></label></div>
  <div class="stats"><div class="stat">Treinamentos no ano<strong>${T.length}</strong></div><div class="stat warn">Colaboradores sem nenhum treinamento<strong>${sem}</strong></div></div>
  <div class="actions"><button type="button" class="secondary" id="bX">Excel</button></div>
  <div class="table-wrap"><table><thead><tr><th>Colaborador</th><th>Função</th><th>Convocado</th><th>Presente</th><th>Horas</th><th>Faltou em</th></tr></thead><tbody>${linhas.map(l => `<tr><td>${esc(l.f.nome)}<br><small>${esc(l.f.matricula || '')}</small></td><td>${esc(l.f.funcao || '')}</td><td>${l.conv}</td><td>${l.pres}</td><td>${durTxt(l.min)}</td><td><small>${esc(l.falt.join('; '))}</small></td></tr>`).join('')}</tbody></table></div></section>`;
  $('ano').onchange = e => { window.__ano = e.target.value; viewRel(); };
  $('bX').onclick = () => baixarXlsx([['Colaborador', 'Matrícula', 'Função', 'Convocado', 'Presente', 'Horas', 'Faltou em']].concat(linhas.map(l => [l.f.nome, l.f.matricula || '', l.f.funcao || '', l.conv, l.pres, +(l.min / 60).toFixed(2), l.falt.join('; ')])), 'Frequencia_treinamentos_' + ano + '.xlsx', 'Frequência');
}

function render() { nav(); if (view === 'lista') viewLista(); else if (view === 'novo') viewNovo(); else if (view === 'det') viewDet(); else viewRel(); }
(async function init() { try { await UPA.ready(); await carregar(); render(); } catch (e) { notice(UPA.msg(e), true); } })();
