'use strict';

/**
 * Situação cadastral (`dados_pendentes` | `completo`) da cliente NOVA depois de uma edição pela ficha. A API é a autoridade: recalcula pela mesma regra
 * da Lilly (`faltando`: nome conhecido, telefone, nascimento, e-mail válido ou "não possui e-mail") sobre os dados efetivos (cadastro novo + complemento
 * + o que a edição trouxe), na ordem da ficha do front (`clientRegistrationSituation`: nome completo ou de identificação; WhatsApp ou telefone). Pura.
 */

const { faltando } = require('../lilly/executores/cliente.campos');

const cheio = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
const primeiro = (...vs) => vs.map(cheio).find(Boolean) || '';
/** `dd/mm/aaaa` (a ficha) ou `AAAA-MM-DD` -> `AAAA-MM-DD`; qualquer outra coisa, nulo. */
function nascimentoIso(v) {
  const t = cheio(v);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}

/**
 * @param {object} nova     linha de `gf_clientes_novos` (nome, nome_id, telefone, data_nascimento, email)
 * @param {object} dados    `gf_clientes_ext.dados` já com a edição (name, whatsapp, birthDate, fullName, email...)
 * @param {object} colunas  colunas da ficha em `gf_clientes_ext` já com a edição (nome_completo, email, telefones, telefone_whatsapp_idx, sem_email)
 */
function situacaoDaNova(nova, dados, colunas) {
  const fones = Array.isArray(colunas.telefones) ? colunas.telefones : [];
  const efetivos = {
    nome: primeiro(colunas.nome_completo, dados.fullName, nova.nome, dados.name, nova.nome_id),
    telefone: primeiro(dados.whatsapp, fones[Number(colunas.telefone_whatsapp_idx) || 0], nova.telefone),
    nascimento: nascimentoIso(dados.birthDate) || nascimentoIso(nova.data_nascimento instanceof Date ? nova.data_nascimento.toISOString() : nova.data_nascimento),
    email: primeiro(colunas.email, dados.email, nova.email),
    semEmail: colunas.sem_email === true,
  };
  return faltando(efetivos).length ? 'dados_pendentes' : 'completo';
}

module.exports = { situacaoDaNova };
