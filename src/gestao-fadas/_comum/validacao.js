'use strict';

const AppError = require('../../utils/AppError');

/** ID legado: inteiro positivo (INT(11)), recebido como texto. */
function idLegado(valor, campo = 'id') {
  const texto = `${valor ?? ''}`.trim();
  if (!/^\d{1,10}$/.test(texto)) throw new AppError(`${campo} inválido.`, 400, { campo });
  const n = Number(texto);
  if (n < 1 || n > 2147483647) throw new AppError(`${campo} inválido.`, 400, { campo });
  return n;
}

function dataCivil(valor, campo) {
  const texto = `${valor ?? ''}`.trim();
  const m = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new AppError(`${campo} deve estar no formato AAAA-MM-DD.`, 400, { campo });
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw new AppError(`${campo} não é uma data válida.`, 400, { campo });
  }
  return texto;
}

/** Período [inicio, fim] de datas civis, no máximo `maxDias` (padrão 366). */
function periodo(query, maxDias = 366) {
  const inicio = dataCivil(query.inicio, 'inicio');
  const fim = dataCivil(query.fim, 'fim');
  const dias = (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86400000;
  if (dias < 0) throw new AppError('fim não pode ser anterior a inicio.', 400);
  if (dias + 1 > maxDias) throw new AppError(`O período pode ter no máximo ${maxDias} dias.`, 400);
  return { inicio, fim };
}

/** Paginação padrão deste módulo: `pagina` (1..) e `limite` (1..max). */
function paginacao(query, { padrao = 20, max = 100 } = {}) {
  const pagina = Math.max(1, Number.parseInt(query.pagina, 10) || 1);
  let limite = Number.parseInt(query.limite, 10) || padrao;
  limite = Math.min(Math.max(1, limite), max);
  return { pagina, limite, offset: (pagina - 1) * limite };
}

/** Escapa curingas do LIKE para busca literal. */
function likeLiteral(texto) {
  return `%${String(texto).trim().replace(/[\\%_]/g, '\\$&')}%`;
}

module.exports = { idLegado, dataCivil, periodo, paginacao, likeLiteral };
