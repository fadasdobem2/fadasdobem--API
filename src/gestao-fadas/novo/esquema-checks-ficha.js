'use strict';

/**
 * CHECKs das colunas da ficha acrescentadas a `gf_clientes_ext` pela migração 20261213000000 (decisão da Nice, 08/11): nome completo, CPF,
 * e-mail, telefones e endereço da cliente, sempre pelo MESMO id da cliente. Mesmos limites e formatos do front (client-profile-model.ts).
 * Texto preenchido nunca é vazio nem tem espaço nas pontas; coluna sem valor é NULL. O legado MySQL não é tocado.
 */

const preenchido = (c, max) => `${c} IS NULL OR (char_length(${c}) > 0 AND ${c} = trim(${c}) AND char_length(${c}) <= ${max})`;
const ENDERECO = [['end_rua', 200], ['end_numero', 20], ['end_complemento', 100], ['end_bairro', 100], ['end_cep', 24], ['end_cidade', 100], ['end_uf', 100], ['end_pais', 100]];

const CHECKS_FICHA_DADOS = {
  gf_clientes_ext: [
    ['chk_clientes_ext_nome_completo', preenchido('nome_completo', 255)],
    ['chk_clientes_ext_cpf', `cpf IS NULL OR (${preenchido('cpf', 50)} AND regexp_replace(cpf, '[^0-9]', '', 'g') ~ '^[0-9]{11}$')`],
    ['chk_clientes_ext_email', `email IS NULL OR (${preenchido('email', 50)} AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$')`],
    ['chk_clientes_ext_telefones', "telefones IS NULL OR (jsonb_typeof(telefones) = 'array' AND jsonb_array_length(telefones) BETWEEN 1 AND 20)"],
    ['chk_clientes_ext_telefones_indices', '(telefones IS NULL AND telefone_consulta_idx IS NULL AND telefone_whatsapp_idx IS NULL) OR (telefones IS NOT NULL AND telefone_consulta_idx IS NOT NULL AND telefone_whatsapp_idx IS NOT NULL AND telefone_consulta_idx >= 0 AND telefone_consulta_idx < jsonb_array_length(telefones) AND telefone_whatsapp_idx >= 0 AND telefone_whatsapp_idx < jsonb_array_length(telefones))'],
    ...ENDERECO.map(([coluna, max]) => [`chk_clientes_ext_${coluna}`, preenchido(coluna, max)]),
  ],
};

/**
 * Migração 20261216000000 (decisão da Nice, 09/11: "há cadastros antigos que usavam"): e-mail 2 (limite 100 do front) e telefone comercial
 * (limite 50). O nascimento NÃO entra aqui: já é gravado em `dados.birthDate` (identidade, nome da API `birthDate`).
 */
const CHECKS_FICHA_DADOS_2 = {
  gf_clientes_ext: [
    ['chk_clientes_ext_email2', `email2 IS NULL OR (${preenchido('email2', 100)} AND email2 ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$')`],
    ['chk_clientes_ext_telefone_comercial', preenchido('telefone_comercial', 50)],
  ],
};

module.exports = { CHECKS_FICHA_DADOS, CHECKS_FICHA_DADOS_2 };
