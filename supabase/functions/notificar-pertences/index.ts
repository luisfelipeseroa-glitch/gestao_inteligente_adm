// Supabase Edge Function: notificar-pertences
// Envia e-mail ao(s) gestor(es) quando há solicitação de liberação de pertences de paciente.
// Usa o Resend (https://resend.com). Publicar:  supabase functions deploy notificar-pertences
// Segredos:  supabase secrets set RESEND_API_KEY=re_...   (opcional: MAIL_FROM="Gestão UPA <aviso@seudominio.com>")
// Sem RESEND_API_KEY a função responde 200 com {erro} e o sistema continua avisando dentro do portal.
// Exige usuário logado (verify_jwt ligado). Nunca coloca dados clínicos no e-mail: só número do envelope e solicitante.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return J({ erro: "RESEND_API_KEY não configurada" });
    const b = await req.json();
    const para = (Array.isArray(b.para) ? b.para : []).filter((e: unknown) => typeof e === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).slice(0, 5);
    if (!para.length) return J({ erro: "sem destinatário" });
    const assunto = String(b.assunto || "Solicitação de liberação de pertences").slice(0, 120);
    const texto = String(b.texto || "").slice(0, 1000);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: Deno.env.get("MAIL_FROM") || "Gestão UPA Rocinha <onboarding@resend.dev>", to: para, subject: assunto, text: texto }),
    });
    if (!r.ok) return J({ erro: "Falha no envio", detalhe: (await r.text()).slice(0, 300) });
    return J({ ok: true });
  } catch (e) {
    return J({ erro: "Erro", detalhe: String((e as Error).message || e).slice(0, 300) });
  }
});
