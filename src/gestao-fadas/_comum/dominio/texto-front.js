'use strict';

/** `validateText` / `validateObservation` do front (features/domain/input-validation.ts), mesmas frases. Ouro: scripts/apoio-gf-regras-b/clientes-ouro.js. */

class TextoDoFrontError extends Error {}
const falha = (m) => new TextoDoFrontError(m);

function validarTexto(valor, { rotulo, maximo, obrigatorio = false, multilinha = false }) {
  const erro = (m) => { throw falha(`${rotulo}: ${m}`); };
  if (typeof valor !== 'string') return erro('informe um texto válido.');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(valor)) return erro('há um caractere de controle inválido. Apague e digite novamente o trecho colado.');
  for (const ch of valor) { const p = ch.codePointAt(0); if (p >= 0xD800 && p <= 0xDFFF) return erro('há um caractere incompleto. Apague e digite novamente o trecho colado.'); }
  if (!multilinha && /[\r\n\t\u2028\u2029]/u.test(valor)) return erro('use uma única linha.');
  const t = valor.trim();
  if (obrigatorio && !t) return erro('preencha este campo.');
  if (Array.from(t).length > maximo) return erro(`use no máximo ${maximo} caracteres. O texto não foi cortado.`);
  return t;
}
/** `validateObservation`: até 4.000 caracteres, várias linhas. */
const validarObservacao = (valor, rotulo = 'Observação', obrigatorio = false) => validarTexto(valor, { rotulo, maximo: 4000, multilinha: true, obrigatorio });

module.exports = { TextoDoFrontError, validarTexto, validarObservacao };
