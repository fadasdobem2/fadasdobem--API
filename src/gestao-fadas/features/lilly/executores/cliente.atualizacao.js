'use strict';

/**
 * Atualização de cadastro da Lilly v708 (dados que chegam em partes completam o MESMO ID; nunca criam outra cliente):
 *  - cliente da faixa nova (`gf_clientes_novos`): atualiza a linha e a extensão;
 *  - cliente do legado: o legado é somente leitura; nome de identificação, tratar por, WhatsApp e nascimento seguem pelo serviço existente
 *    (`cliente.comum.js`), e o que ele não guarda (situação cadastral, "sem e-mail", e-mail, nome completo) vai para `gf_clientes_ext`.
 * Regra de "campo novo vazio nunca apaga": vazio/`null` recebido mantém o que existe. Preferências humanas (identificação, tratar por) só
 * mudam se estiverem vazias, quando a ação pede `preservePreferences` / `onlyIfEmpty`.
 */

const { faltando, situacaoConferida } = require('./cliente.campos');
const { gravarExtensao } = require('./cliente.extensao');
const { ehObjeto, chaveDaOperacao, auditar, recusar } = require('./executores.comum');
const { nomesDeIdentificacao } = require('./cliente.registro');
const cfg = require('./executores.config');

const QUEM = { quem: cfg.NOME_DO_SERVICO };

/** Mescla o que chegou com o que existe, pela regra acima. `atual` e o resultado: `{ nome, nomeId, tratarPor, nascimento, telefone, email, semEmail }`. */
function mesclar(atual, campos, payload) {
  const guardar = payload.onlyIfEmpty === true || payload.preservePreferences === true;
  const soVazio = payload.onlyIfEmpty === true;
  const novo = { ...atual };
  const mudou = [];
  const pondo = (campo, valor, permitido = true) => { if (permitido && valor !== undefined && valor !== null && valor !== '' && valor !== atual[campo]) { novo[campo] = valor; mudou.push(campo); } };
  pondo('nome', campos.nome, !soVazio || !atual.nome);
  pondo('nomeId', campos.nomeId, !guardar || !atual.nomeId);
  pondo('tratarPor', campos.tratarPor, !guardar || !atual.tratarPor);
  pondo('nascimento', campos.nascimento, !soVazio || !atual.nascimento);
  pondo('telefone', campos.telefone, !atual.telefone || !guardar);
  if (campos.email) { pondo('email', campos.email, !soVazio || !atual.email); if (atual.semEmail) { novo.semEmail = false; mudou.push('semEmail'); } }
  if (campos.semEmail === true && !atual.semEmail) { novo.semEmail = true; novo.email = ''; mudou.push('semEmail'); }
  return { novo, mudou };
}

async function atualizarClienteNovo(acao, { executor, chave }, id, campos) {
  const payload = ehObjeto(acao.payload) ? acao.payload : {};
  const [linhas] = await executor.execute('SELECT nome, nome_id, nome2, data_nascimento, telefone, email FROM gf_clientes_novos WHERE id_cliente = ? FOR UPDATE', [id]);
  const l = linhas[0];
  if (!l) recusar('LILLY_CLIENT_INVALID', 'Cadastro de cliente não encontrado.', 404);
  const [ext] = await executor.execute('SELECT situacao_cadastral, sem_email FROM gf_clientes_ext WHERE id_cliente = ?', [id]);
  const atual = { nome: l.nome, nomeId: l.nome_id, tratarPor: l.nome2, nascimento: l.data_nascimento ? `${l.data_nascimento instanceof Date ? l.data_nascimento.toISOString() : l.data_nascimento}`.slice(0, 10) : null, telefone: l.telefone || '', email: l.email || '', semEmail: ext[0] ? ext[0].sem_email === true : false };
  const { novo, mudou } = mesclar(atual, campos, payload);
  const conf = situacaoConferida(campos.situacao, novo);
  if (conf.erro) recusar('LILLY_CLIENT_STATUS_MISMATCH', conf.erro);
  const situacaoAntes = ext[0] ? ext[0].situacao_cadastral : null;
  const situacao = campos.situacao ? conf.situacao : situacaoAntes;
  if (situacao === 'completo' && !novo.nomeId && !novo.tratarPor) Object.assign(novo, nomesDeIdentificacao({}, novo.nome));
  if (mudou.length || situacao !== situacaoAntes) {
    await executor.execute(
      'UPDATE gf_clientes_novos SET nome = ?, nome_id = ?, nome2 = ?, data_nascimento = ?, telefone = ?, email = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id_cliente = ?',
      [novo.nome, novo.nomeId, novo.tratarPor, novo.nascimento, novo.telefone || null, novo.email || null, id],
    );
    await gravarExtensao(executor, id, { situacao, semEmail: novo.semEmail, dados: novo.telefone ? { whatsapp: novo.telefone } : {} }, { ...QUEM, operationKey: chaveDaOperacao(chave, 'cliente-ext') });
  }
  await auditar(executor, chave, {
    acao: acao.kind, entidade: 'cliente', entidadeId: id, antes: { situacao_cadastral: situacaoAntes },
    depois: { campos: mudou, situacao_cadastral: situacao, faltando: faltando(novo), conversationId: acao.conversationId },
  });
  return { id, changed: mudou, situacao_cadastral: situacao, noEmail: novo.semEmail === true, ...(mudou.includes('tratarPor') ? { treatAs: novo.tratarPor } : {}) };
}

/** Cliente do legado: só o que o serviço existente NÃO guarda. Chamado depois de `completarCadastro`. */
async function complementarClienteLegado(acao, { executor, chave }, id, campos) {
  const dados = {};
  if (campos.email) dados.email = campos.email;
  if (campos.nome) dados.fullName = campos.nome;
  const semEmail = campos.semEmail === true ? true : (campos.email ? false : undefined);
  if (campos.semEmail === true) dados.email = '';
  if (!campos.situacao && semEmail === undefined && !Object.keys(dados).length) return null;
  const r = await gravarExtensao(executor, id, { situacao: campos.situacao, semEmail, dados }, { ...QUEM, operationKey: chaveDaOperacao(chave, 'cliente-compl') });
  await auditar(executor, chave, { acao: `${acao.kind}.complemento`, entidade: 'cliente', entidadeId: id, antes: null, depois: { situacao_cadastral: r.situacao, sem_email: r.semEmail, campos: Object.keys(dados) } });
  return r;
}

module.exports = { atualizarClienteNovo, complementarClienteLegado, mesclar };
