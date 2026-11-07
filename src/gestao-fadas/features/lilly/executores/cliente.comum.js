'use strict';

/**
 * Completar o cadastro de uma cliente que JÁ existe (Maturacao/60, item 1, fase A): PATCH /catalog/clients/:id (`gf_clientes_ext`), pelo
 * serviço existente `cadastros/clientes.service.js` (respeita `GF_LEGADO_CLIENTES`). Respeita `onlyIfEmpty`/`preservePreferences` (nada
 * preenchido é sobrescrito) e guarda `sourceMessageIds` na auditoria. NÃO cria usuário no legado.
 */

const cadastros = require('../../cadastros/clientes.service');
const vinculos = require('../dados/vinculos.repo');
const { dependencias } = require('./executores.dependencias');
const { recusar, ehObjeto, texto, ehIdCliente, chaveDaOperacao, pedidoDeServico, chamarServico, auditar } = require('./executores.comum');

/** Data AAAA-MM-DD (contrato) -> dd/mm/aaaa (cadastro). `null` se não for uma data civil. */
function dataParaCadastro(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto(v));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}
const dataDoCadastro = (v) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto(v)); return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined; };

/** A cliente existe e a conversa não está vinculada a OUTRA cliente. Devolve o ID. */
async function conferirCliente(acao, executor) {
  const payload = ehObjeto(acao.payload) ? acao.payload : {};
  const id = `${acao.clientId ?? payload.clientId ?? ''}`;
  if (!ehIdCliente(id)) return { id: '', motivo: 'Informe o ID da cliente.' };
  if (payload.clientId !== undefined && acao.clientId !== undefined && acao.clientId !== null && `${payload.clientId}` !== `${acao.clientId}`) return { id, motivo: 'O ID do cadastro não confere com o da ação.' };
  if (!(await dependencias().clienteExiste(id))) return { id, motivo: 'Cadastro de cliente não encontrado.' };
  const v = acao.conversationId ? await vinculos.buscarAtivoDaConversa(executor, `${acao.conversationId}`) : null;
  if (v && v.clientId !== id) return { id, motivo: 'A conversa já está vinculada a outra cliente.' };
  return { id, motivo: null };
}

async function lerExtensao(executor, id) {
  const [linhas] = await executor.execute('SELECT perfil_pagamento, dados, revisao FROM gf_clientes_ext WHERE id_cliente = ?', [id]);
  const l = linhas[0];
  if (!l) return { revisao: 0, perfil: '', dados: {} };
  return { revisao: Number(l.revisao), perfil: l.perfil_pagamento || '', dados: typeof l.dados === 'string' ? JSON.parse(l.dados) : l.dados || {} };
}

/** O que o payload pede mudar, já sem o que está preenchido e deve ser preservado. */
function calcularMudancas(payload, atual, { registro }) {
  const guardar = payload.onlyIfEmpty === true || payload.preservePreferences === true;
  const soVazio = payload.onlyIfEmpty === true;
  const vazio = (v) => !texto(v);
  const m = {};
  const nome = texto(payload.identificationName);
  if (nome && (vazio(atual.name) || !guardar)) m.name = nome;
  const tratar = texto(payload.treatAs);
  if (tratar && (vazio(atual.treatAs) || !guardar)) m.treatAs = tratar;
  const nasc = dataParaCadastro(payload.birthDate);
  if (nasc && !soVazio) m.birthDate = nasc;
  const fone = texto(payload.phone);
  if (fone && !soVazio) m.whatsapp = fone;
  if (registro && !atual.perfil) m.paymentProfile = 'Pré-pago'; // o painel cadastra sempre Pré-pago (client-create-model.ts)
  return m;
}

/**
 * Aplica o cadastro. `registro:true` (register_client) devolve o resultado completo; senão `{ id, ... }`.
 * Tudo certo ou recusa 4xx; a escrita real é do serviço da equipe (transação dele), a auditoria da Lilly vai na do executor.
 */
async function completarCadastro(acao, { executor, chave }, { registro }) {
  const payload = ehObjeto(acao.payload) ? acao.payload : {};
  const { id, motivo } = await conferirCliente(acao, executor);
  if (motivo) recusar('LILLY_CLIENT_INVALID', motivo, motivo.startsWith('Cadastro de cliente não') ? 404 : 422);
  const legado = await dependencias().lerCadastro(id);
  if (!legado) recusar('LILLY_CLIENT_INVALID', 'Cadastro de cliente não encontrado.', 404);
  const ext = await lerExtensao(executor, id);
  const atual = { name: texto(ext.dados.name) || legado.name, treatAs: texto(ext.dados.treatAs) || legado.treatAs, perfil: ext.perfil };
  const mudancas = calcularMudancas(payload, atual, { registro });
  let revisao = ext.revisao;
  if (Object.keys(mudancas).length) {
    const r = await chamarServico(() => cadastros.gravar(pedidoDeServico({
      params: { id }, body: { operationKey: chaveDaOperacao(chave, 'cliente'), expectedRevision: ext.revisao, changes: mudancas },
    })));
    revisao = r.extension.revision;
  }
  const fonte = Array.isArray(payload.sourceMessageIds) ? payload.sourceMessageIds.filter((s) => typeof s === 'string').slice(0, 20) : [];
  await auditar(executor, chave, {
    acao: acao.kind, entidade: 'cliente', entidadeId: id, antes: { revisao: ext.revisao },
    depois: { campos: Object.keys(mudancas), revisao, sourceMessageIds: fonte, conversationId: acao.conversationId },
    motivo: fonte.length ? `sourceMessageIds:${fonte.join(',')}` : undefined,
  });
  return { id, mudancas, ext, atual, revisao };
}

/** Resultado do contrato para `register_client` (5.1, item 5): `id`, nomes e o tipo de pagamento (a Lilly o usa no nome do contato). */
function resultadoDoCadastro(acao, feito) {
  const p = ehObjeto(acao.payload) ? acao.payload : {};
  const m = feito.mudancas;
  const perfil = m.paymentProfile || feito.ext.perfil || 'Pré-pago';
  const nasc = m.birthDate ? dataDoCadastro(m.birthDate) : (dataDoCadastro(feito.ext.dados.birthDate) || undefined);
  const fone = m.whatsapp || texto(feito.ext.dados.whatsapp) || undefined;
  return {
    id: feito.id,
    name: texto(p.name) || m.name || feito.atual.name,
    identificationName: m.name || feito.atual.name,
    paymentType: perfil === 'Pós-pago' ? 'Pós-pago' : 'Pré-pago',
    postpaid: perfil === 'Pós-pago',
    ...(nasc ? { birthDate: nasc } : {}),
    ...(fone ? { phone: fone } : {}),
    ...(texto(p.channel) ? { channel: texto(p.channel) } : {}),
    ...(texto(p.ddd) ? { ddd: texto(p.ddd) } : {}),
    ...(Number.isInteger(p.minutes) ? { minutes: p.minutes } : {}),
  };
}

module.exports = { conferirCliente, completarCadastro, resultadoDoCadastro, calcularMudancas, dataParaCadastro };
