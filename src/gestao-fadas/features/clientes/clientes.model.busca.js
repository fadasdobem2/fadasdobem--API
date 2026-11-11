'use strict';

/** A busca da v608 sobre o cadastro real (fatia de clientes.model.js). */

const { clientMatchesSearch, emptyClientSearch } = require('./helpers/busca');
const { readRealClientRow } = require('./clientes.model.cadastro');

/** clientMatchesSearch da v608 lê estes campos de uma linha demo e do cadastro; o cadastro real os preenche. */
function searchable(record, [whatsapp, phone, workPhone]) {
  const client = { id: record.id, name: record.name ?? '', treatAs: record.treatAs ?? undefined, whatsapp, birthDate: record.birthDate ?? '' };
  const registration = { fullName: record.fullName ?? undefined, email: record.email ?? undefined, email2: record.email2 ?? undefined, phone, workPhone };
  return { client, registration };
}
const dialed = (phone) => (phone ? `${phone.ddd ?? ''}${phone.number}` : undefined);

function matchesSearch(record, search, role, telefones = []) {
  // A v608 compara três telefones e o cadastro real tem quatro (R19). Cada critério roda nos dois conjuntos de telefones
  // e vale se um deles o cumpre; os critérios continuam combinados, como na v608.
  const sets = [
    searchable(record, [record.whatsapp ?? undefined, dialed(record.phones.home), dialed(record.phones.work)]),
    searchable(record, [dialed(record.phones.mobile)]),
    ...telefones.map((telefone) => searchable(record, [telefone])),
  ];
  const fields = Object.keys(search).filter((key) => search[key].trim());
  return fields.every((key) => sets.some(({ client, registration }) => clientMatchesSearch(client, registration, { ...emptyClientSearch(), [key]: search[key] }, role)));
}

/** Se a busca da v608 acha uma linha de cadastro; o leitor decide ID, telefone e nascimento com ela (R19, T096). */
function realClientMatches(row, search, role) {
  const record = readRealClientRow(row);
  return record !== null && matchesSearch(record, search, role, Array.isArray(row._telefones) ? row._telefones : []);
}

module.exports = {
  matchesSearch,
  realClientMatches,
};
