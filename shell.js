'use strict';
/* Portal unificado: navegação entre Início, Manutenção e módulos embutidos (iframes). */
(function(){
  var orig = window.goTab;
  var VER = Date.now();
  function bust(f){ var p = f.dataset.src.split('#'); return p[0] + (p[0].indexOf('?') < 0 ? '?' : '&') + 'v=' + VER + (p[1] != null ? '#' + p[1] : ''); }
  function viewOf(t){ return t === 'home' ? 'home' : (/^mod-/.test(t) ? 'mod' : 'manut'); }
  function afterTab(t){
    document.body.setAttribute('data-view', viewOf(t));
    if (/^mod-/.test(t)) {
      var f = document.getElementById('frame-' + t.slice(4));
      if (f && !f.getAttribute('src')) f.setAttribute('src', bust(f));
    }
    try { history.replaceState(null, '', t === 'home' ? location.pathname : '#' + t); } catch (e) {}
  }
  window.goTab = function(t){ orig(t); afterTab(t); };
  document.querySelectorAll('[data-reload]').forEach(function(b){
    b.addEventListener('click', function(){
      var f = document.getElementById('frame-' + b.dataset.reload.slice(4));
      if (f) f.setAttribute('src', bust(f));
    });
  });
  // "Novo relatório" (botão do app de manutenção) abre a aba de relatório: manter a vista coerente
  var nb = document.getElementById('new');
  if (nb) nb.addEventListener('click', function(){ afterTab('report'); });
  // Login único: o portal só aparece depois de entrar
  var lo = document.getElementById('logout');
  if (lo) lo.addEventListener('click', function () { UPA.logout().then(function () { location.reload(); }); });
  if (window.UPA) UPA.ready().then(function (s) {
    if (lo && s && s.user) lo.innerHTML = '<span>⎋</span> Sair <small style="opacity:.7;font-size:10px;display:block;word-break:break-all">' + s.user.email + '</small>';
  }).catch(function () {});
  // Abrir direto por link (#fluxo, #dashboard...)
  var h = (location.hash || '').replace('#', '');
  if (h === 'fluxo' || h === 'epi' || h === 'central' || h === 'pgrss') h = 'mod-' + h;
  if (h && document.getElementById(h) && document.getElementById(h).classList.contains('tab') && h !== 'home') window.goTab(h);
  else afterTab('home');
})();
