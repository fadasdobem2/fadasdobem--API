'use strict';

/**
 * Adicionais do repasse no servidor (Maturacao/43). Porte do CÓDIGO do front `features/finance/payout-recurring-adjustments.ts`: categorias,
 * regras recorrentes (valor fixo ou por unidade, semanal ou mensal) e ocorrências (uma por período). Tudo puro: o relógio (`hoje`, `at`) entra
 * de fora e os números saem em pt-BR por implementação própria (sem Intl/ICU). Ouro: `scripts/gerar-ouro-gf-estado-financeiro.js`.
 *   - categorias: `adicionarCategoria`, `revisarCategoria`;
 *   - regras: `validarRegra`, `adicionarRegra`, `mudarRegra`, `datasDaRegra`;
 *   - ocorrências: `materializar` (cria os períodos devidos e o lançamento dos de valor fixo), `resolver` (quantidade informada pela equipe);
 *   - `lojaValida`: a forma do armazém (`validPayoutAdditionStore`).
 */

class AdicionalInvalidoError extends Error {
  constructor(mensagem, tipo = 'regra') { super(mensagem); this.name = 'AdicionalInvalidoError'; this.tipo = tipo; }
}
const recusa = (m) => { throw new AdicionalInvalidoError(m); };

const CATEGORIAS_PADRAO = [{ id: 'carta-do-dia', name: 'Carta do dia' }, { id: 'monitoria', name: 'Monitoria' }, { id: 'outros', name: 'Outros' }];
const lojaVazia = () => ({ version: 1, categories: CATEGORIAS_PADRAO.map((c) => ({ ...c })), rules: [], occurrences: [] });

const normalizado = (t) => t.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dinheiroValido = (v) => Number.isFinite(v) && v > 0 && Number.isSafeInteger(Math.round(v * 100)) && Math.abs(Math.round(v * 100) / 100 - v) < 1e-8;
const quantidadeValida = (q) => Number.isFinite(q) && q >= 0 && q <= 100000 && Math.abs(Math.round(q * 100) / 100 - q) < 1e-8;
const valorValido = (v) => (v && v.kind === 'fixed' ? dinheiroValido(v.amount) : Boolean(v && v.kind === 'unit' && dinheiroValido(v.unitValue) && typeof v.unitLabel === 'string' && v.unitLabel.trim() && v.unitLabel.length <= 40));
const instanteValido = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
/** `isAgendaDate`. */
const ehData = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
const exibirData = (d) => d.split('-').reverse().join('/');
const idOcorrencia = (regra, data) => `PAO:${encodeURIComponent(regra)}:${data}`;
/** `shiftDateKey` (domain/formatters.ts). */
function somarDias(data, dias) {
  const [a, m, d] = data.split('-').map(Number);
  const x = new Date(Date.UTC(a, m - 1, d + dias, 12));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}
/** `toLocaleString('pt-BR', { minimumFractionDigits, maximumFractionDigits })` para número finito não negativo. */
function numeroPtBr(n, minimo, maximo) {
  const fixo = (Math.round(n * 10 ** maximo) / 10 ** maximo).toFixed(maximo);
  let [inteiro, frac = ''] = fixo.split('.');
  while (frac.length > minimo && frac.endsWith('0')) frac = frac.slice(0, -1);
  inteiro = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return frac ? `${inteiro},${frac}` : inteiro;
}
function situacao(regra) { const a = regra.history[regra.history.length - 1] && regra.history[regra.history.length - 1].action; return a === 'ended' ? 'ended' : a === 'paused' ? 'paused' : 'active'; }

function adicionarCategoria(loja, categoria) {
  const nome = (categoria.name || '').trim();
  if (!categoria.id || !nome || nome.length > 60) recusa('Informe o nome da categoria, com até 60 caracteres.');
  if (loja.categories.some((c) => c.id === categoria.id || normalizado(c.name) === normalizado(nome))) recusa('Esta categoria já existe.');
  return { ...loja, categories: [...loja.categories, { ...categoria, name: nome }] };
}

/** `revisePayoutAdditionCategory`: devolve a lista de categorias (a mesma se nada mudou). */
function revisarCategoria(categorias, id, entrada, ator, at) {
  const atual = categorias.find((c) => c.id === id);
  if (!atual) recusa('Categoria não encontrada.');
  if (id === 'outros') recusa('Outros permanece disponível para descrever um adicional avulso.');
  const nome = (entrada.name ?? atual.name).trim(); const ativa = entrada.active ?? atual.active !== false;
  if (!nome || nome.length > 60) recusa('Informe um nome com até 60 caracteres.');
  if (categorias.some((c) => c.id !== id && normalizado(c.name) === normalizado(nome))) recusa('Esta categoria já existe. Confira também as inativas.');
  if (!ator.trim() || !instanteValido(at)) recusa('Confira o responsável e a data da alteração.');
  if (nome === atual.name && ativa === (atual.active !== false)) return categorias;
  return categorias.map((c) => (c.id === id ? { ...c, name: nome, active: ativa, revisions: [...(c.revisions || []), { name: nome, active: ativa, at, by: ator.trim() }] } : c));
}

/** `validatePayoutAdditionRule`: a frase do primeiro problema, ou `null`. */
function validarRegra(regra, hoje, categorias) {
  if (!regra.id || !regra.tarotId) return 'Selecione a profissional.';
  const categoria = categorias.find((c) => c.id === regra.categoryId);
  if (!categoria || categoria.active === false || categoria.name !== regra.categoryName) return 'Selecione uma categoria ativa cadastrada.';
  if (!valorValido(regra.value)) return 'Informe um valor positivo válido e a unidade, quando aplicável.';
  if (!['weekly', 'monthly'].includes(regra.frequency)) return 'Escolha semanal ou mensal.';
  if (!ehData(regra.startDate) || regra.startDate < hoje) return 'Escolha a primeira data de lançamento a partir de hoje. Não geramos períodos retroativos.';
  if (regra.categoryId === 'outros' && !regra.description.trim()) return 'Descreva qual é o adicional em Outros.';
  if (regra.description.length > 700) return 'Use até 700 caracteres na observação.';
  const h = regra.history;
  if (h.length !== 1 || h[0].action !== 'created' || h[0].date !== hoje || !instanteValido(h[0].at) || !h[0].by.trim()) return 'Confira o registro de criação da recorrência.';
  return null;
}
function adicionarRegra(loja, regra, hoje) {
  const p = validarRegra(regra, hoje, loja.categories); if (p) recusa(p);
  if (loja.rules.some((r) => r.id === regra.id)) recusa('Esta recorrência já foi salva.');
  return { ...loja, rules: [...loja.rules, regra] };
}
/** `changePayoutAdditionRule`: pausar, retomar ou encerrar. O histórico conserva os intervalos de pausa. */
function mudarRegra(loja, id, acao, data, at, por) {
  const regra = loja.rules.find((r) => r.id === id); if (!regra) recusa('Recorrência não encontrada.');
  const st = situacao(regra);
  if (st === 'ended') recusa('Esta recorrência já foi encerrada.');
  if ((acao === 'paused' && st !== 'active') || (acao === 'resumed' && st !== 'paused')) recusa('A situação da recorrência mudou. Confira novamente.');
  if (!ehData(data) || data < regra.history[regra.history.length - 1].date || !instanteValido(at) || !por.trim()) recusa('Informe uma data válida para a alteração.');
  return { ...loja, rules: loja.rules.map((r) => (r.id === id ? { ...r, history: [...r.history, { action: acao, date: data, at, by: por }] } : r)) };
}
function ativaEm(regra, data) { const e = regra.history.filter((x) => x.date <= data).slice(-1)[0]; return Boolean(e) && (e.action === 'created' || e.action === 'resumed'); }
/** `payoutAdditionDates`: as datas devidas até `ate`. */
function datasDaRegra(regra, ate) {
  if (!ehData(regra.startDate) || !ehData(ate) || ate < regra.startDate) return [];
  const datas = []; let cursor = regra.startDate; let indice = 0;
  const [ano, mes, dia] = regra.startDate.split('-').map(Number);
  while (cursor <= ate) {
    if (ativaEm(regra, cursor)) datas.push(cursor);
    if (regra.frequency === 'weekly') cursor = somarDias(cursor, 7);
    else {
      indice += 1; const primeiro = new Date(Date.UTC(ano, mes - 1 + indice, 1)); const ultimo = new Date(Date.UTC(primeiro.getUTCFullYear(), primeiro.getUTCMonth() + 1, 0)).getUTCDate();
      cursor = `${primeiro.getUTCFullYear()}-${String(primeiro.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
    }
  }
  return datas;
}

function descricaoDoAdicional(categoria, data, descricao, valor, quantidade, frequencia) {
  const cadencia = frequencia === 'weekly' ? 'Semanal' : frequencia === 'monthly' ? 'Mensal' : 'Único';
  const unidades = valor.kind === 'unit' ? ` · ${quantidade === undefined ? 'undefined' : numeroPtBr(quantidade, 0, 3)} ${valor.unitLabel} × R$ ${numeroPtBr(valor.unitValue, 2, 2)}` : '';
  return `${categoria} · ${cadencia} de ${exibirData(data)}${unidades}${descricao.trim() ? ` · ${descricao.trim()}` : ''}`;
}
/** `adjustmentFor`: o lançamento (ajuste do repasse) que a ocorrência gera. */
function ajusteDe(regra, data, por, quantidade) {
  const oid = idOcorrencia(regra.id, data); const v = regra.value;
  const valor = v.kind === 'fixed' ? v.amount : Math.round(v.unitValue * 100 * quantidade) / 100;
  return {
    id: `AJ-${oid}`, tarotId: regra.tarotId, amount: valor, at: `${data}T12:00:00-03:00`, periodStart: data, periodEnd: data, kind: 'other', categoryId: regra.categoryId, categoryName: regra.categoryName,
    calculation: v.kind, additionalNote: regra.description.trim(), ...(regra.financialReason ? { financialReason: { ...regra.financialReason } } : {}),
    ...(v.kind === 'unit' ? { unitValue: v.unitValue, unitLabel: v.unitLabel, quantity: quantidade } : {}), recurringRuleId: regra.id, occurrenceDate: data, registeredBy: por,
    description: descricaoDoAdicional(regra.categoryName, data, regra.description, v, quantidade, regra.frequency),
  };
}

/** `materializePayoutAdditions`: cria os períodos devidos até `ate`. Existe ocorrência = marcador, nunca se recria. Devolve `{ loja, ajustes }`. */
function materializar(loja, ajustes, ate, at, por) {
  if (!ehData(ate)) return { loja, ajustes };
  const vistos = new Set(loja.occurrences.map((o) => o.id)); const novas = []; const entradas = [];
  for (const regra of loja.rules) {
    for (const data of datasDaRegra(regra, ate)) {
      const id = idOcorrencia(regra.id, data); if (vistos.has(id)) continue; vistos.add(id);
      const entrada = ajusteDe(regra, data, por, regra.value.kind === 'unit' ? 0 : undefined);
      const existente = ajustes.find((a) => a.id === entrada.id || (a.recurringRuleId === regra.id && a.occurrenceDate === data));
      if (existente) { novas.push({ id, ruleId: regra.id, date: data, status: 'posted', adjustmentId: existente.id }); continue; }
      if (regra.value.kind === 'unit') { novas.push({ id, ruleId: regra.id, date: data, status: 'pending' }); continue; }
      entradas.push(entrada); novas.push({ id, ruleId: regra.id, date: data, status: 'posted', adjustmentId: entrada.id, resolvedAt: at, resolvedBy: por });
    }
  }
  return { loja: novas.length ? { ...loja, occurrences: [...loja.occurrences, ...novas] } : loja, ajustes: entradas.length ? [...ajustes, ...entradas] : ajustes };
}

/** `resolvePayoutAdditionQuantity`: zero registra período sem serviço; quantidade positiva gera o crédito integral. */
function resolver(loja, ajustes, id, quantidade, hoje, at, por) {
  const ocorrencia = loja.occurrences.find((o) => o.id === id); const regra = loja.rules.find((r) => ocorrencia && r.id === ocorrencia.ruleId);
  if (!ocorrencia || !regra || regra.value.kind !== 'unit' || ocorrencia.status !== 'pending') recusa('Este período já foi conferido ou não está pendente.');
  if (!quantidadeValida(quantidade)) recusa('Informe a quantidade realizada, com até duas casas decimais, ou zero.');
  if (!ehData(hoje) || ocorrencia.date > hoje) recusa('A quantidade só pode ser conferida na data do período ou depois.');
  const entrada = ajusteDe(regra, ocorrencia.date, por, quantidade);
  if (quantidade > 0 && !dinheiroValido(entrada.amount)) recusa('Confira o valor e a quantidade antes de lançar.');
  if (ajustes.some((a) => a.id === entrada.id || (a.recurringRuleId === regra.id && a.occurrenceDate === ocorrencia.date))) recusa('Este período já tem lançamento. Atualize a tela.');
  return {
    loja: { ...loja, occurrences: loja.occurrences.map((o) => (o.id === id ? { ...o, status: quantidade === 0 ? 'skipped' : 'posted', quantity: quantidade, resolvedAt: at, resolvedBy: por, ...(quantidade > 0 ? { adjustmentId: entrada.id } : {}) } : o)) },
    ajustes: quantidade > 0 ? [...ajustes, entrada] : ajustes,
  };
}

/** `validPayoutAdditionStore`. */
function lojaValida(valor) {
  if (!valor || typeof valor !== 'object' || valor.version !== 1 || !Array.isArray(valor.categories) || !Array.isArray(valor.rules) || !Array.isArray(valor.occurrences)) return false;
  const unico = (l) => l.every((x) => x && typeof x.id === 'string' && x.id) && new Set(l.map((x) => x.id)).size === l.length;
  if (!unico(valor.categories) || !unico(valor.rules) || !unico(valor.occurrences)) return false;
  const revisaoRuim = (r) => !r || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 60 || typeof r.active !== 'boolean' || typeof r.by !== 'string' || !r.by.trim() || !instanteValido(r.at);
  if (valor.categories.some((c) => typeof c.name !== 'string' || !c.name.trim() || c.name.length > 60 || (c.active !== undefined && typeof c.active !== 'boolean') || (c.revisions !== undefined && (!Array.isArray(c.revisions) || c.revisions.some(revisaoRuim))))
    || new Set(valor.categories.map((c) => normalizado(c.name))).size !== valor.categories.length) return false;
  const regraRuim = (r) => typeof r.tarotId !== 'string' || !r.tarotId || !valor.categories.some((c) => c.id === r.categoryId) || typeof r.categoryName !== 'string' || !r.categoryName.trim() || r.categoryName.length > 60
    || !valorValido(r.value) || !['weekly', 'monthly'].includes(r.frequency) || !ehData(r.startDate) || typeof r.description !== 'string' || r.description.length > 700 || !Array.isArray(r.history) || !r.history.length || !r.history[0]
    || r.history[0].action !== 'created' || r.startDate < r.history[0].date
    || r.history.some((e, i) => !e || !['created', 'paused', 'resumed', 'ended'].includes(e.action) || !ehData(e.date) || !instanteValido(e.at) || typeof e.by !== 'string' || !e.by.trim() || (i > 0 && (e.action === 'created' || e.date < r.history[i - 1].date || r.history[i - 1].action === 'ended')));
  if (valor.rules.some(regraRuim)) return false;
  return valor.occurrences.every((o) => valor.rules.some((r) => r.id === o.ruleId) && ehData(o.date) && o.id === idOcorrencia(o.ruleId, o.date) && ['pending', 'posted', 'skipped'].includes(o.status) && (o.quantity === undefined || quantidadeValida(o.quantity)) && (o.status !== 'posted' || typeof o.adjustmentId === 'string'));
}

module.exports = {
  AdicionalInvalidoError, CATEGORIAS_PADRAO, lojaVazia, adicionarCategoria, revisarCategoria, validarRegra, adicionarRegra, mudarRegra, datasDaRegra, ajusteDe, materializar, resolver, lojaValida,
  idOcorrencia, situacao, ehData, normalizado, numeroPtBr,
};
