'use strict';
/* Resumo de insumos: lê vários DFD (PDF ou Word), extrai a tabela "Demanda – Quantidade Solicitada" (item, código SIGMA, descrição, unidade, quantidade 12 meses),
   soma por ano e gera planilha Excel (Resumo por item × ano, Detalhe, Arquivos lidos). Tudo no navegador; nada é enviado a terceiros. */
let RES = []; // {nome, ano, data, itens:[{n,cod,desc,un,qtd}], origem, aviso}
const NANOS = 5;
const numBR = s => { s = String(s || '').trim(); if (!s) return NaN; if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.')); return parseFloat(s.replace(/\./g, '').replace(',', '.')); };
const UN = /^(UND|UNID|UN|CX|CAIXA|PCT|PACOTE|FR|FRASCO|KG|PAR|PARES|RL|ROLO|AMP|CP|COMP|L|LT|ML|G|BG|BOLSA|GL|TB|SC|DZ|MT|M)\.?$/i;
const dataDe = txt => { const m = String(txt).match(/DATA\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i) || String(txt).match(/(\d{2})\/(\d{2})\/(20\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
const curto = d => { d = String(d || '').replace(/\s+/g, ' ').trim(); let c = d.split(/\.\s|\s[–-]\s(?=[A-ZÁ-Ú]{3,}\s)/)[0]; if (c.length > 110) c = c.slice(0, 110).replace(/\s\S*$/, '') + '…'; return c; };

/* ---------- PDF ---------- */
async function lerPdfDfd(bytes) {
  await iniciarPdfJs(); const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise, itens = []; let data = '', textoAll = '', emSerie = false, primeiraPag = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const pg = await pdf.getPage(n), vp = pg.getViewport({ scale: 1 }), H = vp.height, tc = await pg.getTextContent();
    const its = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: H - i.transform[5], w: i.width || 0 })); // y de cima para baixo
    textoAll += ' ' + its.map(i => i.s).join(' ');
    const rows = [];
    its.filter(i => /^\d{8,13}$/.test(i.s)).forEach(c => {
      const mesmo = its.filter(i => Math.abs(i.y - c.y) <= 5 && i !== c);
      const un = mesmo.filter(i => i.x > c.x && UN.test(i.s)).sort((a, b) => a.x - b.x)[0];
      const q = un ? mesmo.filter(i => i.x > un.x && /^[\d.,]+$/.test(i.s)).sort((a, b) => a.x - b.x)[0] : null;
      const ni = mesmo.filter(i => i.x < c.x && /^\d{1,3}$/.test(i.s)).sort((a, b) => b.x - a.x)[0];
      if (un && q) rows.push({ c, un, q, ni });
    });
    rows.sort((a, b) => a.c.y - b.c.y);
    const corteY = its.filter(i => /S[ée]rie Hist[óo]rica|Fundamenta[çc][ãa]o da Demanda/i.test(i.s)).map(i => i.y).sort((a, b) => a - b);
    const serieY = its.filter(i => /S[ée]rie Hist[óo]rica/i.test(i.s)).map(i => i.y)[0];
    const hdrs = its.filter(i => /^(12 MESES|DESCRI[ÇC][ÃA]O|C[ÓO]DIGO|SIGMA|QUANT\.?|UNID|ITEM)$/i.test(i.s));
    const emSerie0 = emSerie && serieY == null; if (serieY != null) emSerie = true;
    const pri = rows.filter(r => !(emSerie0 || (serieY != null && r.c.y > serieY)));
    pri.forEach((r, k) => {
      const hdr = hdrs.filter(h => h.y < r.c.y).map(h => h.y).sort((a, b) => b - a)[0];
      const topo = k === 0 ? Math.max(95, hdr != null && !primeiraPag ? hdr + 6 : 95) : null;
      pri[k].topo0 = topo;
    });
    const descs = pri.map(() => []);
    // linhas de descrição: faixa horizontal entre o código e a unidade, dentro da área da tabela de requisitos
    pri.forEach((r, k) => {
      const topoK = k === 0 ? pri[0].topo0 : (pri[k - 1].c.y + r.c.y) / 2, ate = corteY.filter(y => y > r.c.y)[0];
      const baseK = k === pri.length - 1 ? (ate != null ? ate - 4 : H - 40) : (r.c.y + pri[k + 1].c.y) / 2;
      r.topoK = topoK; r.baseK = baseK;
    });
    // ajuste fino da fronteira entre descrições vizinhas: maior vão vertical entre linhas na zona de transição
    for (let k = 1; k < pri.length; k++) {
      const a1 = pri[k - 1], b1 = pri[k], x0 = a1.c.x + a1.c.w - 2, x1 = a1.un.x - 3;
      const ys = its.filter(i => i.y > a1.c.y - 2 && i.y < b1.c.y + 2 && i.x >= x0 && i.x < x1 && i !== a1.c && i !== b1.c).map(i => Math.round(i.y * 2) / 2).filter((v, i, ar) => ar.indexOf(v) === i).sort((p, q) => p - q);
      if (ys.length >= 3) { const gaps = ys.slice(1).map((v, i) => v - ys[i]), med = gaps.slice().sort((p, q) => p - q)[Math.floor(gaps.length / 2)], mx = Math.max(...gaps); if (mx > med * 1.2) { const gi = gaps.indexOf(mx), corte = (ys[gi] + ys[gi + 1]) / 2; a1.baseK = corte; b1.topoK = corte; } }
    }
    pri.forEach(r => {
      const x0 = r.c.x + r.c.w - 2, x1 = r.un.x - 3;
      const desc = its.filter(i => i.y > r.topoK && i.y < r.baseK && i.x >= x0 && i.x < x1 && i !== r.c).sort((p, q) => p.y - q.y || p.x - q.x).map(i => i.s).join(' ');
      itens.push({ n: r.ni ? +r.ni.s : '', cod: r.c.s, desc: desc.replace(/\s+/g, ' ').replace(/\u200b/g, '').trim(), un: r.un.s.toUpperCase(), qtd: numBR(r.q.s) });
    });
    if (pri.length) primeiraPag = primeiraPag || n;
  }
  data = dataDe(textoAll); return { itens, data };
}
/* ---------- Word ---------- */
async function lerWordDfd(buf) {
  const r = await docxLer(buf), itens = [];
  r.tabelas.forEach(t => {
    const hi = t.findIndex(l => /C[ÓO]DIGO/i.test(l.join(' ')) && /QUANT/i.test(l.join(' '))); if (hi < 0) return;
    for (let i = hi + 1; i < t.length; i++) { const l = t[i], cod = l.find(c => /^\d{8,13}$/.test(c)); if (!cod) continue; const k = l.indexOf(cod), q = numBR(l[l.length - 1]), un = (l[l.length - 2] || '').toUpperCase(); const ni = /^\d{1,3}$/.test(l[0]) ? +l[0] : ''; itens.push({ n: ni, cod, desc: l.slice(k + 1, l.length - 2).join(' '), un, qtd: q }); }
  });
  return { itens, data: dataDe(r.texto) };
}
async function lerArquivoDfd(nome, bytes, origem) {
  const word = /\.docx$/i.test(nome); let r;
  try { r = word ? await lerWordDfd(bytes.slice ? bytes.slice(0) : bytes) : await lerPdfDfd(new Uint8Array(bytes)); } catch (e) { return { nome, ano: '', data: '', itens: [], origem, aviso: 'Erro ao ler: ' + (e.message || e) }; }
  const ano = r.data ? +r.data.slice(0, 4) : '';
  return { nome, ano, data: r.data, itens: r.itens, origem, aviso: !r.itens.length ? 'Nenhum item encontrado (o formato da tabela não foi reconhecido)' : (!ano ? 'Data não encontrada — informe o ano' : '') };
}

/* ---------- consolidação ---------- */
function consolidar() {
  const atual = new Date().getFullYear(), ini = atual - NANOS + 1, anos = []; for (let a = ini; a <= atual; a++) anos.push(a);
  const mapa = {}, det = [];
  RES.filter(r => r.ano && r.ano >= ini && r.ano <= atual).forEach(r => r.itens.forEach(it => {
    const m = mapa[it.cod] = mapa[it.cod] || { cod: it.cod, desc: '', un: it.un, ult: 0, porAno: {} };
    if (r.ano >= m.ult && it.desc) { m.desc = it.desc; m.ult = r.ano; m.un = it.un || m.un; }
    m.porAno[r.ano] = (m.porAno[r.ano] || 0) + (isNaN(it.qtd) ? 0 : it.qtd);
    det.push({ ano: r.ano, arquivo: r.nome, data: r.data, n: it.n, cod: it.cod, desc: it.desc, un: it.un, qtd: it.qtd });
  }));
  const linhas = Object.values(mapa).sort((a, b) => a.desc.localeCompare(b.desc));
  return { anos, linhas, det, fora: RES.filter(r => r.ano && (r.ano < ini || r.ano > atual)) };
}
function baixarResumo() {
  if (typeof XLSX === 'undefined') { notice('Biblioteca de Excel não carregou (verifique a internet).', true); return; }
  const c = consolidar(); if (!c.linhas.length) { notice('Nenhum item no período para gerar a planilha.', true); return; }
  const head = ['Código SIGMA', 'Insumo (descrição resumida)', 'Un.'].concat(c.anos.map(String), ['Total no período', 'Média anual']);
  const A = [['Resumo de insumos solicitados em DFD — UPA 24H Rocinha — ' + c.anos[0] + ' a ' + c.anos[c.anos.length - 1]], ['Quantidades = “quant. 12 meses” de cada DFD, somadas por ano de referência. Gerado em ' + new Date().toLocaleString('pt-BR')], [], head];
  c.linhas.forEach(l => { const v = c.anos.map(a => l.porAno[a] || 0), tot = v.reduce((s, x) => s + x, 0); A.push([l.cod, curto(l.desc), l.un].concat(v, [tot, Math.round(tot / c.anos.filter(a => l.porAno[a] != null).length * 100) / 100])); });
  const tot = ['', 'TOTAL DE UNIDADES', ''].concat(c.anos.map(a => c.linhas.reduce((s, l) => s + (l.porAno[a] || 0), 0)), [c.linhas.reduce((s, l) => s + c.anos.reduce((x, a) => x + (l.porAno[a] || 0), 0), 0), '']); A.push(tot);
  const wsR = XLSX.utils.aoa_to_sheet(A); wsR['!cols'] = [{ wch: 14 }, { wch: 70 }, { wch: 6 }].concat(c.anos.map(() => ({ wch: 10 })), [{ wch: 16 }, { wch: 12 }]);
  const D = [['Ano', 'Arquivo', 'Data do DFD', 'Item nº', 'Código SIGMA', 'Descrição completa', 'Un.', 'Quantidade']].concat(c.det.sort((a, b) => a.ano - b.ano || a.cod.localeCompare(b.cod)).map(d => [d.ano, d.arquivo, d.data ? d.data.split('-').reverse().join('/') : '', d.n, d.cod, d.desc, d.un, d.qtd]));
  const wsD = XLSX.utils.aoa_to_sheet(D); wsD['!cols'] = [{ wch: 6 }, { wch: 45 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 90 }, { wch: 6 }, { wch: 11 }];
  const F = [['Arquivo', 'Ano de referência', 'Data lida', 'Itens lidos', 'Situação']].concat(RES.map(r => [r.nome, r.ano || '', r.data ? r.data.split('-').reverse().join('/') : '', r.itens.length, r.aviso || (r.ano && (r.ano < c.anos[0] || r.ano > c.anos[c.anos.length - 1]) ? 'Fora do período (não somado)' : 'OK')]));
  const wsF = XLSX.utils.aoa_to_sheet(F); wsF['!cols'] = [{ wch: 55 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 55 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, wsR, 'Resumo'); XLSX.utils.book_append_sheet(wb, wsD, 'Detalhe'); XLSX.utils.book_append_sheet(wb, wsF, 'Arquivos lidos');
  XLSX.writeFile(wb, 'Resumo_insumos_DFD_' + c.anos[0] + '_' + c.anos[c.anos.length - 1] + '.xlsx');
}

/* ---------- tela ---------- */
function viewResumo() {
  const c = consolidar(), prob = RES.filter(r => r.aviso);
  $('content').innerHTML = `<section class="view"><h2>Resumo de insumos (últimos ${NANOS} anos)</h2>
  <p class="muted">Importe vários DFD (PDF ou Word). O sistema lê a tabela de itens de cada um, soma as quantidades por ano e gera a planilha Excel. A leitura é automática — confira o resumo antes de usar os números.</p>
  <label class="fld">Arquivos DFD (selecione vários de uma vez)<input type="file" id="rsIn" multiple accept="application/pdf,.pdf,.docx"></label>
  <div class="actions"><button type="button" class="secondary" id="rsArq">Incluir os ${DOCS.length} DFD já arquivados no sistema</button><button type="button" id="rsXls"${c.linhas.length ? '' : ' disabled'}>⇩ Baixar planilha Excel</button><button type="button" class="secondary" id="rsLimpa"${RES.length ? '' : ' disabled'}>Limpar lista</button></div><p id="rsProg" class="muted"></p>
  ${RES.length ? `<h3>Arquivos lidos (${RES.length})</h3><div class="table-wrap"><table><thead><tr><th>Arquivo</th><th>Ano de referência</th><th>Itens</th><th>Situação</th><th></th></tr></thead><tbody>${RES.map((r, i) => `<tr><td>${esc(r.nome)}</td><td><input type="number" min="2000" max="2100" value="${esc(r.ano)}" data-ano="${i}" style="width:90px"></td><td>${r.itens.length}</td><td>${r.aviso ? '<span class="badge warn">' + esc(r.aviso) + '</span>' : (r.ano && (r.ano < c.anos[0] || r.ano > c.anos[c.anos.length - 1]) ? '<span class="badge">Fora do período</span>' : '<span class="badge ok">OK</span>')}</td><td><button type="button" class="small danger" data-rm="${i}">remover</button></td></tr>`).join('')}</tbody></table></div>` : ''}
  ${prob.length ? '<div class="alert warn"><b>⚠</b><span>Alguns arquivos precisam de atenção (ano não encontrado ou tabela não reconhecida). Informe o ano na coluna ou use o PDF original do DFD.</span></div>' : ''}
  ${c.linhas.length ? `<h3>Prévia — ${c.linhas.length} insumos (${c.anos[0]} a ${c.anos[c.anos.length - 1]})</h3><div class="table-wrap"><table><thead><tr><th>Código</th><th>Insumo</th><th>Un.</th>${c.anos.map(a => `<th>${a}</th>`).join('')}<th>Total</th></tr></thead><tbody>${c.linhas.slice(0, 200).map(l => `<tr><td>${esc(l.cod)}</td><td>${esc(curto(l.desc))}</td><td>${esc(l.un)}</td>${c.anos.map(a => `<td>${l.porAno[a] != null ? l.porAno[a].toLocaleString('pt-BR') : '—'}</td>`).join('')}<td><b>${c.anos.reduce((s, a) => s + (l.porAno[a] || 0), 0).toLocaleString('pt-BR')}</b></td></tr>`).join('')}</tbody></table></div>` : ''}</section>`;
  $('rsIn').onchange = async ev => { const fs = Array.from(ev.target.files); for (let i = 0; i < fs.length; i++) { $('rsProg').textContent = `Lendo ${i + 1}/${fs.length}: ${fs[i].name}`; RES.push(await lerArquivoDfd(fs[i].name, await fs[i].arrayBuffer(), 'upload')); } viewResumo(); };
  $('rsArq').onclick = async () => {
    const novos = DOCS.filter(d => !RES.some(r => r.origem === d.id)); if (!novos.length) { notice('Todos os DFD arquivados já estão na lista.'); return; }
    for (let i = 0; i < novos.length; i++) { const d = novos[i]; $('rsProg').textContent = `Lendo arquivados ${i + 1}/${novos.length}`; try { const u = (await UPA.files.urls([d.pathOrig]))[d.pathOrig], buf = await (await fetch(u)).arrayBuffer(); const r = await lerArquivoDfd(d.nomeOriginal || d.objeto, buf, d.id); if (!r.ano && d.dataDoc) { r.ano = +d.dataDoc.slice(0, 4); r.data = d.dataDoc; r.aviso = r.itens.length ? '' : r.aviso; } RES.push(r); } catch (e) { RES.push({ nome: d.nomeOriginal || d.objeto, ano: '', data: '', itens: [], origem: d.id, aviso: 'Erro ao baixar: ' + UPA.msg(e) }); } }
    viewResumo();
  };
  $('rsXls').onclick = baixarResumo; $('rsLimpa').onclick = () => { RES = []; viewResumo(); };
  document.querySelectorAll('[data-ano]').forEach(i => i.onchange = () => { const r = RES[+i.dataset.ano]; r.ano = +i.value || ''; if (r.ano && r.aviso && /ano/i.test(r.aviso)) r.aviso = ''; viewResumo(); });
  document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { RES.splice(+b.dataset.rm, 1); viewResumo(); });
}
