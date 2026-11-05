// Supabase Edge Function: ia-assistente
// Apoio de IA para RH e DP (parecer de evolução, redação de relato) e Rouparia (carta de questionamento).
// A chave da API fica só aqui, como segredo do Supabase (nunca no navegador).
//
// Publicar:  supabase functions deploy ia-assistente
// Segredo:   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...      (o mesmo já usado pelo pop-gerar)
// (opcional) supabase secrets set IA_MODEL=claude-sonnet-5-5
// Exige usuário logado (verify_jwt ligado).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = `Você apoia a coordenação administrativa da UPA Rocinha, unidade pública de pronto atendimento do SUS no Rio de Janeiro (gestão: Instituto Gnosis).
Escreva em português do Brasil, em linguagem clara, profissional e respeitosa. Use APENAS os dados informados; não invente fatos, datas, valores, nomes, números de contrato ou artigos de lei que não tenham sido informados. Se faltar informação importante, diga o que falta. Nunca inclua dados de pacientes.
Responda SOMENTE com um objeto JSON válido (sem markdown, sem comentários), exatamente no formato pedido.`;

const TAREFAS: Record<string, string> = {
  evolucao: `${BASE}
TAREFA: parecer de apoio à decisão sobre a continuidade de um colaborador, a partir de avaliações de experiência, orientações e advertências e de uma pontuação já calculada pelo sistema.
Regras: a decisão final é SEMPRE humana (gestor e RH); você apenas recomenda e justifica. Fundamente apenas em conduta e desempenho observáveis nos dados; jamais considere sexo, idade, raça, religião, saúde, gravidez, deficiência, filiação sindical ou qualquer característica pessoal. Se os dados forem poucos ou antigos, diga que a recomendação tem baixa confiança. Mencione cuidados formais quando pertinentes (contrato de experiência limitado a 90 dias no total; justa causa exige prova, proporcionalidade e imediatidade; registrar orientação/advertência antes de medidas mais graves) sem citar artigos que não tenha certeza.
Formato: {"recomendacao":"continuar"|"continuar_com_acompanhamento"|"nao_continuar","confianca":"alta"|"media"|"baixa","resumo":"string (2 a 4 frases)","pontos_fortes":["string"],"pontos_atencao":["string"],"plano_desenvolvimento":["string (ações concretas e prazos curtos)"],"cuidados_formais":["string"]}`,
  redigir: `${BASE}
TAREFA: redigir o texto formal de um documento de RH (orientação de conduta, advertência ou desligamento) a partir dos fatos informados pelo coordenador. Tom respeitoso, objetivo, sem adjetivos pessoais, descrevendo comportamentos observáveis, impacto no serviço e a orientação/expectativa. Em orientação de conduta, tom construtivo, voltado ao crescimento profissional. Não acrescente fatos.
Formato: {"texto":"string (1 a 3 parágrafos curtos)"}`,
  carta: `${BASE}
TAREFA: apoiar a unidade em um questionamento formal à lavanderia/fornecedor de rouparia sobre entregas com divergência de peso (peso informado na nota x peso real aferido na UPA), quantidades ou má qualidade (manchas, odor, rasgos, umidade, itens faltantes, atraso).
Entregue (1) uma carta formal, objetiva e cordial porém firme, que cite cada nota (número, data, pesos, quantidades por item, diferença, ocorrência; o contrato contempla apenas lençol, camisola e cobertor), solicite esclarecimento, conferência/recálculo e providências (reposição, relavagem, desconto/abatimento quando cabível) em prazo razoável, e (2) conselhos práticos de condução para a coordenação. Só mencione cláusulas contratuais se o contrato informado trouxer números ou textos; caso contrário, diga "conforme contrato vigente".
Formato: {"assunto":"string","corpo":"string (carta completa, parágrafos separados por \\n\\n, sem assinatura)","conselhos":["string"],"alertas":["string (inconsistências ou dados que a unidade deve conferir antes de enviar)"]}`,
};

function json(corpo: unknown, status = 200) {
  // sempre 200: o motivo do erro vai no corpo ({erro}) para a tela poder mostrá-lo
  return new Response(JSON.stringify(corpo), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
}
function extrair(texto: string) {
  let t = texto.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
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
  const tarefa = String(entrada?.tarefa || "");
  const sistema = TAREFAS[tarefa];
  if (!sistema) return json({ erro: "Tarefa desconhecida." }, 400);
  const dados = JSON.stringify(entrada?.dados ?? {}).slice(0, 24000);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("IA_MODEL") || "claude-sonnet-5-5",
      max_tokens: 3500,
      system: sistema,
      messages: [{ role: "user", content: `Dados (JSON):\n${dados}` }],
    }),
  });
  if (!resp.ok) return json({ erro: `Falha na API do Claude (${resp.status}).`, detalhe: (await resp.text()).slice(0, 300) }, 502);
  const d = await resp.json();
  const texto = (d?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  try { return json({ conteudo: extrair(texto), modelo: d?.model || null }); }
  catch (e) { return json({ erro: "Resposta da IA fora do formato esperado. Tente de novo.", detalhe: String(e).slice(0, 200) }, 502); }
});
