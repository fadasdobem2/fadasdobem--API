'use strict';

/**
 * Grava, na transação da ação, a EXTENSÃO do cadastro (`gf_clientes_ext`, Postgres novo) no que a Lilly v708 acrescentou: `situacao_cadastral`
 * (NULL | dados_pendentes | completo; nunca preenchida em massa e distinta do `perfil_pagamento`), `sem_email` e complementos em `dados`
 * (WhatsApp, e-mail, nome completo). Cria a linha se ainda não existe. NADA vai ao legado: a linha fica `legado_estado = 'sem_registro'`
 * quando a cliente nem existe em `usuarios`.
 */

const { texto } = require('./executores.comum');

const lerDados = (v) => (typeof v === 'string' ? JSON.parse(v) : v || {});

/**
 * @param {object} ex executor da transação
 * @param {string} id
 * @param {{ situacao?: string|null, semEmail?: boolean, dados?: object, perfil?: string, semLinhaNoLegado?: boolean }} mudancas  `undefined` = não mexer
 * @param {{ quem: string, operationKey: string }} autoria
 * @returns {Promise<{ revisao: number, situacao: string|null, semEmail: boolean|null, dados: object }>}
 */
async function gravarExtensao(ex, id, mudancas, { quem, operationKey }) {
  await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_clientes_ext:${id}`]);
  const [linhas] = await ex.execute('SELECT perfil_pagamento, dados, revisao, situacao_cadastral, sem_email FROM gf_clientes_ext WHERE id_cliente = ? FOR UPDATE', [id]);
  const atual = linhas[0];
  const dados = { ...(atual ? lerDados(atual.dados) : {}) };
  for (const [k, v] of Object.entries(mudancas.dados || {})) if (v !== undefined) dados[k] = v;
  const situacao = mudancas.situacao !== undefined ? mudancas.situacao : (atual ? atual.situacao_cadastral : null) ?? null;
  const semEmail = mudancas.semEmail !== undefined ? mudancas.semEmail : (atual ? atual.sem_email : null) ?? null;
  if (!atual) {
    const sem = mudancas.semLinhaNoLegado === true;
    await ex.execute(
      `INSERT INTO gf_clientes_ext (id_cliente, perfil_pagamento, perfil_pagamento_em, dados, revisao, atualizado_por, operation_key, legado_estado, legado_detalhe, situacao_cadastral, sem_email)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      [id, mudancas.perfil || null, mudancas.perfil ? new Date().toISOString() : null, JSON.stringify(dados), quem, operationKey,
        sem ? 'sem_registro' : 'nao_espelhada', sem ? 'cliente criada no banco novo (sem linha em usuarios)' : null, situacao, semEmail],
    );
    return { revisao: 1, situacao, semEmail, dados };
  }
  await ex.execute(
    'UPDATE gf_clientes_ext SET dados = ?, situacao_cadastral = ?, sem_email = ?, revisao = revisao + 1, atualizado_em = CURRENT_TIMESTAMP, atualizado_por = ?, operation_key = ? WHERE id_cliente = ?',
    [JSON.stringify(dados), situacao, semEmail, quem, operationKey, id],
  );
  return { revisao: Number(atual.revisao) + 1, situacao, semEmail, dados };
}

/** Situação e "sem e-mail" gravados da cliente (ou `null` se ainda não há extensão). */
async function lerSituacao(ex, id) {
  const [linhas] = await ex.execute('SELECT situacao_cadastral, sem_email, perfil_pagamento FROM gf_clientes_ext WHERE id_cliente = ?', [id]);
  return linhas[0] ? { situacao: linhas[0].situacao_cadastral, semEmail: linhas[0].sem_email, perfil: texto(linhas[0].perfil_pagamento) } : null;
}

module.exports = { gravarExtensao, lerSituacao };
