'use strict';

/**
 * Espelho no legado das entidades que são ATUALIZAÇÃO de linha já existente (cliente em `usuarios`, tarólogo em `tbl_tarologos`). É o MESMO
 * mecanismo do espelho de consultas (Maturacao/37), generalizado: INTENÇÃO no Postgres na mesma transação da edição (`legado_estado =
 * 'pendente'` + os campos ainda não escritos em `legado_pendentes`), escrita no legado DEPOIS do commit, vínculo/estado no Postgres e
 * reconciliação das que ficaram `pendente`/`erro`. Diferenças que decorrem de ser UPDATE e não INSERT:
 *   - não existe órfã nem duplicata possível (a linha do legado já existe e é achada pelo id): repetir a operação grava os mesmos valores;
 *   - o UPDATE leva SÓ os campos pendentes (nunca o "estado inteiro"): uma edição do ASP em outro campo não é desfeita por cópia velha;
 *   - recusa permanente (valor que não cabe na coluna) vira `erro` com detalhe `recusada: ...` e NÃO é repetida pela reconciliação até a
 *     equipe editar de novo; linha inexistente no legado vira `sem_registro`.
 * Roda só com `GF_LEGADO_ESCRITA_ENABLED=true` E a flag da entidade. Desligado, a edição só fica anotada em `legado_pendentes`.
 */

const { emTransacao: emPostgres } = require('../novo/escritor');
const AppError = require('../../utils/AppError');
const { MapeamentoError } = require('./mapeamento');
const { pendentesDe } = require('./fusao');

const legado = () => require('./index');
const parar = (texto) => String(texto).slice(0, 300);

/**
 * `d`: { entidade, tabela, coluna (id no Postgres), extras (colunas a mais lidas), idLegado(row) -> número|null, traduzir(row, pendentes) -> {colunas,campos}|null,
 *        ler(lx, id), escrever(lx, id, colunas) -> linhas, campos }.
 */
function criar(d) {
  const colunas = `${d.coluna}, legado_estado, legado_detalhe, legado_pendentes${d.extras ? `, ${d.extras}` : ''}`;
  const travar = async (pg, id) => { const [l] = await pg.execute(`SELECT ${colunas} FROM ${d.tabela} WHERE ${d.coluna} = ? FOR UPDATE`, [id]); return l[0] || null; };
  const marcar_ = (pg, id, estado, detalhe, pendentes) => marcar(pg, id, estado, detalhe, pendentes);
  const marcar = (pg, id, estado, detalhe, pendentes) => pg.execute(
    `UPDATE ${d.tabela} SET legado_estado = ?, legado_detalhe = ?, legado_pendentes = ?, legado_atualizado_em = CURRENT_TIMESTAMP WHERE ${d.coluna} = ?`,
    [estado, detalhe ? parar(detalhe) : null, JSON.stringify(pendentes), id],
  );

  /** INTENÇÃO, dentro da transação da edição. `campos`: os campos (nomes do Postgres) que a edição mexeu. Devolve se havia o que espelhar. */
  async function registrar(pg, id, campos) {
    const row = await travar(pg, id);
    if (!row || d.idLegado(row) === null) return false;
    const novos = campos.filter((c) => d.campos.includes(c));
    if (!novos.length) return false;
    const pendentes = [...new Set([...(pendentesDe(row) || []), ...novos])];
    const vai = legado().espelhoLigado(process.env, d.entidade) && Array.isArray(pg.posCommit);
    await marcar(pg, id, vai ? 'pendente' : 'nao_espelhada', vai ? 'intenção de espelho' : 'espelho desligado: edição só no Postgres', pendentes);
    if (vai) pg.posCommit.push(() => sincronizar(id, 'edicao'));
    return true;
  }

  /** Escreve no legado os campos pendentes (depois do commit). Nunca derruba nada: o resultado fica no estado. */
  async function sincronizar(id, momento) {
    try {
      return await emPostgres(async (pg) => {
        const row = await travar(pg, id);
        const idLeg = row ? d.idLegado(row) : null;
        const pendentes = row ? (pendentesDe(row) || []) : [];
        if (!row || idLeg === null || !pendentes.length) return null;
        let linha;
        try { linha = d.traduzir(row, pendentes); } catch (e) {
          if (!(e instanceof MapeamentoError)) throw e;
          const r = { estado: 'erro', detalhe: `recusada: ${e.message}` }; await marcar(pg, id, r.estado, r.detalhe, pendentes); return r;
        }
        if (!linha) { const r = { estado: 'espelhada', detalhe: 'nada a escrever (campos sem valor)' }; await marcar(pg, id, r.estado, r.detalhe, []); return r; }
        const r = await legado().emTransacao(async (lx) => {
          if (!(await d.ler(lx, idLeg))) return { estado: 'sem_registro', detalhe: `${d.rotulo} não encontrado no legado` };
          const n = await d.escrever(lx, idLeg, linha.colunas);
          return n ? { estado: 'espelhada', detalhe: `atualizada (${momento})` } : { estado: 'sem_registro', detalhe: `${d.rotulo} não aceitou a atualização no legado` };
        }, { entidade: d.entidade });
        await marcar(pg, id, r.estado, r.detalhe, r.estado === 'espelhada' ? [] : pendentes);
        return r;
      });
    } catch (erro) {
      const detalhe = `${(erro && (erro.codigo || erro.code)) || 'erro'}: ${String((erro && erro.message) || '').slice(0, 150)}`;
      await emPostgres(async (pg) => { const row = await travar(pg, id); if (row) await marcar(pg, id, 'erro', detalhe, pendentesDe(row) || []); }).catch(() => {});
      console.error(`[gf-espelho.${d.entidade}] falhou:`, detalhe);
      return { estado: 'erro', detalhe };
    }
  }

  /** Ids com espelho por concluir, atualizados antes de `corte`. `incluirNaoEspelhadas`: também as editadas com o espelho desligado (carga inicial, só por comando). */
  async function candidatas(corte, limite, incluirNaoEspelhadas = false) {
    return emPostgres(async (pg) => {
      const filtroEstado = incluirNaoEspelhadas
        ? "(legado_estado IN ('pendente', 'erro') OR (legado_estado = 'nao_espelhada' AND legado_pendentes <> '[]'::jsonb))"
        : "legado_estado IN ('pendente', 'erro')";
      const [linhas] = await pg.execute(
        `SELECT ${d.coluna} AS id FROM ${d.tabela} WHERE ${filtroEstado} AND COALESCE(legado_detalhe, '') NOT LIKE 'recusada%'${d.filtroExtra ? ` AND ${d.filtroExtra}` : ''} AND (legado_atualizado_em IS NULL OR legado_atualizado_em < ?) ORDER BY legado_atualizado_em, ${d.coluna} LIMIT ?`,
        [corte, limite],
      );
      return linhas.map((l) => String(l.id));
    });
  }

  /** Uma passada de reconciliação desta entidade. Desligada, não faz nada. */
  async function reconciliar({ idadeMinutos = 10, limite = 50, agora = Date.now(), ligado = legado().espelhoLigado(process.env, d.entidade), incluirNaoEspelhadas = false } = {}) {
    const r = { entidade: d.entidade, desligado: !ligado, examinadas: 0, espelhadas: 0, recusadas: 0, semRegistro: 0, erros: 0 };
    if (!ligado) return r;
    const ids = await candidatas(new Date(agora - idadeMinutos * 60_000).toISOString(), limite, incluirNaoEspelhadas);
    r.examinadas = ids.length;
    for (const id of ids) {
      const x = await sincronizar(id, 'reconciliacao');
      if (!x) continue;
      if (x.estado === 'espelhada') r.espelhadas += 1; else if (x.estado === 'sem_registro') r.semRegistro += 1; else if (/^recusada/.test(x.detalhe || '')) r.recusadas += 1; else r.erros += 1;
    }
    return r;
  }

  /** Contagem por estado (leitura): o que o comando offline mostra antes de qualquer reenvio. */
  async function resumo() {
    return emPostgres(async (pg) => {
      const [linhas] = await pg.execute(`SELECT legado_estado AS estado, COUNT(*) AS n FROM ${d.tabela} GROUP BY legado_estado ORDER BY legado_estado`, []);
      return Object.fromEntries(linhas.map((l) => [l.estado, Number(l.n)]));
    });
  }

  /**
   * LEGADO PRIMEIRO (Maturacao/46): escreve `linha.colunas` no legado DENTRO do pedido, antes do commit do Postgres. Falha do legado -> 503 e o Postgres
   * desfaz tudo (o pedido lança). Sucesso -> registra a intenção `concluida` na transação do pedido e deixa em `pg.compensacoes` o desfazer, que o
   * `gravar` do pedido roda se o Postgres falhar DEPOIS (revertendo o legado ao valor anterior, se ele ainda tem o que escrevemos).
   * Idempotente: é UPDATE de linha que já existe; repetir grava os mesmos valores (o `operationKey` repetido nem chega aqui: devolve a resposta guardada).
   */
  async function primeiro(pg, id, idLegado, linha, { operationKey, escopo } = {}) {
    const lp = require('./legado-primeiro'); const intencoes = require('./intencoes');
    let intencao = null; let antes = null;
    try {
      await legado().emTransacao(async (lx) => {
        const atual = await d.ler(lx, idLegado);
        if (!atual) throw new AppError(`${d.rotulo[0].toUpperCase()}${d.rotulo.slice(1)} não encontrado no sistema antigo.`, 404, { codigo: 'NOT_FOUND' }, true);
        antes = Object.fromEntries(Object.keys(linha.colunas).map((c) => [c, atual[c] === undefined ? null : atual[c]]));
        intencao = await intencoes.abrir({ entidade: d.entidade, entidadeId: id, escopo, operationKey, legadoId: idLegado, antes, depois: linha.colunas });
        if (!(await d.escrever(lx, idLegado, linha.colunas))) throw new Error(`${d.rotulo} não aceitou a atualização no legado`);
      }, { entidade: d.entidade });
    } catch (e) {
      if (intencao) await intencoes.marcar(intencao, 'revertida', `o legado não gravou: ${(e && (e.codigo || e.code)) || 'erro'}`);
      throw lp.falhaDoLegado(e);
    }
    await intencoes.concluirNaTransacao(pg, intencao, idLegado);
    // Trava da ficha do ASP (Maturacao/53): agenda a conferência pós-gravação NA MESMA transação (desligada = 0 linhas, nada acontece).
    await require('./verificacao').agendar(pg, { entidade: d.entidade, entidadeId: id, legadoId: idLegado, intencao, antes, depois: linha.colunas });
    if (Array.isArray(pg.compensacoes)) {
      pg.compensacoes.push(async () => {
        try {
          const r = await lp.desfazer({ entidade: d.entidade, ler: d.ler, escrever: d.escrever, idLegado, antes, depois: linha.colunas });
          await intencoes.marcar(intencao, r === 'divergente' ? 'divergente' : 'revertida', r === 'divergente' ? 'o Postgres falhou e o legado mudou depois: decisão humana' : 'o Postgres falhou; legado devolvido ao valor anterior');
        } catch (e) { await intencoes.marcar(intencao, 'divergente', `o Postgres falhou e o legado não pôde ser desfeito: ${(e && (e.codigo || e.code)) || 'erro'}`); }
      });
    }
    return { antes, depois: linha.colunas, campos: linha.campos, intencao };
  }

  /** Reverte uma intenção `iniciada` antiga (reconciliação). Devolve 'revertida' | 'divergente' | 'nada'. */
  async function reverter({ legado_id: idLegado, antes, depois }) {
    return require('./legado-primeiro').desfazer({ entidade: d.entidade, ler: d.ler, escrever: d.escrever, idLegado, antes, depois });
  }

  return { entidade: d.entidade, registrar, sincronizar, candidatas, reconciliar, resumo, primeiro, reverter, marcar: marcar_ };
}

module.exports = { criar };
