'use strict';

/** O cadastro: uma linha de usuarios como o Clientes a mostra (fatia de clientes.model.js). */

const { centsToMoney, legacyId, legacyLocalDateTime, legacyMoney, legacyNoteText, legacyText, moneyToCents, utcLocalToSaoPauloLocal } = require('./helpers/valores');

/** Catálogos de referência sem linhas: o código fica sem rótulo (R21). Formato: { cpf_status: {'1':'Regular'}, paises: {...} }. */
const CATALOGOS_VAZIOS = Object.freeze({});

// --- o cadastro ------------------------------------------------------------------------------------------

/** Por que um campo aparece como não informado (R18): o dicionário não deixa um zero ser lido como meia-noite. */
const CLIENT_ISSUES = Object.freeze({
  birthDateZero: 'Data de nascimento não informada: data zerada no sistema antigo',
  birthDateInvalid: 'Data de nascimento inválida no sistema antigo',
  birthTimeMissing: 'Hora de nascimento não informada: vazia, zerada ou 00:00 no sistema antigo',
  createdAtMissing: 'Data do cadastro não informada ou inválida no sistema antigo',
});

const phoneOf = (ddd, number) => {
  const text = legacyText(number);
  return text === null ? null : { ddd: legacyText(ddd), number: text };
};

function catalogOf(catalogos, table, value) {
  if (value === '') return null;
  const code = value === null || value === undefined ? null : String(value);
  if (code === null) return null;
  const labels = (catalogos && catalogos[table]) || {};
  return { code, label: Object.prototype.hasOwnProperty.call(labels, code) ? labels[code] ?? null : null };
}

const ZERO_DATE = /^0000-00-00/;
// Só hora e minuto de horanascimento contam; a parte da data não diz nada.
const TIME_OF_DAY = /^(?:\d{4}-\d{2}-\d{2}[ T])?(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,6})?)?$/;

function birthTimeOf(value) {
  const match = value ? value.match(TIME_OF_DAY) : null;
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || (match[1] === '00' && match[2] === '00')) return null;
  return `${match[1]}:${match[2]}`;
}

/** Uma linha de `usuarios` como o Clientes a mostra, ou null quando não é cliente: só `nivel = 0` é (R18). */
function readRealClientRow(row, catalogos = CATALOGOS_VAZIOS) {
  const id = legacyId(row.id);
  if (id === null || row.nivel === null || row.nivel === undefined || String(row.nivel) !== '0') return null;
  const issues = [];
  const birthDate = legacyLocalDateTime(row.datanascimento)?.slice(0, 10) ?? null;
  if (birthDate === null) {
    const zero = !row.datanascimento || ZERO_DATE.test(row.datanascimento);
    issues.push({ field: 'birthDate', message: zero ? CLIENT_ISSUES.birthDateZero : CLIENT_ISSUES.birthDateInvalid });
  }
  const birthTime = birthTimeOf(row.horanascimento);
  if (birthTime === null) issues.push({ field: 'birthTime', message: CLIENT_ISSUES.birthTimeMissing });
  const createdUtc = legacyLocalDateTime(row.data_cadastro);
  if (createdUtc === null) issues.push({ field: 'createdAtLocal', message: CLIENT_ISSUES.createdAtMissing });
  const credit = legacyMoney(row.saldo);
  const toPay = legacyMoney(row.valorAPagar);
  // saldo - valorAPagar em centavos, como o cadastro antigo mostra; coluna nula não é zero (R20).
  const balanceCents = credit === null || toPay === null ? null : moneyToCents(credit) - moneyToCents(toPay);
  return {
    // Nome de identificação vazio é pendência; nenhum outro nome toma o lugar dele (R18).
    id, name: legacyText(row.nome_id)?.trim() || null, treatAs: legacyText(row.nome2), fullName: legacyText(row.nome),
    phones: { home: phoneOf(row.ddd, row.telresidencial), work: phoneOf(row.ddd, row.telcomercial), mobile: phoneOf(row.ddd, row.cel) },
    whatsapp: legacyText(row.whats), email: legacyText(row.email), email2: legacyText(row.email2),
    cpf: legacyText(row.cpf), cpfStatus: catalogOf(catalogos, 'cpf_status', row.status_cpf_id),
    // Texto puro: <br /> vira quebra de linha e qualquer outra marcação fica como escrita, nunca interpretada.
    cpfResult: legacyText(row.buscaNaReceita) === null ? null : legacyNoteText(row.buscaNaReceita),
    birthDate, birthTime,
    birthCity: legacyText(row.cidadeNascimento), birthState: legacyText(row.ufNascimento), birthCountry: catalogOf(catalogos, 'paises', row.IDpaisNascimento),
    address: {
      street: legacyText(row.endereco), number: legacyText(row.numero), complement: legacyText(row.complemento), district: legacyText(row.bairro),
      zip: legacyText(row.cep), city: legacyText(row.cidade), state: legacyText(row.estado), country: catalogOf(catalogos, 'paises', row.idPais),
    },
    createdAtLocal: createdUtc === null ? null : utcLocalToSaoPauloLocal(createdUtc),
    oldBalance: { credit, toPay, balance: balanceCents === null ? null : centsToMoney(balanceCents) }, balanceCents,
    // 0 não é vínculo; o vínculo abre o outro cadastro e as histórias nunca são juntadas (R20).
    linkedValidId: legacyId(row.id_cliente_valido),
    issues,
  };
}

module.exports = {
  CATALOGOS_VAZIOS,
  CLIENT_ISSUES,
  readRealClientRow,
};
