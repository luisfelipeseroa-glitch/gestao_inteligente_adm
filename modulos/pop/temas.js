'use strict';
/* POP — catálogo de temas, perguntas e gerador de reserva (sem IA).
   Estrutura do conteúdo segue o modelo "POP.ADM.033 – Aplicação de Sanção e Abandono de Plantão". */

const POP_AREAS = [['ADM', 'Administrativo'], ['ASS', 'Assistencial'], ['ENF', 'Enfermagem'], ['MED', 'Médico'], ['FAR', 'Farmácia'], ['ALM', 'Almoxarifado'], ['RH', 'Recursos Humanos'], ['NIR', 'NIR / Regulação'], ['TI', 'Tecnologia da Informação'], ['HIG', 'Higienização'], ['MAN', 'Manutenção'], ['SEG', 'Segurança']];

/* perguntas comuns a todo POP */
const POP_COMUNS = [
  { k: 'responsavel', l: 'Responsável pelo POP (aparece no cabeçalho)', ph: 'Ex.: COORDENAÇÃO ADMINISTRATIVA', def: 'COORDENAÇÃO ADMINISTRATIVA' },
  { k: 'quem', l: 'Quem executa esta rotina? (cargos / setores)', t: 'textarea', ph: 'Ex.: recepcionistas, auxiliares administrativos, coordenação...' },
  { k: 'quando', l: 'Quando / com que frequência acontece?', ph: 'Ex.: todo dia, a cada plantão, até o 5º dia útil do mês...' },
  { k: 'passos', l: 'Passo a passo em linhas gerais (um passo por linha)', t: 'textarea', big: 1, ph: 'Escreva do seu jeito, uma linha por passo. A IA organiza e completa.' }
];
const POP_FINAIS = [
  { k: 'sistemas', l: 'Materiais, sistemas e formulários usados', t: 'textarea', ph: 'Ex.: TI-MED, planilha X, formulário Y, e-mail institucional...' },
  { k: 'riscos', l: 'Erros comuns, riscos e pontos críticos', t: 'textarea', ph: 'O que costuma dar errado? O que não pode falhar?' },
  { k: 'registros', l: 'Que registros comprovam que foi feito?', t: 'textarea', ph: 'Ex.: assinatura em livro, registro no sistema, e-mail enviado...' },
  { k: 'indicadores', l: 'Como medir se está sendo cumprido? (opcional)', ph: 'Ex.: % de plantões com passagem registrada' },
  { k: 'normas', l: 'Normas, contratos ou regras internas que se aplicam (se souber)', t: 'textarea' },
  { k: 'extra', l: 'Outras informações importantes (opcional)', t: 'textarea' }
];

const POP_TEMAS = [
  { id: 'passagem', nome: 'Passagem de plantão', area: 'ASS', desc: 'Como o plantão que sai repassa pendências ao que entra.', q: [
    { k: 'setores', l: 'Quais setores / categorias passam plantão?' }, { k: 'conteudo', l: 'O que obrigatoriamente precisa constar na passagem?', t: 'textarea' }, { k: 'onde', l: 'Onde a passagem é registrada? (sistema, livro, planilha)' }] },
  { id: 'turno', nome: 'Rotina diária do coordenador (abertura e fechamento de turno)', area: 'ADM', desc: 'Rounds, conferências e pendências do dia.', q: [
    { k: 'conferencias', l: 'O que o coordenador confere na abertura do turno?', t: 'textarea' }, { k: 'fechamento', l: 'O que é conferido/repassado no fechamento?', t: 'textarea' }, { k: 'escalada', l: 'A quem o coordenador comunica problemas (e como)?' }] },
  { id: 'higienizacao', nome: 'Higienização e limpeza de ambientes', area: 'HIG', desc: 'Limpeza concorrente e terminal, produtos e escala.', q: [
    { k: 'areas', l: 'Quais áreas (críticas, semicríticas, não críticas) e setores são cobertos?' }, { k: 'produtos', l: 'Produtos, equipamentos e diluições usados' }, { k: 'empresa', l: 'A limpeza é feita por equipe própria ou terceirizada? Quem fiscaliza?' }] },
  { id: 'pgrss', nome: 'Segregação, acondicionamento e descarte de resíduos (PGRSS)', area: 'HIG', desc: 'Grupos de resíduos, coleta interna e armazenamento.', q: [
    { k: 'grupos', l: 'Quais grupos de resíduos são gerados? (A, B, D, E...)' }, { k: 'abrigo', l: 'Como é o armazenamento temporário/externo e quem recolhe?' }, { k: 'pesagem', l: 'Como e por quem é feita a pesagem/registro?' }] },
  { id: 'almox', nome: 'Recebimento, armazenamento e controle de estoque (almoxarifado)', area: 'ALM', desc: 'Entrada, conferência, guarda, saída e inventário.', q: [
    { k: 'itens', l: 'Que tipos de itens são controlados?' }, { k: 'conferencia', l: 'Como é feita a conferência no recebimento (nota, contrato, validade)?', t: 'textarea' }, { k: 'inventario', l: 'Frequência e forma do inventário / contagem' }] },
  { id: 'dispensacao', nome: 'Dispensação e controle de medicamentos', area: 'FAR', desc: 'Dispensação, estoque do setor, controlados e validade.', q: [
    { k: 'tipos', l: 'Quais tipos de medicamentos/insumos (comuns, controlados, termolábeis)?' }, { k: 'prescricao', l: 'Como é a conferência da prescrição e identificação de quem retira?', t: 'textarea' }, { k: 'validade', l: 'Como se controla validade, temperatura e perdas?' }] },
  { id: 'epi', nome: 'Entrega, uso e controle de EPI', area: 'RH', desc: 'Quem recebe o quê, quando, como se registra e se troca.', q: [
    { k: 'epis', l: 'Quais EPIs e para quais cargos/setores?' }, { k: 'troca', l: 'Quando ocorre a troca e como se trata perda/dano?' }, { k: 'registro', l: 'Como a entrega é registrada (ficha, QR, reconhecimento facial)?' }] },
  { id: 'chamado', nome: 'Chamado de manutenção e fiscalização de serviços terceirizados', area: 'MAN', desc: 'Abertura, acompanhamento, atesto e evidências.', q: [
    { k: 'servicos', l: 'Quais serviços/empresas são acompanhados?' }, { k: 'prazos', l: 'Prazos de atendimento combinados (se houver)' }, { k: 'evidencia', l: 'Que evidências (foto, OS, relatório) são exigidas?' }] },
  { id: 'atesto', nome: 'Atesto de notas fiscais e fiscalização de contratos', area: 'ADM', desc: 'Conferência de serviço prestado antes do pagamento.', q: [
    { k: 'contratos', l: 'Quais contratos/serviços entram nessa rotina?' }, { k: 'conferir', l: 'O que é conferido antes de atestar?', t: 'textarea' }, { k: 'prazo', l: 'Prazos internos para atesto e envio' }] },
  { id: 'escala', nome: 'Gestão de escalas, trocas e cobertura de plantão', area: 'RH', desc: 'Montagem da escala, permutas e faltas.', q: [
    { k: 'categorias', l: 'Para quais categorias profissionais?' }, { k: 'trocas', l: 'Regras para troca/permuta e quem autoriza', t: 'textarea' }, { k: 'faltas', l: 'Como é a cobertura quando há falta ou atraso?', t: 'textarea' }] },
  { id: 'disciplinar', nome: 'Registro e encaminhamento de ocorrências funcionais', area: 'ADM', desc: 'Registro objetivo, escuta, encaminhamento ao RH.', q: [
    { k: 'tipos', l: 'Quais ocorrências entram neste POP?' }, { k: 'rh', l: 'Em que casos o RH precisa ser acionado e como?', t: 'textarea' }, { k: 'sigilo', l: 'Quem pode ter acesso aos registros?' }] },
  { id: 'acesso', nome: 'Controle de acesso, visitantes e acompanhantes', area: 'SEG', desc: 'Entrada, identificação e horários.', q: [
    { k: 'regras', l: 'Quais são as regras de visita/acompanhante (horários, número)?', t: 'textarea' }, { k: 'ident', l: 'Como é feita a identificação e o registro?' }, { k: 'excecoes', l: 'Exceções e quem autoriza' }] },
  { id: 'eventos', nome: 'Notificação e tratamento de eventos adversos e incidentes', area: 'ASS', desc: 'Quem notifica, como, prazos e devolutiva.', q: [
    { k: 'quem_notifica', l: 'Quem pode/deve notificar e por qual canal?' }, { k: 'classif', l: 'Como o evento é classificado e investigado?', t: 'textarea' }, { k: 'retorno', l: 'Como é dada a devolutiva à equipe?' }] },
  { id: 'ponto', nome: 'Controle de ponto, atestados e documentos de RH', area: 'RH', desc: 'Frequência, justificativas e envio ao RH.', q: [
    { k: 'documentos', l: 'Quais documentos entram (atestados, declarações, folhas)?' }, { k: 'prazos', l: 'Prazos para entrega e conferência' }, { k: 'fluxo', l: 'Quem confere e para onde encaminha?' }] },
  { id: 'livre', nome: 'Outro tema (descrever)', area: 'ADM', desc: 'Para qualquer rotina que não esteja na lista.', q: [
    { k: 'tema_livre', l: 'Qual é o tema / nome da rotina?' }, { k: 'objetivo_livre', l: 'Para que serve este POP?', t: 'textarea' }] }
];

/* checklist e referências genéricas por tema (reserva sem IA) */
const POP_REFS = {
  pgrss: ['RDC ANVISA nº 222/2018 – Gerenciamento de Resíduos de Serviços de Saúde', 'Norma Regulamentadora NR-32 – Segurança e saúde no trabalho em serviços de saúde'],
  higienizacao: ['RDC ANVISA nº 63/2011 – Boas práticas de funcionamento para serviços de saúde', 'Norma Regulamentadora NR-32'],
  epi: ['Norma Regulamentadora NR-6 – Equipamento de Proteção Individual', 'Norma Regulamentadora NR-32'],
  eventos: ['Portaria GM/MS nº 529/2013 – Programa Nacional de Segurança do Paciente', 'RDC ANVISA nº 36/2013 – Segurança do paciente em serviços de saúde'],
  dispensacao: ['RDC ANVISA nº 63/2011', 'Portaria SVS/MS nº 344/1998 – medicamentos sujeitos a controle especial (quando aplicável)']
};

/* ---------- utilitários de texto ---------- */
const popLinhas = s => String(s || '').split(/\r?\n/).map(x => x.replace(/^\s*(?:[-•*●]|\d+[.)])\s*/, '').trim()).filter(Boolean);
const popFrase = s => { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.') : ''; };

/* Gera o conteúdo-padrão (sem IA) a partir das respostas. Fica no mesmo formato da IA. */
function popConteudoBase(tema, r) {
  const nome = (tema.id === 'livre' && r.tema_livre) ? r.tema_livre : tema.nome;
  const quem = popLinhas(r.quem), passos = popLinhas(r.passos);
  const intro = [
    `Este Procedimento Operacional Padrão (POP) padroniza a rotina de "${nome}" na UPA 24H Rocinha, para que seja executada de forma uniforme, segura e rastreável por todas as equipes envolvidas.`,
    r.quando ? `Esta rotina ocorre: ${r.quando.trim()}.` : ''
  ].filter(Boolean).join('\n\n');
  const etapas = (passos.length ? passos : ['Descrever aqui a primeira etapa da rotina.']).map((p, i) => ({ titulo: 'Etapa ' + (i + 1), descricao: popFrase(p) }));
  const espec = tema.q.map(q => r[q.k] ? `${q.l.replace(/\?$/, '')}: ${String(r[q.k]).trim()}` : '').filter(Boolean);
  const principios = [];
  const checklist = passos.map(p => popFrase(p).replace(/\.$/, ''));
  return {
    introducao: intro,
    objetivo: [`Padronizar a rotina de ${nome.toLowerCase()} na UPA 24H Rocinha;`, 'Definir quem faz o quê, quando e com quais registros;', 'Reduzir falhas, retrabalho e riscos à segurança de pacientes e colaboradores;', 'Garantir rastreabilidade e facilitar a supervisão pela coordenação.'].concat(espec.slice(0, 2)),
    abrangencia: quem.length ? 'Aplica-se a: ' + quem.join('; ') + ', vinculados à UPA 24H Rocinha, e às coordenações responsáveis pela supervisão da rotina.' : 'Aplica-se aos profissionais e coordenações da UPA 24H Rocinha envolvidos nesta rotina.',
    definicoes: [],
    principios,
    responsabilidades: [{ funcao: 'Coordenação responsável', atribuicao: 'Supervisionar o cumprimento deste POP, orientar a equipe, tratar não conformidades e manter o documento atualizado.' }].concat(quem.map(q => ({ funcao: popFrase(q).replace(/\.$/, ''), atribuicao: 'Executar a rotina conforme as etapas deste POP e registrar o que for realizado.' }))),
    fluxos: [{ titulo: 'Fluxo – ' + nome, introducao: espec.join('\n'), etapas }],
    documentacao: popLinhas(r.registros),
    situacoes: popLinhas(r.riscos).map(x => ({ situacao: popFrase(x).replace(/\.$/, ''), conduta: 'Registrar a ocorrência, comunicar a coordenação responsável e adotar a conduta definida pela unidade.' })),
    fluxo_resumido: etapas.map(e => e.descricao.replace(/\.$/, '').toUpperCase()).join(' → ') + '.',
    checklist,
    formularios: popLinhas(r.sistemas),
    referencias: (POP_REFS[tema.id] || []).concat(popLinhas(r.normas)),
    observacao: [r.extra && popFrase(r.extra), r.indicadores && 'Indicador de acompanhamento: ' + popFrase(r.indicadores), 'Texto gerado a partir do modelo-padrão do sistema. Revise todas as seções antes de enviar para assinatura.'].filter(Boolean).join('\n')
  };
}
