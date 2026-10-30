'use strict';

/**
 * Pendências (Maturacao/34). Uma linha por pendência encaminhada (`gf_pendencias_encaminhamentos`), registro do front em `item`.
 *   - leitura (`GET /pending-routing`): a equipe lê os encaminhamentos que o perfil vê (`pendingVisible`); a taróloga não vê Pendências;
 *   - gravação (`PUT /pending-routing`): `{ operationKey, expectedVersion (0 = nova), record }`. O servidor confere forma e transição
 *     (quem encaminha para onde, como `canTransferPending`) e carimba autor e instante do evento novo (domínio `pendencias.js`);
 *   - idempotência `operationKey`, revisão `expectedVersion` (409 `VERSION_CHANGED`), auditoria e `gf_operacoes` na MESMA transação.
 */

const janela = require('../../_comum/janela');
const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const dom = require('../../_comum/dominio/pendencias');
const f = require('../financeiro-cliente/fin.comum');
const { contaDaRequisicao } = require('../../_comum/conta');
const origem = require('./pendencias.origem');
const dominioOrigem = require('../../_comum/dominio/pendencias-origem');
/** Espera máxima (4 x 350 ms) pela gravação da ficha antes de recusar uma pendência `guidance:` sem fonte; os testes a encurtam. */
const ESPERA_DA_FICHA = { tentativas: 4, ms: 350 };

const CONFERIR_ANTES = 'A pendência mudou. Atualize a lista e tente novamente.';
const traduzir = (e) => (e instanceof dom.PendenciaInvalidaError ? f.regra(e.message) : e instanceof dom.PendenciaMudouError ? f.conflitoVersao(e.message) : e);
const atorDe = (req, escrita = false) => f.ator(req, { permissao: 'canViewConsultations', escrita });
const comoItem = (l) => ({ ...f.textoDe(l), key: l.chave });

async function ler(req) {
  const a = atorDe(req);
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const linhas = await lendoNovo((m) => m.GfPendenciasEncaminhamentos.findAll({ order: [['criado_em', 'ASC'], ['chave', 'ASC']] }));
  const visiveis = linhas.map((l) => ({ r: comoItem(l), v: Number(l.version) })).filter((x) => dom.visivel(a.perfil, x.r.snapshot));
  const { itens: pagina, nextCursor } = janela.fatiar(visiveis, janela.ler(req.query), (x) => x.r.key);
  return {
    readAt: new Date().toISOString(),
    items: pagina.map((x) => x.r),
    versions: Object.fromEntries(pagina.map((x) => [x.r.key, x.v])),
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}

const todosOsRegistros = async () => (await lendoNovo((m) => m.GfPendenciasEncaminhamentos.findAll({ order: [['criado_em', 'ASC'], ['chave', 'ASC']] }))).map(comoItem);

/** `GET /pending-routing/derived`: as pendências que o SERVIDOR deriva das fontes (consultas, pagamentos, divergências, agenda), só as que o perfil vê. */
async function derivadas(req) {
  const a = atorDe(req);
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const registros = await todosOsRegistros();
  const d = await origem.derivar(registros);
  if (!d) throw f.regra('As fontes das pendências não estão disponíveis neste ambiente.');
  // Como a tela (`staff-operations-context.tsx`): as vivas de hoje mais os encaminhamentos ainda não resolvidos (com o snapshot da origem, se ela existe).
  const lista = new Map(d.vivas);
  for (const r of registros) {
    const fonte = (d.fontes.get(r.key) || []).slice(-1)[0];
    // `reconcilePending`: sem fonte e com a origem lida = resolvida; resolvida com a fonte de volta = reaberta.
    const resolvida = r.resolvedAt ? !fonte : !fonte && d.origens.has(r.snapshot.id);
    if (!resolvida) lista.set(r.key, fonte || r.snapshot);
  }
  return { readAt: new Date().toISOString(), date: d.hoje, items: [...lista.values()].filter((s) => dom.visivel(a.perfil, s)) };
}

async function gravar(req) {
  const a = atorDe(req, true);
  const b = req.body;
  if (!f.ehObjeto(b)) throw f.invalido('corpo');
  const operationKey = f.chaveOperacao(b.operationKey);
  const expectedVersion = f.revisao(b.expectedVersion);
  let pedido;
  try { pedido = dom.forma(b.record); } catch (e) { throw traduzir(e); }
  const conta = contaDaRequisicao(req);
  const chave = pedido.key;
  // Origem derivada no servidor (null = sem as fontes neste ambiente; vale só a conferência de forma e de filas).
  const derivar = async () => (dominioOrigem.derivavel(pedido.snapshot) ? origem.derivar(await todosOsRegistros(), [pedido.snapshot.referenceDate]) : null);
  let derivado = await derivar();
  // A orientação nasce na ficha (PUT /client-guidance) e a tela manda a pendência no mesmo instante: a gravação da ficha pode ainda não ter chegado ao
  // banco quando a semente ou a resolução chega. Só para `guidance:`, a conferência de origem espera um pouco e confere de novo antes de recusar.
  let recusadaPelaOrigem = false;
  const guidance = pedido.snapshot.id.startsWith('guidance:');
  const tentarGravar = () => f.gravar(req, {
    escopo: 'pendencias.gravar', operationKey, corpo: { chave, expectedVersion, record: pedido }, entidade: 'pendencia', entidadeId: chave.slice(0, 120), acao: 'pendencias.gravar',
    producao: async (ex) => {
      try {
        await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_pendencias:${chave}`]);
        const [linhas] = await ex.execute('SELECT chave, item, version FROM gf_pendencias_encaminhamentos WHERE chave = ? FOR UPDATE', [chave]);
        const antes = linhas[0] ? comoItem(linhas[0]) : null;
        if ((antes ? Number(linhas[0].version) : 0) !== expectedVersion) throw f.conflitoVersao(CONFERIR_ANTES);
        if (antes && !dom.visivel(a.perfil, antes.snapshot)) throw f.negado(true);
        const agora = new Date().toISOString();
        const reg = dom.aplicar(antes, pedido, { id: String(conta), nome: a.nome, papel: a.perfil }, agora);
        if (derivado) { try { dominioOrigem.conferirOrigem(antes, pedido, reg, derivado); } catch (e) { recusadaPelaOrigem = true; throw e; } }
        const versao = expectedVersion + 1;
        const { key: _k, ...semChave } = reg;
        const item = JSON.stringify(semChave);
        if (!antes) {
          await ex.execute('INSERT INTO gf_pendencias_encaminhamentos (fila, resolvida, item, chave, version, criado_por, operation_key) VALUES (?, ?, ?, ?, 1, ?, ?)', [reg.queue, Boolean(reg.resolvedAt), item, chave, a.nome, operationKey]);
        } else {
          await ex.execute('UPDATE gf_pendencias_encaminhamentos SET fila = ?, resolvida = ?, item = ?, version = ?, atualizado_em = CURRENT_TIMESTAMP WHERE chave = ?', [reg.queue, Boolean(reg.resolvedAt), item, versao, chave]);
        }
        const novo = reg.events.length > (antes ? antes.events.length : 0) ? reg.events[reg.events.length - 1] : null;
        return {
          antes: antes ? { version: expectedVersion, queue: antes.queue, resolved: Boolean(antes.resolvedAt) } : null,
          depois: { version: versao, queue: reg.queue, resolved: Boolean(reg.resolvedAt), action: novo ? novo.action : 'snapshot', pendencia: reg.snapshot.id },
          resposta: { readAt: agora, items: [reg], versions: { [chave]: versao } },
        };
      } catch (e) { throw traduzir(e); }
    },
  });
  for (let tentativa = 0; ; tentativa += 1) {
    try { return await tentarGravar(); } catch (e) {
      if (!(guidance && recusadaPelaOrigem && tentativa < ESPERA_DA_FICHA.tentativas)) throw e;
      recusadaPelaOrigem = false;
      await new Promise((r) => setTimeout(r, ESPERA_DA_FICHA.ms));
      derivado = await derivar();
    }
  }
}

module.exports = { ler, gravar, derivadas, ESPERA_DA_FICHA };
