'use strict';
/* RH e DP — avaliação de experiência, relatório de evolução, orientação de conduta, advertência e desligamento.
   Dados na tabela protegida rhdp_registros (sql/rhdp.sql): só coordenadores cadastrados em POP > Signatários.
   A IA (função ia-assistente) é APOIO: a decisão é sempre do gestor/RH. Sem a função, o sistema usa regras locais. */
const $ = id => document.getElementById(id);
const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => crypto.randomUUID();
const hoje = () => new Date().toLocaleDateString('en-CA');
const fd = d => { if (!d) return ''; const p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(d); };
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
const semAc = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const meuEmail = () => { const u = window.UPA && UPA.user(); return (u && u.email) || ''; };
const C = () => UPA.client();
const T = 'rhdp_registros';
function notice(t, erro) { const m = $('message'); m.textContent = t || ''; m.className = erro ? 'err' : ''; if (t) m.scrollIntoView({ block: 'nearest' }); }
function erroTxt(e) {
  const m = (e && (e.message || e.details)) || String(e);
  if (/does not exist|Could not find the table|schema cache|relation/i.test(m)) return 'A tabela do RH e DP ainda não existe no Supabase. Rode o arquivo sql/rhdp.sql no SQL Editor.';
  if (/row-level security|violates|permission/i.test(m)) return 'Sem permissão: seu e-mail precisa estar cadastrado como coordenador ativo em POP > Signatários (rode também o sql/pop.sql).';
  return UPA.msg(e);
}

/* ---------------- dados ---------------- */
async function listar(col) {
  const r = await C().from(T).select('id,dados,updated_at').eq('colecao', col).order('updated_at', { ascending: false });
  if (r.error) throw r.error;
  return (r.data || []).map(x => ({ ...x.dados, id: x.id }));
}
async function salvar(col, o) {
  const d = { ...o }; d.id = d.id || uuid(); d.atualizadoEm = new Date().toISOString(); d.atualizadoPor = meuEmail();
  if (!d.criadoEm) { d.criadoEm = d.atualizadoEm; d.criadoPor = d.atualizadoPor; }
  const r = await C().from(T).upsert({ id: d.id, colecao: col, dados: d, atualizado_por: d.atualizadoPor, updated_at: d.atualizadoEm });
  if (r.error) throw r.error; return d;
}
async function inserir(col, o) {
  const d = { ...o }; d.atualizadoEm = new Date().toISOString(); d.atualizadoPor = meuEmail(); d.criadoEm = d.atualizadoEm; d.criadoPor = d.atualizadoPor;
  const r = await C().from(T).insert({ id: d.id, colecao: col, dados: d, atualizado_por: d.atualizadoPor, updated_at: d.atualizadoEm });
  if (r.error) throw r.error; return d;
}
/* Numeração sequencial por ano, sem repetir: o id do registro É o número (chave primária), então dois
   salvamentos ao mesmo tempo não geram o mesmo número (o segundo falha e tenta o próximo). Excluídos ficam como "cancelado". */
async function salvarNumerado(col, o) {
  const ano = String(o.data || hoje()).slice(0, 4);
  for (let t = 0; t < 10; t++) {
    const L = await listar(col);
    const n = L.filter(r => String(r.numero || '').slice(-4) === ano).map(r => parseInt(String(r.numero), 10) || 0).reduce((m, x) => Math.max(m, x), 0) + 1 + t;
    const numero = String(n).padStart(2, '0') + '/' + ano, id = `${col}-${ano}-${String(n).padStart(3, '0')}`;
    try { return await inserir(col, { ...o, id, numero }); }
    catch (e) { if (!/duplicate|23505|already exists|unique/i.test((e && (e.code + ' ' + e.message)) || '')) throw e; }
  }
  throw new Error('Não foi possível gerar um número único. Tente novamente.');
}
const vivos = L => L.filter(r => !r.cancelado);
async function excluir(id) { const r = await C().from(T).delete().eq('id', id); if (r.error) throw r.error; }
let COLABS = [];
async function carregarColabs() {
  const m = new Map();
  const add = (nome, mat, cargo, setor, adm) => { if (!nome) return; const k = mat ? 'm' + mat : 'n' + semAc(nome); const o = m.get(k) || {}; m.set(k, { nome: o.nome || nome, matricula: o.matricula || mat || '', cargo: o.cargo || cargo || '', setor: o.setor || setor || '', admissao: o.admissao || adm || '' }); };
  try { const r = await C().from('profissionais').select('*'); (r.data || []).filter(x => x.ativo !== false).forEach(x => add(x.nome, x.matricula, x.cargo_descricao || x.cargo, x.setor, x.data_admissao)); } catch (e) { /* tabela pode não existir */ }
  try { const r = await C().from('funcionarios').select('*'); (r.data || []).filter(x => x.ativo !== false).forEach(x => add(x.nome, x.matricula, x.funcao, x.setor, '')); } catch (e) { /* idem */ }
  COLABS = Array.from(m.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  $('dlColab').innerHTML = COLABS.map(c => `<option value="${esc(c.nome)}">${esc([c.matricula, c.cargo].filter(Boolean).join(' · '))}</option>`).join('');
}
const achaColab = nome => COLABS.find(c => semAc(c.nome) === semAc(nome));

/* ---------------- configuração (coordenador que assina) ---------------- */
const CFG_ID = 'rhdp-cfg';
let CFG = { unidade: 'UPA 24h Rocinha', lotacao: 'SMS UPA 24H ROCINHA', coordNome: 'Luis Felipe W. Seroa da Motta', coordCargo: 'Coordenador Administrativo', coordCnes: '6507409' };
async function carregarCfg() { const l = await listar('cfg'); const c = l.find(x => x.id === CFG_ID); if (c) CFG = { ...CFG, ...c }; }

/* ---------------- critérios e escalas ---------------- */
const CRITERIOS = [
  ['assid', 'Assiduidade (faltas e atrasos)'], ['pont', 'Pontualidade'], ['prod', 'Produtividade e cumprimento das tarefas'],
  ['qual', 'Qualidade e atenção aos detalhes'], ['rel', 'Relacionamento e trabalho em equipe'], ['hier', 'Respeito à hierarquia e às normas da unidade'],
  ['post', 'Postura profissional (apresentação, uso de celular, permanência no posto)'], ['inic', 'Iniciativa e proatividade'],
  ['tec', 'Conhecimento técnico e capacidade de aprendizado'], ['seg', 'Cumprimento de protocolos, biossegurança e EPI']
];
const ESCALA = [[0, 'Não avaliado'], [1, '1 · Insatisfatório'], [2, '2 · Precisa melhorar'], [3, '3 · Atende'], [4, '4 · Supera'], [5, '5 · Excelente']];
const mediaCrit = arr => { const v = (arr || []).map(num).filter(x => x > 0); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; };
const NIVEIS_ADV = ['Advertência verbal (registrada)', 'Advertência escrita', 'Suspensão'];
const TIPOS_DESL = ['Término do contrato de experiência', 'Dispensa sem justa causa', 'Dispensa por justa causa', 'Pedido de demissão', 'Acordo entre as partes (art. 484-A da CLT)', 'Término de contrato por prazo determinado'];
const CHECK_DESL = ['Exame demissional agendado/realizado', 'Devolução de crachá, uniforme e EPI', 'Baixa de acessos e sistemas (TI-MED, e-mail, Supabase)', 'Baixa/atualização no SCNES (CNES)', 'Baixa na escala e no ponto', 'Cálculo e documentos rescisórios (TRCT, guias)', 'Pagamento/homologação dentro do prazo legal', 'Entrega de documentos ao colaborador (CTPS, carta de referência quando houver)'];

/* ---------------- definição das telas ---------------- */
const colabF = [{ k: 'nome', l: 'Colaborador', t: 'colab', req: 1 }, { k: 'matricula', l: 'Matrícula' }, { k: 'cargo', l: 'Cargo' }, { k: 'setor', l: 'Setor' }];
const ENT = {
  aval: {
    t: 'Avaliação de experiência', col: 'aval',
    help: 'Avalie o colaborador em período de experiência (45 e 90 dias). A média alimenta o Relatório de evolução.',
    f: [...colabF, { k: 'admissao', l: 'Data de admissão', t: 'date' },
      { k: 'periodo', l: 'Período avaliado', t: 'select', o: ['45 dias', '90 dias', 'Avaliação periódica'] }, { k: 'data', l: 'Data da avaliação', t: 'date', req: 1 },
      { k: 'avaliador', l: 'Avaliador', def: () => CFG.coordNome },
      { k: 'crit', l: 'Critérios (1 a 5)', t: 'crit' },
      { k: 'fortes', l: 'Pontos fortes', t: 'textarea', full: 1 }, { k: 'melhorar', l: 'Pontos a melhorar / ocorrências observadas', t: 'textarea', full: 1 },
      { k: 'parecer', l: 'Parecer do avaliador', t: 'select', o: ['Recomenda efetivação', 'Recomenda prorrogar a experiência / acompanhar', 'Não recomenda a efetivação'] }],
    cols: [['Data', r => fd(r.data)], ['Colaborador', r => `<b>${esc(r.nome)}</b><br><small>${esc(r.cargo)}</small>`], ['Período', r => esc(r.periodo)], ['Média', r => { const m = mediaCrit(r.crit); return m ? m.toFixed(1) + ' / 5' : '—'; }], ['Parecer', r => esc(r.parecer || '')]],
    imprimir: docAval
  },
  cond: {
    t: 'Orientação de conduta', col: 'cond', numerar: 1,
    help: 'Registro formal e construtivo da orientação dada ao colaborador (modelo da unidade). Imprime com assinaturas e testemunhas.',
    f: [{ k: 'data', l: 'Data', t: 'date', req: 1 }, ...colabF,
      { k: 'assunto', l: 'Assunto', def: () => 'Orientação de Conduta Profissional' },
      { k: 'relato', l: 'Relato da orientação', t: 'textarea', full: 1, ia: 'orientação de conduta', req: 1 },
      { k: 'obsColab', l: 'Observação do colaborador (se já manifestada)', t: 'textarea', full: 1 }],
    cols: [['Nº', r => esc(r.numero || '')], ['Data', r => fd(r.data)], ['Colaborador', r => `<b>${esc(r.nome)}</b><br><small>${esc(r.cargo)}</small>`], ['Assunto', r => esc(r.assunto)]],
    imprimir: docCond
  },
  adv: {
    t: 'Advertência', col: 'adv', numerar: 1,
    help: 'Advertência verbal registrada, escrita ou suspensão. Mostra o histórico do colaborador (reincidência) e imprime com ciência e testemunhas.',
    f: [{ k: 'data', l: 'Data da advertência', t: 'date', req: 1 }, { k: 'dataFato', l: 'Data do fato', t: 'date' }, ...colabF,
      { k: 'nivel', l: 'Medida aplicada', t: 'select', o: NIVEIS_ADV, req: 1 }, { k: 'diasSusp', l: 'Dias de suspensão (se houver)', t: 'number' },
      { k: 'fato', l: 'Descrição do fato', t: 'textarea', full: 1, ia: 'advertência', req: 1 },
      { k: 'norma', l: 'Norma/regra descumprida (regimento interno, POP, CLT art. 482 etc.)', t: 'textarea', full: 1 },
      { k: 'orient', l: 'Orientação e expectativa para o futuro', t: 'textarea', full: 1 },
      { k: 'recusou', l: 'O colaborador recusou-se a assinar', t: 'select', o: ['Não', 'Sim'] }, { k: 'obsColab', l: 'Manifestação do colaborador', t: 'textarea', full: 1 }],
    cols: [['Nº', r => esc(r.numero || '')], ['Data', r => fd(r.data)], ['Colaborador', r => `<b>${esc(r.nome)}</b><br><small>${esc(r.cargo)}</small>`], ['Medida', r => esc(r.nivel)], ['Fato', r => esc(String(r.fato || '').slice(0, 90))]],
    imprimir: docAdv
  },
  desl: {
    t: 'Desligamento', col: 'desl', numerar: 1,
    help: 'Relatório de desligamento com histórico do colaborador e checklist das providências. Valide com o RH/jurídico antes de formalizar.',
    f: [{ k: 'data', l: 'Data da comunicação', t: 'date', req: 1 }, { k: 'ultimoDia', l: 'Último dia trabalhado', t: 'date' }, ...colabF, { k: 'admissao', l: 'Data de admissão', t: 'date' },
      { k: 'tipo', l: 'Tipo de desligamento', t: 'select', o: TIPOS_DESL, req: 1 }, { k: 'aviso', l: 'Aviso prévio', t: 'select', o: ['Não se aplica', 'Trabalhado', 'Indenizado', 'Dispensado'] },
      { k: 'motivo', l: 'Motivo / fundamentação', t: 'textarea', full: 1, ia: 'desligamento', req: 1 },
      { k: 'checks', l: 'Providências', t: 'checks', o: CHECK_DESL }, { k: 'obsGestor', l: 'Observações do gestor/RH', t: 'textarea', full: 1 }],
    cols: [['Nº', r => esc(r.numero || '')], ['Data', r => fd(r.data)], ['Colaborador', r => `<b>${esc(r.nome)}</b><br><small>${esc(r.cargo)}</small>`], ['Tipo', r => esc(r.tipo)], ['Providências', r => { const n = (r.checks || []).length; return `<span class="badge ${n === CHECK_DESL.length ? 'ok' : 'warn'}">${n}/${CHECK_DESL.length}</span>`; }]],
    imprimir: docDesl
  }
};
const VIEWS = [['painel', 'Painel'], ['quadro', 'Quadro de progressão'], ['aval', 'Avaliação de experiência'], ['evol', 'Relatório de evolução'], ['cond', 'Orientação de conduta'], ['adv', 'Advertência'], ['desl', 'Desligamento'], ['cfg', 'Configurações']];
let view = 'painel', ed = {}, flt = {}, CACHE = {};
async function dados(col) { return CACHE[col] || (CACHE[col] = await listar(col)); }
const limparCache = () => { CACHE = {}; };

/* ---------------- formulários ---------------- */
function campo(f, v) {
  const nm = ` name="${f.k}"${f.req ? ' required' : ''}`, cls = 'fld' + (f.full ? ' full' : '');
  if (v == null || v === '') v = f.def ? f.def() : (f.t === 'date' && f.k === 'data' ? hoje() : '');
  if (f.t === 'crit') {
    const cur = v || [];
    return `<fieldset class="fld full"><legend>${esc(f.l)}</legend>${CRITERIOS.map((c, i) => `<div class="rate"><span>${esc(c[1])}</span><select name="crit_${i}">${ESCALA.map(e => `<option value="${e[0]}"${String(cur[i] || 0) === String(e[0]) ? ' selected' : ''}>${esc(e[1])}</option>`).join('')}</select></div>`).join('')}</fieldset>`;
  }
  if (f.t === 'checks') return `<fieldset class="fld full"><legend>${esc(f.l)}</legend><div class="chk">${f.o.map(o => `<label class="c"><input type="checkbox" name="${f.k}" value="${esc(o)}"${(v || []).indexOf(o) >= 0 ? ' checked' : ''}>${esc(o)}</label>`).join('')}</div></fieldset>`;
  if (f.t === 'textarea') return `<label class="${cls}">${esc(f.l)}<textarea${nm}>${esc(v)}</textarea></label>${f.ia ? `<div class="fld full" style="margin-top:-4px"><button type="button" class="secondary small" data-act="redigir" data-k="${f.k}" data-tipo="${esc(f.ia)}">✨ Redigir / melhorar o texto com IA</button> <span class="muted">Descreva os fatos em tópicos e a IA organiza o texto formal. Sempre revise.</span></div>` : ''}`;
  if (f.t === 'select') return `<label class="${cls}">${esc(f.l)}<select${nm}><option value=""></option>${f.o.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  if (f.t === 'colab') return `<label class="${cls}">${esc(f.l)}<input type="text" list="dlColab" autocomplete="off"${nm} value="${esc(v)}" data-colab="1"></label>`;
  if (f.t === 'number') return `<label class="${cls}">${esc(f.l)}<input type="number" step="1" min="0"${nm} value="${esc(v)}"></label>`;
  return `<label class="${cls}">${esc(f.l)}<input type="${f.t || 'text'}"${nm} value="${esc(v)}"></label>`;
}
function lerCampos(form, fields, base) {
  const o = { ...base };
  fields.forEach(f => {
    if (f.t === 'crit') o[f.k] = CRITERIOS.map((_, i) => num(form.elements['crit_' + i].value));
    else if (f.t === 'checks') o[f.k] = Array.from(form.querySelectorAll(`input[name="${f.k}"]:checked`)).map(x => x.value);
    else o[f.k] = String(form.elements[f.k].value || '').trim();
  });
  return o;
}
async function proxNumero(col, data) {
  const ano = String(data || hoje()).slice(0, 4), L = await dados(col);
  const n = L.filter(r => String(r.data || '').slice(0, 4) === ano).map(r => parseInt(String(r.numero || '0'), 10) || 0).reduce((m, x) => Math.max(m, x), 0) + 1;
  return String(n).padStart(2, '0') + '/' + ano;
}

async function viewEntity(k) {
  const E = ENT[k], L = await dados(E.col), cur = ed[k] ? L.find(r => r.id === ed[k]) : null;
  if (!(k in flt)) flt[k] = '';
  const q = semAc(flt[k]);
  const lista = L.filter(r => !q || semAc([r.nome, r.matricula, r.cargo, r.numero].join(' ')).indexOf(q) >= 0).sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  const campos = E.f.map(f => campo(f, cur ? cur[f.k] : '')).join('');
  const linhas = lista.map(r => `<tr${r.cancelado ? ' style="opacity:.5;text-decoration:line-through"' : ''}>${E.cols.map(c => `<td>${c[1](r)}</td>`).join('')}<td style="white-space:nowrap"><button type="button" class="small" data-act="edit" data-id="${esc(r.id)}">Editar</button><button type="button" class="small secondary" data-act="print" data-id="${esc(r.id)}">Imprimir</button><button type="button" class="small danger" data-act="del" data-id="${esc(r.id)}">Excluir</button></td></tr>`).join('');
  $('content').innerHTML = `<section class="view"><h2>${esc(E.t)}</h2><p class="muted">${esc(E.help)}</p>
  <form id="ef" data-k="${k}"><div class="grid">${campos}</div><div id="histBox"></div>
  <div class="actions"><button type="submit">${cur ? 'Salvar alterações' : 'Salvar registro'}</button><button type="submit" class="secondary" data-after="print">Salvar e imprimir</button>${cur ? '<button type="button" class="secondary" data-act="cancelar">Cancelar edição</button>' : ''}</div></form>
  <h3>Registros (${lista.length})</h3><div class="filtro"><label>Buscar<input type="search" id="busca" value="${esc(flt[k])}" placeholder="nome, matrícula, cargo"></label></div>
  <div class="table-wrap"><table><thead><tr>${E.cols.map(c => `<th>${c[0]}</th>`).join('')}<th>Ações</th></tr></thead><tbody>${linhas || `<tr><td colspan="${E.cols.length + 1}">Nenhum registro.</td></tr>`}</tbody></table></div></section>`;
  atualizaHist();
}
/* histórico do colaborador mostrado no formulário */
async function historicoDe(nome, mat) {
  const mesmo = r => (mat && String(r.matricula || '') === String(mat)) || semAc(r.nome) === semAc(nome);
  const [av, co, ad, ev] = await Promise.all([dados('aval'), dados('cond'), dados('adv'), dados('evol')]);
  return { aval: vivos(av).filter(mesmo), cond: vivos(co).filter(mesmo), adv: vivos(ad).filter(mesmo), evol: ev.filter(mesmo) };
}
async function atualizaHist() {
  const f = $('ef'); if (!f || !f.elements.nome) return; const box = $('histBox'); if (!box) return;
  const nome = f.elements.nome.value.trim(); if (!nome || !['cond', 'adv', 'desl'].includes(f.dataset.k)) { box.innerHTML = ''; return; }
  const h = await historicoDe(nome, f.elements.matricula ? f.elements.matricula.value : '');
  const partes = [];
  if (h.aval.length) partes.push(`${h.aval.length} avaliação(ões)`); if (h.cond.length) partes.push(`${h.cond.length} orientação(ões) de conduta`); if (h.adv.length) partes.push(`${h.adv.length} advertência(s)`);
  box.innerHTML = (f.dataset.k === 'cond' ? `<div class="box2"><b>Esta será a ${h.cond.length + 1}ª orientação de conduta deste colaborador.</b></div>` : '') + (partes.length ? `<div class="box2"><b>Histórico deste colaborador no sistema:</b> ${partes.join(' · ')}. ${h.adv.length || h.cond.length ? 'Considere a progressividade das medidas (orientação → advertência → suspensão) e a proporcionalidade.' : ''}</div>` : '<div class="box2 muted">Sem registros anteriores deste colaborador no sistema.</div>');
}
async function salvarEntidade(form, depois) {
  const k = form.dataset.k, E = ENT[k], L = await dados(E.col), cur = ed[k] ? L.find(r => r.id === ed[k]) : null;
  const o = lerCampos(form, E.f, cur || {});
  const d = (E.numerar && !o.numero) ? await salvarNumerado(E.col, o) : await salvar(E.col, o); limparCache(); ed[k] = null;
  notice(cur ? 'Registro atualizado.' : 'Registro salvo.');
  await render();
  if (depois === 'print') imprimirDoc(k, d);
}

/* ---------------- IA / regras: redação ---------------- */
async function motivoIA(e) {
  try { const c = e.context; if (c && c.json) { const j = await c.json(); if (j && j.erro) return j.erro + (j.detalhe ? ' — ' + j.detalhe : ''); } else if (c && c.status === 404) return 'função ia-assistente não encontrada neste projeto'; } catch (x) { /* segue */ }
  return (e && e.message) || 'IA indisponível';
}
async function ia(tarefa, d) {
  const r = await C().functions.invoke('ia-assistente', { body: { tarefa, dados: d } });
  if (r.error) throw new Error(await motivoIA(r.error));
  if (!r.data || r.data.erro) throw new Error(((r.data && r.data.erro) || 'IA indisponível') + (r.data && r.data.detalhe ? ' — ' + r.data.detalhe : ''));
  return r.data.conteudo;
}
async function redigir(d, b) {
  const f = b.closest('form'), ta = f.elements[d.k], tipo = d.tipo;
  const fatos = ta.value.trim(); if (!fatos) { notice('Escreva primeiro os fatos em tópicos no campo de texto.', true); return; }
  b.disabled = true; const t0 = b.textContent; b.textContent = 'Redigindo…';
  try {
    const out = await ia('redigir', { tipo, colaborador: f.elements.nome.value, cargo: f.elements.cargo.value, fatos });
    ta.value = out.texto || fatos; notice('Texto redigido pela IA. Revise antes de salvar.');
  } catch (e) {
    ta.value = modeloLocal(tipo, f, fatos); notice('IA indisponível (' + erroTxt(e) + '). Usei o modelo-padrão: complete e revise.', true);
  } finally { b.disabled = false; b.textContent = t0; }
}
function modeloLocal(tipo, f, fatos) {
  const lista = fatos.split(/\n+/).map(x => x.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean);
  const corpo = lista.join('; ');
  if (/orienta/i.test(tipo)) return `O(A) colaborador(a) está sendo orientado(a) quanto à conduta profissional observada em seus plantões: ${corpo}. A orientação tem caráter construtivo, com o objetivo de promover mudança de postura e crescimento profissional, e a continuidade do comportamento poderá ensejar medidas disciplinares.`;
  if (/advert/i.test(tipo)) return `Fica o(a) colaborador(a) advertido(a) em razão de: ${corpo}. Tais fatos contrariam as normas da unidade e prejudicam a dinâmica e a continuidade do serviço. Orienta-se a correção imediata da conduta, sendo que a reincidência poderá acarretar medidas disciplinares mais severas.`;
  return `Comunica-se o desligamento do(a) colaborador(a) em razão de: ${corpo}.`;
}

/* ---------------- Relatório de evolução ---------------- */
function calcularEvolucao(av, cond, adv) {
  const ordenadas = av.slice().sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const medias = ordenadas.map(a => mediaCrit(a.crit)).filter(x => x > 0);
  let base = 0;
  if (medias.length) { let ps = 0, ws = 0; medias.forEach((m, i) => { const w = i + 1; ps += m * w; ws += w; }); base = (ps / ws) * 20; }
  const pen = adv.reduce((s, a) => s + (/suspens/i.test(a.nivel) ? 10 : /escrita/i.test(a.nivel) ? 5 : 2), 0) + cond.length;
  const penal = Math.min(30, pen);
  const score = Math.max(0, Math.round(base - penal));
  const porCrit = CRITERIOS.map((c, i) => { const v = ordenadas.map(a => num((a.crit || [])[i])).filter(x => x > 0); return { chave: c[0], nome: c[1], media: v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0 }; });
  const fracos = porCrit.filter(c => c.media && c.media < 3).sort((a, b) => a.media - b.media);
  const fortes = porCrit.filter(c => c.media >= 4).sort((a, b) => b.media - a.media);
  const criticos = porCrit.filter(c => ['assid', 'hier', 'post', 'seg'].includes(c.chave) && c.media && c.media <= 2);
  const tendencia = medias.length >= 2 ? medias[medias.length - 1] - medias[0] : null;
  let rec = 'continuar';
  if (!medias.length) rec = 'sem_dados';
  else if (score < 55 || criticos.length >= 2) rec = 'nao_continuar';
  else if (score < 75 || criticos.length === 1 || adv.some(a => /suspens/i.test(a.nivel))) rec = 'continuar_com_acompanhamento';
  const confianca = medias.length >= 2 ? 'alta' : medias.length === 1 ? 'media' : 'baixa';
  return { score, base: Math.round(base), penal, medias, tendencia, porCrit, fracos, fortes, criticos, rec, confianca };
}
const REC = { continuar: ['Continuar', 'ok'], continuar_com_acompanhamento: ['Continuar com acompanhamento / prorrogar', 'warn'], nao_continuar: ['Não recomendada a continuidade', 'bad'], sem_dados: ['Sem avaliações suficientes', 'warn'] };
let EVOL = null;
async function viewEvol() {
  const L = await dados('evol');
  $('content').innerHTML = `<section class="view"><h2>Relatório de evolução</h2><p class="muted">Reúne as avaliações, orientações e advertências do colaborador, calcula uma pontuação e gera uma <b>recomendação de apoio à decisão</b> (continuar, acompanhar ou não continuar). A decisão final é sempre do gestor e do RH.</p>
  <div class="filtro"><label>Colaborador<input type="text" id="evNome" list="dlColab" autocomplete="off" placeholder="digite o nome" value="${esc(EVOL ? EVOL.nome : '')}"></label><button type="button" data-act="analisar">Analisar</button></div>
  <div id="evRes">${EVOL ? htmlEvol() : '<p class="muted">Escolha o colaborador e clique em Analisar.</p>'}</div>
  <h3>Relatórios salvos (${L.length})</h3><div class="table-wrap"><table><thead><tr><th>Data</th><th>Colaborador</th><th>Pontuação</th><th>Recomendação</th><th>Decisão do gestor</th><th>Ações</th></tr></thead><tbody>${L.sort((a, b) => String(b.data).localeCompare(String(a.data))).map(r => `<tr><td>${fd(r.data)}</td><td><b>${esc(r.nome)}</b></td><td>${esc(r.score)}</td><td>${esc((REC[r.rec] || ['', ''])[0])}</td><td>${esc(r.decisao || '—')}</td><td style="white-space:nowrap"><button type="button" class="small secondary" data-act="evPrint" data-id="${esc(r.id)}">Imprimir</button><button type="button" class="small danger" data-act="evDel" data-id="${esc(r.id)}">Excluir</button></td></tr>`).join('') || '<tr><td colspan="6">Nenhum relatório salvo.</td></tr>'}</tbody></table></div></section>`;
}
function htmlEvol() {
  const E = EVOL, c = E.calc, r = REC[c.rec];
  const crit = c.porCrit.filter(x => x.media).map(x => `<div class="barrow"><span>${esc(x.nome.split(' (')[0])}</span><div class="bar"><i style="width:${x.media / 5 * 100}%;background:${x.media < 3 ? '#c0392b' : x.media >= 4 ? '#12805c' : '#2672ce'}"></i></div><b>${x.media.toFixed(1)}</b></div>`).join('');
  const ai = E.ia;
  return `<div class="grow"><div class="box2"><div class="muted">Pontuação do sistema (0–100)</div><div class="big">${c.score}</div>
    <p class="muted">Base das avaliações: ${c.base} · Descontos por orientações/advertências: −${c.penal}${c.tendencia != null ? ` · Tendência: ${c.tendencia > 0.2 ? '↗ melhorando' : c.tendencia < -0.2 ? '↘ piorando' : '→ estável'}` : ''}</p>
    <span class="badge ${r[1]}">${esc(r[0])}</span> <span class="muted">confiança ${esc(c.confianca)} · ${E.nAval} avaliação(ões), ${E.nCond} orientação(ões), ${E.nAdv} advertência(s)</span></div>
    <div class="box2"><b>Média por critério</b>${crit || '<p class="muted">Sem notas.</p>'}</div></div>
  ${c.criticos.length ? `<div class="alert bad"><b>⛔</b><span>Critérios sensíveis com nota baixa: ${c.criticos.map(x => esc(x.nome.split(' (')[0])).join(', ')}.</span></div>` : ''}
  <div class="actions"><button type="button" data-act="parecerIA">✨ Pedir parecer da IA</button></div>
  ${ai ? `<div class="ia"><h4>Parecer da IA ${ai.local ? '(modelo local — função de IA indisponível)' : ''}</h4><p><b>Recomendação:</b> ${esc((REC[ai.recomendacao] || [ai.recomendacao])[0])} · confiança ${esc(ai.confianca || '')}</p><p>${esc(ai.resumo || '')}</p>
    ${(ai.pontos_fortes || []).length ? `<b>Pontos fortes</b><ul>${ai.pontos_fortes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${(ai.pontos_atencao || []).length ? `<b>Pontos de atenção</b><ul>${ai.pontos_atencao.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${(ai.plano_desenvolvimento || []).length ? `<b>Plano de desenvolvimento</b><ul>${ai.plano_desenvolvimento.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${(ai.cuidados_formais || []).length ? `<b>Cuidados formais</b><ul>${ai.cuidados_formais.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <p class="muted">Apoio à decisão. Não substitui a análise do gestor, do RH e do jurídico.</p></div>` : ''}
  <form id="evForm"><div class="grid"><label class="fld">Decisão do gestor<select name="decisao"><option value=""></option><option>Continuar / efetivar</option><option>Prorrogar a experiência / acompanhar</option><option>Desligar</option></select></label>
  <label class="fld full">Justificativa do gestor<textarea name="just"></textarea></label></div><div class="actions"><button type="submit">Salvar relatório</button><button type="submit" class="secondary" data-after="print">Salvar e imprimir</button></div></form>`;
}
async function analisar() {
  const nome = $('evNome').value.trim(); if (!nome) { notice('Informe o colaborador.', true); return; }
  const c0 = achaColab(nome), h = await historicoDe(nome, c0 ? c0.matricula : '');
  const calc = calcularEvolucao(h.aval, h.cond, h.adv);
  EVOL = { nome: c0 ? c0.nome : nome, matricula: c0 ? c0.matricula : '', cargo: c0 ? c0.cargo : '', setor: c0 ? c0.setor : '', calc, nAval: h.aval.length, nCond: h.cond.length, nAdv: h.adv.length, hist: h, ia: null };
  notice(''); $('evRes').innerHTML = htmlEvol();
}
function resumoParaIA() {
  const E = EVOL, h = E.hist;
  return { colaborador: E.nome, cargo: E.cargo, setor: E.setor, pontuacao: E.calc.score, recomendacao_regras: E.calc.rec, tendencia: E.calc.tendencia,
    medias_por_criterio: E.calc.porCrit.filter(x => x.media).map(x => ({ criterio: x.nome, media: Number(x.media.toFixed(2)) })),
    avaliacoes: h.aval.map(a => ({ data: a.data, periodo: a.periodo, media: Number(mediaCrit(a.crit).toFixed(2)), fortes: a.fortes, melhorar: a.melhorar, parecer: a.parecer })),
    orientacoes: h.cond.map(a => ({ data: a.data, relato: a.relato })), advertencias: h.adv.map(a => ({ data: a.data, medida: a.nivel, fato: a.fato })) };
}
async function parecerIA(b) {
  b.disabled = true; const t0 = b.textContent; b.textContent = 'Analisando…';
  try { EVOL.ia = await ia('evolucao', resumoParaIA()); }
  catch (e) { EVOL.ia = parecerLocal(); notice('IA indisponível (' + erroTxt(e) + '). Mostrando o parecer do modelo local.', true); }
  $('evRes').innerHTML = htmlEvol();
}
function parecerLocal() {
  const c = EVOL.calc;
  return { local: true, recomendacao: c.rec === 'sem_dados' ? 'continuar_com_acompanhamento' : c.rec, confianca: c.confianca,
    resumo: c.rec === 'sem_dados' ? 'Não há avaliações registradas; faça a avaliação de experiência antes de decidir.' : `Pontuação ${c.score}/100 com base em ${EVOL.nAval} avaliação(ões), ${EVOL.nCond} orientação(ões) e ${EVOL.nAdv} advertência(s).`,
    pontos_fortes: c.fortes.map(x => `${x.nome} (média ${x.media.toFixed(1)})`), pontos_atencao: c.fracos.map(x => `${x.nome} (média ${x.media.toFixed(1)})`),
    plano_desenvolvimento: c.fracos.slice(0, 3).map(x => `Acompanhar e orientar em: ${x.nome.split(' (')[0]}; reavaliar em 30 dias.`),
    cuidados_formais: ['Contrato de experiência: máximo de 90 dias no total (incluindo prorrogação).', 'Medidas disciplinares exigem registro prévio, proporcionalidade e imediatidade.', 'Decisão final do gestor com RH/jurídico.'] };
}

/* ---------------- documentos impressos ---------------- */
const logos = () => `<div class="logos"><img src="../../assets/logo-gnosis.jpg" alt="Instituto Gnosis"><img src="../../assets/logo-upa.png" alt="UPA Rocinha"></div>`;
const caixaCab = (r, assunto, extra) => `<table class="hdrbox"><tr><td>Data: ${fd(r.data)}</td><td>Nº: ${esc(r.numero || '')}</td></tr><tr><td>Unidade: ${esc(CFG.unidade)}</td><td>Funcionário: ${esc(r.nome)}</td></tr><tr><td colspan="2">Assunto: ${esc(assunto)}${extra || ''}</td></tr></table>`;
const assinaturas = (r, recusou) => `<div class="assin"><div>${recusou ? 'Colaborador recusou-se a assinar' : ''}<br>Funcionário(a)</div><div>${esc(CFG.coordNome)}<br>${esc(CFG.coordCargo)}${CFG.coordCnes ? '<br>CNES ' + esc(CFG.coordCnes) : ''}<br>Coordenador(a)</div><div>Testemunha</div><div>Testemunha</div></div>`;
function docCond(r) {
  return `${logos()}${caixaCab(r, r.assunto || 'Orientação de Conduta Profissional')}
  <p style="margin:14px 0">Eu, <b>${esc(r.nome)}</b>, com cargo de <b>${esc(r.cargo)}</b> lotado(a) no(a) ${esc(CFG.lotacao)}, reconheço que fui orientado(a) quanto à minha postura profissional. Os pontos negativos de minha conduta foram sinalizados a fim de promover mudança e crescimento profissional.</p>
  <p>Relato da orientação:</p><div class="rel">${esc(r.relato)}</div>
  <div class="obsbox">Observação do Colaborador sobre a Orientação:<br>${esc(r.obsColab || '')}</div>${assinaturas(r)}`;
}
function docAdv(r) {
  const susp = /suspens/i.test(r.nivel);
  return `${logos()}${caixaCab(r, 'Advertência Disciplinar — ' + (r.nivel || ''))}
  <p style="margin:14px 0">Eu, <b>${esc(r.nome)}</b>, com cargo de <b>${esc(r.cargo)}</b>${r.matricula ? ', matrícula ' + esc(r.matricula) : ''}, lotado(a) no(a) ${esc(CFG.lotacao)}, declaro ter tomado ciência da medida de <b>${esc(r.nivel)}</b>${susp && r.diasSusp ? ` (${esc(r.diasSusp)} dia(s))` : ''}, aplicada em ${fd(r.data)}${r.dataFato ? ', referente a fato ocorrido em ' + fd(r.dataFato) : ''}.</p>
  <p>Descrição do fato:</p><div class="rel">${esc(r.fato)}</div>
  ${r.norma ? `<p>Norma/regra descumprida:</p><div class="rel">${esc(r.norma)}</div>` : ''}${r.orient ? `<p>Orientação e expectativa:</p><div class="rel">${esc(r.orient)}</div>` : ''}
  <p style="margin-top:10px"><small>A reincidência poderá acarretar a aplicação de medidas disciplinares mais severas, nos termos da legislação trabalhista e das normas da instituição. A assinatura atesta apenas a ciência, não a concordância.</small></p>
  <div class="obsbox">Manifestação do Colaborador:<br>${esc(r.obsColab || '')}</div>${assinaturas(r, r.recusou === 'Sim')}`;
}
async function docDeslHtml(r) {
  const h = await historicoDe(r.nome, r.matricula);
  const linhasHist = [...h.aval.map(a => [a.data, 'Avaliação de experiência (' + (a.periodo || '') + ')', 'Média ' + mediaCrit(a.crit).toFixed(1) + '/5']), ...h.cond.map(a => [a.data, 'Orientação de conduta nº ' + (a.numero || ''), String(a.relato || '').slice(0, 110)]), ...h.adv.map(a => [a.data, a.nivel + ' nº ' + (a.numero || ''), String(a.fato || '').slice(0, 110)])].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return `${logos()}${caixaCab(r, 'Relatório de Desligamento')}
  <table class="t kv"><tr><td>Colaborador</td><td>${esc(r.nome)}${r.matricula ? ' · matrícula ' + esc(r.matricula) : ''}</td></tr><tr><td>Cargo / setor</td><td>${esc(r.cargo)} · ${esc(r.setor)}</td></tr><tr><td>Admissão</td><td>${fd(r.admissao)}</td></tr><tr><td>Tipo de desligamento</td><td>${esc(r.tipo)}</td></tr><tr><td>Último dia trabalhado</td><td>${fd(r.ultimoDia)}</td></tr><tr><td>Aviso prévio</td><td>${esc(r.aviso || '')}</td></tr></table>
  <p><b>Motivo / fundamentação:</b></p><div class="rel">${esc(r.motivo)}</div>
  <p style="margin-top:12px"><b>Histórico funcional registrado no sistema:</b></p>
  <table class="t"><thead><tr><th>Data</th><th>Registro</th><th>Resumo</th></tr></thead><tbody>${linhasHist.map(x => `<tr><td>${fd(x[0])}</td><td>${esc(x[1])}</td><td>${esc(x[2])}</td></tr>`).join('') || '<tr><td colspan="3">Sem registros anteriores.</td></tr>'}</tbody></table>
  <p><b>Providências:</b></p><table class="t">${CHECK_DESL.map(c => `<tr><td style="width:7%">${(r.checks || []).indexOf(c) >= 0 ? '☑' : '☐'}</td><td>${esc(c)}</td></tr>`).join('')}</table>
  ${r.obsGestor ? `<p><b>Observações:</b></p><div class="rel">${esc(r.obsGestor)}</div>` : ''}${assinaturas(r)}`;
}
function docAval(r) {
  const m = mediaCrit(r.crit);
  return `${logos()}<table class="hdrbox"><tr><td>Data: ${fd(r.data)}</td><td>Período: ${esc(r.periodo || '')}</td></tr><tr><td>Unidade: ${esc(CFG.unidade)}</td><td>Funcionário: ${esc(r.nome)}</td></tr><tr><td colspan="2">Assunto: Avaliação de Experiência · Cargo: ${esc(r.cargo)} · Admissão: ${fd(r.admissao)}</td></tr></table>
  <table class="t"><thead><tr><th>Critério</th><th style="width:22%">Nota</th></tr></thead><tbody>${CRITERIOS.map((c, i) => `<tr><td>${esc(c[1])}</td><td>${ESCALA.find(e => e[0] === num((r.crit || [])[i]))[1]}</td></tr>`).join('')}<tr><td><b>Média</b></td><td><b>${m ? m.toFixed(1) + ' / 5' : '—'}</b></td></tr></tbody></table>
  <p><b>Pontos fortes:</b></p><div class="rel">${esc(r.fortes || '')}</div><p><b>Pontos a melhorar / ocorrências:</b></p><div class="rel">${esc(r.melhorar || '')}</div>
  <p><b>Parecer do avaliador:</b> ${esc(r.parecer || '')} — ${esc(r.avaliador || '')}</p>${assinaturas(r)}`;
}
async function docDesl(r) { return docDeslHtml(r); }
function docEvol(r) {
  const c = r.calc, ai = r.ia;
  return `${logos()}<table class="hdrbox"><tr><td>Data: ${fd(r.data)}</td><td>Pontuação: ${esc(r.score)}/100</td></tr><tr><td>Unidade: ${esc(CFG.unidade)}</td><td>Funcionário: ${esc(r.nome)}</td></tr><tr><td colspan="2">Assunto: Relatório de Evolução do Colaborador · Cargo: ${esc(r.cargo)}</td></tr></table>
  <table class="t kv"><tr><td>Recomendação do sistema</td><td>${esc((REC[r.rec] || [''])[0])} (confiança ${esc(c.confianca)})</td></tr><tr><td>Base considerada</td><td>${esc(r.nAval)} avaliação(ões), ${esc(r.nCond)} orientação(ões), ${esc(r.nAdv)} advertência(s)</td></tr><tr><td>Pontuação</td><td>Avaliações: ${c.base} · descontos: −${c.penal} · final: ${esc(r.score)}</td></tr></table>
  <table class="t"><thead><tr><th>Critério</th><th style="width:15%">Média</th></tr></thead><tbody>${c.porCrit.filter(x => x.media).map(x => `<tr><td>${esc(x.nome)}</td><td>${x.media.toFixed(1)}</td></tr>`).join('')}</tbody></table>
  ${ai ? `<p><b>Parecer de apoio (${ai.local ? 'modelo local' : 'IA'}):</b> ${esc(ai.resumo || '')}</p>${(ai.pontos_atencao || []).length ? `<p><b>Pontos de atenção:</b></p><ul>${ai.pontos_atencao.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${(ai.plano_desenvolvimento || []).length ? `<p><b>Plano de desenvolvimento:</b></p><ul>${ai.plano_desenvolvimento.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}` : ''}
  <p><b>Decisão do gestor:</b> ${esc(r.decisao || '—')}</p><div class="rel">${esc(r.just || '')}</div>
  <p class="nota" style="font-size:8.5pt;border:1px solid #999;padding:6px 8px">Este relatório é instrumento de apoio à decisão. A decisão final é do gestor, com o RH/jurídico, conforme a legislação trabalhista e as normas da instituição.</p>
  <div class="assin"><div>${esc(CFG.coordNome)}<br>${esc(CFG.coordCargo)}<br>Coordenador(a)</div><div>RH / Gestor(a) Assistencial</div></div>`;
}
async function imprimirDoc(k, r) {
  const E = ENT[k]; const html = await E.imprimir(r);
  const root = $('printRoot'); root.innerHTML = `<div class="doc">${html}</div>`; root.classList.remove('hidden');
  setTimeout(() => { window.print(); root.classList.add('hidden'); }, 150);
}
function imprimirHtml(html) { const root = $('printRoot'); root.innerHTML = `<div class="doc">${html}</div>`; root.classList.remove('hidden'); setTimeout(() => { window.print(); root.classList.add('hidden'); }, 150); }

/* ---------------- Painel ---------------- */
async function viewPainel() {
  const [av, co, ad, de] = (await Promise.all([dados('aval'), dados('cond'), dados('adv'), dados('desl')])).map(vivos);
  const ano = hoje().slice(0, 4), noAno = L => L.filter(r => String(r.data || '').slice(0, 4) === ano).length;
  const alertas = [];
  COLABS.forEach(c => {
    if (!c.admissao) return; const d = diasEntre(String(c.admissao).slice(0, 10), hoje()); if (d < 0 || d > 100) return;
    const tem = p => av.some(a => (semAc(a.nome) === semAc(c.nome)) && a.periodo === p);
    if (d >= 35 && d <= 50 && !tem('45 dias')) alertas.push(['warn', `${c.nome}: avaliação de 45 dias pendente (admissão em ${fd(c.admissao)}, ${d} dias).`]);
    if (d >= 80 && d <= 95 && !tem('90 dias')) alertas.push(['bad', `${c.nome}: avaliação de 90 dias pendente — fim da experiência próximo (admissão em ${fd(c.admissao)}, ${d} dias).`]);
  });
  const des = de.filter(r => (r.checks || []).length < CHECK_DESL.length);
  if (des.length) alertas.push(['warn', `${des.length} desligamento(s) com providências incompletas.`]);
  $('content').innerHTML = `<section class="view"><h2>Painel de RH e DP</h2><p class="muted">Dados protegidos: visíveis só para os coordenadores cadastrados. ${COLABS.length} colaborador(es) na base (RH/EPI).</p>
  <div class="stats"><div class="stat">Avaliações em ${ano}<strong>${noAno(av)}</strong></div><div class="stat">Orientações em ${ano}<strong>${noAno(co)}</strong></div><div class="stat warn">Advertências em ${ano}<strong>${noAno(ad)}</strong></div><div class="stat">Desligamentos em ${ano}<strong>${noAno(de)}</strong></div></div>
  ${dashQualidade(av, co, ad, ano)}
  <h3>Alertas</h3>${alertas.length ? alertas.map(a => `<div class="alert ${a[0]}"><b>${a[0] === 'bad' ? '⛔' : '⚠'}</b><span>${esc(a[1])}</span></div>`).join('') : '<div class="alert ok"><b>✔</b><span>Nenhuma avaliação de experiência pendente.</span></div>'}
  <h3>Como usar</h3><ol><li>Faça a <b>Avaliação de experiência</b> aos 45 e aos 90 dias.</li><li>Registre <b>Orientações de conduta</b> e <b>Advertências</b> quando necessário.</li><li>No <b>Relatório de evolução</b>, o sistema soma tudo e recomenda continuar, acompanhar ou não continuar (apoio à decisão).</li><li>Se houver desligamento, preencha o <b>Relatório de desligamento</b> e as providências.</li></ol></section>`;
}
function dashQualidade(av, co, ad, ano) {
  const por = new Map();
  const reg = (r, k) => { const key = r.matricula ? 'm' + r.matricula : 'n' + semAc(r.nome); const o = por.get(key) || { nome: r.nome, cond: 0, condAno: 0, adv: 0, aval: [], ult: '' }; if (k === 'aval') { const m = mediaCrit(r.crit); if (m) o.aval.push(m); } else { o[k]++; if (String(r.data || '').slice(0, 4) === ano && k === 'cond') o.condAno++; if (String(r.data) > o.ult) o.ult = r.data; } por.set(key, o); };
  co.forEach(r => reg(r, 'cond')); ad.forEach(r => reg(r, 'adv')); av.forEach(r => reg(r, 'aval'));
  const L = Array.from(por.values()).sort((a, b) => b.cond - a.cond || b.adv - a.adv || a.nome.localeCompare(b.nome));
  const max = Math.max(1, ...L.map(x => x.cond));
  const meses = {}; co.forEach(r => { const m = String(r.data || '').slice(0, 7); if (m) meses[m] = (meses[m] || 0) + 1; });
  const ml = Object.keys(meses).sort().slice(-8), mm = Math.max(1, ...ml.map(m => meses[m]));
  const reinc = L.filter(x => x.cond >= 3 || (x.cond >= 1 && x.adv >= 1));
  return `<h3>Qualidade: orientações e advertências por colaborador</h3>
  <div class="box2">${L.filter(x => x.cond).map(x => `<div class="barrow"><span>${esc(x.nome)}</span><div class="bar"><i style="width:${x.cond / max * 100}%;background:${x.cond >= 3 ? '#c0392b' : '#2672ce'}"></i></div><b>${x.cond}</b></div>`).join('') || '<p class="muted">Nenhuma orientação registrada.</p>'}<p class="muted">Vermelho = 3 ou mais orientações (reincidência).</p></div>
  ${reinc.length ? `<div class="alert warn"><b>⚠</b><span>Atenção à reincidência: ${reinc.map(x => esc(x.nome) + ' (' + x.cond + ' orient., ' + x.adv + ' adv.)').join('; ')}.</span></div>` : ''}
  <div class="box2"><b>Orientações por mês</b>${ml.map(m => `<div class="barrow"><span>${m.slice(5)}/${m.slice(0, 4)}</span><div class="bar"><i style="width:${meses[m] / mm * 100}%;background:#12805c"></i></div><b>${meses[m]}</b></div>`).join('') || '<p class="muted">Sem dados.</p>'}</div>
  <div class="table-wrap"><table><thead><tr><th>Colaborador</th><th>Orientações (total)</th><th>Em ${ano}</th><th>Advertências</th><th>Média das avaliações</th><th>Última ocorrência</th></tr></thead><tbody>${L.map(x => `<tr><td><b>${esc(x.nome)}</b></td><td>${x.cond}</td><td>${x.condAno}</td><td>${x.adv}</td><td>${x.aval.length ? (x.aval.reduce((s, v) => s + v, 0) / x.aval.length).toFixed(1) : '—'}</td><td>${fd(x.ult)}</td></tr>`).join('') || '<tr><td colspan="6">Sem registros.</td></tr>'}</tbody></table></div>`;
}
/* Quadro de progressão disciplinar: 1ª a 5ª orientação > advertência > suspensão (1 a 3 dias) > demissão */
const QCOLS = ['1ª orientação', '2ª orientação', '3ª orientação', '4ª orientação', '5ª orientação', 'Advertência', 'Suspensão 1 dia', 'Suspensão 2 dias', 'Suspensão 3 dias', 'Demissão'];
async function montarQuadro() {
  const [co, ad, de] = (await Promise.all([dados('cond'), dados('adv'), dados('desl')])).map(vivos);
  const por = new Map();
  const get = r => { const k = r.matricula ? 'm' + r.matricula : 'n' + semAc(r.nome); if (!por.has(k)) por.set(k, { nome: r.nome, matricula: r.matricula || '', cargo: r.cargo || '', c: Array(10).fill(''), extra: 0, ult: '' }); const o = por.get(k); if (!o.cargo && r.cargo) o.cargo = r.cargo; return o; };
  const marca = (o, i, txt, d) => { o.c[i] = o.c[i] ? o.c[i] + ' / ' + txt : txt; if (String(d) > o.ult) o.ult = d; };
  co.sort((a, b) => String(a.data).localeCompare(String(b.data))).forEach(r => { const o = get(r); const n = o.c.slice(0, 5).filter(Boolean).length; const t = fd(r.data) + (r.numero ? ' (nº ' + r.numero + ')' : ''); if (n < 5) marca(o, n, t, r.data); else { o.extra++; marca(o, 4, '+' + fd(r.data), r.data); } });
  ad.sort((a, b) => String(a.data).localeCompare(String(b.data))).forEach(r => { const o = get(r), t = fd(r.data) + (r.numero ? ' (nº ' + r.numero + ')' : ''); if (/suspens/i.test(r.nivel)) { const d = Math.min(3, Math.max(1, parseInt(r.diasSusp, 10) || 1)); marca(o, 5 + d, t + (parseInt(r.diasSusp, 10) > 3 ? ' [' + r.diasSusp + ' dias]' : ''), r.data); } else marca(o, 5, t + (/verbal/i.test(r.nivel) ? ' (verbal)' : ''), r.data); });
  de.forEach(r => { const o = get(r); marca(o, 9, fd(r.data) + ' · ' + (r.tipo || ''), r.data); });
  const nivel = o => { for (let i = 9; i >= 0; i--) if (o.c[i]) return i; return -1; };
  return Array.from(por.values()).map(o => ({ ...o, nivel: nivel(o) })).sort((a, b) => b.nivel - a.nivel || a.nome.localeCompare(b.nome, 'pt-BR'));
}
async function viewQuadro() {
  const Q = await montarQuadro(), cor = i => i >= 9 ? '#f3c5c5' : i >= 6 ? '#f9d9b8' : i === 5 ? '#fbe8a6' : i >= 0 ? '#dcebfa' : '';
  $('content').innerHTML = `<section class="view"><h2>Quadro de progressão disciplinar</h2><p class="muted">Um colaborador por linha, com a data de cada etapa: 1ª a 5ª orientação, advertência, suspensão (1 a 3 dias) e demissão. Montado automaticamente a partir dos documentos registrados (cancelados não entram).</p>
  <div class="actions"><button type="button" data-act="qXlsx">⬇ Baixar planilha (Excel)</button><button type="button" class="secondary" data-act="qPrint">Imprimir quadro</button></div>
  <div class="table-wrap"><table id="tabQ"><thead><tr><th>Colaborador</th><th>Cargo</th>${QCOLS.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${Q.map(o => `<tr><td><b>${esc(o.nome)}</b>${o.matricula ? '<br><small>mat. ' + esc(o.matricula) + '</small>' : ''}</td><td>${esc(o.cargo)}</td>${o.c.map((v, i) => `<td${v ? ` style="background:${cor(i)}"` : ''}>${esc(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="12">Nenhum registro ainda.</td></tr>`}</tbody></table></div>
  <p class="muted">Cores: azul = orientação · amarelo = advertência · laranja = suspensão · vermelho = demissão. Se houver mais de 5 orientações, as seguintes aparecem na coluna da 5ª com "+".</p></section>`;
}
async function quadroXlsx() {
  if (typeof XLSX === 'undefined') { notice('Biblioteca de planilhas não carregou. Verifique a internet.', true); return; }
  const Q = await montarQuadro();
  const rows = Q.map(o => { const r = { Colaborador: o.nome, Matrícula: o.matricula, Cargo: o.cargo }; QCOLS.forEach((c, i) => { r[c] = o.c[i]; }); r['Orientações extras (além da 5ª)'] = o.extra || ''; return r; });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Progressão'); XLSX.writeFile(wb, `quadro_progressao_${hoje()}.xlsx`);
}
async function viewCfg() {
  $('content').innerHTML = `<section class="view"><h2>Configurações dos documentos</h2><p class="muted">Dados que saem no cabeçalho e nas assinaturas.</p>
  <form id="cfgForm"><div class="grid"><label class="fld">Unidade<input name="unidade" value="${esc(CFG.unidade)}"></label><label class="fld">Lotação (texto do documento)<input name="lotacao" value="${esc(CFG.lotacao)}"></label>
  <label class="fld">Coordenador(a) que assina<input name="coordNome" value="${esc(CFG.coordNome)}"></label><label class="fld">Cargo<input name="coordCargo" value="${esc(CFG.coordCargo)}"></label><label class="fld">CNES (opcional)<input name="coordCnes" value="${esc(CFG.coordCnes)}"></label></div>
  <div class="actions"><button type="submit">Salvar</button></div></form>
  <h3>IA</h3><p class="muted">A IA usa a função <code>ia-assistente</code> do Supabase (veja o LEIA-ME). Sem ela, o sistema usa regras e modelos locais.</p></section>`;
}

/* ---------------- ações / navegação ---------------- */
const acoes = {
  async edit(d) { ed[view] = d.id; await render(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  async cancelar() { ed[view] = null; await render(); },
  async print(d) { const r = (await dados(ENT[view].col)).find(x => x.id === d.id); if (r) await imprimirDoc(view, r); },
  async del(d) {
    const E = ENT[view];
    if (E.numerar) { if (!confirm('Este documento é numerado. Ele será marcado como CANCELADO (o número não é reutilizado e deixa de contar nos indicadores). Continuar?')) return; const r = (await dados(E.col)).find(x => x.id === d.id); await salvar(E.col, { ...r, cancelado: true, canceladoEm: hoje() }); limparCache(); notice('Documento cancelado.'); await render(); return; }
    if (!confirm('Excluir este registro?')) return; await excluir(d.id); limparCache(); notice('Registro excluído.'); await render(); },
  async redigir(d, b) { await redigir(d, b); },
  async qXlsx() { await quadroXlsx(); },
  async qPrint() { imprimirHtml('<h2 style="text-align:center">Quadro de progressão disciplinar</h2>' + $('tabQ').outerHTML); },
  async analisar() { await analisar(); },
  async parecerIA(d, b) { await parecerIA(b); },
  async evPrint(d) { const r = (await dados('evol')).find(x => x.id === d.id); if (r) imprimirHtml(docEvol(r)); },
  async evDel(d) { if (!confirm('Excluir este relatório?')) return; await excluir(d.id); limparCache(); await render(); }
};
async function render() {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.v === view));
  try {
    if (view === 'painel') await viewPainel(); else if (view === 'evol') await viewEvol(); else if (view === 'cfg') await viewCfg(); else if (view === 'quadro') await viewQuadro(); else await viewEntity(view);
  } catch (e) { notice(erroTxt(e), true); }
}
function ligar() {
  $('nav').innerHTML = VIEWS.map(v => `<button type="button" data-v="${v[0]}">${v[1]}</button>`).join('');
  $('nav').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; view = b.dataset.v; notice(''); limparCache(); render(); });
  const c = $('content');
  c.addEventListener('click', async e => { const b = e.target.closest('[data-act]'); if (!b) return; try { await acoes[b.dataset.act](b.dataset, b, e); } catch (err) { notice(erroTxt(err), true); } });
  let depois = null; c.addEventListener('click', e => { const b = e.target.closest('button[type=submit]'); depois = b ? b.dataset.after || null : null; }, true);
  c.addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target, btn = f.querySelector('button[type=submit]');
    try {
      if (f.id === 'ef') await salvarEntidade(f, depois);
      else if (f.id === 'cfgForm') { const fd2 = new FormData(f); CFG = { ...CFG, id: CFG_ID }; ['unidade', 'lotacao', 'coordNome', 'coordCargo', 'coordCnes'].forEach(k => { CFG[k] = String(fd2.get(k) || '').trim(); }); await salvar('cfg', CFG); limparCache(); notice('Configurações salvas.'); }
      else if (f.id === 'evForm') {
        if (!EVOL) return; const g = new FormData(f);
        const d = await salvar('evol', { data: hoje(), nome: EVOL.nome, matricula: EVOL.matricula, cargo: EVOL.cargo, setor: EVOL.setor, score: EVOL.calc.score, rec: EVOL.calc.rec, calc: EVOL.calc, nAval: EVOL.nAval, nCond: EVOL.nCond, nAdv: EVOL.nAdv, ia: EVOL.ia, decisao: g.get('decisao'), just: g.get('just') });
        limparCache(); notice('Relatório de evolução salvo.'); const eu = EVOL; await render(); EVOL = eu; if (depois === 'print') imprimirHtml(docEvol(d));
      }
    } catch (err) { notice(erroTxt(err), true); }
  });
  c.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'busca') { flt[view] = t.value; clearTimeout(ligar.t); ligar.t = setTimeout(async () => { const pos = t.selectionStart; await render(); const n = $('busca'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 300); }
    if (t.dataset && t.dataset.colab) {
      const col = achaColab(t.value), f = t.form;
      if (col) { [['matricula', col.matricula], ['cargo', col.cargo], ['setor', col.setor], ['admissao', col.admissao ? String(col.admissao).slice(0, 10) : '']].forEach(([k, v]) => { if (f.elements[k] && v) f.elements[k].value = v; }); }
      atualizaHist();
    }
  });
}
async function init() {
  try { await UPA.ready(); } catch (e) { notice(UPA.msg(e), true); return; }
  ligar();
  try { await Promise.all([carregarColabs(), carregarCfg()]); } catch (e) { notice(erroTxt(e), true); }
  await render();
}
init();
