'use strict';

/**
 * Extensão do cadastro do cliente (Maturacao/29 seção 9): o que a equipe edita (nome de identificação, "tratar por", WhatsApp, nascimento,
 * Pré/Pós e, desde 08/11, nome completo, CPF, e-mail, telefones e endereço, em colunas próprias) fica em `gf_clientes_ext` (Postgres novo), sobreposto à leitura do legado. NADA é escrito em `usuarios` (nem aqui, nem por
 * adaptador). As regras de texto são as de `integration/legacy-client-write.ts` do front (limites das colunas do legado, sem caractere de
 * 4 bytes). O cliente tem de existir no legado (`clienteExiste`): a CRIAÇÃO de cliente não é feita aqui (o id nasce no legado).
 */

const { traduzirErroDeTexto } = require('./clientes.validacao');
const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const c = require('./cadastros.comum');
const { validarMudancas, aplicar, paraDto } = require('./clientes.validacao');
const espelho = require('../../legado-escrita/entidades');
const legado = require('../../legado-escrita');
const lp = require('../../legado-escrita/legado-primeiro');
const { MENSAGEM: REGIME_NAO_VOLTA, regimePodeMudar } = require('../../_comum/dominio/cliente-regime');
const { SELECT_FICHA, camposDaFicha, colunasDaFicha, fichaParaPerfil } = require('./clientes.ficha');

const CAMPOS_LEGADO = ['name', 'treatAs', 'whatsapp', 'birthDate'];
const { dadosEfetivosDoCliente } = require('../../legado-escrita/fusao');

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
  // Fusão (Maturacao/45): campo já espelhado vem do legado, então a extensão não o repete.
  return { readAt: new Date().toISOString(), extensions: Object.fromEntries(linhas.map((l) => {
    const linha = typeof l.get === 'function' ? l.get({ plain: true }) : l;
    return [l.id_cliente, paraDto({ ...linha, dados: dadosEfetivosDoCliente(l) }, fichaParaPerfil(linha, q.perfil))];
  })) };
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
      // Pré/Pós: só Pós -> Pré (definitivo). Pré -> Pós, ou apagar o Pré, é recusado antes de qualquer escrita.
      if (mudancas.paymentProfile !== undefined && !regimePodeMudar(atual ? atual.perfil_pagamento : null, mudancas.paymentProfile)) throw c.regra(REGIME_NAO_VOLTA);
      const antes = atual ? paraDto(atual) : null;
      const ficha = colunasDaFicha(mudancas);
      const completo = aplicar(atual, mudancas, new Date().toISOString());
      const camposLegado = lp.ativo('clientes') ? CAMPOS_LEGADO.filter((k) => mudancas[k] !== undefined) : [];
      let escrito = null; let prox = completo;
      if (camposLegado.length) {
        // LEGADO PRIMEIRO (Maturacao/46): nome, tratar por, WhatsApp e nascimento são gravados em `usuarios` ANTES do commit; o Postgres NÃO guarda cópia.
        let linha; try { linha = legado.clientes.linhaDoCliente(mudancas, camposLegado); } catch (e) { throw lp.falhaDoLegado(e); }
        escrito = await espelho.clientes.primeiro(ex, id, Number(id), linha, { operationKey, escopo: 'cadastros.cliente.editar' });
        prox = aplicar(atual, Object.fromEntries(Object.entries(mudancas).filter(([k]) => !escrito.campos.includes(k))), new Date().toISOString());
        for (const k of escrito.campos) delete prox.dados[k]; // inclusive o valor antigo só do Postgres: o campo agora vive no legado
      }
      if (atual) {
        await ex.execute(`UPDATE gf_clientes_ext SET perfil_pagamento = ?, perfil_pagamento_em = ?, dados = ?${ficha.map(([col]) => `, ${col} = ?`).join('')}, revisao = revisao + 1, atualizado_em = CURRENT_TIMESTAMP, atualizado_por = ?, operation_key = ? WHERE id_cliente = ?`,
          [prox.perfil_pagamento, prox.perfil_pagamento_em, JSON.stringify(prox.dados), ...ficha.map(([, v]) => v), c.nomeDe(req), operationKey, id]);
      } else {
        await ex.execute(`INSERT INTO gf_clientes_ext (id_cliente, perfil_pagamento, perfil_pagamento_em, dados, revisao, atualizado_por, operation_key${ficha.map(([col]) => `, ${col}`).join('')}) VALUES (?, ?, ?, ?, 1, ?, ?${ficha.map(() => ', ?').join('')})`,
          [id, prox.perfil_pagamento, prox.perfil_pagamento_em, JSON.stringify(prox.dados), c.nomeDe(req), operationKey, ...ficha.map(([, v]) => v)]);
      }
      if (escrito) {
        // O que sobrou de campo do legado em `dados` (edição antiga só no Postgres, ainda não enviada pela carga) segue pendente e legível como fallback.
        const sobra = CAMPOS_LEGADO.filter((k) => prox.dados[k] !== undefined);
        await espelho.clientes.marcar(ex, id, sobra.length ? 'nao_espelhada' : 'espelhada', sobra.length ? 'campos antigos só no Postgres (carga pendente)' : 'legado primeiro', sobra);
      } else {
        // Espelho no legado (Maturacao/45, modo `copia`): INTENÇÃO na mesma transação (os campos mexidos); a escrita no legado vem depois do commit. Desligado, só anota.
        await espelho.clientes.registrar(ex, id, Object.keys(mudancas).filter((k) => k !== 'paymentProfile'));
      }
      const depois = paraDto({ ...completo, id_cliente: id, revisao: (atual ? Number(atual.revisao) : 0) + 1 });
      // A resposta traz a ficha como ficou (lida na mesma transação); a auditoria guarda só os NOMES dos campos da ficha mexidos.
      const [gravada] = await ex.execute(`SELECT ${SELECT_FICHA} FROM gf_clientes_ext WHERE id_cliente = ?`, [id]);
      const resposta = { readAt: new Date().toISOString(), clientId: id, extension: paraDto({ ...completo, id_cliente: id, revisao: depois.revision }, fichaParaPerfil(gravada[0], q.perfil)) };
      const marca = camposDaFicha(mudancas).length ? { ficha: camposDaFicha(mudancas) } : {};
      if (escrito) return { antes: { ...antes, legado: escrito.antes }, depois: { ...depois, ...marca, legado: escrito.depois }, resposta };
      return { antes, depois: { ...depois, ...marca }, resposta };
    },
  });
}

module.exports = { ler, gravar, definirVerificadorDeCliente };
