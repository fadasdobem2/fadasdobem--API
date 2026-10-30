'use strict';

/**
 * Busca de clientes da v608. Porta de: features/clientes/client-search-model.ts e do parse de nascimento de
 * features/clientes/client-input-format.ts (parseClientBirthDate e auxiliares).
 */

const { normalizeSearch } = require('./valores');

// --- client-input-format ----------------------------------------------------------------------------------

function validBirth(day, month, year, currentYear) {
  if (year !== undefined && (year < 1900 || year > currentYear)) return null;
  const probeYear = year ?? 2000;
  const date = new Date(Date.UTC(probeYear, month - 1, day));
  return date.getUTCFullYear() === probeYear && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? { day, month, year } : null;
}

const pad = (value) => String(value).padStart(2, '0');
const formatBirth = ({ day, month, year }) => `${pad(day)}/${pad(month)}${year === undefined ? '' : `/${year}`}`;

/** Zeros omitidos podem deixar duas datas válidas; a pessoa escolhe. */
function compactBirthCandidates(input, currentYear) {
  if (!/^\d{5}$|^\d{7}$/.test(input)) return [];
  const suffix = Number(input.slice(3));
  const year = input.length === 7 ? suffix : suffix <= currentYear % 100 ? 2000 + suffix : 1900 + suffix;
  const candidates = [
    validBirth(Number(input[0]), Number(input.slice(1, 3)), year, currentYear),
    validBirth(Number(input.slice(0, 2)), Number(input[2]), year, currentYear),
  ].filter(Boolean);
  return [...new Map(candidates.map((item) => [formatBirth(item), item])).values()];
}

/** Lê o campo de nascimento; uma consulta numérica geral continua sendo ID/telefone. */
function parseClientBirthDate(value, currentYear = new Date().getFullYear()) {
  const input = value.trim();
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return validBirth(Number(iso[3]), Number(iso[2]), Number(iso[1]), currentYear);
  const separated = input.match(/^(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\s*[/.\-]\s*(\d{4}))?$/);
  if (separated) return validBirth(Number(separated[1]), Number(separated[2]), separated[3] ? Number(separated[3]) : undefined, currentYear);
  if (!/^\d+$/.test(input)) return null;
  if (input.length === 8) return validBirth(Number(input.slice(0, 2)), Number(input.slice(2, 4)), Number(input.slice(4)), currentYear);
  if (input.length === 4) return validBirth(Number(input.slice(0, 2)), Number(input.slice(2)), undefined, currentYear);
  if (input.length === 5 || input.length === 7) {
    const candidates = compactBirthCandidates(input, currentYear);
    return candidates.length === 1 ? candidates[0] : null;
  }
  if (input.length === 6) {
    const day = Number(input.slice(0, 2));
    const month = Number(input.slice(2, 4));
    const shortYear = Number(input.slice(4));
    const year = shortYear <= currentYear % 100 ? 2000 + shortYear : 1900 + shortYear;
    // Mês reconhecível com dia impossível continua inválido; nunca vira outra data.
    if (month >= 1 && month <= 12) return validBirth(day, month, year, currentYear);
    const suffix = Number(input.slice(3));
    const expandedYear = suffix < 100 ? 2000 + suffix : suffix >= 900 ? 1000 + suffix : 0;
    return validBirth(day, Number(input[2]), expandedYear, currentYear);
  }
  return null;
}

// --- client-search-model ----------------------------------------------------------------------------------

const emptyClientSearch = () => ({ query: '', id: '', name: '', phone: '', email: '', birthDate: '' });
const hasClientSearch = (search) => Object.values(search).some((value) => value.trim());
const normalize = (text) => normalizeSearch(text).trim().replace(/\s+/g, ' ');
const termsMatch = (query, text) => normalize(query).split(' ').every((term) => normalize(text).includes(term));

function phoneParts(value) {
  let digits = value.replace(/\D/g, '');
  const explicitInternational = value.trim().startsWith('+');
  const brazil = digits.startsWith('55') && ((digits.length === 12 || digits.length === 13) || (explicitInternational && (digits.length === 10 || digits.length === 11)));
  if (brazil) digits = digits.slice(2);
  return { digits, foreign: explicitInternational && !brazil };
}

function clientPhoneMatches(query, stored) {
  if (!/^[+\d\s().-]+$/.test(query.trim())) return false;
  const q = phoneParts(query);
  const s = phoneParts(stored);
  if (!q.digits || !s.digits) return false;
  if (q.foreign || s.foreign) return q.digits === s.digits;
  if (q.digits.length === 8 || q.digits.length === 9) {
    return s.digits === q.digits || ((s.digits.length === 10 || s.digits.length === 11) && s.digits.slice(2) === q.digits);
  }
  return q.digits.length >= 10 && q.digits === s.digits;
}

function clientBirthMatches(query, stored) {
  const q = parseClientBirthDate(query);
  const s = parseClientBirthDate(stored);
  return Boolean(q && s && q.day === s.day && q.month === s.month && (q.year === undefined || q.year === s.year));
}

/** Nome exibido/ordenado: nome completo da ficha, senão o displayName; a taróloga só vê o displayName. */
function clientListDisplayName(client, record, role) {
  return role !== 'tarologa' ? (record.fullName && record.fullName.trim()) || client.displayName : client.displayName;
}

/** `client` = { id, name, treatAs, whatsapp, birthDate }; `record` = { fullName, email, email2, phone, workPhone }. */
function clientMatchesSearch(client, record, search, role) {
  if (role === 'tarologa') return false;
  if (role === 'assistente') return Boolean(/^\d+$/.test(search.query.trim()) && client.id === search.query.trim());
  const names = [client.name, client.treatAs, record.fullName].filter(Boolean).join(' ');
  const emails = [record.email, record.email2].filter(Boolean).join(' ');
  const phones = [client.whatsapp, record.phone, record.workPhone].filter((value) => Boolean(value));
  const phoneMatch = (value) => phones.some((phone) => clientPhoneMatches(value, phone));
  const query = search.query.trim();
  let simple = true;
  if (query) {
    if (/[/.\-]/.test(query) && parseClientBirthDate(query)) simple = clientBirthMatches(query, client.birthDate);
    else if (/^[\d\s().+-]+$/.test(query)) simple = client.id === query || phoneMatch(query);
    else simple = termsMatch(query, names) || normalize(emails).includes(normalize(query));
  }
  return simple && (!search.id.trim() || client.id === search.id.trim())
    && (!search.name.trim() || termsMatch(search.name, names))
    && (!search.phone.trim() || phoneMatch(search.phone))
    && (!search.email.trim() || normalize(emails).includes(normalize(search.email)))
    && (!search.birthDate.trim() || clientBirthMatches(search.birthDate, client.birthDate));
}

module.exports = {
  clientBirthMatches, clientListDisplayName, clientMatchesSearch, clientPhoneMatches, emptyClientSearch, hasClientSearch, parseClientBirthDate,
};
