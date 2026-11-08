'use strict';

/**
 * Formas de atendimento da profissional (v711), regras do CÓDIGO do front: features/domain/professional-service-modes.mjs (compartilhado por
 * painel, API e Lilly). PABX, Áudio e Texto; o padrão vem do cadastro (`serviceModes`, ou os canais antigos) e a profissional pode informar
 * outro conjunto para UM dia operacional. "Voz" antigo não distingue PABX de áudio: não vira meio sozinho. Puro: a data operacional vem de fora.
 */

const MODOS = Object.freeze(['pabx', 'audio', 'texto']);
const ROTULOS = Object.freeze({ pabx: 'PABX', audio: 'Áudio', texto: 'Texto' });
const MSG_MODOS = 'Escolha PABX, Áudio ou Texto.';
const chave = (v) => String(v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();

function validateServiceModes(entrada) {
  if (!Array.isArray(entrada) || entrada.some((v) => !MODOS.includes(v))) throw new Error(MSG_MODOS);
  return MODOS.filter((m) => entrada.includes(m));
}

function habitualServiceModes(perfil) {
  if (perfil && Array.isArray(perfil.serviceModes)) return validateServiceModes(perfil.serviceModes);
  const canais = perfil && Array.isArray(perfil.channels) ? perfil.channels : [];
  const mapeados = canais.map(chave).flatMap((v) => (v === 'chat' ? ['texto'] : MODOS.includes(v) ? [v] : []));
  return canais.length ? [...new Set(mapeados)] : ['texto'];
}

function effectiveServiceModes(perfil, data) {
  return perfil && perfil.serviceModesToday && perfil.serviceModesToday.date === data ? validateServiceModes(perfil.serviceModesToday.modes) : habitualServiceModes(perfil);
}

function requestedServiceMode(canal) {
  const v = chave(canal);
  if (v.includes('pabx')) return 'pabx';
  if (v.includes('audio')) return 'audio';
  if (v.includes('texto') || v.includes('digitad') || v === 'chat') return 'texto';
  return null;
}

function acceptsServiceMode(perfil, pedido, data) {
  const modo = MODOS.includes(pedido) ? pedido : requestedServiceMode(pedido);
  return !modo || effectiveServiceModes(perfil, data).includes(modo);
}

function serviceModeWarning(perfil, canal, data) {
  const modo = requestedServiceMode(canal);
  return modo && !acceptsServiceMode(perfil, modo, data) ? `${ROTULOS[modo]} indisponível para este atendimento. Confira com a taróloga.` : '';
}

/** `validateUmblerContact`: vínculo PROPOSTO da profissional com a Umbler (uso interno; a Lilly o verifica antes de usar). */
function validateUmblerContact(entrada) {
  if (entrada === undefined || entrada === null) return undefined;
  if (typeof entrada !== 'object' || Array.isArray(entrada)) throw new Error('Confira o contato da Umbler.');
  const r = {};
  for (const campo of ['contactId', 'phone', 'conversationId']) {
    const v = entrada[campo] ?? '';
    if (typeof v !== 'string' || v.length > 160 || /[\u0000-\u001f\u007f]/.test(v)) throw new Error('Confira o contato da Umbler.');
    r[campo] = v.trim();
  }
  if (!r.contactId && !r.phone && !r.conversationId) return undefined;
  if (!r.contactId || !/^[\w.-]+$/.test(r.contactId) || (r.conversationId && !/^[\w.-]+$/.test(r.conversationId))) throw new Error('Informe o ID do contato da Umbler.');
  if (r.phone && !/^\+?[\d\s().-]{10,24}$/.test(r.phone)) throw new Error('Confira o telefone do contato da Umbler.');
  return r;
}

module.exports = { MODOS, ROTULOS, MSG_MODOS, validateServiceModes, habitualServiceModes, effectiveServiceModes, requestedServiceMode, acceptsServiceMode, serviceModeWarning, validateUmblerContact };
