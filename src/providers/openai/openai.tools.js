/**
 * Ferramentas (JSON Schema / Function Calling) expostas ao Assistant.
 * O Assistant na OpenAI deve declarar ferramentas com os MESMOS nomes/parametrizacao.
 */

const check_balance = {
  type: 'function',
  function: {
    name: 'check_balance',
    description:
      'Consulta o saldo aproximado da carteira em BRL para o cliente autenticado no contexto operacional atual (ficcional até integrar ledger).',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
};

/** Lista pronta para `tools: [...]` ao criar/atualizar Assistants pela API quando necessário. */
function assistantToolDefinitions() {
  return [check_balance];
}

module.exports = {
  assistantToolDefinitions,
  check_balance,
};
