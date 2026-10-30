/** Textos versionados junto ao repositório (não dependemos do Dashboard OpenAI para o “contrato”). */

/** Nome estável registrado ao criar o Assistant via API (consulta por igualdade). */
const ASSISTANT_DISPLAY_NAME =
  process.env.OPENAI_ASSISTANT_DISPLAY_NAME || 'Fadas do Bem • Orquestrador IA';

/**
 * Chave lógica no metadata do Assistant — desambigua clones na mesma org.
 * Ajustável via env sem alterar código.
 */
const ASSISTANT_REGISTRY_SLUG =
  process.env.OPENAI_ASSISTANT_REGISTRY_SLUG || 'fadbem_orchestrator_v1';

/** Instruções principais gravadas diretamente no recurso Assistant (assistants=v2). */
const ASSISTANT_SYSTEM_INSTRUCTIONS = `Você é a IA operacional da plataforma Fadas do Bem.
Contexto resumido: conectamos clientes a especialistas via consultas comercialmente sensíveis.
Regras gerais:
- Seja cortês e profissional.
- Prefira mensagens objetivas antes de perguntas abertas.
- Nunca invente valores financeiros: use apenas dados retornados pelas ferramentas (functions) disponíveis.
- Se algo depender identidade/carteira ainda não atribuída ao canal atual, sugira ao usuário entrar em contato com um humano/atendimento.
`;

/** Reforços leves aplicados também em cada execução de Run (`additional_instructions`). */
const RUN_APPEND_INSTRUCTIONS_PT =
  'Use português do Brasil sempre que o usuário também estiver usando português. Mantenha alinhamento com as políticas comerciais Fadas do Bem.';

const FALLBACK_IA_UNAVAILABLE =
  'Não consegui contatar nossa IA no momento — equipe será avisada. Tente novamente em instantes.';

module.exports = {
  ASSISTANT_DISPLAY_NAME,
  ASSISTANT_REGISTRY_SLUG,
  ASSISTANT_SYSTEM_INSTRUCTIONS,
  RUN_APPEND_INSTRUCTIONS_PT,
  FALLBACK_IA_UNAVAILABLE,
};
