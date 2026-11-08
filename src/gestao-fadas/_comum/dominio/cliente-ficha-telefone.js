'use strict';

/**
 * Conferência do telefone do editor da ficha. Porta de normalizeClientPhone, formatClientPhoneNumber, clientPhoneText e clientPhoneComplete
 * (features/clientes/client-create-model.ts). Ouro: scripts/apoio-gf-ficha-dados/ouro.json.
 */

function normalizarTelefone(valor, atual = { ddi: '+55', ddd: '', number: '' }) {
  const digitos = valor.replace(/\D/g, '');
  if (valor.trim().startsWith('+') && !digitos.startsWith('55')) return { ...atual, number: valor.trim() };
  if (valor.trim().startsWith('+55') && [10, 11].includes(digitos.length)) return { ddi: '+55', ddd: '', number: digitos.slice(2) };
  const brasil = !atual.ddi.trim() || atual.ddi.replace(/\D/g, '') === '55';
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) return { ddi: '+55', ddd: digitos.slice(2, 4), number: digitos.slice(4) };
  if (brasil && (digitos.length === 10 || digitos.length === 11)) return { ddi: '+55', ddd: digitos.slice(0, 2), number: digitos.slice(2) };
  return { ...atual, number: valor.trim() };
}

function formatarNumero(fone) {
  const brasil = !fone.ddi.trim() || fone.ddi.replace(/\D/g, '') === '55';
  const digitos = fone.number.replace(/\D/g, '');
  if (!brasil || !/^[\d\s().-]+$/.test(fone.number) || !/^\d{8,9}$/.test(digitos)) return fone;
  return { ...fone, number: `${digitos.slice(0, -4)}-${digitos.slice(-4)}` };
}

function textoDoTelefone(fone) {
  if (!fone.ddd.trim() && !fone.number.trim()) return '';
  if (fone.number.trim().startsWith('+')) return fone.number.trim();
  const ddi = fone.ddi.replace(/\D/g, '') || '55';
  return [`+${ddi}`, fone.ddd.trim(), formatarNumero(fone).number.trim()].filter(Boolean).join(' ');
}

function clientePhoneComplete(fone) {
  if (!fone.number.trim()) return false;
  const texto = textoDoTelefone(formatarNumero(normalizarTelefone(fone.number, fone)));
  const digitos = texto.replace(/\D/g, '');
  return texto.startsWith('+55') ? /^55\d{10,11}$/.test(digitos) : /^\d{10,15}$/.test(digitos);
}

module.exports = { clientePhoneComplete, formatarNumero, normalizarTelefone, textoDoTelefone };
