'use strict';

/**
 * Motivos financeiros (Maturacao/43). Uma linha por motivo em `gf_motivos_financeiros` com TODAS as versões em `item` (`{ versions }`), que só crescem.
 *   - leitura (`GET /financial-reasons`): a loja inteira como o front a monta (`createFinancialReasonStore` + as versões gravadas), agrupada por motivo;
 *     `versions[id]` = número da última versão. Equipe lê (o seletor de motivo está nos lançamentos); a taróloga leva 403;
 *   - gravação (`PUT /financial-reasons`): `{ operationKey, expectedVersion (0 = motivo novo), record: { id, versions } }`. O servidor refaz `addFinancialReason` /
 *     `reviseFinancialReason` do front (mesmas frases) e CARIMBA autor (sessão) e instante da versão nova. Só administradora, assistente e supervisora
 *     (`canManageFinancialReasons`); atendente recebe a frase do front (422);
 *   - idempotência `operationKey`, revisão (409 `VERSION_CHANGED`), auditoria e `gf_operacoes` na MESMA transação.
 */

const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const dom = require('../../_comum/dominio/motivos-financeiros');
const { contaDaRequisicao } = require('../../_comum/conta');
const c = require('./estado.comum');

const { f } = c;
const SEM_PERMISSAO = 'O cadastro de motivos está disponível para supervisora, assistente e administradora.';

const lojaDe = (linhas) => dom.normalizarLoja({ version: 1, reasons: linhas.flatMap((l) => f.textoDe(l).versions) });
const versoes = (loja) => Object.fromEntries(dom.registros(loja).map((r) => [r.id, r.versions[r.versions.length - 1].version]));

async function ler(req) {
  c.atorEquipe(req);
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const linhas = await lendoNovo((m) => m.GfMotivosFinanceiros.findAll({ order: [['criado_em', 'ASC'], ['id', 'ASC']] }));
  const loja = lojaDe(linhas);
  return { readAt: c.relogioAtual().agora(), items: dom.registros(loja), versions: versoes(loja) };
}

/** Forma do registro que o navegador manda: `{ id, versions: [versão, ...] }` (a conferência de regra é do domínio). */
function formaDoRegistro(r) {
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(r.id) || !Array.isArray(r.versions) || r.versions.length < 1 || r.versions.length > 500 || !r.versions.every(f.ehObjeto)) throw f.invalido('record');
  const ultima = r.versions[r.versions.length - 1];
  for (const campo of ['name', 'description', 'statementText', 'scope', 'nature']) if (ultima[campo] !== undefined && typeof ultima[campo] !== 'string') throw f.invalido('record');
  if (!Number.isSafeInteger(ultima.version)) throw f.invalido('record');
  return r;
}

async function gravar(req) {
  const a = c.atorEquipe(req, true);
  const { operationKey, expectedVersion, record } = c.corpoDeGravacao(req);
  const pedido = formaDoRegistro(record);
  const id = pedido.id; const conta = contaDaRequisicao(req);
  return f.gravar(req, {
    escopo: 'estado-financeiro.motivos', operationKey, corpo: { id, expectedVersion, record: pedido }, entidade: 'motivo_financeiro', entidadeId: id, acao: 'estado-financeiro.motivo.gravar',
    producao: async (ex) => {
      try {
        await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', ['gf_motivos_financeiros']);
        const [linhas] = await ex.execute('SELECT id, item, version FROM gf_motivos_financeiros ORDER BY criado_em, id FOR UPDATE');
        const loja = lojaDe(linhas);
        const agora = c.relogioAtual().agora();
        const existentes = loja.reasons.filter((r) => r.id === id);
        const atual = dom.atuais(loja).find((r) => r.id === id);
        let versoesNovas;
        if (!dom.podeGerenciar(a.perfil)) throw new dom.MotivoInvalidoError(SEM_PERMISSAO);
        if (!atual) {
          if (expectedVersion !== 0) throw new dom.MotivoInvalidoError('Este motivo foi atualizado. Abra a edição novamente.', 'conflito');
          if (pedido.versions.length !== 1 || pedido.versions[0].version !== 1) throw new dom.MotivoInvalidoError('', 'forma');
          const v = pedido.versions[0];
          versoesNovas = [dom.adicionar(loja, { id, scope: v.scope, nature: v.nature, name: typeof v.name === 'string' ? v.name : '', description: v.description, statementText: v.statementText }, a.nome, agora, a.perfil).motivo];
        } else {
          if (expectedVersion !== atual.version) throw new dom.MotivoInvalidoError('Este motivo foi atualizado. Abra a edição novamente.', 'conflito');
          const novo = pedido.versions[pedido.versions.length - 1];
          const antigas = pedido.versions.slice(0, -1);
          if (pedido.versions.length !== existentes.length + 1 || !antigas.every((v, i) => f.igual(v, existentes[i])) || novo.version !== atual.version + 1 || novo.nature !== atual.nature || novo.scope !== atual.scope) throw new dom.MotivoInvalidoError('', 'forma');
          const entrada = { name: typeof novo.name === 'string' ? novo.name : '', description: typeof novo.description === 'string' ? novo.description : '', active: novo.active, statementText: novo.statementText };
          if (typeof entrada.active !== 'boolean') throw new dom.MotivoInvalidoError('', 'forma');
          const depois = dom.revisar(loja, id, expectedVersion, entrada, a.nome, agora, a.perfil);
          if (depois === loja) return { antes: { version: atual.version }, depois: { version: atual.version, igual: true }, resposta: { readAt: agora, items: [{ id, versions: existentes }], versions: { [id]: atual.version } } };
          versoesNovas = [...existentes, depois.reasons[depois.reasons.length - 1]];
        }
        const versao = versoesNovas[versoesNovas.length - 1].version;
        const item = JSON.stringify({ versions: versoesNovas });
        const [ja] = await ex.execute('SELECT id FROM gf_motivos_financeiros WHERE id = ?', [id]);
        if (ja[0]) await ex.execute('UPDATE gf_motivos_financeiros SET item = ?, version = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', [item, versao, id]);
        else await ex.execute('INSERT INTO gf_motivos_financeiros (id, item, version, criado_por, operation_key) VALUES (?, ?, ?, ?, ?)', [id, item, versao, a.nome, operationKey]);
        return {
          antes: atual ? { version: atual.version, name: atual.name, active: atual.active } : null,
          depois: { version: versao, name: versoesNovas[versoesNovas.length - 1].name, active: versoesNovas[versoesNovas.length - 1].active, usuario: String(conta) },
          resposta: { readAt: agora, items: [{ id, versions: versoesNovas }], versions: { [id]: versao } },
        };
      } catch (e) { throw c.traduzir(e); }
    },
  });
}

module.exports = { ler, gravar, lojaDe };
