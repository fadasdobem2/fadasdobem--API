'use strict';

/**
 * Adicionais do repasse (Maturacao/43): categorias, regras recorrentes e ocorrências em `gf_adicionais_itens` (uma linha por item, registro do front em `item`).
 *   - leitura (`GET /payout-additions`): `{ readAt, items, versions }` com os registros `{ key, kind, category | rule | occurrence, adjustment? }`; a equipe lê
 *     (a pendência `addition:` e o seletor de categoria dependem dele); a taróloga leva 403;
 *   - gravação (`PUT /payout-additions`): `{ operationKey, expectedVersion (0 = novo), record }`. O servidor refaz as funções do front
 *     (`addPayoutAdditionCategory`, `revisePayoutAdditionCategory`, `addPayoutAdditionRule`, `changePayoutAdditionRule`, `materializePayoutAdditions`,
 *     `resolvePayoutAdditionQuantity`) com as MESMAS frases e compara o resultado com o registro enviado; autor e instante são do servidor. Criar categoria,
 *     regra e ocorrência e conferir quantidade: `canManagePayouts` (administradora e assistente); revisar categoria: `canManageFinancialReasons`;
 *   - idempotência `operationKey`, revisão (409 `VERSION_CHANGED`), auditoria e `gf_operacoes` na MESMA transação.
 */

const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const dom = require('../../_comum/dominio/adicionais');
const motivos = require('../../_comum/dominio/motivos-financeiros');
const c = require('./estado.comum');
const loja = require('./adicionais.store');

const { f } = c;
const SEM_ACESSO = 'Seu acesso não permite alterar pagamentos.';
const SEM_EDICAO = 'O cadastro de adicionais não está disponível para edição.';
const erro = (m, tipo = 'regra') => new dom.AdicionalInvalidoError(m, tipo);
const forma = () => erro('', 'forma');

let catalogo = () => require('../cadastros/tarologos.service').catalogo();
/** Para os testes: de onde vêm os tarólogos (padrão: o catálogo real). */
const definirCatalogo = (fn) => { catalogo = fn; };
const tarologos = () => catalogo();

async function ler(req) {
  c.atorEquipe(req);
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const linhas = await lendoNovo((m) => m.GfAdicionaisItens.findAll({ order: [['criado_em', 'ASC'], ['chave', 'ASC']] }));
  const { loja: l, versoes, ajustes } = loja.montar(linhas);
  return { readAt: c.relogioAtual().agora(), items: loja.registros(l, ajustes), versions: versoes };
}

/** Sem os carimbos que o servidor refaz. */
const semCarimbo = {
  category: (x) => ({ ...x, revisions: (x.revisions || []).map((r, i, l) => (i === l.length - 1 ? { name: r.name, active: r.active } : r)) }),
  rule: (x) => ({ ...x, history: x.history.map((e, i, l) => (i === l.length - 1 ? { action: e.action, date: e.date } : e)) }),
  occurrence: (x) => { const { resolvedAt: _a, resolvedBy: _b, ...resto } = x; return resto; },
};
const CAMPOS_REGRA = ['id', 'tarotId', 'categoryId', 'categoryName', 'value', 'frequency', 'startDate', 'description', 'history', 'financialReason'];
const escolher = (o, campos) => Object.fromEntries(campos.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const idDe = (v) => { if (typeof v !== 'string' || !/^[A-Za-z0-9._:%-]{1,160}$/.test(v)) throw f.invalido('record'); return v; };

/** Categoria: criar (`addPayoutAdditionCategory`) ou revisar (`revisePayoutAdditionCategory`). Devolve `{ nova, mudou }`. */
function categoria(a, st, pedido, esperada, agora) {
  const id = idDe(pedido.id); const existe = st.loja.categories.find((x) => x.id === id);
  if (!existe) {
    if (!a.p.canManagePayouts) throw erro(SEM_ACESSO);
    if (typeof pedido.name !== 'string' || Object.keys(pedido).some((k) => !['id', 'name'].includes(k))) throw forma();
    const depois = dom.adicionarCategoria(st.loja, { id, name: pedido.name });
    return { nova: depois.categories[depois.categories.length - 1], mudou: true };
  }
  if (!motivos.podeGerenciar(a.perfil)) throw erro(SEM_EDICAO);
  if (typeof pedido.name !== 'string' || (pedido.active !== undefined && typeof pedido.active !== 'boolean')) throw forma();
  const lista = dom.revisarCategoria(st.loja.categories, id, { name: pedido.name, active: pedido.active !== false }, a.nome, agora);
  if (lista === st.loja.categories) return { nova: existe, mudou: false };
  const nova = lista.find((x) => x.id === id);
  if (!f.igual(semCarimbo.category(nova), semCarimbo.category(escolher(pedido, ['id', 'name', 'active', 'revisions'])))) throw forma();
  return { nova, mudou: true };
}

/** Regra: criar (`addPayoutAdditionRule`) ou pausar, retomar, encerrar (`changePayoutAdditionRule`). */
async function regra(a, st, pedido, hoje, agora) {
  if (!a.p.canManagePayouts) throw erro(SEM_ACESSO);
  const id = idDe(pedido.id); const existe = st.loja.rules.find((x) => x.id === id);
  const p = escolher(pedido, CAMPOS_REGRA);
  if (!existe) {
    if (!Array.isArray(p.history) || p.history.length !== 1 || !f.ehObjeto(p.history[0]) || typeof p.history[0].by !== 'string') throw forma();
    const carimbada = { ...p, history: [{ ...p.history[0], at: agora, by: a.nome }] };
    const nomes = await catalogo();
    if (!nomes.some((t) => t.id === carimbada.tarotId)) throw erro('Selecione a profissional.');
    const depois = dom.adicionarRegra(st.loja, carimbada, hoje);
    return { nova: depois.rules[depois.rules.length - 1], mudou: true };
  }
  if (!Array.isArray(p.history) || p.history.length !== existe.history.length + 1) throw forma();
  const ultimo = p.history[p.history.length - 1];
  if (!f.ehObjeto(ultimo) || !['paused', 'resumed', 'ended'].includes(ultimo.action) || typeof ultimo.date !== 'string') throw forma();
  const depois = dom.mudarRegra(st.loja, id, ultimo.action, ultimo.date, agora, a.nome);
  const nova = depois.rules.find((x) => x.id === id);
  if (!f.igual(semCarimbo.rule(nova), semCarimbo.rule(p))) throw forma();
  return { nova, mudou: true };
}

/** Ocorrência: nascer (`materializePayoutAdditions`) ou ser conferida (`resolvePayoutAdditionQuantity`). */
function ocorrencia(a, st, pedido, hoje, agora) {
  if (!a.p.canManagePayouts) throw erro(SEM_ACESSO);
  const id = idDe(pedido.id); const existe = st.loja.occurrences.find((x) => x.id === id);
  if (!existe) {
    const m = dom.materializar(st.loja, st.ajustes, hoje, agora, a.nome);
    const nova = m.loja.occurrences.find((x) => x.id === id);
    if (!nova) throw erro('Este período não é devido nesta recorrência.');
    if (!f.igual(semCarimbo.occurrence(nova), semCarimbo.occurrence(pedido))) throw forma();
    return { nova, mudou: true };
  }
  if (pedido.status === 'pending' || existe.status !== 'pending') {
    if (!f.igual(semCarimbo.occurrence(existe), semCarimbo.occurrence(pedido))) throw erro('Este período já foi conferido ou não está pendente.');
    return { nova: existe, mudou: false };
  }
  if (typeof pedido.quantity !== 'number') throw erro('Informe a quantidade realizada, com até duas casas decimais, ou zero.');
  const depois = dom.resolver(st.loja, st.ajustes, id, pedido.quantity, hoje, agora, a.nome);
  const nova = depois.loja.occurrences.find((x) => x.id === id);
  if (!f.igual(semCarimbo.occurrence(nova), semCarimbo.occurrence(pedido))) throw forma();
  return { nova, mudou: true };
}

async function gravar(req) {
  const a = c.atorEquipe(req, true);
  const { operationKey, expectedVersion, record } = c.corpoDeGravacao(req);
  const kind = record.kind;
  if (!loja.TIPOS[kind] || !f.ehObjeto(record[kind])) throw f.invalido('record');
  const pedido = record[kind]; const id = idDe(pedido.id); const chave = loja.chaveDe(kind, id);
  return f.gravar(req, {
    escopo: 'estado-financeiro.adicionais', operationKey, corpo: { chave, expectedVersion, record }, entidade: 'adicional', entidadeId: chave.slice(0, 120), acao: `estado-financeiro.adicional.${kind}`,
    producao: async (ex) => {
      try {
        await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', ['gf_adicionais_itens']);
        const [linhas] = await ex.execute('SELECT chave, tipo, item, version FROM gf_adicionais_itens ORDER BY criado_em, chave FOR UPDATE');
        const st = loja.montar(linhas);
        const hoje = c.relogioAtual().hoje(); const agora = c.relogioAtual().agora();
        const versaoAtual = st.versoes[chave] ?? 0;
        if (expectedVersion !== versaoAtual) throw f.conflitoVersao();
        const r = kind === 'category' ? categoria(a, st, pedido, expectedVersion, agora) : kind === 'rule' ? await regra(a, st, pedido, hoje, agora) : ocorrencia(a, st, pedido, hoje, agora);
        const versao = r.mudou ? versaoAtual + 1 : versaoAtual;
        if (r.mudou) {
          const item = JSON.stringify(r.nova); const [ja] = await ex.execute('SELECT chave FROM gf_adicionais_itens WHERE chave = ?', [chave]);
          if (ja[0]) await ex.execute('UPDATE gf_adicionais_itens SET item = ?, version = ?, atualizado_em = CURRENT_TIMESTAMP WHERE chave = ?', [item, versao, chave]);
          else await ex.execute('INSERT INTO gf_adicionais_itens (chave, tipo, item, version, criado_por, operation_key) VALUES (?, ?, ?, ?, ?, ?)', [chave, loja.TIPOS[kind], item, versao, a.nome, operationKey]);
        }
        const depoisLoja = { ...st.loja, [kind === 'category' ? 'categories' : kind === 'rule' ? 'rules' : 'occurrences']: (kind === 'category' ? st.loja.categories : kind === 'rule' ? st.loja.rules : st.loja.occurrences).filter((x) => x.id !== id).concat([r.nova]) };
        const ajustes = loja.ajustesDe(depoisLoja);
        return {
          antes: versaoAtual ? { version: versaoAtual } : null, depois: { version: versao, tipo: kind, mudou: r.mudou },
          resposta: { readAt: agora, items: [loja.registro(depoisLoja, kind, id, ajustes)], versions: { [chave]: versao } },
        };
      } catch (e) { throw c.traduzir(e); }
    },
  });
}

module.exports = { ler, gravar, definirCatalogo, tarologos };
