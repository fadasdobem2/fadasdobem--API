'use strict';

/**
 * TRAVA DA FICHA DO ASP (Maturacao/53), parte comum: política, decisão PURA e agendamento. A ficha de cliente do ASP regrava ~40 colunas de `usuarios`
 * com o que carregou ao abrir; se o painel editou o cliente enquanto a ficha estava aberta, o ASP desfaz a edição ao salvar. Depois que o painel grava
 * um campo no legado (`espelho-entidades.js#primeiro`, mesma intenção de `gf_legado_intencoes`), são agendadas conferências curtas (`gf_legado_verificacoes`)
 * que releem o campo e comparam com o que gravamos. A conferência em si está em `verificacao.conferir.js`; o job em `verificacao.job.js`.
 * Flag própria `GF_LEGADO_VERIFICACAO` (desligada por padrão) E o espelho geral E a flag da entidade: sem as três, nada é agendado nem conferido.
 */

const { randomUUID } = require('crypto');

const legado = () => require('./index');

/** Campos verificados por entidade. Cliente: pode REAPLICAR uma vez. Tarólogo (`nmuTarologo`, MyISAM): só lê e compara. `whats` não entra: a ficha do ASP nunca o toca. */
const POLITICA = Object.freeze({
  clientes: Object.freeze({ reaplica: true, colunas: Object.freeze(['nome_id', 'nome2', 'datanascimento']), tabela: 'gf_clientes_ext', chave: 'id_cliente', campoFront: Object.freeze({ nome_id: 'name', nome2: 'treatAs', datanascimento: 'birthDate' }), categoria: 'cliente' }),
  tarologos: Object.freeze({ reaplica: false, colunas: Object.freeze(['nmuTarologo']), tabela: 'gf_tarologos_perfil', chave: 'tarot_id', campoFront: Object.freeze({ nmuTarologo: 'nome' }), categoria: 'profissional' }),
});
/** Nome que a equipe lê no log (o mesmo rótulo da ficha). */
const ROTULO = Object.freeze({ nome_id: 'Nome de identificação', nome2: 'Tratar por', datanascimento: 'Data de nascimento', nmuTarologo: 'Nome do profissional' });

const ligada = (env = process.env) => `${env.GF_LEGADO_VERIFICACAO || ''}`.trim().toLowerCase() === 'true';
/** Ligada para a entidade: precisa da flag própria, do espelho geral e da flag da entidade (e o modo `primeiro`). */
const ativa = (entidade, env = process.env) => ligada(env) && Boolean(POLITICA[entidade]) && legado().espelhoLigado(env, entidade) && require('./legado-primeiro').modoPrimeiro(env);

/** Minutos de cada conferência (padrão +2 min, +15 min, +2 h). `GF_LEGADO_VERIFICACAO_MINUTOS="2,15,120"` (aceita fração; usado nos ensaios). */
function etapas(env = process.env) {
  const lista = `${env.GF_LEGADO_VERIFICACAO_MINUTOS || ''}`.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0 && x <= 1440);
  return lista.length ? lista.slice(0, 6) : [2, 15, 120];
}

const texto = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Decisão pura de uma conferência. `atual`/`antigo`/`novo`: valor lido, valor que substituímos e valor que gravamos. `reaplicada`: já reaplicamos esta cadeia.
 * Devolve `{ acao: 'ok' | 'reaplicar' | 'divergente', tipo }`. Sem linha no legado: `divergente` (`sem_registro`).
 */
function decidir({ atual, antigo, novo, reaplicada = false, reaplica = true, existe = true }) {
  if (!existe) return { acao: 'divergente', tipo: 'sem_registro' };
  if (texto(atual) === texto(novo)) return { acao: 'ok', tipo: 'igual_ao_gravado' };
  if (texto(atual) === texto(antigo)) {
    if (!reaplica) return { acao: 'divergente', tipo: 'voltou_ao_valor_antigo_sem_reaplicar' };
    return reaplicada ? { acao: 'divergente', tipo: 'voltou_ao_valor_antigo_de_novo' } : { acao: 'reaplicar', tipo: 'voltou_ao_valor_antigo' };
  }
  return { acao: 'divergente', tipo: 'valor_diferente' };
}

/**
 * Agenda as conferências, DENTRO da transação do pedido (se o pedido for desfeito, nada fica agendado). Só colunas que realmente mudaram e que a política
 * cobre. Uma edição mais nova do mesmo campo encerra as conferências pendentes da anterior (senão a anterior veria o valor novo como "outra pessoa").
 * Devolve quantas linhas criou (0 com a flag desligada).
 */
async function agendar(pg, { entidade, entidadeId, legadoId, intencao, antes, depois, agora = Date.now(), env = process.env }) {
  if (!ativa(entidade, env)) return 0;
  const colunas = POLITICA[entidade].colunas.filter((c) => depois && c in depois && texto(antes && antes[c]) !== texto(depois[c]));
  let n = 0;
  for (const coluna of colunas) {
    await pg.execute("UPDATE gf_legado_verificacoes SET estado = 'encerrada', detalhe = 'substituída por uma edição mais nova do mesmo campo', atualizado_em = CURRENT_TIMESTAMP WHERE entidade = ? AND entidade_id = ? AND coluna = ? AND estado = 'pendente'", [entidade, String(entidadeId), coluna]);
    for (const [i, minutos] of etapas(env).entries()) {
      await pg.execute('INSERT INTO gf_legado_verificacoes (id, intencao_id, entidade, entidade_id, legado_id, coluna, etapa, vence_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), intencao, entidade, String(entidadeId), String(legadoId).slice(0, 20), coluna, i, new Date(agora + minutos * 60_000).toISOString()]);
      n += 1;
    }
  }
  return n;
}

/** Contagem por estado (o que a API registra no log). Só leitura. */
async function contagem(ex) {
  const [l] = await ex.execute('SELECT estado, COUNT(*) AS n FROM gf_legado_verificacoes GROUP BY estado ORDER BY estado', []);
  return Object.fromEntries(l.map((x) => [x.estado, Number(x.n)]));
}

module.exports = { POLITICA, ROTULO, ligada, ativa, etapas, decidir, agendar, contagem, texto };
