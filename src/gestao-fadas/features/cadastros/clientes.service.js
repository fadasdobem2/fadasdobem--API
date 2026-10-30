'use strict';

/**
 * Extensão do cadastro do cliente (Maturacao/29 seção 9): o que a equipe edita (nome de identificação, "tratar por", WhatsApp, nascimento,
 * Pré/Pós) fica em `gf_clientes_ext` (Postgres novo), sobreposto à leitura do legado. NADA é escrito em `usuarios` (nem aqui, nem por
 * adaptador). As regras de texto são as de `integration/legacy-client-write.ts` do front (limites das colunas do legado, sem caractere de
 * 4 bytes). O cliente tem de existir no legado (`clienteExiste`): a CRIAÇÃO de cliente não é feita aqui (o id nasce no legado).
 */

const { traduzirErroDeTexto } = require('./clientes.validacao');
const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const c = require('./cadastros.comum');
const { validarMudancas, aplicar, paraDto } = require('./clientes.validacao');

let verificarCliente = async (id) => require('../clientes/clientes.service').clienteExiste(id);
const definirVerificadorDeCliente = (f) => { verificarCliente = f; };

const idCliente = (v) => {
  if (typeof v !== 'string' || !/^[1-9]\d{0,9}$/.test(v) || Number(v) > 2147483647) throw c.invalido('id');
  return v;
};

/** `GET /catalog/clients?ids=1,2`: as extensões dos ids pedidos (no máximo 100). */
async function ler(req) {
  if (!novosDadosNoPostgres()) throw c.indisponivel();
  const q = c.quem(req);
  if (!q.p.canViewClients) throw c.negado(false);
  const bruto = `${(req.query && req.query.ids) || ''}`;
  const ids = [...new Set(bruto.split(',').map((s) => s.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 100) throw c.invalido('ids');
  ids.forEach(idCliente);
  const linhas = await lendoNovo((m) => m.GfClientesExt.findAll({ where: { id_cliente: ids } }));
  return { readAt: new Date().toISOString(), extensions: Object.fromEntries(linhas.map((l) => [l.id_cliente, paraDto(l)])) };
}

/** `PATCH /catalog/clients/:id`: `{ operationKey, expectedRevision, changes }`. */
async function gravar(req) {
  const id = idCliente(req.params.id);
  const q = c.quem(req);
  if (!q.p.canViewClients || q.perfil === 'tarologa') throw c.negado(true);
  const b = req.body;
  if (!c.ehObjeto(b)) throw c.invalido('corpo');
  const operationKey = c.chaveOperacao(b.operationKey);
  const expectedRevision = c.revisao(b.expectedRevision);
  let mudancas;
  try { mudancas = validarMudancas(b.changes); } catch (e) { throw traduzirErroDeTexto(e); }
  if (!(await verificarCliente(id))) throw new (require('../../../utils/AppError'))('Cadastro de cliente não encontrado.', 404, { codigo: 'CLIENT_NOT_FOUND' }, true);
  return c.gravar(req, {
    escopo: 'cadastros.cliente.editar', operationKey, corpo: { id, expectedRevision, mudancas }, entidade: 'cliente-ext', entidadeId: id, acao: 'cadastros.cliente.editar',
    producao: async (ex) => {
      await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_clientes_ext:${id}`]);
      const [linhas] = await ex.execute('SELECT id_cliente, perfil_pagamento, perfil_pagamento_em, dados, revisao FROM gf_clientes_ext WHERE id_cliente = ? FOR UPDATE', [id]);
      const atual = linhas[0] || null;
      if ((atual ? Number(atual.revisao) : 0) !== expectedRevision) throw c.conflitoVersao('Este cadastro mudou. Feche e abra novamente para conferir.');
      const antes = atual ? paraDto(atual) : null;
      const prox = aplicar(atual, mudancas, new Date().toISOString());
      if (atual) {
        await ex.execute('UPDATE gf_clientes_ext SET perfil_pagamento = ?, perfil_pagamento_em = ?, dados = ?, revisao = revisao + 1, atualizado_em = CURRENT_TIMESTAMP, atualizado_por = ?, operation_key = ? WHERE id_cliente = ?',
          [prox.perfil_pagamento, prox.perfil_pagamento_em, JSON.stringify(prox.dados), c.nomeDe(req), operationKey, id]);
      } else {
        await ex.execute('INSERT INTO gf_clientes_ext (id_cliente, perfil_pagamento, perfil_pagamento_em, dados, revisao, atualizado_por, operation_key) VALUES (?, ?, ?, ?, 1, ?, ?)',
          [id, prox.perfil_pagamento, prox.perfil_pagamento_em, JSON.stringify(prox.dados), c.nomeDe(req), operationKey]);
      }
      const depois = paraDto({ ...prox, id_cliente: id, revisao: (atual ? Number(atual.revisao) : 0) + 1 });
      return { antes, depois, resposta: { readAt: new Date().toISOString(), clientId: id, extension: depois } };
    },
  });
}

module.exports = { ler, gravar, definirVerificadorDeCliente };
