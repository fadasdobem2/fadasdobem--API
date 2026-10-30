'use strict';

/**
 * Validação e formato da extensão de cliente. Regras de `features/integration/legacy-client-write.ts` do front
 * (`legacyIdentityChanges`, ouro em Maturacao/44): limites 50/50/45 das colunas do legado, nascimento obrigatório e válido (ano de 1000 em diante, como `legacyLocalDateTime`), sem caractere de 4 bytes,
 * Pré/Pós. Campo ausente = preservado (nunca apagado por omissão); só "tratar por" e WhatsApp aceitam texto vazio.
 */

const AppError = require('../../../utils/AppError');

class TextoInvalidoError extends Error {}
const falha = (m) => new TextoInvalidoError(m);

function textoLinha(v, rotulo, max, obrigatorio = false) {
  if (typeof v !== 'string') throw falha(`${rotulo}: informe um texto válido.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(v)) throw falha(`${rotulo}: há um caractere de controle inválido. Apague e digite novamente o trecho colado.`);
  for (const ch of v) { const p = ch.codePointAt(0); if (p >= 0xD800 && p <= 0xDFFF) throw falha(`${rotulo}: há um caractere incompleto. Apague e digite novamente o trecho colado.`); }
  if (/[\r\n\t\u2028\u2029]/u.test(v)) throw falha(`${rotulo}: use uma única linha.`);
  const t = v.trim();
  if (obrigatorio && !t) throw falha(`${rotulo}: preencha este campo.`);
  if (Array.from(t).length > max) throw falha(`${rotulo}: use no máximo ${max} caracteres. O texto não foi cortado.`);
  if (Array.from(t).some((ch) => ch.codePointAt(0) > 0xFFFF)) throw falha(`${rotulo}: este cadastro ainda não aceita emojis ou caracteres de quatro bytes. O texto não foi alterado.`);
  return t;
}

function validarMudancas(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw falha('Alterações inválidas.');
  const s = {};
  if (m.name !== undefined) s.name = textoLinha(m.name, 'Nome de identificação', 50, true);
  if (m.treatAs !== undefined) s.treatAs = textoLinha(m.treatAs, 'Tratar por', 50);
  if (m.whatsapp !== undefined) s.whatsapp = textoLinha(m.whatsapp, 'WhatsApp', 45);
  if (m.birthDate !== undefined) {
    const t = typeof m.birthDate === 'string' ? m.birthDate.trim() : '';
    if (!t) throw falha('A data de nascimento não pode ser apagada neste cadastro.');
    const g = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const d = g ? new Date(Date.UTC(+g[3], +g[2] - 1, +g[1])) : null;
    if (!g || d.getUTCFullYear() !== +g[3] || d.getUTCMonth() !== +g[2] - 1 || d.getUTCDate() !== +g[1] || +g[3] < 1000) throw falha('Informe o nascimento no formato dd/mm/aaaa.');
    s.birthDate = t;
  }
  if (m.paymentProfile !== undefined) {
    if (!['', 'Pré-pago', 'Pós-pago'].includes(m.paymentProfile)) throw falha('Selecione Pré ou Pós.');
    s.paymentProfile = m.paymentProfile || null;
  }
  if (!Object.keys(s).length) throw falha('Nenhuma alteração informada.');
  return s;
}

const traduzirErroDeTexto = (e) => (e instanceof TextoInvalidoError ? new AppError(e.message, 422, { codigo: 'RULE_VIOLATION' }, true) : e);

/** Linha atual (ou null) + mudanças -> colunas novas. `paymentProfile` só muda o carimbo quando o valor muda. */
function aplicar(atual, mudancas, agoraIso) {
  const dadosAtuais = atual ? (typeof atual.dados === 'string' ? JSON.parse(atual.dados) : atual.dados || {}) : {};
  const dados = { ...dadosAtuais };
  for (const k of ['name', 'treatAs', 'whatsapp', 'birthDate']) if (mudancas[k] !== undefined) dados[k] = mudancas[k];
  const perfilAntes = atual ? atual.perfil_pagamento : null;
  const mudouPerfil = mudancas.paymentProfile !== undefined && mudancas.paymentProfile !== perfilAntes;
  return {
    dados,
    perfil_pagamento: mudancas.paymentProfile !== undefined ? mudancas.paymentProfile : perfilAntes ?? null,
    perfil_pagamento_em: mudouPerfil ? agoraIso : (atual ? atual.perfil_pagamento_em : null) ?? null,
  };
}

function paraDto(l) {
  const dados = typeof l.dados === 'string' ? JSON.parse(l.dados) : l.dados || {};
  const em = l.perfil_pagamento_em ? new Date(l.perfil_pagamento_em).toISOString() : null;
  return { ...dados, ...(l.perfil_pagamento ? { paymentProfile: l.perfil_pagamento } : {}), ...(em && l.perfil_pagamento ? { paymentProfileUpdatedAt: em } : {}), revision: Number(l.revisao) };
}

module.exports = { validarMudancas, traduzirErroDeTexto, aplicar, paraDto };
