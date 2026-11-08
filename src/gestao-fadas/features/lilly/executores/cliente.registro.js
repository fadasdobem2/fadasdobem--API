'use strict';

/**
 * Cadastro NOVO de cliente pela Lilly no BANCO NOVO (Postgres `gf_clientes_novos` + `gf_clientes_ext`), docs/banco/21 da Nice. Nada no legado.
 *  - o ID vem de `gf_clientes_novos_id_seq` (faixa >= 1.000.000.000) e só é devolvido depois do commit (a guarda confirma na mesma transação);
 *  - nomes vazios enquanto desconhecidos, nascimento NULL, `situacao_cadastral` calculada e conferida (`dados_pendentes` | `completo`);
 *  - "sem e-mail" persistido (`sem_email`) e devolvido nas leituras; telefone único (outra cliente com o mesmo telefone = conferência humana);
 *  - cria o vínculo cliente x contato x conversa (verificado) quando o evento da conversa foi resolvido pelo Gestão, para o Pix achar o cadastro.
 * Recusa conhecida = 4xx. A repetição da mesma chave devolve a mesma cliente (idempotência pela guarda e pela `operation_key`).
 */

const vinculos = require('../dados/vinculos.repo');
const { dependencias } = require('./executores.dependencias');
const { normalizarCampos, situacaoConferida, faltando, nomeConhecido } = require('./cliente.campos');
const { conferirAprovacao } = require('./cliente.aprovacao');
const { gravarExtensao } = require('./cliente.extensao');
const { suggestedRegistrationNames } = require('../../../_comum/dominio/cliente-cadastro-nomes');
const { recusar, ehObjeto, texto, chaveDaOperacao, auditar } = require('./executores.comum');
const cfg = require('./executores.config');

const falha = (motivo, code = 'LILLY_CLIENT_INVALID', status = 422) => ({ motivo, code, status });

/** Telefone já cadastrado em OUTRA cliente (banco novo + legado somente leitura). Lista de IDs; `null` se a busca não é conclusiva. */
async function donasDoTelefone(executor, telefone) {
  if (!telefone) return [];
  const [nossas] = await executor.execute('SELECT id_cliente FROM gf_clientes_novos WHERE telefone = ?', [telefone]);
  const busca = await dependencias().clientesComTelefone(telefone);
  if (busca === null) return null;
  return [...new Set([...nossas.map((l) => l.id_cliente), ...busca])];
}

/**
 * Confere uma CRIAÇÃO (validate e execução). Devolve `{ motivo, code, status }` ou `{ campos, efetivos, situacao, conversationId }`.
 * @param {object} executor
 */
async function conferirCriacao(executor, acao) {
  const p = ehObjeto(acao.payload) ? acao.payload : {};
  const { campos, erro } = normalizarCampos(p);
  if (erro) return falha(erro);
  const conversationId = texto(acao.conversationId);
  if (!conversationId) return falha('A ação não informa a conversa.');
  if (p.sourceConversationId !== undefined && texto(p.sourceConversationId) !== conversationId) return falha('A conversa de origem não confere com a da ação.');
  const efetivos = { nome: campos.nome || '', telefone: campos.telefone || '', nascimento: campos.nascimento || null, email: campos.email || '', semEmail: campos.semEmail === true };
  const conf = situacaoConferida(campos.situacao, efetivos);
  if (conf.erro) return falha(conf.erro, 'LILLY_CLIENT_STATUS_MISMATCH');
  if (cfg.cadastroExigeAprovacao() || acao.registrationApproval !== undefined) {
    const ap = await conferirAprovacao(executor, acao);
    if (ap.motivo) return falha(ap.motivo, 'LILLY_REGISTRATION_APPROVAL_MISSING', 403);
  }
  const ocupada = await vinculos.buscarAtivoDaConversa(executor, conversationId);
  if (ocupada) return falha('A conversa já está vinculada a uma cliente. Não criei outro ID.', 'LILLY_CLIENT_ALREADY_LINKED', 409);
  const donas = await donasDoTelefone(executor, efetivos.telefone);
  if (donas === null) return falha('Não consegui conferir se o telefone já tem cadastro. Confira antes de criar.', 'LILLY_CLIENT_IDENTITY_REVIEW', 409);
  if (donas.length) return falha(`O telefone já consta no cadastro ${donas.join(', ')}. Confira antes de criar outro.`, 'LILLY_CLIENT_DUPLICATE_PHONE', 409);
  return { campos, efetivos, situacao: conf.situacao, conversationId };
}

/** Nome de identificação e "tratar por": o que a Lilly mandou; sem isso, a sugestão do Gestão, só com o nome completo conhecido. */
function nomesDeIdentificacao(campos, nome) {
  const sugeridos = nomeConhecido(nome) ? suggestedRegistrationNames(nome) : { name: '', treatAs: '' };
  return { nomeId: campos.nomeId || sugeridos.name, tratarPor: campos.tratarPor || sugeridos.treatAs };
}

async function criarVinculo(executor, { clientId, conversationId, contactId }) {
  if (!contactId) return false;
  const [prova] = await executor.execute('SELECT 1 AS ok FROM gf_lilly_eventos WHERE conversation_id = ? AND contact_id = ? LIMIT 1', [conversationId, contactId]);
  if (!prova[0]) return false; // sem evento resolvido pelo Gestão para este par contato x conversa, o vínculo não é "verificado": não cria
  await vinculos.salvarVinculo(executor, { clientId, contactId, conversationId, verified: true, active: true });
  return true;
}

/** Resultado do contrato (`register_client`): `id` real mais o que a Lilly usa para o nome do contato e para a Nota. */
function resultadoDaCriacao(id, linha, extra) {
  return {
    id, name: linha.nome || undefined, fullName: linha.nome || undefined, identificationName: linha.nomeId || undefined, treatAs: linha.tratarPor || undefined,
    paymentType: 'Pré-pago', postpaid: false, noEmail: extra.semEmail === true, situacao_cadastral: extra.situacao,
    ...(linha.nascimento ? { birthDate: linha.nascimento } : {}), ...(linha.telefone ? { phone: linha.telefone } : {}), ...(linha.email ? { email: linha.email } : {}),
    ...(extra.vinculada ? { linked: true } : {}),
  };
}

/** Executa a criação (dentro da transação da guarda). */
async function criarCliente(acao, { executor, chave }) {
  // A trava vem ANTES da conferência: duas criações simultâneas com o mesmo telefone/conversa se enfileiram e a segunda enxerga a primeira.
  await executor.execute('SELECT pg_advisory_xact_lock(hashtext(?))', ['gf_clientes_novos:criar']);
  const v = await conferirCriacao(executor, acao);
  if (v.motivo) recusar(v.code, v.motivo, v.status);
  const p = acao.payload;
  const { nomeId, tratarPor } = nomesDeIdentificacao(v.campos, v.efetivos.nome);
  const opKey = chaveDaOperacao(chave, 'cliente-novo');
  const [seq] = await executor.execute("SELECT nextval('gf_clientes_novos_id_seq') AS id");
  const id = `${seq[0].id}`;
  const contactId = texto(p.sourceContactId) || null;
  await executor.execute(
    `INSERT INTO gf_clientes_novos (id_cliente, nome, nome_id, nome2, data_nascimento, telefone, email, origem, source_contact_id, source_conversation_id, criado_por, operation_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'lilly', ?, ?, ?, ?)`,
    [id, v.efetivos.nome, nomeId, tratarPor, v.efetivos.nascimento, v.efetivos.telefone || null, v.efetivos.email || null, contactId, v.conversationId, cfg.NOME_DO_SERVICO, opKey],
  );
  await gravarExtensao(executor, id, {
    situacao: v.situacao, semEmail: v.campos.semEmail === true ? true : (v.campos.semEmail === false ? false : null), perfil: 'Pré-pago', semLinhaNoLegado: true,
    dados: { ...(v.efetivos.telefone ? { whatsapp: v.efetivos.telefone } : {}), registrationSource: 'umbler' },
  }, { quem: cfg.NOME_DO_SERVICO, operationKey: chaveDaOperacao(chave, 'cliente-ext') });
  const vinculada = await criarVinculo(executor, { clientId: id, conversationId: v.conversationId, contactId });
  const linha = { nome: v.efetivos.nome, nomeId, tratarPor, nascimento: v.efetivos.nascimento, telefone: v.efetivos.telefone, email: v.efetivos.email };
  await auditar(executor, chave, {
    acao: 'register_client', entidade: 'cliente', entidadeId: id, antes: null,
    depois: { origem: 'banco-novo', situacao_cadastral: v.situacao, faltando: faltando(v.efetivos), vinculada, conversationId: v.conversationId, proposalId: texto(p.proposalId) || undefined },
  });
  return resultadoDaCriacao(id, linha, { situacao: v.situacao, semEmail: v.efetivos.semEmail, vinculada });
}

module.exports = { conferirCriacao, criarCliente, nomesDeIdentificacao, resultadoDaCriacao };
