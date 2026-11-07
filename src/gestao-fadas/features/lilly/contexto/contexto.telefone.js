'use strict';

/**
 * Telefone no snapshot (Maturacao/60, seção 9). Funções puras.
 *  - O painel da Nice casa por `clientPhoneMatches` (features/clientes/helpers/busca.js, porte fiel); a Lilly casa por `fullPhone`
 *    (igualdade do texto `+55DDNNNNNNNNN`, número sem DDD é descartado e 8 NÃO casa com 9 dígitos). Por isso a API devolve os telefones
 *    já normalizados em `+55 DD número` e, quando o painel só casa pelo nono dígito, devolve também o número no formato do observado.
 *  - `ddi` e `ddd_real` NÃO RESPONDIDOS pelo painel: padrão seguro = `ddi` 0/vazio/55 é Brasil; outro `ddi` é estrangeiro (compara dígitos
 *    inteiros); `ddd_real` só vale se `ddd` estiver vazio; `ddd` e `ddd_real` divergentes tornam a busca incompleta.
 *  - `whats`/`cel2`: formato real em produção NÃO RESPONDIDO; entram como vierem (com ou sem DDI) e só casam se tiverem DDD.
 */

const { clientPhoneMatches } = require('../../clientes/helpers/busca');

const soDigitos = (v) => `${v ?? ''}`.replace(/\D/g, '');

/** Telefone observado (contato da Umbler) -> `+55DDNNNNNNNNN`/`+DDI...`; vazio se inválido ou sem DDD (nunca inventa DDD). */
function normalizarObservado(valor) {
  const texto = typeof valor === 'string' ? valor.trim() : typeof valor === 'number' ? String(valor) : '';
  if (!texto || !/^\+?[\d\s().-]+$/.test(texto)) return '';
  const d = soDigitos(texto);
  if (texto.startsWith('+')) {
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return `+${d}`;
    if (d.startsWith('55') && (d.length === 10 || d.length === 11)) return ''; // "+55" + número sem DDD
    return d.length >= 10 && d.length <= 15 ? `+${d}` : '';
  }
  if (d.startsWith('00') && d.length >= 12 && d.length <= 17) return `+${d.slice(2)}`;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return `+${d}`;
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  return '';
}

/** `+55 DD NNNNN-NNNN` (formato do painel) para número brasileiro com DDD; outro texto sai como veio. */
function textoParaLilly(bruto) {
  const texto = `${bruto ?? ''}`.trim();
  if (!texto) return '';
  let d = soDigitos(texto);
  const comMais = texto.startsWith('+');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  else if (comMais || d.length < 10 || d.length > 11) return texto;
  if (d.length !== 10 && d.length !== 11) return texto;
  const corte = d.length === 11 ? 7 : 6;
  return `+55 ${d.slice(0, 2)} ${d.slice(2, corte)}-${d.slice(corte)}`;
}

function dddDe(v) {
  let d = soDigitos(v);
  if (d.length === 3 && d.startsWith('0')) d = d.slice(1);
  return d.length === 2 && d !== '00' ? d : '';
}

/**
 * Telefones de um cadastro de `usuarios` (leitura). Devolve `{ telefones: string[], ambigua, estrangeira }`.
 * Cada telefone é o texto "como o painel compara" (DDD + número); a decisão final é de `clientPhoneMatches`.
 */
function telefonesDoCadastro(linha) {
  const ddi = soDigitos(linha.ddi).replace(/^0+/, '');
  const estrangeira = ddi !== '' && ddi !== '55';
  const ddd = dddDe(linha.ddd);
  const dddReal = dddDe(linha.ddd_real);
  const ambigua = Boolean(ddd && dddReal && ddd !== dddReal) || (estrangeira && Boolean(ddd));
  const dddEfetivo = ddd || dddReal;
  const compor = (numero) => {
    const d = soDigitos(numero);
    if (!d) return '';
    if (estrangeira) return `+${ddi}${d}`;
    return d.length >= 10 || !dddEfetivo ? d : `${dddEfetivo}${d}`;
  };
  const bruto = [compor(linha.telresidencial), compor(linha.telcomercial), compor(linha.cel), compor(linha.cel2)];
  const whats = `${linha.whats ?? ''}`.trim();
  if (whats) {
    const d = soDigitos(whats);
    if (whats.startsWith('+')) bruto.push(whats);
    else if (estrangeira) bruto.push(`+${ddi}${d}`);
    else bruto.push(d.length >= 10 ? whats : compor(whats));
  }
  return { telefones: [...new Set(bruto.filter(Boolean))], ambigua, estrangeira };
}

/** Mesmo celular com e sem o nono dígito (mesmo DDD, 8 dígitos = os 8 últimos dos 9 que começam com 9). */
function nonoDigito(observado, armazenado) {
  const brasil = (v) => {
    let d = soDigitos(v);
    if (`${v}`.trim().startsWith('+') && !d.startsWith('55')) return null;
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
    return d.length === 10 || d.length === 11 ? d : null;
  };
  const a = brasil(observado);
  const b = brasil(armazenado);
  if (!a || !b || a.length === b.length || a.slice(0, 2) !== b.slice(0, 2)) return false;
  const [longo, curto] = a.length > b.length ? [a, b] : [b, a];
  return longo[2] === '9' && longo.slice(3) === curto.slice(2);
}

/** `'exact'` (decisão do painel), `'ninth_digit'` ou `''`. */
function comoCasa(observado, armazenado) {
  if (clientPhoneMatches(observado, armazenado)) return 'exact';
  return nonoDigito(observado, armazenado) ? 'ninth_digit' : '';
}

module.exports = { soDigitos, ultimos8: (v) => soDigitos(v).slice(-8), normalizarObservado, textoParaLilly, telefonesDoCadastro, comoCasa, nonoDigito };
