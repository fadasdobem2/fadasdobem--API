'use strict';

/**
 * Regra pura de Tarólogos (sem banco). Porte de `readLegacyTarologist` (features/integration/legacy-read-model.ts) e
 * `readRealTarologists` (legacy-operations.server.ts) do suspiro/B.
 *
 * DTO da B: `{ id, name, active }`. `active` é true/false só para '1'/'0'; qualquer outro valor é null ("não
 * informado"), nunca falso. `name` é o texto como está no legado, ou null se vazio/em branco.
 */

const AppError = require('../../../utils/AppError');

/** Colunas lidas de `tbl_tarologos` (a B lê exatamente estas; sem `nmcTarologo` nem senha). */
const COLUNAS = ['idTarologo', 'nmuTarologo', 'ativo'];

/** `legacyId` da B: inteiro positivo de até 10 dígitos, ≤ 2147483647, em texto; senão null. */
function legacyId(valor) {
  const texto = typeof valor === 'number' && Number.isSafeInteger(valor) ? String(valor) : valor;
  return typeof texto === 'string' && /^\d{1,10}$/.test(texto) && Number(texto) > 0 && Number(texto) <= 2147483647 ? texto : null;
}

/** `legacyText` da B. */
const legacyText = (valor) => (typeof valor === 'string' && valor.trim() ? valor : null);

/** Registro sem ID válido não é renumerado: falha (a B também), nunca devolve lista parcial. */
function exigirId(valor) {
  const id = legacyId(valor);
  if (!id) {
    throw new AppError('Identificador inválido em tbl_tarologos.idTarologo; o registro não pode ser renumerado.', 503, {
      codigo: 'LEGADO_REGISTRO_INVALIDO',
    });
  }
  return id;
}

/** `registrationActive` da B. */
const situacaoCadastro = (ativo) => (String(ativo) === '1' ? true : String(ativo) === '0' ? false : null);

/** Linha de `tbl_tarologos` -> DTO da B. */
function paraDto(linha) {
  return { id: exigirId(linha.idTarologo), name: legacyText(linha.nmuTarologo), active: situacaoCadastro(linha.ativo) };
}

/**
 * EXTENSÃO DA A (não existe na B): `gf_tarologos_ext`, campo ADICIONAL e separado do DTO. Sem linha na extensão =
 * null ("não informado"), nunca zero nem vazio.
 */
function paraExtensao(ext) {
  if (!ext) return null;
  return {
    fotoAtualRef: ext.foto_atual_ref ?? null,
    primeiroNomeCivil: ext.primeiro_nome_civil ?? null,
    whatsappPessoal: ext.personal_whatsapp ?? null,
    whatsappAvatar: ext.avatar_whatsapp ?? null,
    situacaoTurno: ext.situacao_turno ?? null,
    retornoPrevistoEm: ext.retorno_previsto_em ?? null,
  };
}

module.exports = { COLUNAS, legacyId, legacyText, exigirId, situacaoCadastro, paraDto, paraExtensao };
