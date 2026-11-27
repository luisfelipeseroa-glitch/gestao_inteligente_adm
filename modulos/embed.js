/* Marca a página como "embutida" quando aberta dentro do portal (iframe). */
try { if (window.top !== window.self) document.documentElement.classList.add('embed'); }
catch (e) { document.documentElement.classList.add('embed'); }
