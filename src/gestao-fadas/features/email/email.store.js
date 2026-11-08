'use strict';

/**
 * Banco novo da configuração de e-mails: `gf_email_config` (linha única, revisão otimista; `conteudo` é a configuração SEM segredo e
 * `segredos` guarda só o texto cifrado de cada conexão) e `gf_email_eventos` (recibos, só acrescenta). Escrita pelo executor do banco novo
 * (só INSERT/UPDATE em gf_*); leitura direta no Postgres da A. Nada daqui devolve ou registra segredo em claro.
 */

const { QueryTypes } = require('sequelize');
const { emTransacao } = require('../../novo/escritor');

const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const ler = (sql, replacements) => require('../../../config/database').sequelize.query(sql, { type: QueryTypes.SELECT, replacements });

const repositorio = {
  /** `{ settings, secrets }` ou null se nunca foi salvo. */
  async read() {
    const [l] = await ler('SELECT conteudo, segredos FROM gf_email_config WHERE id = 1', {});
    return l ? { settings: json(l.conteudo), secrets: json(l.segredos) } : null;
  },
  /** `expectedRevision` 0 insere (a corrida perdida devolve false); senão só grava se a revisão ainda for a lida. */
  async save(valor, expectedRevision, ator, em) {
    const conteudo = JSON.stringify(valor.settings);
    const segredos = JSON.stringify(valor.secrets);
    return emTransacao(async (ex) => {
      const [r] = expectedRevision === 0
        ? await ex.execute('INSERT INTO gf_email_config (id, revisao, conteudo, segredos, atualizado_por, atualizado_em) VALUES (1, 1, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING', [conteudo, segredos, ator, em])
        : await ex.execute('UPDATE gf_email_config SET revisao = revisao + 1, conteudo = ?, segredos = ?, atualizado_por = ?, atualizado_em = ? WHERE id = 1 AND revisao = ?', [conteudo, segredos, ator, em, expectedRevision]);
      return r.affectedRows === 1;
    });
  },
  async audit(v) {
    await emTransacao(async (ex) => {
      await ex.execute(
        'INSERT INTO gf_email_eventos (id, ocorreu_em, ator_id, finalidade, tipo, conta_id, resultado, codigo_erro) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [v.id, v.at, v.actorId, v.purpose, v.kind, v.accountId || null, v.status, v.error || null],
      );
    });
  },
  async recent() {
    const linhas = await ler('SELECT id, ocorreu_em, ator_id, finalidade, tipo, conta_id, resultado, codigo_erro FROM gf_email_eventos ORDER BY ocorreu_em DESC, id DESC LIMIT 50', {});
    return linhas.map((r) => ({
      id: r.id, at: new Date(r.ocorreu_em).toISOString(), actorId: r.ator_id, purpose: r.finalidade, kind: r.tipo,
      ...(r.conta_id ? { accountId: r.conta_id } : {}), status: r.resultado, ...(r.codigo_erro ? { error: r.codigo_erro } : {}),
    }));
  },
};

module.exports = { repositorio };
