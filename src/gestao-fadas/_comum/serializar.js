'use strict';

/**
 * Higiene mínima dos valores do legado (o `sql_mode` do servidor é vazio):
 *   - datas/horas zeradas ("0000-00-00 ...") viram null;
 *   - dinheiro continua TEXTO ("59.20"); nunca vira número;
 *   - textos vazios continuam vazios (não se inventa significado).
 * Regras de negócio (R5, "em andamento", pré/pós) NÃO são aplicadas aqui; ficam nos serviços de cada módulo
 * quando forem especificadas.
 */

const ZERADA = /^0000-00-00/;

function data(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor);
  return ZERADA.test(texto) || texto === '' ? null : texto;
}

function pagina({ total, pagina: p, limite, itens }) {
  return { itens, pagina: p, limite, total, paginas: Math.max(1, Math.ceil(total / limite)) };
}

module.exports = { data, pagina };
