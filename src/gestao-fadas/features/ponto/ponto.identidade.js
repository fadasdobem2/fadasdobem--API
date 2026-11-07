'use strict';

/**
 * Quem é a pessoa do ponto: SÓ a sessão do servidor (nada do pedido escolhe conta, função ou horário). A Nice trata duas funções no ponto:
 * `atendente` (bate o próprio ponto e informa a própria escala) e `administradora` (consulta a equipe e organiza a escala).
 * As atendentes da equipe vêm das contas ativas da A (o mesmo ID da conta, estável, que o diário de ações usa).
 */

const { nomesDeContasDaA } = require('../../novo/contas');

const FUNCOES = Object.freeze({ administradora: 'administradora', atendente: 'atendente' });

/** `{ id, name, role }` da sessão, ou `undefined` para quem não tem função no ponto (supervisora, assistente, tarólogas...). */
async function pessoaDaSessao(req) {
  const role = FUNCOES[req.perfilGate];
  if (!role || !req.user || !`${req.user.id || ''}`.trim()) return undefined;
  const id = `${req.user.id}`.trim();
  const nome = req.user.nome || (await nomesDeContasDaA([id])).get(id) || (role === 'atendente' ? 'Atendente' : 'Administradora');
  return { id, name: nome, role };
}

/** Atendentes ativas: `[{ id, name }]`. */
async function atendentes() {
  const { lerLinhas } = require('../contas/contas.store');
  return (await lerLinhas()).filter((l) => l.perfil === 'atendente' && l.ativo).map((l) => ({ id: `${l.id}`, name: l.nome }));
}

module.exports = { pessoaDaSessao, atendentes };
