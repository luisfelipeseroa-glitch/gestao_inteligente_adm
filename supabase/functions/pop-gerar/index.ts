// Supabase Edge Function: pop-gerar
// Recebe as respostas do questionário e devolve o texto do POP (JSON) escrito pelo Claude.
// A chave da API fica só aqui, como segredo do Supabase (nunca no navegador).
//
// Publicar:  supabase functions deploy pop-gerar
// Segredo:   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (opcional) supabase secrets set POP_MODEL=claude-sonnet-5-5
//
// Por padrão a função exige usuário logado (verify_jwt ligado): só quem entrou no portal chama.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SISTEMA = `Você redige Procedimentos Operacionais Padrão (POP) para a UPA Rocinha, unidade pública de pronto atendimento do SUS no Rio de Janeiro.
Escreva em português do Brasil, em linguagem clara e objetiva, no imperativo ou na voz ativa, pensada para quem executa a rotina (não para juristas).
Use APENAS o que foi informado nas respostas e o que é prática consagrada para o tema. Não invente números, telefones, nomes de pessoas, códigos de sistemas, prazos legais ou valores que não foram informados; quando faltar uma informação importante, escreva a etapa de forma geral e acrescente em "observacao" o que a unidade precisa conferir.
Em "referencias" cite somente normas que você conhece com segurança (ex.: RDC ANVISA nº 222/2018, RDC nº 63/2011, RDC nº 36/2013, Portaria GM/MS nº 529/2013, NR-32, Lei nº 8.080/1990, Lei nº 8.666/1993 e Lei nº 14.133/2021) e somente se tiverem relação direta com o tema. Na dúvida, não cite.
Nunca inclua dados de pacientes.
Siga o MODELO de POP da unidade (mesmo estilo do "POP de Aplicação de Sanção e Abandono de Plantão"): texto institucional, objetivo em tópicos, definições, responsabilidades em tabela, fluxos com etapas numeradas, situações críticas, checklist e observação final.
Responda SOMENTE com um objeto JSON válido (sem markdown, sem comentários), exatamente neste formato:
{
 "introducao": "string (1 a 3 parágrafos separados por \\n\\n: contexto e por que o POP existe)",
 "objetivo": ["string (tópicos curtos, começando com verbo no infinitivo)"],
 "abrangencia": "string (setores, cargos e situações a que se aplica)",
 "definicoes": [{"termo": "string", "definicao": "string"}],
 "principios": ["string (princípios/regras de conduta; lista vazia se não se aplicar)"],
 "responsabilidades": [{"funcao": "string", "atribuicao": "string"}],
 "fluxos": [{"titulo": "string (ex.: Fluxo A – ...)", "introducao": "string (pode ser vazio)", "etapas": [{"titulo": "string curto", "descricao": "string com o que fazer, como, quando e quem"}]}],
 "documentacao": ["string (documentos e evidências mínimos; lista vazia se não se aplicar)"],
 "situacoes": [{"situacao": "string", "conduta": "string"}],
 "fluxo_resumido": "string (etapas em MAIÚSCULAS ligadas por ' → ', terminando com ponto)",
 "checklist": ["string (verificações objetivas que a pessoa marca como feitas)"],
 "formularios": ["string (formulários, sistemas e registros relacionados)"],
 "referencias": ["string"],
 "observacao": "string (limites do POP, o que a unidade deve conferir/validar com RH, jurídico ou direção)"
}
Use de 1 a 3 fluxos, cada um com 4 a 10 etapas na ordem real de execução. Inclua de 4 a 8 situações críticas, de 8 a 16 itens de checklist e de 3 a 6 responsabilidades.`;

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function extrair(texto: string) {
  let t = texto.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const i = t.indexOf("{"), f = t.lastIndexOf("}");
  if (i < 0 || f < i) throw new Error("A IA não devolveu JSON.");
  return JSON.parse(t.slice(i, f + 1));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);

  const chave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!chave) return json({ erro: "ANTHROPIC_API_KEY não configurada no Supabase (supabase secrets set)." }, 500);

  let entrada: any;
  try { entrada = await req.json(); } catch { return json({ erro: "JSON inválido." }, 400); }
  const tema = String(entrada?.tema || "").slice(0, 200);
  const respostas = entrada?.respostas;
  if (!tema || typeof respostas !== "object" || respostas === null) return json({ erro: "Informe tema e respostas." }, 400);

  const usuario = `Tema do POP: ${tema}\n\nRespostas do coordenador ao questionário:\n` +
    Object.entries(respostas).map(([k, v]) => `- ${String(k).slice(0, 120)}: ${String(v ?? "").slice(0, 3000)}`).join("\n") +
    (entrada?.instrucoes ? `\n\nInstruções adicionais: ${String(entrada.instrucoes).slice(0, 1500)}` : "");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("POP_MODEL") || "claude-sonnet-5-5",
      max_tokens: 6000,
      system: SISTEMA,
      messages: [{ role: "user", content: usuario }],
    }),
  });
  if (!resp.ok) {
    const detalhe = (await resp.text()).slice(0, 400);
    return json({ erro: `Falha na API do Claude (${resp.status}).`, detalhe }, 502);
  }
  const dados = await resp.json();
  const texto = (dados?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  try {
    return json({ conteudo: extrair(texto), modelo: dados?.model || null });
  } catch (e) {
    return json({ erro: "Resposta da IA fora do formato esperado. Tente gerar de novo.", detalhe: String(e).slice(0, 200) }, 502);
  }
});
