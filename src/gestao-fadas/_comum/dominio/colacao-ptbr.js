'use strict';

/**
 * Comparação de textos equivalente a `localeCompare('pt-BR')` (ICU) para o conjunto de caracteres de NOMES e códigos (Maturacao/39),
 * sem Intl: nível 1 (espaço < pontuação < dígitos < letras sem acento nem caixa), nível 2 (acentos, da esquerda para a direita), nível 3
 * (minúscula antes de maiúscula). A ordem das pontuações ASCII é a do ICU. Caracteres fora de Latin-1 estendido ordenam por ponto de código
 * depois das letras (limite registrado). O ouro está em `scripts/verificar-gf-painel-fluxo.js` (contra o `Intl.Collator` do Node gerado por caso).
 */

/** Ordem dos acentos no ICU: agudo, grave, breve, circunflexo, caron, anel, trema, til, ponto, cedilha, ogonek, mácron. */
const ACENTOS = ['\u0301', '\u0300', '\u0306', '\u0302', '\u030c', '\u030a', '\u0308', '\u0303', '\u0307', '\u0327', '\u0328', '\u0304'];
const PONTUACAO = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";

function chaves(texto) {
  const p = []; const s = []; const t = [];
  for (const ch of `${texto}`.normalize('NFD')) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x300 && cp <= 0x36f) { if (s.length) s[s.length - 1] = s[s.length - 1] * 20 + 1 + Math.max(0, ACENTOS.indexOf(ch)); continue; }
    let nivel1;
    const baixa = ch.toLowerCase();
    if (PONTUACAO.includes(ch)) nivel1 = PONTUACAO.indexOf(ch);
    else if (ch >= '0' && ch <= '9') nivel1 = 100 + Number(ch);
    else if (baixa >= 'a' && baixa <= 'z') nivel1 = 200 + baixa.charCodeAt(0) - 97;
    else nivel1 = 1000 + cp;
    p.push(nivel1); s.push(0); t.push(ch !== baixa ? 1 : 0);
  }
  return { p, s, t };
}
const lista = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i += 1) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return a.length - b.length < 0 ? -1 : a.length > b.length ? 1 : 0; };

/** Equivale a `a.localeCompare(b, 'pt-BR')` (sinal -1, 0 ou 1). */
function compararPtBR(a, b) {
  const x = chaves(a); const y = chaves(b);
  return lista(x.p, y.p) || lista(x.s, y.s) || lista(x.t, y.t);
}

module.exports = { compararPtBR };
