'use strict';

/**
 * Formas de atendimento do dia no banco novo (`gf_formas_atendimento_dia`, uma linha por profissional e dia operacional, revisão otimista).
 * Escrita pelo executor do banco novo (só INSERT/UPDATE em gf_*); leitura direta no Postgres da A. Painel, equipe e Lilly leem as MESMAS linhas.
 */

const { QueryTypes } = require('sequelize');
const { emTransacao } = require('../../novo/escritor');

const COLUNAS = "tarologo_id, to_char(data_operacional, 'YYYY-MM-DD') AS dia, formas, revisao, atualizado_em, atualizado_por";
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const ler = (sql, replacements) => require('../../../config/database').sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
const linha = (r) => ({ tarotId: r.tarologo_id, date: r.dia, modes: json(r.formas), revision: Number(r.revisao), updatedAt: new Date(r.atualizado_em).toISOString(), updatedBy: r.atualizado_por });

const repositorio = {
  async read(tarotId, data) {
    const [r] = await ler(`SELECT ${COLUNAS} FROM gf_formas_atendimento_dia WHERE tarologo_id = :id AND data_operacional = :data`, { id: tarotId, data });
    return r ? linha(r) : null;
  },
  async list(data) {
    return (await ler(`SELECT ${COLUNAS} FROM gf_formas_atendimento_dia WHERE data_operacional = :data ORDER BY tarologo_id`, { data })).map(linha);
  },
  /** Revisão 0 insere (a corrida perdida devolve null); senão só atualiza se a revisão ainda for a lida. */
  async save(row, expectedRevision) {
    const formas = JSON.stringify(row.modes);
    const gravou = await emTransacao(async (ex) => {
      const [r] = expectedRevision === 0
        ? await ex.execute('INSERT INTO gf_formas_atendimento_dia (tarologo_id, data_operacional, formas, revisao, atualizado_em, atualizado_por) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT (tarologo_id, data_operacional) DO NOTHING', [row.tarotId, row.date, formas, row.updatedAt, row.updatedBy])
        : await ex.execute('UPDATE gf_formas_atendimento_dia SET formas = ?, revisao = revisao + 1, atualizado_em = ?, atualizado_por = ? WHERE tarologo_id = ? AND data_operacional = ? AND revisao = ?', [formas, row.updatedAt, row.updatedBy, row.tarotId, row.date, expectedRevision]);
      return r.affectedRows === 1;
    });
    return gravou ? { ...row, revision: expectedRevision + 1 } : null;
  },
};

module.exports = { repositorio };
