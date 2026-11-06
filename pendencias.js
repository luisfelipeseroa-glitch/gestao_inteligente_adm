'use strict';
/* Painel "Pendências" na tela inicial do portal + backup manual dos dados.
   Lê, em modo somente leitura, os registros dos módulos (pertences, SUBHUE, treinamentos) e mostra o que exige ação.
   Atualiza a cada 60 s enquanto a tela inicial está aberta. */
(function () {
  var hoje = function () { return new Date().toLocaleDateString('en-CA'); };
  var dias = function (iso) { return Math.floor((Date.now() - new Date(iso)) / 864e5); };
  var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch (e) { return ''; } };
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var box = null;
  function montar() {
    var g = document.querySelector('.hub-grid'); if (!g || box) return !!box;
    box = document.createElement('section'); box.id = 'pend-panel'; box.setAttribute('aria-label', 'Pendências');
    g.parentNode.insertBefore(box, g); return true;
  }
  var css = document.createElement('style');
  css.textContent = '#pend-panel{background:#fff;border:1px solid #d4e1f2;border-radius:12px;padding:16px 18px;margin-bottom:16px}#pend-panel h3{margin:0 0 10px;font-size:16px;color:#10345d}#pend-panel .pl{display:flex;flex-direction:column;gap:6px}#pend-panel .pi{display:flex;align-items:center;gap:10px;text-align:left;width:100%;background:#f8fbff;border:1px solid #d4e1f2;border-radius:9px;padding:9px 12px;color:#142f53;font-weight:500;font-size:14px;cursor:pointer}#pend-panel .pi.r{background:#fde4e1;border-color:#e3a39c}#pend-panel .pi.a{background:#fff3d6;border-color:#e0b24a}#pend-panel .pi b{min-width:26px;text-align:center;border-radius:12px;background:#10345d;color:#fff;padding:1px 8px}#pend-panel .ok{color:#13663b;font-weight:600}#pend-panel .rod{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px;font-size:12.5px;color:#526b7c}#pend-panel .rod button{background:#e5edf4;color:#153b61;border:0;border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer;font-weight:600}';
  document.head.appendChild(css);

  async function coletar() {
    var L = [], db = UPA.db, h = hoje();
    var [per, conf, sub, tre] = await Promise.all([db.list('pertences').catch(function () { return []; }), db.list('pertences_conf').catch(function () { return []; }), db.list('subhue_acoes').catch(function () { return []; }), db.list('treinamentos').catch(function () { return []; })]);
    per = per.map(function (r) { return r.dados; }); conf = conf.map(function (r) { return r.dados; });
    var sol = per.filter(function (p) { return p.status === 'Liberação solicitada'; });
    if (sol.length) L.push({ n: sol.length, t: 'Solicitação(ões) de liberação de pertences aguardando autorização', tab: 'mod-pertences', c: 'r' });
    var noCx = per.filter(function (p) { return ['Guardado', 'Liberação solicitada', 'Autorizado'].indexOf(p.status) >= 0; });
    var velhos = noCx.filter(function (p) { return dias(p.guardadoEm || p.criadoEm) > 30; });
    if (velhos.length) L.push({ n: velhos.length, t: 'Envelope(s) de pertences guardado(s) há mais de 30 dias', tab: 'mod-pertences', c: 'a' });
    if (noCx.length) { var u = conf.map(function (c) { return c.ts; }).sort().pop(); if (!u || dias(u) > 7) L.push({ n: noCx.length, t: 'Conferência semanal da caixa de pertences ' + (u ? 'atrasada (última há ' + dias(u) + ' dias)' : 'nunca realizada'), tab: 'mod-pertences', c: 'a' }); }
    var atr = sub.map(function (r) { return r.dados; }).filter(function (a) { return a && a.prazo && a.status !== 'Concluído' && a.prazo < h; });
    if (atr.length) L.push({ n: atr.length, t: 'Item(ns) do plano SUBHUE com prazo vencido', tab: 'mod-subhue', c: 'r' });
    var prox = sub.map(function (r) { return r.dados; }).filter(function (a) { var d = a && a.prazo; return d && a.status !== 'Concluído' && d >= h && d <= new Date(Date.now() + 7 * 864e5).toLocaleDateString('en-CA'); });
    if (prox.length) L.push({ n: prox.length, t: 'Item(ns) do plano SUBHUE vencendo nos próximos 7 dias', tab: 'mod-subhue', c: 'a' });
    var tr = tre.map(function (r) { return r.dados; }).filter(function (t) { return t && t.status !== 'Cancelado' && t.status !== 'Concluído'; });
    var hojeT = tr.filter(function (t) { return t.data === h; }), venc = tr.filter(function (t) { return t.data < h; });
    if (hojeT.length) L.push({ n: hojeT.length, t: 'Treinamento(s) programado(s) para hoje', tab: 'mod-treinamentos', c: 'a' });
    if (venc.length) L.push({ n: venc.length, t: 'Treinamento(s) já realizado(s) ainda sem conclusão (confira presenças e marque como concluído)', tab: 'mod-treinamentos', c: '' });
    return L;
  }
  async function atualizar() {
    if (!montar()) return;
    var home = document.body.getAttribute('data-view'); if (home && home !== 'home') return;
    var itens = []; try { itens = await coletar(); } catch (e) { box.innerHTML = '<h3>Pendências</h3><p class="rod">Não foi possível carregar agora.</p>'; return; }
    var ult = ls('upa_ult_backup'), dB = ult ? dias(ult) : null, avisoB = dB === null ? 'Backup nunca baixado.' : 'Último backup há ' + dB + ' dia(s).';
    box.innerHTML = '<h3>🔔 Pendências</h3>' + (itens.length ? '<div class="pl">' + itens.map(function (i) { return '<button type="button" class="pi ' + i.c + '" data-go="' + i.tab + '"><b>' + i.n + '</b><span>' + esc(i.t) + '</span></button>'; }).join('') + '</div>' : '<p class="ok">✔ Nada pendente agora.</p>') +
      '<div class="rod"><button type="button" id="bBackup">⇩ Baixar backup dos dados</button><span' + (dB === null || dB > 7 ? ' style="color:#a51e30;font-weight:600"' : '') + '>' + avisoB + ' Recomendado: 1 vez por semana. (Não inclui fotos e arquivos anexados.)</span></div>';
    box.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { window.goTab(b.dataset.go); }; });
    document.getElementById('bBackup').onclick = backup;
  }
  async function backup() {
    var b = document.getElementById('bBackup'); b.disabled = true; b.textContent = 'Gerando backup…';
    try {
      var c = UPA.client(), out = { geradoEm: new Date().toISOString(), por: (UPA.user() || {}).email || null, tabelas: {} };
      async function tudo(t, ord) { var r = [], from = 0; for (;;) { var q = await c.from(t).select('*').order(ord).range(from, from + 999); if (q.error) throw q.error; r = r.concat(q.data); if (q.data.length < 1000) break; from += 1000; } return r; }
      out.tabelas.registros = await tudo('registros', 'id');
      var extra = [['funcionarios', 'id'], ['epis', 'id'], ['entregas', 'id']];
      for (var i = 0; i < extra.length; i++) { try { out.tabelas[extra[i][0]] = await tudo(extra[i][0], extra[i][1]); } catch (e) { out.tabelas[extra[i][0]] = { erro: String(e.message || e) }; } }
      var blob = new Blob([JSON.stringify(out)], { type: 'application/json' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'backup_gestao_upa_' + hoje() + '.json'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); ls('upa_ult_backup', new Date().toISOString());
    } catch (e) { alert('Não foi possível gerar o backup: ' + (e.message || e)); }
    atualizar();
  }
  var g0 = window.goTab; if (g0) window.goTab = function (t) { g0(t); if (t === 'home') setTimeout(atualizar, 80); };
  if (window.UPA) UPA.ready().then(function (s) { if (!(s && s.user)) return; atualizar(); setInterval(atualizar, 60000); document.addEventListener('visibilitychange', function () { if (!document.hidden) atualizar(); }); });
})();
