'use strict';

/**
 * ALLOWLIST das entidades espelhadas ALÉM da consulta (Maturacao/45): cliente (`usuarios`) e tarólogo (`tbl_tarologos`). Só UPDATE de colunas
 * EXPLÍCITAS (nunca INSERT, nunca DELETE, nunca DDL, nunca outra tabela), todos de texto fixo com `?`. Como o UPDATE leva só os campos que a
 * equipe mudou, o texto fixo existe para CADA subconjunto não vazio (15 de cliente, 3 de tarólogo), montados aqui uma vez, na ordem das colunas.
 * A cliente é conferida no WHERE (`nivel = 0`: `usuarios` também guarda a equipe; um id de funcionário nunca é tocado).
 * `senha`, `login`, `cpf`, `saldo`, `valorAPagar` e as demais colunas NUNCA entram em lista alguma.
 */

const CAMPOS_CLIENTE = Object.freeze(['nome_id', 'nome2', 'whats', 'datanascimento']);
const CAMPOS_TAROLOGO = Object.freeze(['nmuTarologo', 'ativo']);

/** Todos os subconjuntos não vazios de `colunas`, preservando a ordem. */
function subconjuntos(colunas) {
  const saida = [];
  for (let m = 1; m < (1 << colunas.length); m += 1) saida.push(colunas.filter((_, i) => m & (1 << i)));
  return saida;
}

const montar = (tabela, chave, extra) => (lista) => [lista.join(','), `UPDATE ${tabela} SET ${lista.map((c) => `${c} = ?`).join(', ')} WHERE ${chave} = ?${extra}`];
const UPDATES_CLIENTE = new Map(subconjuntos(CAMPOS_CLIENTE).map(montar('usuarios', 'id', ' AND nivel = 0')));
const UPDATES_TAROLOGO = new Map(subconjuntos(CAMPOS_TAROLOGO).map(montar('tbl_tarologos', 'idTarologo', '')));

const SELECT_CLIENTE = `SELECT id, ${CAMPOS_CLIENTE.join(', ')} FROM usuarios WHERE id = ? AND nivel = 0`;
const SELECT_TAROLOGO_ID = `SELECT idTarologo, ${CAMPOS_TAROLOGO.join(', ')} FROM tbl_tarologos WHERE idTarologo = ?`;

// Doc 47 (ASP): `nome_id` é único entre clientes sem diferenciar maiúscula; conferido antes de gravar.
const SELECT_NOME_ID_DUP = 'SELECT id FROM usuarios WHERE nome_id = ? AND id <> ? AND nivel = 0 LIMIT 1';

const PERMITIDAS = new Set([SELECT_NOME_ID_DUP, SELECT_CLIENTE, SELECT_TAROLOGO_ID, ...UPDATES_CLIENTE.values(), ...UPDATES_TAROLOGO.values()]);

/** SQL fixo do UPDATE para as colunas dadas (qualquer ordem); `null` se alguma coluna não é espelhável. */
function updateDe(mapa, campos, colunas) {
  if (!campos.length || campos.some((c) => !colunas.includes(c))) return null;
  return mapa.get(colunas.filter((c) => campos.includes(c)).join(',')) || null;
}
const updateCliente = (campos) => updateDe(UPDATES_CLIENTE, campos, CAMPOS_CLIENTE);
const updateTarologo = (campos) => updateDe(UPDATES_TAROLOGO, campos, CAMPOS_TAROLOGO);

module.exports = { SELECT_NOME_ID_DUP, CAMPOS_CLIENTE, CAMPOS_TAROLOGO, SELECT_CLIENTE, SELECT_TAROLOGO_ID, PERMITIDAS, UPDATES_CLIENTE, UPDATES_TAROLOGO, updateCliente, updateTarologo };
