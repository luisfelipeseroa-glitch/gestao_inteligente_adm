'use strict';
/* Manutenção: sincroniza os relatórios com o banco único (Supabase).
   Os relatórios continuam no navegador como cópia; o banco é a fonte compartilhada. */
(function () {
  var COL = 'manut_relatorios';
  var known = new Map();           // id -> última versão sincronizada (texto canônico)
  var timer = null, busy = false, again = false, ready = false;
  var canon = function (o) {
    return JSON.stringify(o, function (k, v) {
      return v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce(function (a, x) { a[x] = v[x]; return a; }, {}) : v;
    });
  };
  var blank = function (r) { return !r.company && Object.keys(sections).every(function (k) { return !(r[k] || []).length; }); };
  var state = function (t) { var el = document.getElementById('saveState'); if (el) el.textContent = t; };
  var hhmm = function () { return new Date().toLocaleTimeString('pt-BR'); };

  async function pull() {
    var rows = await UPA.db.list(COL), changed = false;
    known = new Map();
    rows.forEach(function (row) {
      var rem = row.dados; if (!rem || !rem.id) return;
      known.set(rem.id, canon(rem));
      var i = reports.findIndex(function (r) { return r.id === rem.id; });
      if (i < 0) { reports.push(rem); changed = true; }
      else if ((rem.updatedAt || '') > (reports[i].updatedAt || '') && canon(rem) !== canon(reports[i])) { reports[i] = rem; changed = true; }
    });
    // descarta o relatório em branco criado automaticamente quando já existe algum de verdade
    if (reports.some(function (r) { return !blank(r); }) && reports.some(blank)) {
      var keepId = reports.some(function (r) { return r.id === active && !blank(r); }) ? active : null;
      reports = reports.filter(function (r) { return !blank(r); });
      if (!keepId) active = reports[0].id;
      changed = true;
    }
    return changed;
  }

  async function push() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      state('Salvando no banco…');
      for (var i = 0; i < reports.length; i++) {
        var r = reports[i]; if (blank(r)) continue;
        var c = canon(r);
        if (known.get(r.id) !== c) { await UPA.db.put(COL, r.id, r); known.set(r.id, c); }
      }
      var ids = new Set(reports.map(function (r) { return r.id; }));
      for (var id of Array.from(known.keys())) {
        if (!ids.has(id)) { await UPA.db.del(id); known.delete(id); }
      }
      state('Salvo no banco · ' + hhmm());
    } catch (e) {
      state('Erro ao salvar no banco: ' + UPA.msg(e) + ' (cópia mantida neste navegador)');
    } finally {
      busy = false;
      if (again) { again = false; schedule(); }
    }
  }
  function schedule() { if (!ready) return; clearTimeout(timer); timer = setTimeout(push, 1200); }

  var basePersist = window.persist;
  window.persist = function () { basePersist(); state('Alterações pendentes…'); schedule(); };

  async function refresh(first) {
    try {
      var changed = await pull();
      if (changed) { basePersist(); render(); }
      ready = true;
      await push();
    } catch (e) { state('Sem conexão com o banco: ' + UPA.msg(e) + ' (usando a cópia deste navegador)'); }
  }
  UPA.ready().then(function () { return refresh(true); }).catch(function (e) { state('Banco indisponível: ' + UPA.msg(e)); });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && ready && !timer && !busy) refresh(false);
  });
})();

/* Empresa executora: escolher entre as empresas cadastradas na Central de Serviços (fonte única). */
(function () {
  var empresas = [];
  var baseControl = window.control;
  var esc2 = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  window.control = function (key, label, type, choices, val, scope, idx) {
    if (key === 'company' && (scope === undefined || scope === 'field') && empresas.length) {
      var names = empresas.map(function (e) { return e.name; }).filter(Boolean);
      if (val && names.indexOf(val) < 0) names.push(val);   // mantém nome antigo digitado à mão
      var opts = '<option value="">Selecione a empresa cadastrada…</option>' + names.map(function (n) {
        return '<option value="' + esc2(n) + '"' + (n === val ? ' selected' : '') + '>' + esc2(n) + '</option>';
      }).join('');
      return '<label>' + esc2(label) + '<select data-scope="field" data-key="company">' + opts + '</select>' +
        '<small style="font-weight:400;color:#60718a">Não encontrou? Cadastre em <b>Central de Serviços → Empresas</b>.</small></label>';
    }
    return baseControl.apply(this, arguments);
  };
  async function loadEmpresas() {
    try {
      var rows = await UPA.db.list('central_empresas');
      empresas = rows.map(function (r) { return r.dados; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'pt-BR'); });
    } catch (e) { /* sem conexão: mantém o campo como está */ }
  }
  async function refresh() {
    var before = JSON.stringify(empresas.map(function (e) { return e.name; }));
    await loadEmpresas();
    if (before !== JSON.stringify(empresas.map(function (e) { return e.name; }))) {
      var a = document.activeElement;
      if (!(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && document.getElementById('form').contains(a))) renderForm();
    }
  }
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || t.dataset.key !== 'company' || t.dataset.scope !== 'field') return;
    var emp = empresas.find(function (x) { return x.name === t.value; });
    if (!emp) return;
    var r = current(); if (!r) return;
    if (!r.contact) r.contact = [emp.contact, emp.email].filter(Boolean).join(' · ');
    if (!r.technical && emp.technical) r.technical = emp.technical;
    r.updatedAt = new Date().toISOString();
    persist(); renderForm();
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-tab="report"],#new,[data-tab-jump="report"]')) refresh();
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  UPA.ready().then(loadEmpresas).then(function () { renderForm(); }).catch(function () {});
})();
