'use strict';
/* Rouparia — notas de lavanderia (saída = roupa suja enviada; entrada = roupa limpa recebida),
   peso da nota × peso real, diferenças, dashboards, upload/importação, relatório e carta de questionamento. */
const $ = id => document.getElementById(id);
const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => crypto.randomUUID();
const hoje = () => new Date().toLocaleDateString('en-CA');
const fd = d => { if (!d) return ''; const p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(d); };
const num = v => { if (typeof v === 'number') return isFinite(v) ? v : 0; let s = String(v == null ? '' : v).replace(/[^\d,.\-]/g, ''); if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.'); const n = parseFloat(s); return isFinite(n) ? n : 0; };
const kg = n => (Math.round(n * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' kg';
const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const semAc = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const mesDe = d => String(d || '').slice(0, 7);
const mesTxt = m => { const p = m.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+p[1] - 1] + '/' + p[0].slice(2); };
const CN = 'rouparia_notas', CC = 'rouparia_cartas', CG = 'rouparia_cfg', CFG_ID = 'rouparia-cfg';
const ITENS = [['lencol', 'Lençol'], ['camisola', 'Camisola'], ['cobertor', 'Cobertor']]; // itens do contrato
const qi = (n, k) => Math.round(num(n[k]));
const totItens = n => ITENS.reduce((s, i) => s + qi(n, i[0]), 0);
const itensTxt = n => ITENS.filter(i => qi(n, i[0])).map(i => i[1] + ' ' + qi(n, i[0])).join(' · ');
const QUAL = ['Item fora do contrato (só lençol, camisola e cobertor)', 'Manchas', 'Mau cheiro', 'Rasgos / desgaste', 'Peças faltando', 'Peças trocadas / de outra unidade', 'Quantidade diferente da nota', 'Úmida', 'Mal dobrada / embalada', 'Entrega atrasada'];
let CFG = { tolerancia: 5, valorKg: 0, fornecedor: '', contrato: '', coordNome: 'Luis Felipe W. Seroa da Motta', coordCargo: 'Coordenador Administrativo' };
function notice(t, erro) { const m = $('message'); m.textContent = t || ''; m.className = erro ? 'err' : ''; if (t) m.scrollIntoView({ block: 'nearest' }); }

/* ---------- dados ---------- */
const cache = {};
async function all(col) { if (!cache[col]) cache[col] = (await UPA.db.list(col)).map(r => ({ ...r.dados, id: r.id })); return cache[col]; }
async function put(col, o) { const d = { ...o, id: o.id || uuid() }; await UPA.db.put(col, d.id, d); delete cache[col]; return d; }
async function del(col, id) { await UPA.db.del(id); delete cache[col]; }
async function carregarCfg() { const l = await all(CG); const c = l.find(x => x.id === CFG_ID); if (c) CFG = { ...CFG, ...c }; }

/* ---------- cálculo ---------- */
function calc(n) {
  const nota = num(n.pesoNota), real = num(n.pesoReal), tem = nota > 0 && real > 0;
  const dif = tem ? nota - real : 0, pct = tem ? dif / real * 100 : 0;
  return { nota, real, tem, dif, pct, fora: tem && Math.abs(pct) > num(CFG.tolerancia), valor: tem && dif > 0 ? dif * num(CFG.valorKg) : 0 };
}
const tipoSaida = n => /sa[ií]da|suja/i.test(n.tipo || '');
function resumo(L) {
  const r = { itS: { lencol: 0, camisola: 0, cobertor: 0 }, itE: { lencol: 0, camisola: 0, cobertor: 0 }, saida: 0, entrada: 0, saidaNota: 0, entradaNota: 0, dif: 0, difAbs: 0, fora: 0, comDif: 0, valor: 0, pend: 0 };
  L.forEach(n => { ITENS.forEach(i => { (tipoSaida(n) ? r.itS : r.itE)[i[0]] += qi(n, i[0]); }); });
  L.forEach(n => {
    const c = calc(n); if (!c.tem) { r.pend++; return; }
    if (tipoSaida(n)) { r.saida += c.real; r.saidaNota += c.nota; } else { r.entrada += c.real; r.entradaNota += c.nota; }
    r.dif += c.dif; r.difAbs += Math.abs(c.dif); r.comDif++; if (c.fora) r.fora++; r.valor += c.valor;
  });
  return r;
}

/* ---------- navegação ---------- */
const VIEWS = [['painel', 'Painel'], ['notas', 'Notas'], ['importar', 'Upload / Importar'], ['dif', 'Diferenças'], ['cartas', 'Carta de questionamento'], ['cfg', 'Configurações']];
let view = 'painel', ed = null, fil = { mes: '', tipo: '', q: '' }, selCarta = [];
function nav() {
  $('nav').innerHTML = VIEWS.map(v => `<button type="button" data-v="${v[0]}" class="${v[0] === view ? 'active' : ''}">${v[1]}</button>`).join('');
}
const meses = L => Array.from(new Set(L.map(n => mesDe(n.data)).filter(Boolean))).sort().reverse();

/* ---------- Painel ---------- */
async function viewPainel() {
  const L = await all(CN), ms = meses(L), mes = fil.mes || ms[0] || '';
  const doMes = L.filter(n => mesDe(n.data) === mes), R = resumo(doMes), T = resumo(L);
  const hist = ms.slice(0, 8).reverse().map(m => ({ m, ...resumo(L.filter(n => mesDe(n.data) === m)) }));
  const maxKg = Math.max(1, ...hist.map(h => Math.max(h.saida, h.entrada)));
  const maxDif = Math.max(1, ...hist.map(h => Math.abs(h.dif)));
  const probs = {}; doMes.forEach(n => (n.qualidade || []).forEach(q => { probs[q] = (probs[q] || 0) + 1; }));
  const probL = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  const maxP = Math.max(1, ...probL.map(x => x[1]));
  const sel = `<label>Mês<select id="fMes">${ms.map(m => `<option value="${m}"${m === mes ? ' selected' : ''}>${mesTxt(m)}</option>`).join('') || '<option value="">—</option>'}</select></label>`;
  $('content').innerHTML = `<section class="view"><h2>Painel da Rouparia</h2><div class="filtro">${sel}</div>
  <div class="stats"><div class="stat">Roupa suja enviada (peso real)<strong>${kg(R.saida)}</strong></div><div class="stat">Roupa limpa recebida (peso real)<strong>${kg(R.entrada)}</strong></div>
  <div class="stat ${Math.abs(R.dif) > 0 ? 'warn' : ''}">Diferença nota − real<strong>${R.dif > 0 ? '+' : ''}${kg(R.dif)}</strong></div><div class="stat ${R.fora ? 'bad' : ''}">Notas fora da tolerância (${CFG.tolerancia}%)<strong>${R.fora} de ${R.comDif}</strong></div></div>
  ${R.valor > 0 && num(CFG.valorKg) > 0 ? `<div class="alert warn"><b>⚠</b><span>Peso cobrado a maior no mês: estimativa de <b>${brl(R.valor)}</b> (${CFG.valorKg}/kg).</span></div>` : ''}
  ${R.pend ? `<div class="alert warn"><b>⚠</b><span>${R.pend} nota(s) do mês sem peso preenchido (nota ou real).</span></div>` : ''}
  <h3>Itens do contrato no mês (quantidade de peças)</h3><div class="table-wrap"><table><thead><tr><th>Item</th><th>Enviado (suja)</th><th>Recebido (limpa)</th><th>Diferença (recebido − enviado)</th></tr></thead><tbody>${ITENS.map(i => { const e = R.itS[i[0]], r2 = R.itE[i[0]], d = r2 - e; return `<tr><td><b>${i[1]}</b></td><td>${e}</td><td>${r2}</td><td><span class="badge ${d < 0 ? 'bad' : 'ok'}">${d > 0 ? '+' : ''}${d}</span></td></tr>`; }).join('')}</tbody></table></div><p class="muted">Diferença negativa = enviou mais peças do que recebeu de volta (possível falta). Confira também as notas do mês anterior, pois a devolução pode ocorrer depois.</p>
  <h3>Enviado × recebido por mês (peso real)</h3><div class="box2">${hist.map(h => `<div class="barrow"><span>${mesTxt(h.m)} · suja</span><div class="bar"><i style="width:${h.saida / maxKg * 100}%;background:#2672ce"></i></div><b>${kg(h.saida)}</b></div><div class="barrow"><span>${mesTxt(h.m)} · limpa</span><div class="bar"><i style="width:${h.entrada / maxKg * 100}%;background:#12805c"></i></div><b>${kg(h.entrada)}</b></div>`).join('') || '<p class="muted">Sem dados.</p>'}</div>
  <h3>Diferença de peso (nota − real) por mês</h3><div class="box2">${hist.map(h => `<div class="barrow"><span>${mesTxt(h.m)}</span><div class="bar"><i style="width:${Math.abs(h.dif) / maxDif * 100}%;background:${h.dif > 0 ? '#c0392b' : '#12805c'}"></i></div><b>${h.dif > 0 ? '+' : ''}${kg(h.dif)}</b></div>`).join('') || '<p class="muted">Sem dados.</p>'}<p class="muted">Vermelho = nota acima do peso real (possível cobrança a maior).</p></div>
  <h3>Problemas de qualidade no mês</h3><div class="box2">${probL.map(([q, c]) => `<div class="barrow"><span>${esc(q)}</span><div class="bar"><i style="width:${c / maxP * 100}%;background:#c0392b"></i></div><b>${c}</b></div>`).join('') || '<p class="muted">Nenhum problema registrado.</p>'}</div>
  <p class="muted">Total geral: ${L.length} notas · saldo suja−limpa (pesos reais): ${kg(T.saida - T.entrada)}. Observação: a roupa limpa pode ter peso diferente da suja (umidade/sujidade); compare tendências, não valores isolados.</p>
  <div class="actions"><button type="button" data-act="xlsx">⬇ Baixar relatório (Excel)</button><button type="button" class="secondary" data-act="pdf">⬇ Relatório em PDF (imprimir)</button></div></section>`;
}

/* ---------- Notas ---------- */
function formNota(c) {
  c = c || {};
  const q = c.qualidade || [];
  return `<form id="ef"><div class="grid">
  <label class="fld">Movimento<select name="tipo" required><option${tipoSaida(c) || !c.tipo ? ' selected' : ''}>Saída (roupa suja enviada)</option><option${c.tipo && !tipoSaida(c) ? ' selected' : ''}>Entrada (roupa limpa recebida)</option></select></label>
  <label class="fld">Data<input type="date" name="data" required value="${esc(c.data || hoje())}"></label>
  <label class="fld">Nº da nota<input name="numero" value="${esc(c.numero || '')}"></label>
  <label class="fld">Fornecedor<input name="fornecedor" value="${esc(c.fornecedor || CFG.fornecedor)}"></label>
  <label class="fld">Peso da nota (kg)<input name="pesoNota" inputmode="decimal" value="${esc(c.pesoNota || '')}"></label>
  <label class="fld">Peso real aferido (kg)<input name="pesoReal" inputmode="decimal" value="${esc(c.pesoReal || '')}"></label>
  ${ITENS.map(i => `<label class="fld">${i[1]} (qtd. de peças)<input name="${i[0]}" inputmode="numeric" value="${esc(c[i[0]] || '')}"></label>`).join('')}
  <fieldset class="fld full"><legend>Qualidade / ocorrências</legend><div class="chk">${QUAL.map(o => `<label class="c"><input type="checkbox" name="qualidade" value="${esc(o)}"${q.indexOf(o) >= 0 ? ' checked' : ''}>${esc(o)}</label>`).join('')}</div></fieldset>
  <label class="fld full">Observações<textarea name="obs">${esc(c.obs || '')}</textarea></label>
  <label class="fld full">Anexar nota (foto/PDF)<input type="file" id="anexos" multiple accept="image/*,application/pdf"></label>
  ${(c.anexos || []).length ? `<div class="fld full muted">Anexos: ${c.anexos.map((a, i) => `${esc(a.nome)} <button type="button" class="small danger" data-act="rmanexo" data-i="${i}">remover</button>`).join(' · ')}</div>` : ''}
  </div><div class="actions"><button type="submit">${ed ? 'Salvar alterações' : 'Salvar nota'}</button>${ed ? '<button type="button" class="secondary" data-act="cancelar">Cancelar edição</button>' : ''}</div></form>`;
}
async function viewNotas() {
  const L = await all(CN), cur = ed ? L.find(n => n.id === ed) : null, q = semAc(fil.q);
  const lista = L.filter(n => (!fil.mes || mesDe(n.data) === fil.mes) && (!fil.tipo || (fil.tipo === 'S') === tipoSaida(n)) && (!q || semAc([n.numero, n.fornecedor, n.obs].join(' ')).indexOf(q) >= 0)).sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const lin = lista.map(n => { const c = calc(n); return `<tr><td>${fd(n.data)}</td><td>${tipoSaida(n) ? 'Saída' : 'Entrada'}</td><td>${esc(n.numero)}</td><td>${c.nota ? kg(c.nota) : '—'}</td><td>${c.real ? kg(c.real) : '—'}</td><td>${c.tem ? `<span class="badge ${c.fora ? 'bad' : 'ok'}">${c.dif > 0 ? '+' : ''}${kg(c.dif)} (${c.pct.toFixed(1)}%)</span>` : '<span class="badge warn">pendente</span>'}</td><td>${esc(itensTxt(n))}</td><td>${esc((n.qualidade || []).join(', '))}</td><td style="white-space:nowrap">${(n.anexos || []).length ? `<button type="button" class="small secondary" data-act="ver" data-id="${esc(n.id)}">Anexos</button>` : ''}<button type="button" class="small" data-act="edit" data-id="${esc(n.id)}">Editar</button><button type="button" class="small danger" data-act="del" data-id="${esc(n.id)}">Excluir</button></td></tr>`; }).join('');
  const ms = meses(L);
  $('content').innerHTML = `<section class="view"><h2>Notas de lavanderia</h2><p class="muted">Registre cada nota: saída (roupa suja enviada) e entrada (roupa limpa recebida), com o peso da nota e o peso real aferido na balança da unidade.</p>${formNota(cur)}
  <h3>Registros (${lista.length})</h3><div class="filtro"><label>Mês<select id="fMes"><option value="">Todos</option>${ms.map(m => `<option value="${m}"${m === fil.mes ? ' selected' : ''}>${mesTxt(m)}</option>`).join('')}</select></label><label>Movimento<select id="fTipo"><option value="">Todos</option><option value="S"${fil.tipo === 'S' ? ' selected' : ''}>Saída</option><option value="E"${fil.tipo === 'E' ? ' selected' : ''}>Entrada</option></select></label><label>Buscar<input type="search" id="busca" value="${esc(fil.q)}" placeholder="nº, fornecedor"></label></div>
  <div class="table-wrap"><table><thead><tr><th>Data</th><th>Mov.</th><th>Nº</th><th>Peso nota</th><th>Peso real</th><th>Diferença</th><th>Itens (qtd.)</th><th>Qualidade</th><th>Ações</th></tr></thead><tbody>${lin || '<tr><td colspan="9">Nenhuma nota.</td></tr>'}</tbody></table></div></section>`;
}
function lerNota(form, base) {
  const f = form.elements, o = { ...base };
  ['tipo', 'data', 'numero', 'fornecedor', 'pesoNota', 'pesoReal', 'lencol', 'camisola', 'cobertor', 'obs'].forEach(k => { o[k] = String(f[k].value || '').trim(); });
  o.pecas = String(totItens(o) || '');
  o.qualidade = Array.from(form.querySelectorAll('input[name="qualidade"]:checked')).map(x => x.value);
  return o;
}
async function anexar(d, files, pasta) {
  const lista = (d.anexos || []).slice();
  for (const f of files) {
    if (f.size > 12 * 1024 * 1024) throw new Error('Arquivo acima de 12 MB: ' + f.name);
    const path = `rouparia/${d.id}/${uuid().slice(0, 8)}-${f.name.replace(/[^\w.\-]+/g, '_')}`;
    await UPA.files.upload(path, f, f.type); lista.push({ path, nome: f.name, tipo: f.type, tam: f.size });
  }
  return lista;
}
async function salvarNota(form) {
  const L = await all(CN), cur = ed ? L.find(n => n.id === ed) : null, o = lerNota(form, cur || {});
  const files = Array.from(($('anexos') || { files: [] }).files || []);
  let d = { ...o, id: o.id || uuid() };
  if (files.length) d.anexos = await anexar(d, files);
  await put(CN, d); ed = null; notice(cur ? 'Nota atualizada.' : 'Nota salva.'); await render();
}

/* ---------- Upload / Importar ---------- */
async function viewImportar() {
  $('content').innerHTML = `<section class="view"><h2>Upload das notas e importação</h2>
  <div class="box2"><h3 style="margin-top:0">1. Subir as notas (fotos/PDF)</h3><p class="muted">Cada arquivo vira uma nota com o anexo, para você completar os pesos depois (aparece como "pendente").</p>
  <div class="grid"><label class="fld">Movimento<select id="upTipo"><option>Saída (roupa suja enviada)</option><option>Entrada (roupa limpa recebida)</option></select></label><label class="fld">Data<input type="date" id="upData" value="${hoje()}"></label>
  <label class="fld full">Arquivos<input type="file" id="upFiles" multiple accept="image/*,application/pdf"></label></div><div class="actions"><button type="button" data-act="subir">⬆ Enviar notas</button></div></div>
  <div class="box2"><h3 style="margin-top:0">2. Importar planilha (CSV/Excel)</h3><p class="muted">Colunas aceitas (qualquer ordem): <b>data, movimento (saída/entrada), nº nota, fornecedor, peso nota, peso real, lençol, camisola, cobertor, observações</b>. Datas dd/mm/aaaa ou aaaa-mm-dd.</p>
  <div class="actions"><input type="file" id="impFile" accept=".csv,.xlsx,.xls,.txt"><button type="button" data-act="importar">Importar planilha</button><button type="button" class="secondary" data-act="modelo">Baixar modelo</button></div></div></section>`;
}
function dataISO(v) {
  if (v instanceof Date) return v.toLocaleDateString('en-CA');
  const s = String(v || '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[0];
  if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/))) { let y = m[3]; if (y.length === 2) y = '20' + y; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  if (/^\d{5}$/.test(s)) return new Date(Math.round((+s - 25569) * 864e5)).toISOString().slice(0, 10);
  return '';
}
async function importar() {
  const f = ($('impFile').files || [])[0]; if (!f) { notice('Escolha o arquivo.', true); return; }
  if (typeof XLSX === 'undefined') { notice('Biblioteca de planilhas não carregou. Verifique a internet.', true); return; }
  const buf = await f.arrayBuffer(); let rows;
  try {
    let wb; if (/\.csv$|\.txt$/i.test(f.name)) { let t = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, ''); if (t.indexOf('�') >= 0) t = new TextDecoder('windows-1252').decode(buf); wb = XLSX.read(t, { type: 'string', cellDates: true }); } else wb = XLSX.read(buf, { type: 'array', cellDates: true });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
  } catch (e) { notice('Não consegui ler o arquivo: ' + (e.message || e), true); return; }
  const pick = (r, ...ks) => { for (const k of Object.keys(r)) { const n = semAc(k).replace(/[^a-z0-9]/g, ''); if (ks.some(x => n === x || n.indexOf(x) === 0)) return r[k]; } return ''; };
  const novas = []; let ign = 0;
  rows.forEach(r => {
    const data = dataISO(pick(r, 'data', 'dt')), pn = pick(r, 'pesonota', 'pesoda', 'pesoinformado', 'pesonf'), pr = pick(r, 'pesoreal', 'pesoafer', 'pesobalanca');
    const temIt = ['lencol', 'camisola', 'cobertor'].some(k => pick(r, k)); if (!data || (!pn && !pr && !temIt)) { ign++; return; }
    const mov = semAc(pick(r, 'movimento', 'tipo', 'mov')); const ent = /entrada|limpa|receb/.test(mov);
    novas.push({ id: uuid(), tipo: ent ? 'Entrada (roupa limpa recebida)' : 'Saída (roupa suja enviada)', data, numero: String(pick(r, 'nnota', 'nota', 'numero', 'num') || '').trim(), fornecedor: String(pick(r, 'fornecedor', 'lavanderia') || CFG.fornecedor).trim(), pesoNota: String(pn || ''), pesoReal: String(pr || ''), lencol: String(pick(r, 'lencol', 'lencois') || ''), camisola: String(pick(r, 'camisola', 'camisolas') || ''), cobertor: String(pick(r, 'cobertor', 'cobertores') || ''), obs: String(pick(r, 'obs', 'observ') || ''), qualidade: [] });
  });
  if (!novas.length) { notice('Nenhuma linha válida (precisa de data e ao menos um peso ou quantidade). Ignoradas: ' + ign, true); return; }
  if (!confirm(`Importar ${novas.length} nota(s)? (${ign} linha(s) ignorada(s))`)) return;
  for (const n of novas) await put(CN, n);
  notice(`${novas.length} nota(s) importada(s).`); view = 'notas'; await render();
}
function modelo() {
  const ws = XLSX.utils.aoa_to_sheet([['data', 'movimento', 'nº nota', 'fornecedor', 'peso nota', 'peso real', 'lençol', 'camisola', 'cobertor', 'observações'], ['2026-11-03', 'Saída', '1234', 'Lavanderia X', 120.5, 118, 40, 30, 10, ''], ['2026-11-05', 'Entrada', '1235', 'Lavanderia X', 118, 112.4, 40, 28, 10, 'Manchas']]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Notas'); XLSX.writeFile(wb, 'modelo_rouparia.xlsx');
}
async function subir() {
  const files = Array.from(($('upFiles').files || [])); if (!files.length) { notice('Escolha os arquivos.', true); return; }
  const tipo = $('upTipo').value, data = $('upData').value || hoje(); let n = 0;
  for (const f of files) { const d = { id: uuid(), tipo, data, numero: '', fornecedor: CFG.fornecedor, pesoNota: '', pesoReal: '', pecas: '', obs: 'Nota enviada por upload — completar os pesos.', qualidade: [] }; d.anexos = await anexar(d, [f]); await put(CN, d); n++; }
  notice(`${n} nota(s) enviada(s). Complete os pesos em Notas (filtro: pendentes aparecem com selo amarelo).`); view = 'notas'; await render();
}

/* ---------- Diferenças ---------- */
async function viewDif() {
  const L = (await all(CN)).filter(n => calc(n).tem), ms = meses(L), mes = fil.mes;
  const lista = L.filter(n => !mes || mesDe(n.data) === mes).sort((a, b) => Math.abs(calc(b).dif) - Math.abs(calc(a).dif));
  const R = resumo(lista);
  $('content').innerHTML = `<section class="view"><h2>Levantamento da diferença (peso da nota × peso real)</h2>
  <div class="filtro"><label>Mês<select id="fMes"><option value="">Todos</option>${ms.map(m => `<option value="${m}"${m === mes ? ' selected' : ''}>${mesTxt(m)}</option>`).join('')}</select></label></div>
  <div class="stats"><div class="stat">Peso das notas<strong>${kg(R.saidaNota + R.entradaNota)}</strong></div><div class="stat">Peso real<strong>${kg(R.saida + R.entrada)}</strong></div><div class="stat warn">Diferença líquida<strong>${R.dif > 0 ? '+' : ''}${kg(R.dif)}</strong></div><div class="stat bad">Estimativa a maior<strong>${num(CFG.valorKg) ? brl(R.valor) : '—'}</strong></div></div>
  <div class="box2"><b>Balanço de peças (recebido − enviado)</b>: ${ITENS.map(i => { const d = R.itE[i[0]] - R.itS[i[0]]; return `${i[1]} <span class="badge ${d < 0 ? 'bad' : 'ok'}">${d > 0 ? '+' : ''}${d}</span>`; }).join(' · ')}</div>
  <p class="muted">Tolerância configurada: ${CFG.tolerancia}%. Ordenado da maior para a menor diferença. Marque as notas e gere a carta.</p>
  <div class="table-wrap"><table><thead><tr><th></th><th>Data</th><th>Mov.</th><th>Nº</th><th>Nota</th><th>Real</th><th>Diferença</th><th>%</th><th>Situação</th></tr></thead><tbody>${lista.map(n => { const c = calc(n); return `<tr><td><input type="checkbox" data-sel="${esc(n.id)}"${selCarta.indexOf(n.id) >= 0 ? ' checked' : ''}></td><td>${fd(n.data)}</td><td>${tipoSaida(n) ? 'Saída' : 'Entrada'}</td><td>${esc(n.numero)}</td><td>${kg(c.nota)}</td><td>${kg(c.real)}</td><td>${c.dif > 0 ? '+' : ''}${kg(c.dif)}</td><td>${c.pct.toFixed(1)}%</td><td><span class="badge ${c.fora ? 'bad' : 'ok'}">${c.fora ? 'Fora da tolerância' : 'OK'}</span></td></tr>`; }).join('') || '<tr><td colspan="9">Sem notas com os dois pesos.</td></tr>'}</tbody></table></div>
  <div class="actions"><button type="button" data-act="foraSel">Marcar as fora da tolerância</button><button type="button" data-act="cartaSel">✉ Criar carta com as marcadas</button><button type="button" class="secondary" data-act="xlsx">⬇ Baixar relatório (Excel)</button><button type="button" class="secondary" data-act="pdf">⬇ Relatório em PDF</button></div></section>`;
}

/* ---------- Relatório (Excel / PDF) ---------- */
async function xlsxDownload() {
  const L = (await all(CN)).sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const linhas = L.map(n => { const c = calc(n); return { Data: fd(n.data), Movimento: tipoSaida(n) ? 'Saída (suja)' : 'Entrada (limpa)', 'Nº nota': n.numero, Fornecedor: n.fornecedor, 'Peso nota (kg)': c.nota || '', 'Peso real (kg)': c.real || '', 'Diferença (kg)': c.tem ? +c.dif.toFixed(2) : '', 'Diferença (%)': c.tem ? +c.pct.toFixed(2) : '', 'Fora da tolerância': c.tem ? (c.fora ? 'Sim' : 'Não') : '', Lençol: qi(n, 'lencol') || '', Camisola: qi(n, 'camisola') || '', Cobertor: qi(n, 'cobertor') || '', Qualidade: (n.qualidade || []).join('; '), Observações: n.obs }; });
  const ms = meses(L).reverse(), res = ms.map(m => { const r = resumo(L.filter(n => mesDe(n.data) === m)); return { Mês: mesTxt(m), 'Suja enviada (kg)': +r.saida.toFixed(2), 'Limpa recebida (kg)': +r.entrada.toFixed(2), 'Diferença nota−real (kg)': +r.dif.toFixed(2), 'Notas fora da tolerância': r.fora, 'Estimativa a maior (R$)': +r.valor.toFixed(2), 'Lençol enviado': r.itS.lencol, 'Lençol recebido': r.itE.lencol, 'Camisola enviada': r.itS.camisola, 'Camisola recebida': r.itE.camisola, 'Cobertor enviado': r.itS.cobertor, 'Cobertor recebido': r.itE.cobertor }; });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(res), 'Resumo mensal'); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Notas');
  XLSX.writeFile(wb, `relatorio_rouparia_${hoje()}.xlsx`);
}
async function pdfRel() {
  const L = (await all(CN)).sort((a, b) => String(a.data).localeCompare(String(b.data))), mes = fil.mes, lista = mes ? L.filter(n => mesDe(n.data) === mes) : L, R = resumo(lista);
  imprimir(`<div class="logos"><img src="../../assets/logo-upa.png" alt=""></div><h2 style="text-align:center">Relatório da Rouparia ${mes ? '— ' + mesTxt(mes) : ''}</h2>
  <table class="t kv"><tr><td>Suja enviada (real)</td><td>${kg(R.saida)}</td></tr><tr><td>Limpa recebida (real)</td><td>${kg(R.entrada)}</td></tr><tr><td>Diferença nota − real</td><td>${kg(R.dif)}</td></tr><tr><td>Notas fora da tolerância (${CFG.tolerancia}%)</td><td>${R.fora} de ${R.comDif}</td></tr>${num(CFG.valorKg) ? `<tr><td>Estimativa cobrada a maior</td><td>${brl(R.valor)}</td></tr>` : ''}${ITENS.map(i => `<tr><td>${i[1]}: enviado / recebido</td><td>${R.itS[i[0]]} / ${R.itE[i[0]]}</td></tr>`).join('')}</table>
  <table class="t"><thead><tr><th>Data</th><th>Mov.</th><th>Nº</th><th>Nota</th><th>Real</th><th>Dif.</th><th>%</th><th>Itens</th><th>Ocorrências</th></tr></thead><tbody>${lista.map(n => { const c = calc(n); return `<tr><td>${fd(n.data)}</td><td>${tipoSaida(n) ? 'Saída' : 'Entrada'}</td><td>${esc(n.numero)}</td><td>${c.nota || ''}</td><td>${c.real || ''}</td><td>${c.tem ? c.dif.toFixed(2) : ''}</td><td>${c.tem ? c.pct.toFixed(1) : ''}</td><td>${esc(itensTxt(n))}</td><td>${esc((n.qualidade || []).join(', '))}</td></tr>`; }).join('')}</tbody></table>`);
}
function imprimir(html) { const r = $('printRoot'); r.innerHTML = `<div class="doc">${html}</div>`; r.classList.remove('hidden'); setTimeout(() => { window.print(); r.classList.add('hidden'); }, 150); }

/* ---------- Carta ---------- */
let CARTA = null;
async function viewCartas() {
  const L = await all(CN), Cs = (await all(CC)).sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const marc = L.filter(n => selCarta.indexOf(n.id) >= 0);
  $('content').innerHTML = `<section class="view"><h2>Carta de questionamento à lavanderia</h2><p class="muted">Marque as notas em <b>Diferenças</b> (ou escolha abaixo), indique o problema e a IA aconselha e redige a carta. Revise antes de enviar.</p>
  <div class="grid"><label class="fld full">Notas incluídas<select id="cNotas" multiple size="6">${L.sort((a, b) => String(b.data).localeCompare(String(a.data))).map(n => `<option value="${esc(n.id)}"${selCarta.indexOf(n.id) >= 0 ? ' selected' : ''}>${fd(n.data)} · ${tipoSaida(n) ? 'Saída' : 'Entrada'} · nº ${esc(n.numero)} · ${calc(n).tem ? (calc(n).dif > 0 ? '+' : '') + calc(n).dif.toFixed(1) + ' kg' : 'sem pesos'}${(n.qualidade || []).length ? ' · ' + esc(n.qualidade.join(', ')) : ''}</option>`).join('')}</select></label>
  <label class="fld">Motivo<select id="cMotivo"><option>Diferença de peso</option><option>Entrega errada (peças/quantidade)</option><option>Má qualidade da lavagem</option><option>Diferença de peso e má qualidade</option></select></label>
  <label class="fld">Tom<select id="cTom"><option>Cordial e firme</option><option>Formal / contratual</option><option>Muito firme (último aviso)</option></select></label>
  <label class="fld full">Detalhes adicionais (opcional)<textarea id="cExtra" placeholder="ex.: já avisamos por telefone em 28/10; solicitamos nova pesagem; prazo de resposta de 5 dias."></textarea></label></div>
  <div class="actions"><button type="button" data-act="gerarCarta">✨ Aconselhar e criar carta</button></div>
  <div id="cartaBox">${CARTA ? htmlCarta() : ''}</div>
  <h3>Cartas salvas (${Cs.length})</h3><div class="table-wrap"><table><thead><tr><th>Data</th><th>Assunto</th><th>Ações</th></tr></thead><tbody>${Cs.map(c => `<tr><td>${fd(c.data)}</td><td>${esc(c.assunto)}</td><td style="white-space:nowrap"><button type="button" class="small" data-act="cAbrir" data-id="${esc(c.id)}">Abrir</button><button type="button" class="small secondary" data-act="cImp" data-id="${esc(c.id)}">Imprimir</button><button type="button" class="small danger" data-act="cDel" data-id="${esc(c.id)}">Excluir</button></td></tr>`).join('') || '<tr><td colspan="3">Nenhuma carta salva.</td></tr>'}</tbody></table></div></section>`;
}
function htmlCarta() {
  const c = CARTA;
  return `<div class="ia"><h4>Orientações da IA ${c.local ? '(modelo local — função de IA indisponível)' : ''}</h4>${(c.conselhos || []).length ? `<ul>${c.conselhos.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${(c.alertas || []).length ? `<p><b>Atenção:</b></p><ul>${c.alertas.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>
  <form id="cartaForm"><div class="grid"><label class="fld full">Assunto<input name="assunto" value="${esc(c.assunto)}"></label><label class="fld full">Carta<textarea name="corpo" style="min-height:300px">${esc(c.corpo)}</textarea></label></div><div class="actions"><button type="submit">Salvar carta</button><button type="submit" class="secondary" data-after="print">Salvar e imprimir</button></div></form>`;
}
function dadosCarta(marc) {
  return marc.map(n => { const c = calc(n); return { data: fd(n.data), movimento: tipoSaida(n) ? 'saída, roupa suja enviada' : 'entrada, roupa limpa recebida', nota: n.numero, peso_nota_kg: c.nota || null, peso_real_kg: c.real || null, diferenca_kg: c.tem ? +c.dif.toFixed(2) : null, diferenca_pct: c.tem ? +c.pct.toFixed(1) : null, itens_qtd: { lencol: qi(n, 'lencol'), camisola: qi(n, 'camisola'), cobertor: qi(n, 'cobertor') }, ocorrencias: n.qualidade || [], obs: n.obs || '' }; });
}
function cartaLocal(marc, motivo, tom, extra) {
  const L = dadosCarta(marc), tot = L.reduce((s, x) => s + (x.diferenca_kg || 0), 0);
  const formal = /Formal|firme \(/.test(tom) ? 'Solicitamos, com a devida urgência, ' : 'Gostaríamos de solicitar ';
  const itens = L.map(x => `• Nota nº ${x.nota || 's/n'} (${x.movimento}, ${x.data}): ${x.peso_nota_kg != null ? `peso na nota ${x.peso_nota_kg} kg; peso aferido em nossa balança ${x.peso_real_kg} kg; diferença de ${x.diferenca_kg > 0 ? '+' : ''}${x.diferenca_kg} kg (${x.diferenca_pct}%)` : 'sem pesos aferidos'}${itensTxt(marc.find(m => m.numero === x.nota) || {}) ? '; itens: ' + itensTxt(marc.find(m => m.numero === x.nota)) : ''}${x.ocorrencias.length ? '; ocorrências: ' + x.ocorrencias.join(', ') : ''}${x.obs ? '; ' + x.obs : ''}.`).join('\n');
  const corpo = `Rio de Janeiro, ${fd(hoje())}.\n\nÀ ${CFG.fornecedor || '[Lavanderia]'}\n${CFG.contrato ? 'Ref.: contrato ' + CFG.contrato + '\n' : ''}\nAssunto: Questionamento — ${motivo}\n\nPrezados,\n\nA UPA 24h Rocinha, ao conferir os serviços de lavanderia prestados, identificou as seguintes inconsistências:\n\n${itens}\n\n${/peso/i.test(motivo) && tot ? `A soma das diferenças registradas nas notas acima é de ${tot > 0 ? '+' : ''}${tot.toFixed(2)} kg entre o peso informado na nota e o peso aferido pela unidade. ` : ''}${formal}esclarecimentos formais, a conferência conjunta dos pesos e, quando cabível, a correção/ajuste dos valores faturados e a reposição ou relavagem das peças com problema, no prazo de 5 (cinco) dias úteis.\n${extra ? '\n' + extra + '\n' : ''}\nColocamo-nos à disposição para tratar do assunto e agradecemos a atenção.\n\nAtenciosamente,\n\n${CFG.coordNome}\n${CFG.coordCargo} — UPA 24h Rocinha`;
  return { local: true, assunto: `Questionamento — ${motivo}`, corpo, conselhos: ['Anexe cópias das notas e registros de pesagem (foto da balança) à carta.', 'Peça a pesagem conjunta na próxima entrega e registre com data/hora.', 'Confirme no contrato a tolerância de peso e o prazo para contestação.'], alertas: ['Revise valores, datas e cláusulas contratuais antes de enviar.'] };
}
async function gerarCarta(b) {
  const sel = Array.from($('cNotas').selectedOptions).map(o => o.value); selCarta = sel;
  const L = await all(CN), marc = L.filter(n => sel.indexOf(n.id) >= 0);
  if (!marc.length) { notice('Selecione ao menos uma nota.', true); return; }
  const motivo = $('cMotivo').value, tom = $('cTom').value, extra = $('cExtra').value.trim();
  b.disabled = true; const t0 = b.textContent; b.textContent = 'Criando…';
  try {
    const r = await UPA.client().functions.invoke('ia-assistente', { body: { tarefa: 'carta', dados: { motivo, tom, detalhes: extra, remetente: CFG.coordNome + ', ' + CFG.coordCargo + ' — UPA 24h Rocinha', fornecedor: CFG.fornecedor, contrato: CFG.contrato, itens_do_contrato: ['lençol', 'camisola', 'cobertor'], tolerancia_pct: CFG.tolerancia, notas: dadosCarta(marc) } } });
    if (r.error || !r.data || r.data.erro) { let m = r.error ? r.error.message : r.data.erro + (r.data.detalhe ? ' — ' + r.data.detalhe : ''); try { const j = r.error && r.error.context && await r.error.context.json(); if (j && j.erro) m = j.erro + (j.detalhe ? ' — ' + j.detalhe : ''); } catch (x) { /* segue */ } throw new Error(m); }
    const c = r.data.conteudo; CARTA = { assunto: c.assunto, corpo: c.corpo, conselhos: c.conselhos, alertas: c.alertas, notas: sel };
  } catch (e) { CARTA = { ...cartaLocal(marc, motivo, tom, extra), notas: sel }; notice('IA indisponível (' + (e.message || e) + ') — usei o modelo-padrão de carta. Revise e complete.', true); }
  finally { b.disabled = false; b.textContent = t0; }
  $('cartaBox').innerHTML = htmlCarta();
}
function docCarta(c) { return `<div class="logos"><img src="../../assets/logo-upa.png" alt=""></div><div style="white-space:pre-wrap;line-height:1.5;font-size:11.5pt">${esc(c.corpo)}</div>`; }

/* ---------- Config ---------- */
async function viewCfg() {
  $('content').innerHTML = `<section class="view"><h2>Configurações</h2><form id="cfgForm"><div class="grid">
  <label class="fld">Fornecedor (lavanderia)<input name="fornecedor" value="${esc(CFG.fornecedor)}"></label><label class="fld">Contrato nº<input name="contrato" value="${esc(CFG.contrato)}"></label>
  <label class="fld">Tolerância de diferença de peso (%)<input name="tolerancia" inputmode="decimal" value="${esc(CFG.tolerancia)}"></label><label class="fld">Valor por kg (R$) — para estimar cobrança a maior<input name="valorKg" inputmode="decimal" value="${esc(CFG.valorKg)}"></label>
  <label class="fld">Quem assina as cartas<input name="coordNome" value="${esc(CFG.coordNome)}"></label><label class="fld">Cargo<input name="coordCargo" value="${esc(CFG.coordCargo)}"></label></div><div class="actions"><button type="submit">Salvar</button></div></form></section>`;
}

/* ---------- ações ---------- */
const acoes = {
  async edit(d) { ed = d.id; view = 'notas'; await render(); window.scrollTo(0, 0); },
  async cancelar() { ed = null; await render(); },
  async del(d) { if (!confirm('Excluir esta nota e seus anexos?')) return; const r = (await all(CN)).find(x => x.id === d.id); if (r && (r.anexos || []).length) { try { await UPA.files.remove(r.anexos.map(a => a.path)); } catch (e) { /* segue */ } } await del(CN, d.id); notice('Nota excluída.'); await render(); },
  async ver(d) { const r = (await all(CN)).find(x => x.id === d.id), u = await UPA.files.urls((r.anexos || []).map(a => a.path)); const w = document.createElement('div'); w.className = 'box2'; w.innerHTML = '<b>Anexos:</b> ' + (r.anexos || []).map(a => `<a href="${esc(u[a.path] || '#')}" target="_blank" rel="noopener">${esc(a.nome)}</a>`).join(' · ') + ' <span class="muted">(links expiram em horas)</span>'; $('content').prepend(w); },
  async rmanexo(d) { if (!confirm('Remover este anexo?')) return; const r = (await all(CN)).find(x => x.id === ed); const a = r.anexos[+d.i]; try { await UPA.files.remove([a.path]); } catch (e) { /* segue */ } await put(CN, { ...r, anexos: r.anexos.filter((_, i) => i !== +d.i) }); await render(); },
  async subir() { await subir(); }, async importar() { await importar(); }, async modelo() { modelo(); },
  async xlsx() { await xlsxDownload(); }, async pdf() { await pdfRel(); },
  async foraSel() { const L = await all(CN); selCarta = L.filter(n => calc(n).fora && (!fil.mes || mesDe(n.data) === fil.mes)).map(n => n.id); await render(); },
  async cartaSel() { if (!selCarta.length) { notice('Marque ao menos uma nota.', true); return; } view = 'cartas'; await render(); },
  async gerarCarta(d, b) { await gerarCarta(b); },
  async cAbrir(d) { const c = (await all(CC)).find(x => x.id === d.id); CARTA = { ...c }; selCarta = c.notas || []; await render(); window.scrollTo({ top: 300, behavior: 'smooth' }); },
  async cImp(d) { const c = (await all(CC)).find(x => x.id === d.id); if (c) imprimir(docCarta(c)); },
  async cDel(d) { if (!confirm('Excluir esta carta?')) return; await del(CC, d.id); await render(); }
};
async function render() {
  nav();
  try { if (view === 'painel') await viewPainel(); else if (view === 'notas') await viewNotas(); else if (view === 'importar') await viewImportar(); else if (view === 'dif') await viewDif(); else if (view === 'cartas') await viewCartas(); else await viewCfg(); }
  catch (e) { notice(UPA.msg(e), true); }
}
function ligar() {
  $('nav').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; view = b.dataset.v; ed = null; notice(''); render(); });
  const c = $('content'); let depois = null;
  c.addEventListener('click', async e => { const s = e.target.closest('button[type=submit]'); depois = s ? s.dataset.after || null : null; const b = e.target.closest('[data-act]'); if (!b) return; try { await acoes[b.dataset.act](b.dataset, b, e); } catch (err) { notice(UPA.msg(err), true); } });
  c.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'fMes') { fil.mes = t.value; await render(); } else if (t.id === 'fTipo') { fil.tipo = t.value; await render(); }
    else if (t.dataset && t.dataset.sel) { const i = selCarta.indexOf(t.dataset.sel); if (t.checked && i < 0) selCarta.push(t.dataset.sel); if (!t.checked && i >= 0) selCarta.splice(i, 1); }
  });
  c.addEventListener('input', e => { if (e.target.id === 'busca') { fil.q = e.target.value; clearTimeout(ligar.t); ligar.t = setTimeout(async () => { const p = e.target.selectionStart; await render(); const n = $('busca'); if (n) { n.focus(); n.setSelectionRange(p, p); } }, 300); } });
  c.addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target;
    try {
      if (f.id === 'ef') await salvarNota(f);
      else if (f.id === 'cfgForm') { const g = new FormData(f); CFG = { ...CFG, id: CFG_ID }; ['fornecedor', 'contrato', 'coordNome', 'coordCargo'].forEach(k => { CFG[k] = String(g.get(k) || '').trim(); }); CFG.tolerancia = num(g.get('tolerancia')); CFG.valorKg = num(g.get('valorKg')); await put(CG, CFG); notice('Configurações salvas.'); }
      else if (f.id === 'cartaForm') { const g = new FormData(f); const d = await put(CC, { ...CARTA, id: undefined, data: hoje(), assunto: g.get('assunto'), corpo: g.get('corpo') }); notice('Carta salva.'); if (depois === 'print') imprimir(docCarta(d)); await render(); }
    } catch (err) { notice(UPA.msg(err), true); }
  });
}
(async function () { try { await UPA.ready(); } catch (e) { notice(UPA.msg(e), true); return; } ligar(); try { await carregarCfg(); } catch (e) { /* usa padrão */ } await render(); })();
