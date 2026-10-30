'use strict';

/**
 * Trilha operacional (Maturacao/43), a aba Logs de Configurações. O navegador deriva cada evento (`OperationalAuditEvent`) da diferença entre dois estados;
 * o servidor só o GUARDA, sem refazê-lo, e acrescenta quem o entregou e quando (`registrado_por`, `registrado_em`, `conta_id`).
 *   - gravação (`POST /operation-audit`): `{ operationKey, events: [...] }` (1 a 200). Qualquer pessoa com sessão entrega os eventos das ações dela
 *     (inclusive a taróloga); só ACRESCENTA: o evento de mesmo id já guardado vence (mesmo id e corpo diferente não regrava nem dá erro);
 *   - leitura (`GET /operation-audit`): só a administradora (`canView` do front); os últimos 5.000 eventos, do mais antigo ao mais novo;
 *   - auditoria e `gf_operacoes` na MESMA transação. Limite honesto: o conteúdo (antes/depois) é o que o navegador viu; o servidor não o reconstrói.
 */

const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const dom = require('../../_comum/dominio/log-operacional');
const { contaDaRequisicao } = require('../../_comum/conta');
const c = require('./estado.comum');

const { f } = c;
const LIMITE_LEITURA = 5000;

async function ler(req) {
  const a = f.ator(req, { permissao: 'canViewConsultations' });
  if (a.perfil !== 'administradora') throw f.negado(false);
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const linhas = await lendoNovo((m) => m.GfLogOperacional.findAll({ order: [['ocorrido_em', 'DESC'], ['registrado_em', 'DESC'], ['id', 'DESC']], limit: LIMITE_LEITURA }));
  const items = linhas.map(f.textoDe).reverse();
  return { readAt: c.relogioAtual().agora(), items, truncated: linhas.length === LIMITE_LEITURA };
}

async function gravar(req) {
  const a = f.ator(req, { permissao: 'canViewConsultations', escrita: true, aceitaTarologa: true });
  const b = req.body;
  if (!f.ehObjeto(b)) throw f.invalido('corpo');
  const operationKey = f.chaveOperacao(b.operationKey);
  let eventos;
  try { eventos = dom.validar(b.events); } catch (e) { throw c.traduzir(e); }
  const conta = String(contaDaRequisicao(req));
  return f.gravar(req, {
    escopo: 'estado-financeiro.log', operationKey, corpo: { events: eventos }, entidade: 'log_operacional', entidadeId: eventos[0].id.slice(0, 64).trim(), acao: 'estado-financeiro.log.registrar',
    producao: async (ex) => {
      let gravados = 0;
      for (const e of eventos) {
        const [r] = await ex.execute('INSERT IGNORE INTO gf_log_operacional (id, categoria, ocorrido_em, item, registrado_por, conta_id, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [e.id, e.category, e.at || null, JSON.stringify(e), a.nome, conta, operationKey]);
        gravados += Number(r.affectedRows) || 0;
      }
      return { antes: null, depois: { recebidos: eventos.length, gravados }, resposta: { readAt: c.relogioAtual().agora(), received: eventos.length, stored: gravados } };
    },
  });
}

module.exports = { ler, gravar };
