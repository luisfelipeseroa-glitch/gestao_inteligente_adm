'use strict';
/* Converte um .docx (Word) em PDF no próprio navegador, para poder assinar.
   Método: docx-preview desenha o documento em páginas HTML e html2canvas fotografa cada página, que entra como página do PDF (pdf-lib).
   Resultado visual aproximado (o texto do PDF fica como imagem). Para fidelidade total, no Word use Arquivo > Salvar como PDF e importe o PDF.
   Devolve { bytes, hint } onde hint indica a posição da linha "Matr." (fração da página) quando encontrada. */
(function () {
  var CDN = {
    jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    docx: 'https://cdn.jsdelivr.net/npm/docx-preview@0.3.3/dist/docx-preview.min.js',
    h2c: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'
  };
  function carregar(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Não consegui carregar a biblioteca de Word (verifique a internet).')); }; document.head.appendChild(s); }); }
  async function preparar() {
    if (!window.JSZip) await carregar(CDN.jszip);
    if (!window.docx) await carregar(CDN.docx);
    if (!window.html2canvas) await carregar(CDN.h2c);
  }
  async function docxParaPdf(arrayBuffer, aoProgresso) {
    await preparar();
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-20000px;top:0;background:#fff;z-index:-1';
    document.body.appendChild(box);
    try {
      await window.docx.renderAsync(arrayBuffer, box, null, { className: 'docx', inWrapper: false, ignoreWidth: false, ignoreHeight: false, breakPages: true, useBase64URL: true, renderHeaders: true, renderFooters: true });
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await new Promise(function (r) { setTimeout(r, 300); });
      var pgs = Array.prototype.slice.call(box.querySelectorAll('section.docx'));
      if (!pgs.length) throw new Error('O Word não tem páginas legíveis.');
      var PL = window.PDFLib, pdf = await PL.PDFDocument.create(), hint = null, total = 0, W = 595.28, H = W * 1.4142;
      for (var i = 0; i < pgs.length; i++) {
        if (aoProgresso) aoProgresso(i + 1, pgs.length);
        var el = pgs[i], r = el.getBoundingClientRect();
        var cv = await window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
        // o docx-preview só quebra página onde o Word marcou; se a seção ficou mais alta que uma A4, fatia em páginas A4
        var altA4 = r.width * 1.4142, n = r.height > altA4 * 1.03 ? Math.ceil(r.height / altA4 - 0.02) : 1, fatia = n > 1 ? Math.round(cv.height * altA4 / r.height) : cv.height;
        for (var k = 0; k < n; k++) {
          var c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = n > 1 ? fatia : cv.height; var x = c2.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c2.width, c2.height); x.drawImage(cv, 0, -k * fatia);
          var jpg = await new Promise(function (res) { c2.toBlob(res, 'image/jpeg', 0.92); }), img = await pdf.embedJpg(await jpg.arrayBuffer());
          var h = n > 1 ? H : W * (r.height / r.width), page = pdf.addPage([W, h]); page.drawImage(img, { x: 0, y: 0, width: W, height: h });
        }
        var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nd, achado = null;
        while ((nd = walker.nextNode())) { if (/^\s*Matr/i.test(nd.nodeValue)) achado = nd; }
        if (achado) { var rg = document.createRange(); rg.selectNodeContents(achado); var rr = rg.getBoundingClientRect(), yAbs = rr.top - r.top; hint = n > 1 ? { n: total + Math.floor(yAbs / altA4) + 1, cx: (rr.left + rr.width / 2 - r.left) / r.width, topo: (yAbs % altA4) / altA4 } : { n: total + 1, cx: (rr.left + rr.width / 2 - r.left) / r.width, topo: yAbs / r.height }; }
        total += n;
      }
      return { bytes: await pdf.save(), hint: hint, paginas: total };
    } finally { box.remove(); }
  }
  window.docxParaPdf = docxParaPdf;
})();
