'use strict';
/* Perfis de acesso: usuarios com app_metadata.perfil = "enfermagem" veem so os modulos liberados.
   Quem nao tem perfil (ex.: administrador) continua vendo tudo. O perfil e definido no Supabase
   (app_metadata) e nao pode ser alterado pelo proprio usuario. */
(function () {
  var PERFIS = {
    enfermagem: ['home', 'dashboard', 'mod-pop', 'mod-central', 'mod-rhdp', 'mod-subhue', 'mod-treinamentos', 'mod-pertences', 'help']
  };
  if (!window.UPA) return;
  UPA.ready().then(function (s) {
    var meta = (s && s.user && s.user.app_metadata) || {};
    var perm = PERFIS[meta.perfil];
    if (!perm) return;
    document.body.classList.add('perfil-restrito');
    var st = document.createElement('style');
    st.textContent = '.perfil-restrito #bBackup,.perfil-restrito #exportAll,.perfil-restrito .side-import,.perfil-restrito #new{display:none!important}';
    document.head.appendChild(st);
    var ok = function (t) { return perm.indexOf(t) >= 0; };
    document.querySelectorAll('nav button[data-tab]').forEach(function (b) { if (!ok(b.dataset.tab)) b.style.display = 'none'; });
    document.querySelectorAll('[data-tab-jump]').forEach(function (b) { if (!ok(b.dataset.tabJump)) b.style.display = 'none'; });
    ['#new', '#exportAll', '.side-import'].forEach(function (q) { var e = document.querySelector(q); if (e) e.style.display = 'none'; });
    // esconde titulos de grupo sem botoes visiveis
    var grupo = null, n = 0;
    function fecha() { if (grupo && !n) grupo.style.display = 'none'; }
    Array.prototype.forEach.call(document.querySelectorAll('nav > *'), function (e) {
      if (e.classList.contains('side-group')) { fecha(); grupo = e; n = 0; }
      else if (e.tagName === 'BUTTON' && e.dataset.tab && e.style.display !== 'none') n++;
    }); fecha();
    // bloqueia navegacao para abas nao liberadas (atalhos, #hash)
    var go = window.goTab;
    window.goTab = function (t) { go(ok(t) ? t : 'home'); if (!ok(t)) return; };
    var at = document.querySelector('.tab.active');
    if (at && !ok(at.id)) window.goTab('home');
  }).catch(function () {});
})();
