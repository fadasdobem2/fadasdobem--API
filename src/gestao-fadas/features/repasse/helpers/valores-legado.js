'use strict';

/**
 * Leitura dos valores do legado (porta de `integration/legacy-values.ts` e do necessário de
 * `readLegacyConsultation` em `integration/legacy-read-model.ts`, B). Dinheiro continua TEXTO; datetime do MySQL é
 * relógio de parede, sem fuso.
 */

function legacyId(valor) {
  const texto = typeof valor === 'number' && Number.isSafeInteger(valor) ? String(valor) : valor;
  return typeof texto === 'string' && /^\d{1,10}$/.test(texto) && Number(texto) > 0 && Number(texto) <= 2147483647 ? texto : null;
}

function requireLegacyId(valor, origem) {
  const id = legacyId(valor);
  if (!id) throw new Error(`Identificador inválido em ${origem}; o registro não pode ser renumerado.`);
  return id;
}

/** DECIMAL(20,2) atravessa como texto. Nulo não é zero; valor grande nunca vira float. */
function legacyMoney(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number' && (!Number.isFinite(valor) || Math.abs(valor) > Number.MAX_SAFE_INTEGER / 100)) return null;
  const m = String(valor).match(/^(-?)(\d{1,18})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const inteiro = m[2].replace(/^0+(?=\d)/, '');
  const fracao = (m[3] || '').padEnd(2, '0');
  const sinal = inteiro === '0' && fracao === '00' ? '' : m[1];
  return `${sinal}${inteiro}.${fracao}`;
}

function legacyMinutes(valor) {
  if (valor === null || valor === undefined || valor === '' || !/^\d+$/.test(String(valor))) return null;
  const minutos = Number(valor);
  return Number.isSafeInteger(minutos) && minutos <= 2147483647 ? minutos : null;
}

/** DATETIME do MySQL é relógio de parede: devolve AAAA-MM-DDTHH:mm:ss(.f), ou null se zerado/impossível. */
function legacyLocalDateTime(valor) {
  if (!valor) return null;
  const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?$/);
  if (!m) return null;
  const [, ano, mes, dia, hora, minuto, segundo, fracao = ''] = m;
  const y = Number(ano);
  const mo = Number(mes);
  const d = Number(dia);
  if (y < 1000 || mo < 1 || mo > 12 || d < 1 || Number(hora) > 23 || Number(minuto) > 59 || Number(segundo) > 59) return null;
  const dias = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d > dias[mo - 1]) return null;
  return `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}${fracao}`;
}

/**
 * Consulta legada no modelo de leitura do núcleo. Só os campos que a apuração usa (a B devolve mais campos).
 * Entrada: linha de `tbl_consultas` (nomes do legado).
 */
function readLegacyConsultation(linha) {
  return {
    id: requireLegacyId(linha.idConsulta, 'tbl_consultas.idConsulta'),
    clientId: legacyId(linha.idUsuario),
    tarotId: legacyId(linha.idTarologo),
    startedAtLocal: legacyLocalDateTime(linha.iniConsulta),
    endedAtLocal: legacyLocalDateTime(linha.fimConsulta),
    recordedMinutes: legacyMinutes(linha.tmpConsulta),
    recordedAmount: legacyMoney(linha.valor_consulta),
    // Aplicado na conta antiga; não é concessão nova de bônus nem segundo desconto.
    appliedBonusMinutes: legacyMinutes(linha.vlBonus),
    recordedAbatement: legacyMoney(linha.abatimento),
  };
}

module.exports = { legacyId, requireLegacyId, legacyMoney, legacyMinutes, legacyLocalDateTime, readLegacyConsultation };
