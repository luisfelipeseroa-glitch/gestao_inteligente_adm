'use strict';
/* PGRSS — Gestão de Resíduos de Serviços de Saúde (UPA Rocinha)
   Dados na tabela "registros" do banco único (coleções pgrss_*), mesmo login do portal. */
const $ = id => document.getElementById(id);
const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = s => esc(s).replace(/\n/g, '<br>');
const uuid = () => crypto.randomUUID();
const hoje = () => new Date().toLocaleDateString('en-CA');
const mesDe = d => String(d || '').slice(0, 7);
const mesAtual = () => hoje().slice(0, 7);
const fd = d => { if (!d) return ''; const p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(d); };
const fm = m => { const p = String(m || '').split('-'); return p.length === 2 ? p[1] + '/' + p[0] : String(m || ''); };
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
const kg = n => num(n).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = n => (isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const addMeses = (m, n) => { const p = m.split('-').map(Number); const d = new Date(p[0], p[1] - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const diasAte = d => d ? Math.round((new Date(d + 'T00:00:00') - new Date(hoje() + 'T00:00:00')) / 86400000) : null;
const desdeDias = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
const agora = () => new Date().toLocaleString('pt-BR');
const meuEmail = () => { const u = window.UPA && UPA.user(); return (u && u.email) || ''; };
function notice(t, erro) { const m = $('message'); m.textContent = t || ''; m.className = erro ? 'err' : ''; if (t) m.scrollIntoView({ block: 'nearest' }); }

/* ---------------- dados ---------------- */
const COL = { plano: 'pgrss_plano', setores: 'pgrss_setores', empresas: 'pgrss_empresas', pesagens: 'pgrss_pesagens', coletas: 'pgrss_coletas', treinos: 'pgrss_treinamentos', ocorr: 'pgrss_ocorrencias', inspec: 'pgrss_inspecoes', meses: 'pgrss_meses' };
const PLANO_ID = 'pgrss-plano';
let cache = {};
async function all(k) {
  if (cache[k]) return cache[k];
  const rows = await UPA.db.list(COL[k]);
  return (cache[k] = rows.map(r => ({ ...r.dados, id: r.id })));
}
async function put(k, o) {
  const d = { ...o };
  d.id = d.id || uuid();
  d.atualizadoEm = new Date().toISOString();
  d.atualizadoPor = meuEmail();
  if (!d.criadoEm) { d.criadoEm = d.atualizadoEm; d.criadoPor = d.atualizadoPor; }
  await UPA.db.put(COL[k], d.id, d);
  delete cache[k];
  return d;
}
async function del(k, id) { await UPA.db.del(id); delete cache[k]; }
async function loadAll() {
  const ks = Object.keys(COL), v = await Promise.all(ks.map(all)), D = {};
  ks.forEach((k, i) => { D[k] = v[i]; });
  D.plano = D.plano.find(p => p.id === PLANO_ID) || null;
  return D;
}
const planoPadrao = () => ({ id: PLANO_ID, unidade: 'UPA Rocinha', tipo: 'Unidade de Pronto Atendimento (UPA 24 h)', endereco: 'Estrada da Gávea, 522 - Rocinha - Rio de Janeiro/RJ - CEP 22.451-265', tel: '(21) 3613-8280', email: 'gerencia.uparocinha@gmail.com', horario: '24 horas, todos os dias', versao: '1' });
const txt = (P, k) => (P && P.textos && P.textos[k] != null) ? P.textos[k] : PGRSS_DEF[k];

/* ---------------- definição das telas de cadastro ---------------- */
const GR = ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D – comum', 'D – reciclável', 'E'];
const GRUPOS_PES = [['kgA', 'Grupo A'], ['kgB', 'Grupo B'], ['kgD', 'Grupo D comum'], ['kgR', 'Grupo D reciclável'], ['kgE', 'Grupo E']];
const totPes = r => GRUPOS_PES.reduce((s, g) => s + num(r[g[0]]), 0);
const grupoDeColeta = g => /^A/.test(g) ? 'kgA' : g === 'B' ? 'kgB' : g === 'E' ? 'kgE' : /recicl/i.test(g) ? 'kgR' : /^D/.test(g) ? 'kgD' : null;
function valBadge(d) {
  if (!d) return '<span class="muted">—</span>';
  const n = diasAte(d);
  if (n < 0) return `<span class="pill bad">Vencida em ${fd(d)}</span>`;
  if (n <= 60) return `<span class="pill warn">Vence em ${n} d (${fd(d)})</span>`;
  return `<span class="pill ok">Até ${fd(d)}</span>`;
}
const confInsp = r => { const it = r.itens || []; const c = it.filter(x => x === 'C').length, nc = it.filter(x => x === 'NC').length; return { c, nc, p: (c + nc) ? c / (c + nc) * 100 : null }; };

const ENT = {
  setores: {
    t: 'Setores e inventário de resíduos', ord: (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'),
    help: 'Cadastre cada setor gerador, os grupos de resíduos que ele produz e como são acondicionados. Esta lista vira o diagnóstico (inventário) do PGRSS impresso. Não inclua dados de pacientes.',
    f: [
      { k: 'nome', l: 'Setor', req: 1 }, { k: 'resp', l: 'Responsável pelo setor' },
      { k: 'grupos', l: 'Grupos de resíduos gerados', t: 'multi', o: GR },
      { k: 'exemplos', l: 'Principais resíduos gerados', t: 'textarea', full: 1 },
      { k: 'acond', l: 'Acondicionamento (recipientes e sacos)', t: 'textarea', full: 1 },
      { k: 'freq', l: 'Frequência da coleta interna', t: 'select', o: ['A cada turno', '3 vezes ao dia', '2 vezes ao dia', '1 vez ao dia', 'Sob demanda'] },
      { k: 'qtd', l: 'Estimativa de geração (kg/dia)', t: 'number' }],
    cols: [['Setor', r => `<b>${esc(r.nome)}</b>${r.resp ? '<br><small>' + esc(r.resp) + '</small>' : ''}`], ['Grupos', r => esc((r.grupos || []).join(', '))], ['Resíduos / acondicionamento', r => esc(r.exemplos) + (r.acond ? '<br><small>' + esc(r.acond) + '</small>' : '')], ['Coleta interna', r => esc(r.freq)], ['kg/dia', r => r.qtd ? kg(r.qtd) : '']],
    extra: '<button type="button" class="secondary" data-act="seed">Carregar setores padrão da UPA</button>'
  },
  empresas: {
    t: 'Empresas contratadas e licenças', anexos: 1,
    help: 'Empresas de coleta, transporte, tratamento e destinação final. Anexe aqui a cópia (PDF/foto) da licença ambiental, do alvará e do contrato; o sistema avisa quando algo estiver perto de vencer.',
    f: [
      { k: 'nome', l: 'Empresa', req: 1 }, { k: 'cnpj', l: 'CNPJ' },
      { k: 'servico', l: 'Serviço prestado', t: 'select', o: ['Coleta e transporte externos', 'Tratamento', 'Disposição final (aterro sanitário)', 'Coleta, transporte, tratamento e destinação', 'Reciclagem / logística reversa'] },
      { k: 'grupos', l: 'Grupos atendidos', t: 'multi', o: ['A', 'B', 'C', 'D', 'E'] },
      { k: 'licenca', l: 'Licença ambiental (nº)' }, { k: 'licOrgao', l: 'Órgão emissor da licença' }, { k: 'licVal', l: 'Validade da licença ambiental', t: 'date' },
      { k: 'alvara', l: 'Alvará / licença sanitária (nº)' }, { k: 'alvVal', l: 'Validade do alvará', t: 'date' },
      { k: 'contrato', l: 'Contrato / processo (nº)' }, { k: 'contratoVal', l: 'Vigência do contrato até', t: 'date' },
      { k: 'contato', l: 'Contato (nome e telefone)' }],
    cols: [['Empresa', r => `<b>${esc(r.nome)}</b><br><small>${esc(r.cnpj)}</small>`], ['Serviço', r => esc(r.servico) + '<br><small>Grupos: ' + esc((r.grupos || []).join(', ')) + '</small>'], ['Licença ambiental', r => esc(r.licenca) + '<br>' + valBadge(r.licVal)], ['Alvará', r => esc(r.alvara) + '<br>' + valBadge(r.alvVal)], ['Contrato', r => esc(r.contrato) + '<br>' + valBadge(r.contratoVal)]]
  },
  pesagens: {
    t: 'Pesagem diária de resíduos', mesPadrao: 1,
    help: 'Lance a pesagem por setor (ou "Geral / abrigo externo" para o total do dia). Preencha só os grupos pesados, em kg.',
    f: [
      { k: 'data', l: 'Data', t: 'date', req: 1 }, { k: 'setor', l: 'Setor', t: 'setor' },
      { k: 'kgA', l: 'Grupo A (kg)', t: 'number' }, { k: 'kgB', l: 'Grupo B (kg)', t: 'number' }, { k: 'kgD', l: 'Grupo D comum (kg)', t: 'number' }, { k: 'kgR', l: 'Grupo D reciclável (kg)', t: 'number' }, { k: 'kgE', l: 'Grupo E (kg)', t: 'number' },
      { k: 'resp', l: 'Responsável pela pesagem' }, { k: 'obs', l: 'Observações', t: 'textarea', full: 1 }],
    cols: [['Data', r => fd(r.data)], ['Setor', r => esc(r.setor)], ['A', r => kg(r.kgA)], ['B', r => kg(r.kgB)], ['D comum', r => kg(r.kgD)], ['D recicl.', r => kg(r.kgR)], ['E', r => kg(r.kgE)], ['Total (kg)', r => '<b>' + kg(totPes(r)) + '</b>'], ['Responsável', r => esc(r.resp)]],
    rodape: l => `Total do filtro: <b>${kg(l.reduce((s, r) => s + totPes(r), 0))} kg</b> em ${l.length} lançamento(s).`
  },
  coletas: {
    t: 'Coletas e manifestos (MTR / CDF)', anexos: 1,
    help: 'Registre cada coleta externa: manifesto (MTR), peso, destino e certificado de destinação final (CDF). Anexe a cópia do MTR/CDF.',
    f: [
      { k: 'data', l: 'Data da coleta', t: 'date', req: 1 }, { k: 'empresa', l: 'Empresa coletora', t: 'empresa' },
      { k: 'mtr', l: 'Nº do MTR / manifesto' }, { k: 'grupo', l: 'Grupo de resíduo', t: 'select', o: ['A', 'B', 'C', 'D – comum', 'D – reciclável', 'E'] },
      { k: 'kg', l: 'Peso coletado (kg)', t: 'number' }, { k: 'placa', l: 'Placa do veículo' }, { k: 'motorista', l: 'Motorista' },
      { k: 'destino', l: 'Tratamento / destino final' }, { k: 'cdf', l: 'Nº do CDF (certificado de destinação)' }, { k: 'cdfData', l: 'Data do CDF', t: 'date' },
      { k: 'obs', l: 'Observações', t: 'textarea', full: 1 }],
    cols: [['Data', r => fd(r.data)], ['Empresa', r => esc(r.empresa)], ['MTR', r => esc(r.mtr)], ['Grupo', r => esc(r.grupo)], ['kg', r => kg(r.kg)], ['Destino', r => esc(r.destino)], ['CDF', r => r.cdf ? esc(r.cdf) + (r.cdfData ? '<br><small>' + fd(r.cdfData) + '</small>' : '') : '<span class="pill warn">Pendente</span>']],
    extra: '<button type="button" class="secondary" data-act="impMtr">Importar relatório de MTR (CSV)</button><input type="file" id="fileMtr" class="hidden">',
    rodape: l => `Total do filtro: <b>${kg(l.reduce((s, r) => s + num(r.kg), 0))} kg</b> em ${l.length} coleta(s).`
  },
  treinos: {
    t: 'Treinamentos e capacitações', anexos: 1,
    help: 'Registre cada capacitação da equipe. Anexe a lista de presença assinada (foto/PDF). A lista de participantes digitada aparece no anexo do documento impresso.',
    f: [
      { k: 'data', l: 'Data', t: 'date', req: 1 }, { k: 'tema', l: 'Tema', req: 1 }, { k: 'ch', l: 'Carga horária (h)', t: 'number' }, { k: 'instrutor', l: 'Instrutor / responsável' },
      { k: 'publico', l: 'Público-alvo / setores' }, { k: 'nPart', l: 'Nº de participantes', t: 'number' },
      { k: 'conteudo', l: 'Conteúdo abordado', t: 'textarea', full: 1 }, { k: 'lista', l: 'Participantes (nome e matrícula, um por linha)', t: 'textarea', full: 1 }],
    cols: [['Data', r => fd(r.data)], ['Tema', r => '<b>' + esc(r.tema) + '</b><br><small>' + esc(r.publico) + '</small>'], ['CH', r => r.ch ? kg(r.ch).replace(',0', '') + ' h' : ''], ['Instrutor', r => esc(r.instrutor)], ['Participantes', r => esc(r.nPart || (r.lista ? r.lista.split('\n').filter(Boolean).length : ''))]]
  },
  ocorr: {
    t: 'Ocorrências e acidentes', anexos: 1,
    help: 'Acidentes, derramamentos, falhas de coleta e não conformidades. Não registre nomes ou dados de pacientes.',
    f: [
      { k: 'data', l: 'Data', t: 'date', req: 1 }, { k: 'hora', l: 'Hora', t: 'time' },
      { k: 'tipo', l: 'Tipo', t: 'select', o: ['Acidente com perfurocortante', 'Exposição a material biológico', 'Derramamento / vazamento', 'Falha ou atraso na coleta externa', 'Segregação inadequada', 'Armazenamento inadequado', 'Outro'] },
      { k: 'setor', l: 'Setor', t: 'setor' }, { k: 'desc', l: 'Descrição', t: 'textarea', full: 1, req: 1 }, { k: 'acao', l: 'Ação imediata / corretiva', t: 'textarea', full: 1 },
      { k: 'resp', l: 'Responsável pelo acompanhamento' }, { k: 'status', l: 'Situação', t: 'select', o: ['Aberta', 'Em acompanhamento', 'Concluída'] }],
    cols: [['Data', r => fd(r.data) + (r.hora ? '<br><small>' + esc(r.hora) + '</small>' : '')], ['Tipo / setor', r => '<b>' + esc(r.tipo) + '</b><br><small>' + esc(r.setor) + '</small>'], ['Descrição', r => esc(r.desc)], ['Ação', r => esc(r.acao)], ['Situação', r => `<span class="pill ${r.status === 'Concluída' ? 'ok' : 'warn'}">${esc(r.status || 'Aberta')}</span>`]]
  },
  inspec: {
    t: 'Inspeções de segregação e acondicionamento',
    help: 'Ronda periódica nos setores. Marque cada item como Conforme (C), Não conforme (NC) ou Não se aplica (NA).',
    f: [
      { k: 'data', l: 'Data', t: 'date', req: 1 }, { k: 'setor', l: 'Setor inspecionado', t: 'setor' }, { k: 'inspetor', l: 'Inspetor / responsável' },
      { k: 'itens', l: 'Itens verificados', t: 'check', itens: PGRSS_INSP },
      { k: 'obs', l: 'Não conformidades e providências', t: 'textarea', full: 1 }],
    cols: [['Data', r => fd(r.data)], ['Setor', r => esc(r.setor)], ['Inspetor', r => esc(r.inspetor)], ['Conformidade', r => { const c = confInsp(r); return c.p == null ? '—' : `<span class="pill ${c.p >= 90 ? 'ok' : c.p >= 70 ? 'warn' : 'bad'}">${pct(c.p)}</span> <small>(${c.c} C / ${c.nc} NC)</small>`; }], ['Observações', r => esc(r.obs)]]
  }
};
const ed = {}, pend = {}, flt = { pesagens: mesAtual() };
let view = 'painel', selMes = mesAtual();
const VIEWS = [['painel', 'Painel'], ['plano', 'Plano e responsáveis'], ['setores', 'Setores / inventário'], ['empresas', 'Empresas e licenças'], ['pesagens', 'Pesagem diária'], ['coletas', 'Coletas e manifestos'], ['treinos', 'Treinamentos'], ['ocorr', 'Ocorrências'], ['inspec', 'Inspeções'], ['imprimir', 'Imprimir documentos']];

/* ---------------- formulários genéricos ---------------- */
function opcoes(f, ctx) {
  if (f.t === 'setor') return ctx.setores;
  if (f.t === 'empresa') return ctx.empresas;
  return f.o || [];
}
function campo(f, v, ctx) {
  const nm = ` name="${f.k}"${f.req ? ' required' : ''}`;
  const cls = 'fld' + (f.full ? ' full' : '');
  if (f.t === 'multi') return `<fieldset class="${cls} full"><legend>${esc(f.l)}</legend><div class="chk">${f.o.map(o => `<label class="c"><input type="checkbox" name="${f.k}" value="${esc(o)}"${(v || []).indexOf(o) >= 0 ? ' checked' : ''}>${esc(o)}</label>`).join('')}</div></fieldset>`;
  if (f.t === 'check') return `<fieldset class="fld full"><legend>${esc(f.l)}</legend>${f.itens.map((it, i) => { const cur = (v || [])[i] || ''; return `<div class="ck"><span>${i + 1}. ${esc(it)}</span><span class="opt">${[['C', 'C'], ['NC', 'NC'], ['NA', 'NA']].map(o => `<label><input type="radio" name="${f.k}_${i}" value="${o[0]}"${cur === o[0] ? ' checked' : ''}>${o[1]}</label>`).join('')}</span></div>`; }).join('')}</fieldset>`;
  if (f.t === 'textarea') return `<label class="${cls}">${esc(f.l)}<textarea${nm}>${esc(v)}</textarea></label>`;
  if (f.t === 'select' || f.t === 'setor' || f.t === 'empresa') {
    const os = opcoes(f, ctx).slice(); if (v && os.indexOf(v) < 0) os.push(v);
    return `<label class="${cls}">${esc(f.l)}<select${nm}><option value=""></option>${os.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  }
  if (f.t === 'number') return `<label class="${cls}">${esc(f.l)}<input type="number" step="0.1" min="0"${nm} value="${esc(v)}"></label>`;
  return `<label class="${cls}">${esc(f.l)}<input type="${f.t || 'text'}"${nm} value="${esc(v)}"></label>`;
}
function lerCampos(form, fields, base) {
  const o = { ...base };
  fields.forEach(f => {
    if (f.t === 'multi') o[f.k] = Array.from(form.querySelectorAll(`input[name="${f.k}"]:checked`)).map(x => x.value);
    else if (f.t === 'check') o[f.k] = f.itens.map((_, i) => { const r = form.querySelector(`input[name="${f.k}_${i}"]:checked`); return r ? r.value : ''; });
    else o[f.k] = String(form.elements[f.k].value || '').trim();
  });
  return o;
}
const ctxDe = D => ({ setores: D.setores.map(s => s.nome).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR')).concat(['Geral / abrigo externo']), empresas: D.empresas.map(e => e.nome).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR')) });

async function viewEntity(k) {
  const E = ENT[k], D = await loadAll(), ctx = ctxDe(D), cur = ed[k] ? D[k].find(r => r.id === ed[k]) : null;
  const temData = E.f.some(f => f.k === 'data');
  if (!(k in flt)) flt[k] = '';
  let lista = D[k].slice();
  if (temData && flt[k]) lista = lista.filter(r => mesDe(r.data) === flt[k]);
  lista.sort(E.ord || ((a, b) => String(b.data || '').localeCompare(String(a.data || '')) || String(b.criadoEm || '').localeCompare(String(a.criadoEm || ''))));
  const campos = E.f.map(f => campo(f, cur ? cur[f.k] : (f.k === 'data' ? hoje() : ''), ctx)).join('');
  const anex = E.anexos ? `<label class="fld full">Anexar arquivos (fotos ou PDF, até 12 MB cada)<input type="file" id="anexos" accept="image/*,.pdf" multiple></label>` + (cur && (cur.anexos || []).length ? `<div class="fld full">Arquivos já anexados: ${(cur.anexos).map((a, i) => `<span class="pill">${esc(a.nome)} <button type="button" class="danger small" data-act="rmanexo" data-i="${i}" title="Remover">×</button></span>`).join(' ')}</div>` : '') : '';
  const filtro = temData ? `<div class="filtro"><label>Mês<input type="month" id="flt" value="${esc(flt[k])}"></label><button type="button" class="secondary small" data-act="fltLimpar">Mostrar tudo</button></div>` : '';
  const linhas = lista.map(r => `<tr>${E.cols.map(c => `<td>${c[1](r)}</td>`).join('')}<td style="white-space:nowrap"><button type="button" class="small" data-act="edit" data-id="${esc(r.id)}">Editar</button>${E.anexos ? `<button type="button" class="small secondary" data-act="anexos" data-id="${esc(r.id)}">Anexos (${(r.anexos || []).length})</button>` : ''}<button type="button" class="small danger" data-act="del" data-id="${esc(r.id)}">Excluir</button></td></tr>`).join('');
  $('content').innerHTML = `<section class="view"><h2>${esc(E.t)}</h2><p class="muted">${esc(E.help)}</p>
  <form id="ef" data-k="${k}"><div class="grid">${campos}${anex}</div><div class="actions"><button type="submit">${cur ? 'Salvar alterações' : 'Salvar registro'}</button>${cur ? '<button type="button" class="secondary" data-act="cancelar">Cancelar edição</button>' : ''}${E.extra || ''}</div></form>
  <h3>Registros (${lista.length})</h3>${filtro}<div class="table-wrap"><table><thead><tr>${E.cols.map(c => `<th>${c[0]}</th>`).join('')}<th>Ações</th></tr></thead><tbody>${linhas || `<tr><td colspan="${E.cols.length + 1}">Nenhum registro${flt[k] ? ' neste mês' : ''}.</td></tr>`}</tbody></table></div>${E.rodape ? `<p>${E.rodape(lista)}</p>` : ''}</section>`;
}
async function salvarEntidade(form) {
  const k = form.dataset.k, E = ENT[k], D = await loadAll();
  const cur = ed[k] ? D[k].find(r => r.id === ed[k]) : null;
  const o = lerCampos(form, E.f, cur || {});
  if (k === 'coletas' && o.kg === '' && !confirm('Peso em branco. Salvar mesmo assim?')) return;
  const files = Array.from(($('anexos') || { files: [] }).files || []);
  for (const f of files) if (f.size > 12 * 1024 * 1024) { notice('Arquivo acima de 12 MB: ' + f.name, true); return; }
  let d = await put(k, o);
  if (files.length) {
    const lista = (d.anexos || []).slice();
    for (const f of files) {
      const path = `pgrss/${k}/${d.id}/${uuid().slice(0, 8)}-${f.name.replace(/[^\w.\-]+/g, '_')}`;
      await UPA.files.upload(path, f, f.type);
      lista.push({ path, nome: f.name, tipo: f.type, tam: f.size });
    }
    d = await put(k, { ...d, anexos: lista });
  }
  ed[k] = null;
  notice(cur ? 'Registro atualizado.' : 'Registro salvo no banco. Já aparece em todos os aparelhos.');
  await render();
}

/* ---------------- Painel ---------------- */
function somaMes(pes, m) {
  const s = { kgA: 0, kgB: 0, kgD: 0, kgR: 0, kgE: 0, total: 0 };
  pes.filter(r => mesDe(r.data) === m).forEach(r => { GRUPOS_PES.forEach(g => { s[g[0]] += num(r[g[0]]); }); });
  s.total = s.kgA + s.kgB + s.kgD + s.kgR + s.kgE; return s;
}
const atendDoMes = (D, m) => { const x = D.meses.find(r => r.mes === m); return x && x.atend ? num(x.atend) : (D.plano && D.plano.atendMes ? num(D.plano.atendMes) : 0); };
function barras(itens, max) { max = max || Math.max.apply(null, itens.map(i => i[1]).concat([1])); return itens.map(i => `<div class="barrow"><span>${esc(i[0])}</span><div class="bar"><i style="width:${Math.max(0, i[1] / max * 100)}%"></i></div><b>${kg(i[1])} kg</b></div>`).join(''); }
function alertas(D) {
  const L = [], P = D.plano || {};
  const venc = (rot, d) => { if (!d) return; const n = diasAte(d); if (n < 0) L.push(['bad', `${rot} vencida em ${fd(d)}.`, 'empresas']); else if (n <= 60) L.push(['warn', `${rot} vence em ${n} dia(s) (${fd(d)}).`, 'empresas']); };
  D.empresas.forEach(e => { venc(`Licença ambiental de ${e.nome}`, e.licVal); venc(`Alvará de ${e.nome}`, e.alvVal); venc(`Contrato com ${e.nome}`, e.contratoVal); });
  if (P.alvaraVal) { const n = diasAte(P.alvaraVal); if (n < 0) L.push(['bad', `Alvará sanitário da unidade vencido em ${fd(P.alvaraVal)}.`, 'plano']); else if (n <= 60) L.push(['warn', `Alvará sanitário da unidade vence em ${n} dia(s).`, 'plano']); }
  if (P.vigAte) { const n = diasAte(P.vigAte); if (n < 0) L.push(['bad', `Vigência do PGRSS terminou em ${fd(P.vigAte)}. Revise e emita nova versão.`, 'plano']); else if (n <= 60) L.push(['warn', `Vigência do PGRSS termina em ${n} dia(s).`, 'plano']); }
  const ab = D.ocorr.filter(o => o.status !== 'Concluída').length; if (ab) L.push(['warn', `${ab} ocorrência(s) em aberto.`, 'ocorr']);
  const ult = D.pesagens.map(r => r.data).filter(Boolean).sort().pop();
  if (!ult) L.push(['warn', 'Nenhuma pesagem lançada ainda.', 'pesagens']); else if (ult < desdeDias(3)) L.push(['warn', `Última pesagem lançada em ${fd(ult)}.`, 'pesagens']);
  const semCdf = D.coletas.filter(c => c.data < desdeDias(30) && !c.cdf).length; if (semCdf) L.push(['warn', `${semCdf} coleta(s) com mais de 30 dias sem certificado de destinação (CDF).`, 'coletas']);
  return L;
}
function prontidao(D) {
  const P = D.plano || {}, E = D.empresas;
  const ok12 = D.treinos.some(t => t.data >= desdeDias(365));
  const lic = E.length > 0 && E.every(e => e.licVal && diasAte(e.licVal) >= 0);
  return [
    ['Identificação da unidade preenchida (nome, CNPJ, endereço e alvará)', !!(P.unidade && P.cnpj && P.endereco && P.alvara), 'plano'],
    ['Responsável técnico com registro profissional e ART/TRT informados', !!(P.rtNome && P.rtRegistro && P.rtArt), 'plano'],
    ['Responsável pela direção da unidade informado', !!P.dirNome, 'plano'],
    ['Textos do plano revisados e confirmados pelo responsável técnico', !!P.revisado, 'plano'],
    ['Plano dentro da vigência', !!(P.vigAte && diasAte(P.vigAte) >= 0), 'plano'],
    ['Inventário de resíduos por setor cadastrado', D.setores.length > 0, 'setores'],
    ['Empresa de coleta/transporte e empresa de tratamento/destinação cadastradas', E.some(e => /coleta|transporte/i.test(e.servico || '')) && E.some(e => /destina|disposi|tratamento/i.test(e.servico || '')), 'empresas'],
    ['Licenças ambientais das empresas informadas e dentro da validade', lic, 'empresas'],
    ['Pesagens lançadas nos últimos 30 dias', D.pesagens.some(r => r.data >= desdeDias(30)), 'pesagens'],
    ['Coletas dos últimos 90 dias com MTR e CDF registrados', (() => { const c = D.coletas.filter(r => r.data >= desdeDias(90)); return c.length > 0 && c.every(r => r.mtr && r.cdf); })(), 'coletas'],
    ['Treinamento realizado nos últimos 12 meses', ok12, 'treinos'],
    ['Inspeção de segregação realizada nos últimos 30 dias', D.inspec.some(r => r.data >= desdeDias(30)), 'inspec']
  ];
}
async function viewPainel() {
  const D = await loadAll(), s = somaMes(D.pesagens, selMes), atend = atendDoMes(D, selMes);
  const colMes = D.coletas.filter(c => mesDe(c.data) === selMes).reduce((t, c) => t + num(c.kg), 0);
  const al = alertas(D), pr = prontidao(D), nok = pr.filter(x => x[1]).length;
  const insp = D.inspec.filter(r => mesDe(r.data) === selMes).map(confInsp).filter(c => c.p != null);
  const mInsp = insp.length ? insp.reduce((t, c) => t + c.p, 0) / insp.length : null;
  const tr12 = D.treinos.filter(t => t.data >= desdeDias(365));
  const meses6 = [0, 1, 2, 3, 4, 5].map(i => addMeses(selMes, i - 5));
  $('content').innerHTML = `<section class="view"><div class="row-end"><h2>Painel do PGRSS</h2><div class="filtro"><label>Mês de referência<input type="month" id="selMes" value="${selMes}"></label><label>Atendimentos no mês<input type="number" min="0" id="atend" value="${esc(atend || '')}" style="width:130px"></label><button type="button" class="secondary small" data-act="salvarAtend">Salvar</button></div></div>
  <div class="stats">
   <div class="stat">Resíduos gerados no mês<strong>${kg(s.total)} kg</strong></div>
   <div class="stat">Coletado no mês<strong>${kg(colMes)} kg</strong></div>
   <div class="stat">Grupo A / total<strong>${s.total ? pct(s.kgA / s.total * 100) : '—'}</strong></div>
   <div class="stat">kg por atendimento<strong>${atend && s.total ? (s.total / atend).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '—'}</strong></div>
   <div class="stat ${D.ocorr.some(o => o.status !== 'Concluída') ? 'warn' : 'ok'}">Ocorrências em aberto<strong>${D.ocorr.filter(o => o.status !== 'Concluída').length}</strong></div>
   <div class="stat">Treinamentos (12 meses)<strong>${tr12.length}</strong>${tr12.reduce((t, x) => t + num(x.ch), 0)} h</div>
   <div class="stat">Conformidade das inspeções<strong>${mInsp == null ? '—' : pct(mInsp)}</strong></div>
  </div>
  <div class="two"><div><h3>Geração por grupo em ${fm(selMes)}</h3>${barras(GRUPOS_PES.map(g => [g[1], s[g[0]]]))}</div><div><h3>Total mensal (últimos 6 meses)</h3>${barras(meses6.map(m => [fm(m), somaMes(D.pesagens, m).total]))}</div></div>
  <div class="two"><div><h3>Alertas</h3>${al.length ? al.map(a => `<div class="alert ${a[0]}"><b>${a[0] === 'bad' ? '⛔' : '⚠'}</b><span>${esc(a[1])} <a href="#" data-act="go" data-v="${a[2]}">abrir</a></span></div>`).join('') : '<div class="alert ok"><b>✔</b><span>Nenhum alerta no momento.</span></div>'}</div>
  <div><h3>Pronto para fiscalização? (${nok}/${pr.length})</h3>${pr.map(x => `<div class="alert ${x[1] ? 'ok' : 'warn'}"><b>${x[1] ? '✔' : '○'}</b><span>${esc(x[0])}${x[1] ? '' : ` <a href="#" data-act="go" data-v="${x[2]}">preencher</a>`}</span></div>`).join('')}</div></div></section>`;
}

/* ---------------- Plano ---------------- */
const PL = [
  ['Identificação do estabelecimento', [
    { k: 'unidade', l: 'Nome da unidade', req: 1 }, { k: 'tipo', l: 'Tipo de estabelecimento' }, { k: 'mantenedora', l: 'Razão social / mantenedora / organização gestora' },
    { k: 'cnpj', l: 'CNPJ' }, { k: 'cnes', l: 'CNES' }, { k: 'endereco', l: 'Endereço completo', full: 1 }, { k: 'tel', l: 'Telefone' }, { k: 'email', l: 'E-mail' },
    { k: 'alvara', l: 'Alvará / licença sanitária (nº)' }, { k: 'alvaraVal', l: 'Validade do alvará', t: 'date' }, { k: 'horario', l: 'Horário de funcionamento' },
    { k: 'leitos', l: 'Nº de leitos (observação / emergência)', t: 'number' }, { k: 'atendMes', l: 'Média de atendimentos por mês', t: 'number' }, { k: 'func', l: 'Nº de profissionais', t: 'number' }]],
  ['Responsáveis', [
    { k: 'rtNome', l: 'Responsável técnico (RT) pelo PGRSS' }, { k: 'rtProf', l: 'Profissão / formação' }, { k: 'rtConselho', l: 'Conselho profissional (ex.: COREN, CRM, CRF, CREA)' },
    { k: 'rtRegistro', l: 'Nº do registro no conselho' }, { k: 'rtArt', l: 'Nº da ART / TRT / CRT do RT' }, { k: 'rtContato', l: 'Contato do RT (telefone / e-mail)' },
    { k: 'dirNome', l: 'Responsável pela direção da unidade' }, { k: 'dirCargo', l: 'Cargo' }, { k: 'coordNome', l: 'Coordenador interno do PGRSS' }, { k: 'coordCargo', l: 'Cargo do coordenador' }]],
  ['Controle do documento', [
    { k: 'versao', l: 'Versão / revisão nº' }, { k: 'dataElab', l: 'Data de elaboração', t: 'date' }, { k: 'vigAte', l: 'Vigência até', t: 'date' }, { k: 'proxRev', l: 'Próxima revisão prevista', t: 'date' },
    { k: 'historico', l: 'Histórico de revisões', t: 'textarea', full: 1 }, { k: 'legalLocal', l: 'Legislação estadual / municipal complementar aplicável', t: 'textarea', full: 1 }]]
];
async function viewPlano() {
  const D = await loadAll(), P = D.plano || planoPadrao();
  $('content').innerHTML = `<section class="view"><h2>Plano e responsáveis</h2><p class="muted">Dados que compõem a capa, a identificação, as responsabilidades e as assinaturas do PGRSS impresso. Os textos-padrão seguem a RDC ANVISA nº 222/2018; o responsável técnico deve revisar e adequar à realidade da unidade antes de imprimir.</p>
  <form id="pf">${PL.map(s => `<div class="sec-title">${esc(s[0])}</div><div class="grid">${s[1].map(f => campo(f, P[f.k], {})).join('')}</div>`).join('')}
  <div class="sec-title">Textos do plano (editáveis)</div>
  ${PGRSS_TXT.map(t => `<label class="fld full"><span class="row-end"><span>${esc(t[1])}</span><button type="button" class="secondary small" data-act="restaurar" data-k="${t[0]}">Restaurar texto padrão</button></span><textarea class="big" name="txt_${t[0]}">${esc(txt(P, t[0]))}</textarea></label>`).join('')}
  <div class="sec-title">Revisão pelo responsável técnico</div>
  <div class="grid"><div class="fld"><div class="chk"><label class="c"><input type="checkbox" name="revisado"${P.revisado ? ' checked' : ''}> Declaro que os textos acima foram revisados e estão adequados à unidade</label></div></div><label class="fld">Data da revisão<input type="date" name="revisadoEm" value="${esc(P.revisadoEm || '')}"></label></div>
  <div class="actions"><button type="submit">Salvar plano</button></div></form></section>`;
}
async function salvarPlano(form) {
  const D = await loadAll(), base = D.plano || planoPadrao(), fields = [];
  PL.forEach(s => s[1].forEach(f => fields.push(f)));
  const o = lerCampos(form, fields, base);
  o.id = PLANO_ID; o.textos = {};
  PGRSS_TXT.forEach(t => { o.textos[t[0]] = form.elements['txt_' + t[0]].value; });
  o.revisado = form.elements.revisado.checked; o.revisadoEm = form.elements.revisadoEm.value;
  if (o.revisado && !o.revisadoEm) o.revisadoEm = hoje();
  await put('plano', o);
  notice('Plano salvo no banco.');
  await render();
}

/* ---------------- documentos para impressão ---------------- */
let imp = { tipo: 'pgrss', de: addMeses(mesAtual(), -11), ate: mesAtual(), mes: mesAtual(), detalhe: false, anexos: true };
function tbl(head, rows, cls) { return `<table class="t ${cls || ''}"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${c == null ? '' : c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}">Sem registros no período.</td></tr>`}</tbody></table>`; }
const kv = rows => `<table class="t kv"><tbody>${rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1]) || '&nbsp;'}</td></tr>`).join('')}</tbody></table>`;
const mesesEntre = (a, b) => { const l = []; let m = a; while (m <= b && l.length < 60) { l.push(m); m = addMeses(m, 1); } return l; };
function envelope(D, titulo, corpo) {
  const P = D.plano || planoPadrao();
  return `<div class="doc"><table class="pg"><thead><tr><td><div class="ph"><img src="${esc(UPA.LOGO)}" alt=""><div><strong>${esc(P.unidade)}</strong><span>${esc(titulo)}</span></div><small>Versão ${esc(P.versao || '1')}</small></div></td></tr></thead><tbody><tr><td>${corpo}</td></tr></tbody><tfoot><tr><td><div class="pf">${esc(P.unidade)}${P.endereco ? ' · ' + esc(P.endereco) : ''} — Emitido em ${agora()} por ${esc(meuEmail())}</div></td></tr></tfoot></table></div>`;
}
function assinaturas(P) {
  return `<div class="sign"><div><br><br>${esc(P.rtNome) || '&nbsp;'}<br><b>Responsável Técnico pelo PGRSS</b><br>${esc(P.rtConselho)} ${esc(P.rtRegistro)}${P.rtArt ? ' · ART/TRT ' + esc(P.rtArt) : ''}</div><div><br><br>${esc(P.dirNome) || '&nbsp;'}<br><b>${esc(P.dirCargo) || 'Direção da unidade'}</b></div>${P.coordNome ? `<div><br><br>${esc(P.coordNome)}<br><b>${esc(P.coordCargo) || 'Coordenação do PGRSS'}</b></div>` : ''}</div>`;
}
const resumoMeses = (D, meses) => meses.map(m => { const s = somaMes(D.pesagens, m), a = atendDoMes(D, m); return [fm(m), kg(s.kgA), kg(s.kgB), kg(s.kgD), kg(s.kgR), kg(s.kgE), '<b>' + kg(s.total) + '</b>', s.total ? pct(s.kgA / s.total * 100) : '—', a ? String(a) : '—', a && s.total ? (s.total / a).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '—']; });
const HRES = ['Mês', 'A (kg)', 'B (kg)', 'D comum (kg)', 'D recicl. (kg)', 'E (kg)', 'Total (kg)', '% Grupo A', 'Atend.', 'kg/atend.'];

function buildPGRSS(D) {
  const P = D.plano || planoPadrao(), T = k => txt(P, k), meses = mesesEntre(imp.de, imp.ate), de = imp.de + '-01', ate = imp.ate + '-31';
  const secs = [], sec = (t, h) => secs.push([t, h]);
  const par = k => `<div class="txt">${esc(T(k))}</div>`;
  sec('Identificação do estabelecimento', kv([['Estabelecimento', P.unidade], ['Tipo', P.tipo], ['Razão social / mantenedora', P.mantenedora], ['CNPJ', P.cnpj], ['CNES', P.cnes], ['Endereço', P.endereco], ['Telefone / e-mail', [P.tel, P.email].filter(Boolean).join(' · ')], ['Alvará / licença sanitária', P.alvara ? P.alvara + (P.alvaraVal ? ' (validade ' + fd(P.alvaraVal) + ')' : '') : ''], ['Funcionamento', P.horario], ['Leitos', P.leitos], ['Média de atendimentos/mês', P.atendMes], ['Nº de profissionais', P.func]]));
  sec('Responsáveis', kv([['Responsável técnico (RT)', P.rtNome], ['Formação / conselho', [P.rtProf, [P.rtConselho, P.rtRegistro].filter(Boolean).join(' ')].filter(Boolean).join(' — ')], ['ART / TRT / CRT', P.rtArt], ['Contato do RT', P.rtContato], ['Direção da unidade', [P.dirNome, P.dirCargo].filter(Boolean).join(' — ')], ['Coordenação do PGRSS', [P.coordNome, P.coordCargo].filter(Boolean).join(' — ')]]) + '<h3>Atribuições</h3>' + par('responsabilidades'));
  sec('Objetivo e abrangência', par('objetivo'));
  sec('Base legal e normativa', par('legal') + (P.legalLocal ? `<h3>Legislação estadual e municipal complementar</h3><div class="txt">${esc(P.legalLocal)}</div>` : ''));
  const tot = D.setores.reduce((s, x) => s + num(x.qtd), 0);
  sec('Diagnóstico: classificação e inventário dos resíduos', par('classificacao') + '<h3>Inventário por setor gerador</h3>' + tbl(['Setor', 'Grupos', 'Resíduos gerados', 'Acondicionamento', 'Coleta interna', 'kg/dia'], D.setores.slice().sort(ENT.setores.ord).map(r => [`<b>${esc(r.nome)}</b>${r.resp ? '<br>' + esc(r.resp) : ''}`, esc((r.grupos || []).join(', ')), esc(r.exemplos), esc(r.acond), esc(r.freq), r.qtd ? kg(r.qtd) : '']).concat(tot ? [['<b>Total estimado</b>', '', '', '', '', '<b>' + kg(tot) + '</b>']] : [])));
  sec('Procedimentos de manejo dos resíduos', [['Segregação', 'segregacao'], ['Acondicionamento', 'acondicionamento'], ['Identificação', 'identificacao'], ['Coleta e transporte internos', 'transporteInterno'], ['Armazenamento temporário', 'armazTemp'], ['Armazenamento externo', 'armazExterno'], ['Coleta e transporte externos', 'coletaExterna'], ['Tratamento e destinação final', 'destinacao']].map((x, i) => `<h3>${secs.length + 1}.${i + 1} ${x[0]}</h3>${par(x[1])}`).join(''));
  sec('Empresas contratadas e licenciamento', tbl(['Empresa', 'Serviço / grupos', 'Licença ambiental', 'Alvará', 'Contrato'], D.empresas.map(e => [`<b>${esc(e.nome)}</b><br>${esc(e.cnpj)}`, esc(e.servico) + '<br>Grupos: ' + esc((e.grupos || []).join(', ')), esc(e.licenca) + (e.licOrgao ? ' (' + esc(e.licOrgao) + ')' : '') + (e.licVal ? '<br>Val.: ' + fd(e.licVal) : ''), esc(e.alvara) + (e.alvVal ? '<br>Val.: ' + fd(e.alvVal) : ''), esc(e.contrato) + (e.contratoVal ? '<br>Até: ' + fd(e.contratoVal) : '')])));
  sec('Saúde e segurança do trabalhador', par('epi'));
  const tr = D.treinos.filter(t => t.data >= de && t.data <= ate).sort((a, b) => a.data.localeCompare(b.data));
  sec('Capacitação e educação continuada', par('capacitacao') + `<h3>Capacitações realizadas (${fm(imp.de)} a ${fm(imp.ate)})</h3>` + tbl(['Data', 'Tema', 'Carga horária', 'Instrutor', 'Participantes'], tr.map(t => [fd(t.data), esc(t.tema), t.ch ? esc(t.ch) + ' h' : '', esc(t.instrutor), esc(t.nPart || (t.lista ? t.lista.split('\n').filter(Boolean).length : ''))])));
  sec('Plano de contingência e emergência', par('contingencia'));
  sec('Monitoramento e indicadores', par('monitoramento') + `<h3>Geração de resíduos (${fm(imp.de)} a ${fm(imp.ate)})</h3>` + tbl(HRES, resumoMeses(D, meses)));
  sec('Controle de versões e revisões', kv([['Versão / revisão', P.versao], ['Data de elaboração', fd(P.dataElab)], ['Vigência até', fd(P.vigAte)], ['Próxima revisão', fd(P.proxRev)], ['Revisão dos textos pelo RT', P.revisado ? 'Confirmada em ' + fd(P.revisadoEm) : 'Não confirmada']]) + (P.historico ? `<h3>Histórico</h3><div class="txt">${esc(P.historico)}</div>` : ''));
  sec('Assinaturas', '<p>Declaramos que este plano foi elaborado e é executado conforme descrito, e que os registros anexos refletem a rotina da unidade.</p>' + `<p>Rio de Janeiro, ${fd(hoje())}.</p>` + assinaturas(P));
  const toc = `<div class="toc"><h2 style="margin-top:0">Sumário</h2><ol>${secs.map(s => `<li>${s[0]}</li>`).join('')}${imp.anexos ? '<li>Anexos: coletas e manifestos; capacitações (participantes); ocorrências; inspeções' + (imp.detalhe ? '; lançamentos diários de pesagem' : '') + '</li>' : ''}</ol></div>`;
  const capa = `<div class="cover"><img src="${esc(UPA.LOGO)}" alt=""><h1>PLANO DE GERENCIAMENTO DE RESÍDUOS DE SERVIÇOS DE SAÚDE<br>PGRSS</h1><h2>${esc(P.unidade)}</h2><p>${esc(P.mantenedora)}</p><div class="meta">${kv([['Versão', P.versao || '1'], ['Elaboração', fd(P.dataElab)], ['Vigência até', fd(P.vigAte)], ['Responsável técnico', [P.rtNome, P.rtConselho, P.rtRegistro].filter(Boolean).join(' · ')], ['Fundamento', 'RDC ANVISA nº 222/2018']])}</div></div>`;
  let corpo = capa + toc + secs.map((s, i) => `<h2>${i + 1}. ${s[0]}</h2>${s[1]}`).join('');
  if (imp.anexos) {
    const col = D.coletas.filter(c => c.data >= de && c.data <= ate).sort((a, b) => a.data.localeCompare(b.data));
    const oc = D.ocorr.filter(c => c.data >= de && c.data <= ate).sort((a, b) => a.data.localeCompare(b.data));
    const ins = D.inspec.filter(c => c.data >= de && c.data <= ate).sort((a, b) => a.data.localeCompare(b.data));
    let ax = `<div class="annex"><h2 style="margin-top:0">Anexo A — Coletas, manifestos (MTR) e certificados de destinação (CDF)</h2>${tbl(['Data', 'Empresa', 'MTR', 'Grupo', 'kg', 'Placa / motorista', 'Destino', 'CDF'], col.map(c => [fd(c.data), esc(c.empresa), esc(c.mtr), esc(c.grupo), kg(c.kg), esc([c.placa, c.motorista].filter(Boolean).join(' / ')), esc(c.destino), esc(c.cdf) + (c.cdfData ? '<br>' + fd(c.cdfData) : '')]).concat(col.length ? [['<b>Total</b>', '', '', '', '<b>' + kg(col.reduce((s, c) => s + num(c.kg), 0)) + '</b>', '', '', '']] : []))}</div>`;
    ax += `<div class="annex"><h2 style="margin-top:0">Anexo B — Capacitações: participantes</h2>${tr.length ? tr.map(t => `<h3>${fd(t.data)} — ${esc(t.tema)}</h3><p>Carga horária: ${esc(t.ch)} h · Instrutor: ${esc(t.instrutor)} · Público: ${esc(t.publico)}</p>${t.conteudo ? `<div class="txt">${esc(t.conteudo)}</div>` : ''}${t.lista ? `<div class="txt"><b>Participantes:</b>\n${esc(t.lista)}</div>` : ''}`).join('') : '<p>Sem registros no período.</p>'}</div>`;
    ax += `<div class="annex"><h2 style="margin-top:0">Anexo C — Ocorrências e acidentes</h2>${tbl(['Data', 'Tipo / setor', 'Descrição', 'Ação', 'Situação'], oc.map(o => [fd(o.data), esc(o.tipo) + '<br>' + esc(o.setor), esc(o.desc), esc(o.acao), esc(o.status || 'Aberta')]))}</div>`;
    ax += `<div class="annex"><h2 style="margin-top:0">Anexo D — Inspeções de segregação e acondicionamento</h2>${tbl(['Data', 'Setor', 'Inspetor', 'Conformidade', 'Observações'], ins.map(i => { const c = confInsp(i); return [fd(i.data), esc(i.setor), esc(i.inspetor), c.p == null ? '—' : pct(c.p) + ` (${c.c} C / ${c.nc} NC)`, esc(i.obs)]; }))}</div>`;
    if (imp.detalhe) {
      const pe = D.pesagens.filter(c => c.data >= de && c.data <= ate).sort((a, b) => a.data.localeCompare(b.data));
      ax += `<div class="annex"><h2 style="margin-top:0">Anexo E — Lançamentos diários de pesagem</h2>${tbl(['Data', 'Setor', 'A', 'B', 'D comum', 'D recicl.', 'E', 'Total', 'Responsável'], pe.map(r => [fd(r.data), esc(r.setor), kg(r.kgA), kg(r.kgB), kg(r.kgD), kg(r.kgR), kg(r.kgE), '<b>' + kg(totPes(r)) + '</b>', esc(r.resp)]))}</div>`;
    }
    corpo += ax;
  }
  corpo += `<div class="nota">Documento emitido pelo sistema Gestão Inteligente UPA Rocinha em ${agora()} por ${esc(meuEmail())}. Os registros foram lançados por usuários identificados do sistema. Este documento só tem validade como PGRSS após revisão e assinatura do responsável técnico e da direção da unidade.</div>`;
  return envelope(D, 'Plano de Gerenciamento de Resíduos de Serviços de Saúde — PGRSS', corpo);
}
function buildMensal(D) {
  const P = D.plano || planoPadrao(), m = imp.mes, ant = addMeses(m, -1), s = somaMes(D.pesagens, m), sa = somaMes(D.pesagens, ant), a = atendDoMes(D, m);
  const dm = r => mesDe(r.data) === m;
  const setores = {}; D.pesagens.filter(dm).forEach(r => { const n = r.setor || 'Geral / abrigo externo'; const o = setores[n] = setores[n] || { kgA: 0, kgB: 0, kgD: 0, kgR: 0, kgE: 0 }; GRUPOS_PES.forEach(g => { o[g[0]] += num(r[g[0]]); }); });
  const col = D.coletas.filter(dm).sort((x, y) => x.data.localeCompare(y.data)), tr = D.treinos.filter(dm), oc = D.ocorr.filter(dm), ins = D.inspec.filter(dm);
  const dif = (x, y) => y ? ((x - y) / y * 100 >= 0 ? '+' : '') + pct((x - y) / y * 100) : '—';
  const corpo = `<h2 style="margin-top:0">Relatório mensal do PGRSS — ${fm(m)}</h2>
  ${kv([['Unidade', P.unidade], ['Competência', fm(m)], ['Responsável técnico', [P.rtNome, P.rtConselho, P.rtRegistro].filter(Boolean).join(' · ')], ['Atendimentos no mês', a || '—']])}
  <h2>1. Geração por grupo</h2>${tbl(['Grupo', 'Mês atual (kg)', '% do total', 'Mês anterior (kg)', 'Variação'], GRUPOS_PES.map(g => [g[1], kg(s[g[0]]), s.total ? pct(s[g[0]] / s.total * 100) : '—', kg(sa[g[0]]), dif(s[g[0]], sa[g[0]])]).concat([['<b>Total</b>', '<b>' + kg(s.total) + '</b>', '', '<b>' + kg(sa.total) + '</b>', dif(s.total, sa.total)]]))}
  ${a && s.total ? `<p>Geração por atendimento: <b>${(s.total / a).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg/atendimento</b>.</p>` : ''}
  <h2>2. Geração por setor</h2>${tbl(['Setor', 'A', 'B', 'D comum', 'D recicl.', 'E', 'Total (kg)'], Object.keys(setores).sort((x, y) => x.localeCompare(y, 'pt-BR')).map(n => { const o = setores[n]; return [esc(n), kg(o.kgA), kg(o.kgB), kg(o.kgD), kg(o.kgR), kg(o.kgE), '<b>' + kg(o.kgA + o.kgB + o.kgD + o.kgR + o.kgE) + '</b>']; }))}
  <h2>3. Coletas e destinação</h2>${tbl(['Data', 'Empresa', 'MTR', 'Grupo', 'kg', 'Destino', 'CDF'], col.map(c => [fd(c.data), esc(c.empresa), esc(c.mtr), esc(c.grupo), kg(c.kg), esc(c.destino), c.cdf ? esc(c.cdf) : 'Pendente']))}
  <h2>4. Capacitações</h2>${tbl(['Data', 'Tema', 'CH', 'Instrutor', 'Participantes'], tr.map(t => [fd(t.data), esc(t.tema), esc(t.ch), esc(t.instrutor), esc(t.nPart)]))}
  <h2>5. Ocorrências</h2>${tbl(['Data', 'Tipo / setor', 'Descrição', 'Ação', 'Situação'], oc.map(o => [fd(o.data), esc(o.tipo) + '<br>' + esc(o.setor), esc(o.desc), esc(o.acao), esc(o.status || 'Aberta')]))}
  <h2>6. Inspeções</h2>${tbl(['Data', 'Setor', 'Inspetor', 'Conformidade', 'Observações'], ins.map(i => { const c = confInsp(i); return [fd(i.data), esc(i.setor), esc(i.inspetor), c.p == null ? '—' : pct(c.p), esc(i.obs)]; }))}
  <h2>7. Observações</h2><div class="lines"><div></div><div></div><div></div></div>${assinaturas(P)}`;
  return envelope(D, 'Relatório mensal de gerenciamento de resíduos — ' + fm(m), corpo);
}
async function viewImprimir() {
  const D = await loadAll(), P = D.plano, pr = prontidao(D).filter(x => !x[1]);
  $('content').innerHTML = `<section class="view"><h2>Imprimir documentos para fiscalização</h2><p class="muted">Gere a pré-visualização, confira e use "Imprimir / salvar PDF" (escolha "Salvar como PDF" para arquivar). O documento sai com cabeçalho, rodapé, data e usuário de emissão e campos de assinatura.</p>
  ${!P ? '<div class="alert warn"><b>⚠</b><span>O plano ainda não foi salvo. Preencha e salve a aba "Plano e responsáveis" antes de emitir o documento oficial.</span></div>' : ''}
  ${pr.length ? `<div class="alert warn"><b>⚠</b><span>Pendências para a fiscalização: ${pr.map(x => esc(x[0])).join('; ')}.</span></div>` : '<div class="alert ok"><b>✔</b><span>Nenhuma pendência de preenchimento detectada.</span></div>'}
  <div class="grid"><label class="fld">Documento<select id="impTipo"><option value="pgrss"${imp.tipo === 'pgrss' ? ' selected' : ''}>PGRSS completo (com anexos)</option><option value="mensal"${imp.tipo === 'mensal' ? ' selected' : ''}>Relatório mensal</option></select></label>
  ${imp.tipo === 'pgrss' ? `<label class="fld">Registros de<input type="month" id="impDe" value="${imp.de}"></label><label class="fld">até<input type="month" id="impAte" value="${imp.ate}"></label>` : `<label class="fld">Mês<input type="month" id="impMes" value="${imp.mes}"></label>`}</div>
  ${imp.tipo === 'pgrss' ? `<div class="chk"><label class="c"><input type="checkbox" id="impAnexos"${imp.anexos ? ' checked' : ''}> Incluir anexos (coletas, capacitações, ocorrências, inspeções)</label><label class="c"><input type="checkbox" id="impDetalhe"${imp.detalhe ? ' checked' : ''}> Incluir lançamentos diários de pesagem</label></div>` : ''}
  <div class="actions"><button type="button" data-act="gerar">Gerar pré-visualização</button><button type="button" data-act="imprimir">Imprimir / salvar PDF</button></div></section>`;
}
async function gerar() {
  const D = await loadAll();
  $('printRoot').innerHTML = imp.tipo === 'pgrss' ? buildPGRSS(D) : buildMensal(D);
  $('printRoot').classList.remove('hidden');
  $('printRoot').scrollIntoView({ block: 'start' });
}

/* ---------------- ações (cliques) ---------------- */

/* ---------------- importar relatório de MTR (CSV do sistema de manifestos) ---------------- */
function csvLinhas(t) {
  t = t.replace(/^﻿/, '');
  const prim = t.split(/\r?\n/).filter(x => x.trim()).slice(0, 5).join('\n');
  const sep = [';', ',', '\t'].sort((a, b) => prim.split(b).length - prim.split(a).length)[0];
  const out = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x.trim() !== '')) out.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some(x => x.trim() !== '')) out.push(row);
  return out;
}
const dataBR = d => { const m = String(d || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
const semAc = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
async function importarMtr(file) {
  if (!/\.csv$/i.test(file.name)) { notice('Escolha o arquivo .csv exportado do sistema de MTR.', true); return; }
  const buf = await file.arrayBuffer();
  let t = new TextDecoder('utf-8').decode(buf); if (t.indexOf('�') >= 0) t = new TextDecoder('windows-1252').decode(buf);
  const L = csvLinhas(t);
  const hi = L.findIndex(r => r.some(c => semAc(c) === 'mtr n' || /^mtr n/.test(semAc(c))));
  if (hi < 0) { notice('Não achei o cabeçalho "MTR Nº". Colunas lidas na 1ª linha: [' + (L[0] || []).join(' | ') + ']', true); return; }
  const H = L[hi].map(semAc), ix = n => H.findIndex(h => h === semAc(n));
  const c = { mtr: ix('MTR Nº'), sit: ix('Situação'), tr: ix('Data de Transporte'), em: ix('Data de Emissão'), rec: ix('Data de Recebimento'), transp: ix('Transportador Nome'), dest: ix('Destinador Nome'), mot: ix('Motorista'), placa: ix('Placa'), cls: ix('Classe'), tec: ix('Tecnologia'), acond: ix('Acondicionamento'), qr: ix('Qt. recebida (t)'), qi: ix('Qt. Indicada (t)'), cdf: ix('Número do CDF'), cdfd: ix('Data de Emissão do CDF') };
  if (c.mtr < 0 || c.sit < 0 || c.cls < 0) { notice('O arquivo não tem as colunas esperadas (MTR Nº, Situação, Classe).', true); return; }
  const g = (r, k) => (c[k] >= 0 && r[c[k]] != null ? String(r[c[k]]).trim().replace(/^="?|"$/g, '') : '');
  const rows = L.slice(hi + 1).filter(r => g(r, 'mtr'));
  const rec = rows.filter(r => /recebido/i.test(g(r, 'sit')));
  const D = await loadAll();
  const ja = new Set(D.coletas.map(x => String(x.mtr || '').trim() + '|' + String(x.grupo || '').trim()));
  const novos = [], vistos = new Set(); let rep = 0, semPeso = 0;
  rec.forEach(r => {
    const grupo = g(r, 'cls').replace(/^grupo\s*/i, '').trim() || '';
    const key = g(r, 'mtr') + '|' + grupo;
    if (ja.has(key) || vistos.has(key)) { rep++; return; } vistos.add(key);
    const t = num(g(r, 'qr')); if (!t) semPeso++;
    novos.push({
      data: dataBR(g(r, 'tr')) || dataBR(g(r, 'rec')) || dataBR(g(r, 'em')), empresa: g(r, 'transp'), mtr: g(r, 'mtr'), grupo,
      kg: String(Math.round(t * 1000)), placa: g(r, 'placa'), motorista: g(r, 'mot'),
      destino: [g(r, 'dest'), g(r, 'tec')].filter(Boolean).join(' — '), cdf: g(r, 'cdf'), cdfData: dataBR(g(r, 'cdfd')),
      obs: 'Importado do relatório de MTR (peso recebido pelo destinador). ' + (g(r, 'acond') ? 'Acondicionamento: ' + g(r, 'acond') + '.' : ''), origem: 'importacao-mtr'
    });
  });
  const ign = rows.length - rec.length;
  if (!novos.length) { notice(`Nada a importar: ${rec.length} linha(s) recebida(s) no arquivo${rep ? ', todas já lançadas' : ''}. Ignoradas ${ign} cancelada(s)/salva(s).`); return; }
  const soma = novos.reduce((s, x) => s + num(x.kg), 0);
  if (!confirm(`${rows.length} linha(s) no arquivo.\n• ${novos.length} coleta(s) recebida(s) serão lançadas (${soma.toLocaleString('pt-BR')} kg no total)\n• ${rep} já existente(s) serão ignoradas\n• ${ign} cancelada(s)/salva(s) NÃO serão importadas${semPeso ? '\n• ' + semPeso + ' sem peso recebido' : ''}\n\nContinuar?`)) return;
  for (const o of novos) await put('coletas', o);
  notice(`Importadas ${novos.length} coleta(s) (${soma.toLocaleString('pt-BR')} kg). Cadastre a empresa "${novos[0].empresa}" em Empresas e licenças, se ainda não estiver.`);
  await render();
}

const acoes = {
  async edit(d) { ed[view] = d.id; pend[view] = []; await render(); window.scrollTo(0, 0); },
  async cancelar() { ed[view] = null; await render(); },
  async del(d) { if (!confirm('Excluir este registro? Os arquivos anexados também serão removidos.')) return; const D = await all(view); const r = D.find(x => x.id === d.id); if (r && (r.anexos || []).length) { try { await UPA.files.remove(r.anexos.map(a => a.path)); } catch (e) { /* segue */ } } await del(view, d.id); notice('Registro excluído.'); await render(); },
  async anexos(d) {
    const r = (await all(view)).find(x => x.id === d.id), L = (r && r.anexos) || [];
    if (!L.length) { modal('<p>Nenhum arquivo anexado a este registro.</p>'); return; }
    const urls = await UPA.files.urls(L.map(a => a.path));
    modal('<h3>Arquivos anexados</h3><ul>' + L.map(a => `<li><a href="${esc(urls[a.path] || '#')}" target="_blank" rel="noopener">${esc(a.nome)}</a></li>`).join('') + '</ul><p class="muted">Os links expiram em algumas horas.</p>');
  },
  async rmanexo(d) {
    if (!confirm('Remover este arquivo?')) return;
    const r = (await all(view)).find(x => x.id === ed[view]); if (!r) return;
    const a = r.anexos[Number(d.i)]; try { await UPA.files.remove([a.path]); } catch (e) { /* segue */ }
    await put(view, { ...r, anexos: r.anexos.filter((_, i) => i !== Number(d.i)) }); await render();
  },
  async fltLimpar() { flt[view] = ''; await render(); },
  async go(d, b, ev) { ev.preventDefault(); view = d.v; await render(); },
  async salvarAtend() {
    const v = $('atend').value, D = await loadAll(), x = D.meses.find(r => r.mes === selMes) || { id: 'pgrss-mes-' + selMes, mes: selMes };
    await put('meses', { ...x, atend: v }); notice('Atendimentos do mês salvos.'); await render();
  },
  async restaurar(d) { document.querySelector(`textarea[name="txt_${d.k}"]`).value = PGRSS_DEF[d.k]; notice('Texto padrão restaurado nesta tela. Clique em "Salvar plano" para gravar.'); },
  async seed() {
    const D = await loadAll(), ja = new Set(D.setores.map(s => String(s.nome).toLowerCase())); let n = 0;
    for (const s of PGRSS_SETORES) { if (ja.has(s[0].toLowerCase())) continue; await put('setores', { nome: s[0], grupos: s[1], exemplos: s[2], acond: s[3], freq: 'A cada turno' }); n++; }
    notice(n ? `${n} setor(es) padrão incluído(s). Revise grupos, acondicionamento e estimativas de cada um.` : 'Os setores padrão já estão cadastrados.'); await render();
  },
  async impMtr() { const f = $('fileMtr'); f.value = ''; f.click(); },
  async gerar() { await gerar(); },
  async imprimir() { await gerar(); setTimeout(() => window.print(), 150); }
};
function modal(h) { $('modalBody').innerHTML = h; $('modal').classList.remove('hidden'); }

/* ---------------- navegação / início ---------------- */
async function render() {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.v === view));
  if (view !== 'imprimir') $('printRoot').classList.add('hidden');
  try {
    if (view === 'painel') await viewPainel(); else if (view === 'plano') await viewPlano(); else if (view === 'imprimir') await viewImprimir(); else await viewEntity(view);
  } catch (e) { notice(UPA.msg(e), true); }
}
function ligar() {
  $('nav').innerHTML = VIEWS.map(v => `<button type="button" data-v="${v[0]}">${v[1]}</button>`).join('');
  $('nav').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; view = b.dataset.v; notice(''); cache = {}; render(); });
  $('modalClose').onclick = () => $('modal').classList.add('hidden');
  const c = $('content');
  c.addEventListener('click', async e => { const b = e.target.closest('[data-act]'); if (!b) return; try { await acoes[b.dataset.act](b.dataset, b, e); } catch (err) { notice(UPA.msg(err), true); } });
  c.addEventListener('submit', async e => {
    e.preventDefault(); const btn = e.target.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
    try { if (e.target.id === 'ef') await salvarEntidade(e.target); else if (e.target.id === 'pf') await salvarPlano(e.target); }
    catch (err) { notice(UPA.msg(err), true); if (btn) btn.disabled = false; }
  });
  c.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'fileMtr') { if (t.files[0]) { try { await importarMtr(t.files[0]); } catch (err) { notice(UPA.msg(err), true); } } }
    else if (t.id === 'flt') { flt[view] = t.value; await render(); }
    else if (t.id === 'selMes') { if (t.value) { selMes = t.value; await render(); } }
    else if (t.id === 'impTipo') { imp.tipo = t.value; $('printRoot').classList.add('hidden'); await render(); }
    else if (t.id === 'impDe') imp.de = t.value || imp.de; else if (t.id === 'impAte') imp.ate = t.value || imp.ate; else if (t.id === 'impMes') imp.mes = t.value || imp.mes;
    else if (t.id === 'impAnexos') imp.anexos = t.checked; else if (t.id === 'impDetalhe') imp.detalhe = t.checked;
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && view === 'painel') { cache = {}; render(); } });
}
async function init() {
  try { await UPA.ready(); } catch (e) { notice(UPA.msg(e), true); return; }
  ligar(); await render();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
