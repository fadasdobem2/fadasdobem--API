'use strict';

/**
 * Dados da ficha da cliente em `gf_clientes_ext` (nome completo, CPF, e-mail, telefones, endereço): quais colunas gravar e o que ler por perfil.
 * A leitura segue a regra do legado: nome completo e CPF só com identidade civil, telefones e endereço só com cadastro completo.
 */

const { COLUNAS, ENDERECO, fichaDeLinha, recortarPorPerfil } = require('../../_comum/dominio/cliente-ficha-efetivo');
const { canViewCivilIdentity, canViewFullRegistration } = require('../clientes/helpers/perfis');

/** Pares [coluna, valor] a gravar para os campos validados presentes em `m` (campo ausente = coluna intocada). */
function colunasDaFicha(m) {
  const pares = [];
  if (m.fullName !== undefined) pares.push(['nome_completo', m.fullName]);
  if (m.cpf !== undefined) pares.push(['cpf', m.cpf]);
  if (m.email !== undefined) pares.push(['email', m.email]);
  // Declarar "não possui e-mail" guarda a declaração e tira o e-mail do complemento (o legado segue só leitura).
  if (m.noEmail !== undefined) { pares.push(['sem_email', m.noEmail]); if (m.noEmail === true && m.email === undefined) pares.push(['email', null]); }
  if (m.phones !== undefined) pares.push(['telefones', JSON.stringify(m.phones)], ['telefone_consulta_idx', m.consultationPhoneIndex], ['telefone_whatsapp_idx', m.whatsappPhoneIndex]);
  // O endereço é uma unidade: grava as oito partes, a vazia como NULL.
  if (m.address !== undefined) for (const [chave, coluna] of ENDERECO) pares.push([coluna, m.address[chave] || null]);
  return pares;
}

/** Os nomes (da API) dos campos da ficha que a gravação mexeu, para a auditoria (sem os valores: CPF e endereço não vão ao log). */
const camposDaFicha = (m) => ['fullName', 'cpf', 'email', 'noEmail', 'phones', 'address'].filter((k) => m[k] !== undefined);

const SELECT_FICHA = `${COLUNAS.join(', ')}, dados`;

/** Os dados da ficha de uma linha, recortados para o perfil. */
const fichaParaPerfil = (linha, perfil) => recortarPorPerfil(fichaDeLinha(linha), { civil: canViewCivilIdentity(perfil), completo: canViewFullRegistration(perfil) });

module.exports = { SELECT_FICHA, camposDaFicha, colunasDaFicha, fichaParaPerfil };
