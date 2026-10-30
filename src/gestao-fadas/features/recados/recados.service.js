'use strict';

/**
 * Recados (Maturacao/30): mural da equipe, caixa de mensagens, respostas, leituras, notas do tarólogo e organização pessoal.
 *   - `GET /notes`: os recados que a conta pode ler (a raiz da conversa visível a ela, `canViewOperationalNote`), cada um já com as leituras de
 *     todos e fixar/prioridade/arquivo SÓ da própria conta, mais a lista de contas que o front precisa conhecer;
 *   - `PUT /notes/:id` `{ operationKey, expectedVersion, record }`: o servidor descobre a mudança (criar, editar, apagar, responder, OK,
 *     importância, aplicação na agenda, recibo, fixar, prioridade, arquivar), confere quem pode e carimba autor e instante (`_comum/dominio/recados-aplicar.js`).
 *     Mudança PESSOAL (lido, fixado, prioridade, arquivado) não depende de versão nem a sobe. Conteúdo: `expectedVersion` (0 = novo), 409 `VERSION_CHANGED`.
 *   - Idempotência `operationKey`, auditoria `gf_auditoria` e `gf_operacoes` na MESMA transação. A tabela legada `recado` NÃO é usada.
 * Equipe (`canManageConsultations`) e taróloga COM `tarotId` (só o que a regra de visibilidade deixa).
 */

const janela = require('../../_comum/janela');
const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const dom = require('../../_comum/dominio/recados');
const aplicarDom = require('../../_comum/dominio/recados-aplicar');
const f = require('../cadastros/cadastros.comum');
const { contasDaEquipe } = require('./recados.contas');

const EQUIPE = new Set(['administradora', 'assistente', 'supervisora', 'atendente']);
const regra = (m) => f.regra(m);
const normPessoal = (p) => (p && typeof p.arquivado === 'string' ? { ...p, arquivado: JSON.parse(p.arquivado) } : p);
const textoDe = (l) => (typeof l.item === 'string' ? JSON.parse(l.item) : l.item);

function ator(req, escrita = false) {
  const q = f.quem(req);
  if (!q.perfil) throw f.negado(escrita);
  const tarologa = q.perfil === 'tarologa';
  if (tarologa ? !q.proprio : !EQUIPE.has(q.perfil) || !q.p.canManageConsultations) throw f.negado(escrita);
  const id = String((req.user && req.user.id) || '');
  if (!id) throw f.negado(escrita);
  return { id, papel: q.perfil, nome: q.nome, tarotId: tarologa ? q.proprio : undefined };
}

async function carregar() {
  return lendoNovo(async (m) => ({
    notas: await m.GfRecados.findAll({ order: [['criado_em', 'ASC'], ['id', 'ASC']] }),
    pessoais: await m.GfRecadosPessoais.findAll({}),
  }));
}

const porRecado = (pessoais) => { const mapa = new Map(); for (const p of pessoais) mapa.set(p.id_recado, [...(mapa.get(p.id_recado) || []), p]); return mapa; };

/** `GET /notes`. */
async function ler(req) {
  const a = ator(req);
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const { notas, pessoais } = await carregar();
  const itens = notas.map((l) => ({ ...textoDe(l), id: l.id }));
  const todas = dom.visiveisPara(itens, a);
  const { itens: visiveis, nextCursor } = janela.fatiar(todas, janela.ler(req.query));
  const ids = new Set(visiveis.map((n) => n.id));
  const mapa = porRecado(pessoais);
  const versoes = Object.fromEntries(notas.filter((l) => ids.has(l.id)).map((l) => [l.id, Number(l.version)]));
  const contas = await contasDaEquipe();
  return { readAt: new Date().toISOString(), items: visiveis.map((n) => dom.montar(n, mapa.get(n.id) || [], a.id)), versions: versoes, accounts: contas, ...(nextCursor !== undefined ? { nextCursor } : {}) };
}

/** `PUT /notes/:id`. */
async function gravar(req) {
  const a = ator(req, true);
  const id = f.idRegistro ? f.idRegistro(req.params.id) : req.params.id;
  const b = req.body;
  if (!f.ehObjeto(b)) throw f.invalido('corpo');
  const operationKey = f.chaveOperacao(b.operationKey);
  const expectedVersion = f.revisao(b.expectedVersion);
  if (!f.ehObjeto(b.record) || b.record.id !== id || !/^[A-Za-z0-9._:-]{1,64}$/.test(id)) throw f.invalido('record');
  const contas = new Set((await contasDaEquipe()).map((c) => c.id));
  return f.gravar(req, {
    escopo: 'recados.gravar', operationKey, corpo: { id, expectedVersion, record: b.record }, entidade: 'recado', entidadeId: id, acao: 'recados.gravar',
    producao: async (ex) => {
      await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', ['gf_recados']);
      const [todas] = await ex.execute('SELECT id, item, version FROM gf_recados ORDER BY criado_em, id', []);
      const itens = todas.map((l) => ({ ...textoDe(l), id: l.id }));
      const linha = todas.find((l) => l.id === id);
      const antes = linha ? itens.find((n) => n.id === id) : undefined;
      const versaoAtual = linha ? Number(linha.version) : 0;
      if (linha && expectedVersion === 0) throw f.conflitoVersao('Este recado já existe. Atualize a tela e tente novamente.');
      const [pesBruto] = await ex.execute('SELECT * FROM gf_recados_pessoais WHERE id_recado = ?', [id]);
      const minha = normPessoal(pesBruto.find((p) => p.id_conta === a.id)) || null;
      const agora = new Date().toISOString();
      let r;
      try { r = aplicarDom.aplicar({ antes, pedido: b.record, conta: a, agora, todas: itens, contas: contas.size ? contas : undefined, pessoalAntes: minha }); } catch (e) {
        if (!(e instanceof dom.RecadoInvalidoError)) throw e;
        // Pedido montado sobre uma versão velha: a regra que ele fere pode ser só o atraso (histórico, texto), então o conflito de versão vem primeiro.
        if (linha && expectedVersion !== versaoAtual) throw f.conflitoVersao('O recado mudou. Atualize a tela e tente novamente.');
        throw regra(e.message);
      }
      const mudou = r.criou || !dom.igual(r.item, antes);
      if (r.criou && versaoAtual !== 0) throw f.conflitoVersao('Este recado já existe. Atualize a tela e tente novamente.');
      if (!r.criou && mudou && expectedVersion !== versaoAtual) throw f.conflitoVersao('O recado mudou. Atualize a tela e tente novamente.');
      const { id: _i, ...semId } = r.item;
      let versao = versaoAtual;
      if (r.criou) {
        versao = 1;
        await ex.execute('INSERT INTO gf_recados (id, id_tarologo, origem, id_ator, id_resposta_a, excluido, item, version, criado_por, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
          [id, r.item.tarotId, r.item.source, r.item.actorId || null, r.item.replyToId || null, false, JSON.stringify(semId), a.nome, operationKey]);
      } else if (mudou) {
        versao = versaoAtual + 1;
        await ex.execute('UPDATE gf_recados SET item = ?, excluido = ?, version = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(semId), Boolean(r.item.deletedAt), versao, id]);
      }
      const p = r.pessoal;
      if (p.limparLeituras) await ex.execute('UPDATE gf_recados_pessoais SET lido_em = NULL, lido_por = NULL, lido_versao = NULL, atualizado_em = CURRENT_TIMESTAMP WHERE id_recado = ?', [id]);
      const temPessoal = ['lido', 'fixado', 'prioridade', 'arquivado'].some((k) => p[k] !== undefined);
      if (temPessoal) {
        const novo = { ...(minha || {}) };
        if (p.lido) { novo.lido_em = p.lido.em; novo.lido_por = p.lido.por; novo.lido_versao = p.lido.versao; }
        if (p.fixado !== undefined) novo.fixado_em = p.fixado;
        if (p.prioridade !== undefined) novo.prioridade_em = p.prioridade;
        if (p.arquivado !== undefined) novo.arquivado = p.arquivado;
        const arq = novo.arquivado ? JSON.stringify(novo.arquivado) : null;
        if (!minha) {
          await ex.execute('INSERT INTO gf_recados_pessoais (id_recado, id_conta, lido_em, lido_por, lido_versao, fixado_em, prioridade_em, arquivado, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [id, a.id, novo.lido_em || null, novo.lido_por || null, novo.lido_versao || null, novo.fixado_em || null, novo.prioridade_em || null, arq, operationKey]);
        } else {
          await ex.execute('UPDATE gf_recados_pessoais SET lido_em = ?, lido_por = ?, lido_versao = ?, fixado_em = ?, prioridade_em = ?, arquivado = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id_recado = ? AND id_conta = ?',
            [novo.lido_em || null, novo.lido_por || null, novo.lido_versao || null, novo.fixado_em || null, novo.prioridade_em || null, arq, id, a.id]);
        }
      }
      const [pes2] = await ex.execute('SELECT * FROM gf_recados_pessoais WHERE id_recado = ?', [id]);
      const resposta = dom.montar({ ...r.item, id }, pes2.map(normPessoal), a.id);
      const tipo = r.criou ? 'criar' : mudou ? (r.conteudo ? 'editar' : 'especial') : 'pessoal';
      return { antes: antes ? { version: versaoAtual } : null, depois: { version: versao, tipo, tarotId: r.item.tarotId, source: r.item.source }, resposta: { readAt: agora, items: [resposta], versions: { [id]: versao } } };
    },
  });
}

/** Para o Painel (`GET /panel/sources`): os recados visíveis à conta, sem a lista de contas. */
async function paraOPainel(req) {
  const { items, versions } = await ler(req);
  return { items, versions };
}

module.exports = { ler, gravar, paraOPainel };
