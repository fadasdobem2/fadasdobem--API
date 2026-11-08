'use strict';

/** Telefone para o mapeamento taróloga x Umbler: normalização (BR), variantes do nono dígito e máscara para log/relatório. Funções puras, sem rede. */

const digitos = (t) => `${t ?? ''}`.replace(/\D/g, '');

/** `{ ddd, local }` de um telefone brasileiro (com ou sem 55), ou null se não der para saber o DDD. */
function partes(tel) {
  let d = digitos(tel);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  return { ddd: d.slice(0, 2), local: d.slice(2) };
}

const e164 = ({ ddd, local }) => `+55${ddd}${local}`;

/**
 * Formas a procurar na Umbler, na ordem: a informada e, quando o nono dígito pode ter sido omitido ou acrescentado, a outra
 * (a Lilly também avisa que 8 e 9 dígitos não casam sozinhos). Telefone sem DDD reconhecível: nenhuma variante.
 */
function variantes(tel) {
  const p = partes(tel);
  if (!p) return [];
  const saida = [e164(p)];
  if (p.local.length === 9 && p.local[0] === '9') saida.push(e164({ ddd: p.ddd, local: p.local.slice(1) }));
  else if (p.local.length === 8 && /^[6-9]/.test(p.local)) saida.push(e164({ ddd: p.ddd, local: `9${p.local}` }));
  return saida;
}

/** `+55 11 *****-1234`: DDI e DDD e os 4 últimos dígitos; nunca o número completo. Entrada irreconhecível vira `***`. */
function mascarar(tel) {
  const p = partes(tel);
  const d = digitos(tel);
  if (!p) return d.length >= 4 ? `***${d.slice(-2)}` : '***';
  return `+55 ${p.ddd} ${'*'.repeat(p.local.length - 4)}-${p.local.slice(-4)}`;
}

/** Chave para juntar o mesmo número escrito de formas diferentes (DDD + local, sem 55). */
const chave = (tel) => { const p = partes(tel); return p ? `${p.ddd}${p.local}` : digitos(tel); };

module.exports = { digitos, partes, variantes, mascarar, chave };
