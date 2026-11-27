/* Os dados da vistoria ficam no banco (só com login): registros, coleção subhue_base. Nada sensível neste arquivo. */
window.carregarSubhue = async function () {
  if (window.SUBHUE) return window.SUBHUE;
  const r = await UPA.client().from('registros').select('dados').eq('colecao', 'subhue_base').eq('id', 'subhue-base').maybeSingle();
  if (r.error) throw r.error;
  window.SUBHUE = r.data ? r.data.dados : null;
  return window.SUBHUE;
};
