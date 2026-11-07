'use strict';

/**
 * Sugestão e formato de nomes do cadastro (v706). Porta de server/lilly/registration-format.mjs
 * (`suggestedClientNames`, `suggestedRegistrationNames`, `registrationFullName`), que a ficha e o "Cadastrar cliente" usam.
 * Substitui `suggestedClientNames` de client-create-model.ts da v608 (a lista de nomes compostos mudou de lugar, não de conteúdo)
 * e acrescenta o nome de identificação sem o último sobrenome quando o nome é longo. A API não cria cliente no legado: estas
 * funções ficam como a regra de referência para o cadastro nativo.
 */

const compoundGivenNames = new Set([
  'ana maria', 'ana paula', 'ana carolina', 'ana clara', 'ana beatriz', 'ana luiza', 'ana luisa', 'ana julia', 'ana laura', 'ana vitoria', 'ana helena', 'ana alice',
  'maria clara', 'maria eduarda', 'maria luiza', 'maria luisa', 'maria fernanda', 'maria helena', 'maria alice', 'maria julia', 'maria cecilia', 'maria vitoria', 'maria aparecida', 'maria jose', 'maria de fatima',
  'joao pedro', 'joao paulo', 'joao vitor', 'joao victor', 'joao miguel', 'jose carlos', 'jose luis', 'jose luiz', 'luiz carlos', 'luis carlos', 'pedro henrique', 'paulo henrique', 'carlos eduardo',
]);
const comparableName = (value) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

function suggestedClientNames(fullName) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const count = [3, 2].find((length) => parts.length >= length && compoundGivenNames.has(comparableName(parts.slice(0, length).join(' ')))) || 1;
  const treatAs = parts.slice(0, count).join(' ');
  return { name: parts.length > count ? `${treatAs} ${parts.at(-1)}` : treatAs, treatAs };
}

/** Sugestão atual. Um sobrenome único nunca é removido. */
function suggestedRegistrationNames(fullName) {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  const particles = new Set(['da', 'de', 'do', 'das', 'dos', 'e', "d'"]);
  if (!tokens.length) return { name: '', treatAs: '' };
  const { treatAs } = suggestedClientNames(fullName);
  const meaningful = tokens.filter((value) => !particles.has(value.toLocaleLowerCase('pt-BR')));
  if (meaningful.length >= 4 || (meaningful.length === 3 && !treatAs.includes(' '))) {
    tokens.pop();
    while (tokens.length && particles.has(tokens.at(-1).toLocaleLowerCase('pt-BR'))) tokens.pop();
  }
  return { name: tokens.join(' '), treatAs };
}

/** Texto em minúsculas ou MAIÚSCULAS vira capitalizado; sobrenome em caixa mista deliberada é preservado. */
function registrationFullName(value) {
  const particles = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
  return typeof value === 'string' ? value.trim().split(/\s+/u).map((word, index) => {
    const lower = word.toLocaleLowerCase('pt-BR');
    if (index > 0 && particles.has(lower)) return lower;
    if (word !== lower && word !== word.toLocaleUpperCase('pt-BR')) return word;
    return lower.replace(/(^|[-'’])(\p{L})/gu, (_, start, letter) => start + letter.toLocaleUpperCase('pt-BR'));
  }).join(' ') : '';
}

module.exports = { registrationFullName, suggestedClientNames, suggestedRegistrationNames };
