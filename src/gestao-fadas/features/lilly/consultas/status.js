'use strict';

/**
 * Tradução do status de consulta do Gestão para o vocabulário da Lilly (Maturacao/59, D8). A Lilly entende
 * `prepared` (preparada, ainda sem início do tarólogo), `in_progress`, `completed` e `cancelled`; o Gestão guarda "Em curso" com
 * `awaitingTarologistStart` para a preparada. Estado desconhecido NÃO vira um dos quatro: vira `unknown`, para a Lilly não agir.
 */

function traduzirStatusConsulta({ status, awaitingTarologistStart = false } = {}) {
  const s = `${status || ''}`.trim();
  if (s === 'Em curso') return awaitingTarologistStart ? 'prepared' : 'in_progress';
  if (s === 'Finalizada pelo tarólogo') return 'in_progress'; // o tarólogo encerrou, a equipe ainda confere: continua aberta para a Lilly
  if (s === 'Concluída') return 'completed';
  if (s === 'Cancelada') return 'cancelled';
  return 'unknown';
}

module.exports = { traduzirStatusConsulta };
