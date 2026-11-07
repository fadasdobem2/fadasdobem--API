'use strict';

/**
 * Limites explícitos do snapshot `POST /lilly/context` (Maturacao/59, 3.11). O snapshot nunca despeja o banco: cada assunto lê só o que o
 * evento exige e, se passar do limite, o assunto NÃO é entregue pela metade: fica vazio e `complete` vira false.
 */

const LIMITES = Object.freeze({
  /** Candidatas por telefone (Maturacao/60, 9, item 6). Acima disso a busca não é completa. */
  CANDIDATAS_TELEFONE: 50,
  /** Conversas do mesmo pedido (evento + referências de aviso do relógio). */
  CONVERSAS: 50,
  /** Clientes "em foco" (as da conversa): só elas levam saldo e perfil de pagamento. */
  CLIENTES_EM_FOCO: 20,
  /** Clientes do snapshot (foco + candidatas + clientes da fila do dia). */
  CLIENTES: 400,
  TAROLOGOS: 200,
  AGENDA: 400,
  CONSULTAS: 400,
  PAGAMENTOS: 200,
  MENSAGENS: 500,
  RESTRICOES: 500,
  DIVERGENCIAS: 200,
  NOTAS_HORARIO: 500,
  /** Janelas (em dias) de leitura, contadas a partir de `now`. */
  JANELA_MENSAGENS_DIAS: 2,
  JANELA_CONSULTAS_DIAS: 45,
  JANELA_PAGAMENTOS_DIAS: 45,
});

module.exports = { LIMITES };
