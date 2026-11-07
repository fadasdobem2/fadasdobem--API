'use strict';

/**
 * Autorização da cliente na transferência de saldo (v706 da Nice). Porte de `features/finance/balance-transfer-authorization-model.ts`
 * (`validateTransferAuthorizationImage`, `normalizeTransferAuthorization`): texto e/ou até 3 imagens PNG/JPG/WebP (1 MB cada, 2 MB no total), observação
 * interna separada, imagens iguais não se repetem e o conteúdo do arquivo tem de bater com o tipo informado. `readTransferAuthorizationImage` é do navegador
 * (File/FileReader) e não existe aqui. Substitui: o pedido do titular em texto simples passa a poder ser trocado pela autorização (a regra antiga continua
 * valendo quando não há autorização). Ouro: scripts/gerar-ouro-gf-area5-v706.js. Puro.
 */

const L = require('./pagamentos-livro');
const { normalizar: normalizarFormatacao } = require('./texto-formatado');

const LIMITE_IMAGEM = 1024 * 1024;
const LIMITE_TOTAL = 2 * 1024 * 1024;
const MAX_IMAGENS = 3;
const TIPOS = ['image/png', 'image/jpeg', 'image/webp'];
const { erro } = L;

function validarImagem(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) erro('Confira a imagem da autorização.');
  const imagem = valor;
  if (typeof imagem.id !== 'string' || !imagem.id.trim() || imagem.id.length > 100 || typeof imagem.name !== 'string' || !imagem.name.trim() || imagem.name.length > 180) erro('Não foi possível identificar a imagem da autorização.');
  if (!TIPOS.includes(imagem.mimeType) || typeof imagem.dataUrl !== 'string') erro('Anexe uma imagem PNG, JPG ou WebP.');
  if (!Number.isSafeInteger(imagem.size) || imagem.size <= 0 || imagem.size > LIMITE_IMAGEM || imagem.dataUrl.length > Math.ceil(LIMITE_IMAGEM / 3) * 4 + 40) erro('Cada imagem pode ter até 1 MB.');
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(imagem.dataUrl);
  if (!m || m[1] !== imagem.mimeType || m[2].length % 4 !== 0) erro('A imagem da autorização está inválida. Anexe o arquivo novamente.');
  const bytes = m[2].length * 3 / 4 - (m[2].endsWith('==') ? 2 : m[2].endsWith('=') ? 1 : 0);
  if (bytes !== imagem.size) erro('O tamanho da imagem não corresponde ao arquivo anexado.');
  const prefixo = Buffer.from(m[2].slice(0, 32), 'base64').toString('latin1');
  const cabecalhoOk = imagem.mimeType === 'image/png' ? prefixo.startsWith('\x89PNG\r\n\x1a\n') : imagem.mimeType === 'image/jpeg' ? prefixo.startsWith('\xff\xd8\xff') : prefixo.startsWith('RIFF') && prefixo.slice(8, 12) === 'WEBP';
  if (!cabecalhoOk) erro('O arquivo não corresponde ao formato da imagem informado.');
  return { id: imagem.id.trim(), name: imagem.name.trim(), mimeType: imagem.mimeType, size: imagem.size, dataUrl: imagem.dataUrl };
}

/** `undefined` quando não há autorização (vale o pedido do titular em texto). */
function normalizarAutorizacao(valor) {
  if (valor === undefined) return undefined;
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) erro('Inclua a autorização da cliente em texto ou imagem.');
  if (valor.version !== 1 || !Array.isArray(valor.images) || valor.images.length > MAX_IMAGENS) erro('Anexe até três imagens da autorização.');
  const texto = L.validarObservacao(valor.text, 'Autorização da cliente'); const interna = L.validarObservacao(valor.internalNote, 'Observação interna');
  const imagens = valor.images.map(validarImagem);
  if (new Set(imagens.map((i) => i.id)).size !== imagens.length) erro('A mesma imagem foi incluída mais de uma vez.');
  if (imagens.reduce((s, i) => s + i.size, 0) > LIMITE_TOTAL) erro('As imagens da autorização podem somar até 2 MB.');
  if (!texto && !imagens.length) erro('Cole a autorização da cliente ou anexe uma imagem da conversa.');
  const formatacao = normalizarFormatacao(texto, valor.formatting);
  return { version: 1, text: texto, ...(formatacao ? { formatting: formatacao } : {}), images: imagens, internalNote: interna };
}

/** O que entra na assinatura da operação: os bytes das imagens são comparados à parte. */
const resumoDaAutorizacao = (aut) => (aut ? { ...aut, images: aut.images.map(({ dataUrl, ...resto }) => resto) } : undefined);
/** A nota gravada na transferência quando há autorização. */
const notaDaAutorizacao = (aut) => aut.internalNote || aut.text || 'Autorização da cliente anexada.';

module.exports = { validarImagem, normalizarAutorizacao, resumoDaAutorizacao, notaDaAutorizacao, LIMITE_IMAGEM, LIMITE_TOTAL, MAX_IMAGENS, TIPOS };
