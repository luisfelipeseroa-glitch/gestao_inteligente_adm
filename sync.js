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
