'use strict';
/* Liga o relatório mensal da Manutenção aos chamados da Central de Serviços.
   Botão na seção 3: traz os chamados da empresa/competência para "Controle de intervenções"
   e os chamados em aberto para "Pendências". Pode ser repetido: atualiza o que já veio da Central. */
(function () {
  var TIPO = { 'Corretiva': 'Corretiva', 'Preventiva': 'Preventiva', 'Inspeção': 'Inspeção', 'Obra': 'Obra', 'Outro': '' };
  var STATUS_INT = { 'Realizado': 'Concluída', 'Solicitado': 'Pendente', 'Programado': 'Pendente', 'Em execução': 'Pendente', 'Não realizado': 'Pendente' };
  var RISCO = { 'Imediata': 'Imediata', 'Alta': 'Alta', 'Rotina': 'Baixa' };
  var fechado = function (c) { return c.execution === 'Realizado' || c.execution === 'Não realizado'; };
  var msgEl = null;
  function say(t, ok) { if (msgEl) { msgEl.textContent = t; msgEl.style.color = ok ? '#16815d' : '#a51e30'; } }

  function upsert(list, row) {
    var i = list.findIndex(function (x) { return x.callId === row.callId; });
    if (i >= 0) { list[i] = Object.assign({}, list[i], row); return 'u'; }
    list.push(row); return 'a';
  }

  async function pull() {
    var r = current();
    if (!r) return;
    if (!r.company) { say('Selecione a empresa executora (cadastrada na Central) antes de puxar os chamados.', false); return; }
    say('Buscando chamados na Central…', true);
    try {
      var res = await Promise.all(['central_empresas', 'central_chamados', 'central_anexos'].map(function (c) { return UPA.db.list(c); }));
      var emp = res[0].map(function (x) { return x.dados; }).find(function (e) { return e.name === r.company; });
      if (!emp) { say('A empresa "' + r.company + '" não está cadastrada na Central. Cadastre-a em Central de Serviços → Empresas.', false); return; }
      var files = res[2].map(function (x) { return x.dados; });
      var calls = res[1].map(function (x) { return x.dados; }).filter(function (c) { return c.company === emp.id; });
      var doMes = calls.filter(function (c) { return String(c.performed || c.opened || '').slice(0, 7) === r.period; });
      var abertos = calls.filter(function (c) { return !fechado(c); });
      r.interventions = r.interventions || []; r.pending = r.pending || [];
      var n = { a: 0, u: 0 };
      var evid = function (c) {
        var nomes = files.filter(function (f) { return f.callId === c.id; }).map(function (f) { return f.name; });
        var at = c.attestation && c.attestation !== 'Não informado' ? 'Atesto: ' + c.attestation + (c.custodian ? ' — ' + c.custodian : '') : '';
        return [at, nomes.length ? 'Anexos: ' + nomes.join(', ') : ''].filter(Boolean).join(' · ');
      };
      doMes.forEach(function (c) {
        n[upsert(r.interventions, {
          callId: c.id, date: c.performed || c.opened || '', os: c.reference || '',
          asset: [c.sector, c.asset].filter(Boolean).join(' / '), type: TIPO[c.type] || '',
          description: [c.description, c.notes].filter(Boolean).join(' — '), executor: emp.name,
          status: STATUS_INT[c.execution] || 'Pendente', evidence: evid(c)
        })]++;
      });
      abertos.forEach(function (c) {
        n[upsert(r.pending, {
          callId: c.id, finding: [c.sector, c.description].filter(Boolean).join(' — ') + (c.reference ? ' (OS ' + c.reference + ')' : ''),
          risk: RISCO[c.priority] || 'Moderada', containment: '', owner: emp.name, due: c.due || '',
          status: c.execution === 'Em execução' ? 'Em andamento' : 'Aberta', evidence: evid(c)
        })]++;
      });
      r.updatedAt = new Date().toISOString();
      persist(); renderForm();
      // renderForm recria o botão: mostra o resultado no novo elemento
      msgEl = document.getElementById('centralLinkMsg');
      say(doMes.length + abertos.length === 0
        ? 'Nenhum chamado desta empresa em ' + r.period + ' e nenhum em aberto.'
        : n.a + ' registro(s) novo(s) e ' + n.u + ' atualizado(s) a partir da Central (intervenções do mês: ' + doMes.length + '; pendências em aberto: ' + abertos.length + ').', true);
    } catch (e) { say('Não foi possível ler a Central: ' + UPA.msg(e), false); }
  }

  function inject() {
    var art = Array.prototype.find.call(document.querySelectorAll('#form article'), function (a) {
      var h = a.querySelector('h2'); return h && /^3\./.test(h.textContent.trim());
    });
    if (!art || art.querySelector('.central-link')) return;
    var box = document.createElement('div');
    box.className = 'central-link';
    box.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#eef4fb;border:1px solid #d4e1f2;border-radius:10px;padding:10px 12px;margin-bottom:12px';
    box.innerHTML = '<button type="button" id="centralLinkBtn">⇄ Puxar chamados da Central</button>' +
      '<span style="font-size:12px;color:#60718a;flex:1;min-width:200px">Traz os chamados da empresa e da competência deste relatório para esta tabela, e os em aberto para “5. Pendências”. Pode repetir quando quiser: atualiza o que veio da Central.</span>' +
      '<span id="centralLinkMsg" role="status" style="font-size:12px;font-weight:650;width:100%"></span>';
    art.querySelector('h2').insertAdjacentElement('afterend', box);
    msgEl = box.querySelector('#centralLinkMsg');
    box.querySelector('#centralLinkBtn').onclick = pull;
  }

  var base = window.renderForm;
  window.renderForm = function () { base.apply(this, arguments); inject(); };
  UPA.ready().then(function () { renderForm(); }).catch(function () {});
})();
