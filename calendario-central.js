'use strict';
/* Calendário de preventivas: além do plano preventivo dos relatórios mensais, mostra os serviços
   lançados na Central de Serviços (de todas as empresas): previsto = prazo (ou abertura), executado = data realizada. */
(function () {
  var cache = null, quando = 0;
  async function chamados() {
    if (cache && Date.now() - quando < 20000) return cache;
    var res = await Promise.all(['central_empresas', 'central_chamados'].map(function (c) { return UPA.db.list(c); }));
    var emp = {}; res[0].forEach(function (x) { emp[x.dados.id] = x.dados.name; });
    cache = res[1].map(function (x) { return Object.assign({}, x.dados, { _empresa: emp[x.dados.company] || '—' }); }); quando = Date.now();
    return cache;
  }
  var dias = function (a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); };
  var fd = function (s) { var m = String(s || '').match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? m[3] + '/' + m[2] + '/' + m[1] : (s || '—'); };
  async function completar() {
    var box = document.getElementById('calendarTable'); if (!box || !window.UPA) return;
    try {
      var mes = document.getElementById('filterMonth').value, emp = document.getElementById('filterCompany').value;
      var rel = filter().flatMap(function (r) { return (r.preventives || []).map(function (x) { return { ord: x.planned || '', emp: r.company || '—', sis: x.system || '—', prev: x.planned || '—', exec: x.performed || '—', desv: x.deviation || '—', fonte: '' }; }); });
      var cen = (await chamados()).filter(function (c) {
        if (emp && c._empresa !== emp) return false;
        if (mes && ![c.due, c.performed, c.opened].some(function (d) { return String(d || '').slice(0, 7) === mes; })) return false;
        return true;
      }).map(function (c) {
        var prev = c.due || c.opened || '', desv = c.performed && c.due ? (dias(c.due, c.performed) > 0 ? '+' + dias(c.due, c.performed) + ' dia(s)' : 'No prazo') : '—';
        return { ord: prev, emp: c._empresa, sis: [c.sector, c.description].filter(Boolean).join(' — ') + ' · ' + (c.execution || 'Solicitado'), prev: fd(prev), exec: c.performed ? fd(c.performed) : '—', desv: desv, fonte: ' <small style="color:#60718a">(Central)</small>' };
      });
      var todos = rel.concat(cen).sort(function (a, b) { return String(b.ord).localeCompare(String(a.ord)); });
      box.innerHTML = table(['Empresa', 'Sistema / ativo', 'Previsto', 'Executado', 'Desvio'], todos.map(function (x) { return '<tr><td>' + esc(x.emp) + x.fonte + '</td><td>' + esc(x.sis) + '</td><td>' + esc(x.prev) + '</td><td>' + esc(x.exec) + '</td><td>' + esc(x.desv) + '</td></tr>'; }));
    } catch (e) { /* mantém o calendário original */ }
  }
  var rd = window.renderDashboard;
  window.renderDashboard = function () { rd.apply(this, arguments); completar(); };
  var go = window.goTab;
  window.goTab = function (t) { go.apply(this, arguments); if (t === 'calendar') { cache = null; completar(); } };
  ['filterMonth', 'filterCompany'].forEach(function (id) { var e = document.getElementById(id); if (e) e.addEventListener('change', function () { setTimeout(completar, 0); }); });
  var lim = document.getElementById('clearFilters'); if (lim) lim.addEventListener('click', function () { setTimeout(completar, 0); });
  if (window.UPA) UPA.ready().then(completar).catch(function () {});
})();
