/* UPA Rocinha — Gestão Inteligente | camada única de banco e login (Supabase)
   Usada pelo portal e por todos os módulos. Um só login vale para tudo,
   pois a sessão fica guardada no mesmo endereço (chave "upa-auth"). */
(function () {
  'use strict';
  var SRC = (document.currentScript && document.currentScript.src) || location.href;
  var URL_ = 'https://dzvnannnwvrdvdoxgbeo.supabase.co';
  var KEY_ = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6dm5hbm5ud3ZyZHZkb3hnYmVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMDM3OTIsImV4cCI6MjEwNzY3OTc5Mn0.CJJO-8ZKhHiZhJ6dad8jGrpYnG9yzrj5mf2oHkA5g_4';
  var BUCKET = 'anexos';
  var LOGO = new URL('../assets/logo-upa.png', SRC).href;
  var sb = null, me = null, pending = null;

  function client() {
    if (sb) return sb;
    if (!window.supabase) throw new Error('A biblioteca do banco não carregou. Verifique a internet.');
    sb = window.supabase.createClient(URL_, KEY_, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'upa-auth' } });
    return sb;
  }
  function msg(e) {
    var m = (e && e.message) || String(e);
    if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/Email not confirmed/i.test(m)) return 'E-mail ainda não confirmado no Supabase.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sem conexão com o banco. Verifique a internet.';
    return m;
  }

  function showLogin(done) {
    var d = document.createElement('div');
    d.id = 'upa-login';
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:linear-gradient(155deg,#0c2c50,#123e70);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,Segoe UI,Arial,sans-serif';
    d.innerHTML =
      '<form style="background:#fff;border-radius:16px;padding:26px;width:100%;max-width:380px;box-shadow:0 20px 50px #0006">' +
      '<img src="' + LOGO + '" alt="UPA Rocinha" style="display:block;max-width:230px;height:70px;object-fit:contain;margin:0 auto 14px">' +
      '<h2 style="margin:0 0 4px;font-size:20px;color:#142f53;text-align:center">Gestão Inteligente</h2>' +
      '<p style="margin:0 0 16px;font-size:13px;color:#60718a;text-align:center">Entre com seu e-mail e senha</p>' +
      '<label style="display:block;font-size:12px;font-weight:650;color:#375476;margin-bottom:10px">E-mail<input name="e" type="email" required autocomplete="username" style="display:block;width:100%;margin-top:4px;padding:11px;border:1px solid #c6d7e8;border-radius:8px;font:inherit;font-size:15px"></label>' +
      '<label style="display:block;font-size:12px;font-weight:650;color:#375476;margin-bottom:14px">Senha<input name="s" type="password" required autocomplete="current-password" style="display:block;width:100%;margin-top:4px;padding:11px;border:1px solid #c6d7e8;border-radius:8px;font:inherit;font-size:15px"></label>' +
      '<button style="width:100%;padding:12px;border:0;border-radius:9px;background:#123e70;color:#fff;font:inherit;font-weight:700;font-size:15px;cursor:pointer">Entrar</button>' +
      '<div class="err" role="alert" style="color:#b42318;font-size:13px;min-height:18px;margin-top:10px;text-align:center"></div></form>';
    document.body.appendChild(d);
    var f = d.querySelector('form'), err = d.querySelector('.err'), btn = d.querySelector('button');
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      err.textContent = ''; btn.disabled = true;
      var fd = new FormData(f);
      client().auth.signInWithPassword({ email: String(fd.get('e')).trim(), password: String(fd.get('s')) }).then(function (r) {
        if (r.error) { err.textContent = msg(r.error); btn.disabled = false; return; }
        me = r.data.session; d.remove(); done(me);
      }).catch(function (e) { err.textContent = msg(e); btn.disabled = false; });
    });
  }

  var UPA = {
    URL: URL_, KEY: KEY_, LOGO: LOGO,
    client: client,
    /* Garante que há alguém logado; se não, mostra a tela de login. Resolve com a sessão. */
    ready: function () {
      if (me) return Promise.resolve(me);
      if (pending) return pending;
      var c;
      try { c = client(); } catch (e) { return Promise.reject(e); }
      pending = c.auth.getSession().then(function (r) {
        if (r.data && r.data.session) { me = r.data.session; return me; }
        return new Promise(function (res) {
          if (document.body) showLogin(res); else document.addEventListener('DOMContentLoaded', function () { showLogin(res); });
        });
      }).then(function (s) { pending = null; return s; }, function (e) { pending = null; throw e; });
      return pending;
    },
    user: function () { return me && me.user; },
    logout: function () { return client().auth.signOut().then(function () { me = null; }); },
    db: {
      list: async function (col) {
        var out = [], from = 0, step = 1000;
        for (;;) {
          var r = await client().from('registros').select('id,colecao,dados,updated_at').eq('colecao', col).order('id').range(from, from + step - 1);
          if (r.error) throw r.error;
          out = out.concat(r.data);
          if (r.data.length < step) break;
          from += step;
        }
        return out;
      },
      put: async function (col, id, obj) {
        var r = await client().from('registros').upsert({ id: String(id), colecao: col, dados: obj, atualizado_por: (me && me.user && me.user.email) || null, updated_at: new Date().toISOString() });
        if (r.error) throw r.error;
      },
      del: async function (id) {
        var r = await client().from('registros').delete().eq('id', String(id));
        if (r.error) throw r.error;
      }
    },
    files: {
      upload: async function (path, blob, type) {
        var r = await client().storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: type || blob.type || 'application/octet-stream' });
        if (r.error) throw r.error;
      },
      urls: async function (paths) {
        var map = {};
        if (!paths.length) return map;
        var r = await client().storage.from(BUCKET).createSignedUrls(paths, 21600);
        if (r.error) throw r.error;
        r.data.forEach(function (x) { if (x.signedUrl) map[x.path] = x.signedUrl; });
        return map;
      },
      remove: async function (paths) {
        var r = await client().storage.from(BUCKET).remove(paths);
        if (r.error) throw r.error;
      }
    },
    dataUrlToBlob: function (u) {
      var p = u.split(','), mime = (p[0].match(/:(.*?);/) || [])[1] || 'application/octet-stream', b = atob(p[1]), n = b.length, a = new Uint8Array(n);
      while (n--) a[n] = b.charCodeAt(n);
      return new Blob([a], { type: mime });
    },
    msg: msg
  };
  window.UPA = UPA;
})();
