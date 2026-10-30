'use strict';

/**
 * SQL do Cadastro de tarólogos (banco novo). Leituras fora de transação usam os models; tudo que grava roda no executor
 * (`novo/escritor.js`) dentro da transação do service. jsonb volta do executor como TEXTO.
 */

const COLUNAS = 'id, dados, status, revisao, tarot_id, aprovado_dados, aprovado_publico, aprovado_revisao, aprovado_em, aprovado_por, criado_em, atualizado_em, atualizado_por';
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v === undefined ? null : v);
const iso = (v) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? undefined : new Date(v).toISOString());

/** Linha (executor ou model) -> registro do front (`RegistrationRecord`): `approvedData` = parte privada + campos públicos, sem `tarotId`. */
function paraRegistro(l) {
  const publico = json(l.aprovado_publico);
  const { tarotId: _t, ...camposPublicos } = publico || {};
  const privado = json(l.aprovado_dados);
  return {
    id: l.id, data: json(l.dados), status: l.status, revision: Number(l.revisao), ...(l.tarot_id ? { tarotId: l.tarot_id } : {}),
    createdAt: iso(l.criado_em), updatedAt: iso(l.atualizado_em), updatedBy: l.atualizado_por,
    ...(privado ? { approvedData: { ...privado, ...camposPublicos } } : {}),
    ...(publico ? { approvedPublic: publico } : {}),
    ...(l.aprovado_em ? { approvedAt: iso(l.aprovado_em) } : {}), ...(l.aprovado_por ? { approvedBy: l.aprovado_por } : {}),
  };
}

const lerPorId = async (m, id) => m.GfCadastrosTarologo.findOne({ where: { id } });
const lerPorTarot = async (m, tarot_id) => m.GfCadastrosTarologo.findOne({ where: { tarot_id } });
const lerRecentes = async (m) => m.GfCadastrosTarologo.findAll({ order: [['atualizado_em', 'DESC']], limit: 200 });
const lerAprovados = async (m) => (await m.GfCadastrosTarologo.findAll({ order: [['atualizado_em', 'DESC']], limit: 200 })).filter((l) => l.aprovado_publico && l.tarot_id);

/** Link válido para o token (não consumido, não vencido e na revisão em que foi emitido). Em transação, trava. */
async function linkValido(ex, tokenHash, agoraIso, travar = false) {
  const [linhas] = await ex.execute(
    `SELECT t.id_cadastro, t.revisao_emitida, t.expira_em, r.dados FROM gf_cadastros_tarologo_links t JOIN gf_cadastros_tarologo r ON r.id = t.id_cadastro
     WHERE t.token_hash = ? AND t.expira_em > ? AND t.consumido_em IS NULL AND r.revisao = t.revisao_emitida${travar ? ' FOR UPDATE OF t' : ''}`,
    [tokenHash, agoraIso],
  );
  return linhas[0] ? { ...linhas[0], dados: json(linhas[0].dados) } : null;
}

const travar = (ex, chave) => ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [chave]);
async function porIdTravado(ex, id) { const [l] = await ex.execute(`SELECT ${COLUNAS} FROM gf_cadastros_tarologo WHERE id = ? FOR UPDATE`, [id]); return l[0] || null; }
async function donoDoTarot(ex, tarotId, exceto) { const [l] = await ex.execute('SELECT id FROM gf_cadastros_tarologo WHERE tarot_id = ? AND id <> ?', [tarotId, exceto]); return l[0] || null; }
async function envioPorChave(ex, chaveHash) { const [l] = await ex.execute('SELECT chave_hash, impressao, id_cadastro, recebido_em FROM gf_cadastros_tarologo_envios WHERE chave_hash = ?', [chaveHash]); return l[0] || null; }

async function inserirCadastro(ex, c) {
  await ex.execute(
    'INSERT INTO gf_cadastros_tarologo (id, dados, status, revisao, tarot_id, aprovado_dados, aprovado_publico, aprovado_revisao, aprovado_em, aprovado_por, criado_em, atualizado_em, atualizado_por) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [c.id, JSON.stringify(c.dados), c.status, c.tarotId, c.aprovadoDados && JSON.stringify(c.aprovadoDados), c.aprovadoPublico && JSON.stringify(c.aprovadoPublico),
      c.aprovadoPublico ? 1 : null, c.aprovadoPublico ? c.agora : null, c.aprovadoPublico ? c.por : null, c.agora, c.agora, c.por],
  );
}

async function atualizarCadastro(ex, c) {
  await ex.execute(
    `UPDATE gf_cadastros_tarologo SET dados = ?, status = ?, revisao = revisao + 1, tarot_id = ?,
       aprovado_dados = CASE WHEN ? THEN ? ELSE aprovado_dados END, aprovado_publico = CASE WHEN ? THEN ? ELSE aprovado_publico END,
       aprovado_revisao = CASE WHEN ? THEN revisao + 1 ELSE aprovado_revisao END, aprovado_em = CASE WHEN ? THEN ? ELSE aprovado_em END,
       aprovado_por = CASE WHEN ? THEN ? ELSE aprovado_por END, atualizado_em = ?, atualizado_por = ? WHERE id = ?`,
    [JSON.stringify(c.dados), c.status, c.tarotId, c.aprovando, c.aprovadoDados && JSON.stringify(c.aprovadoDados), c.aprovando, c.aprovadoPublico && JSON.stringify(c.aprovadoPublico),
      c.aprovando, c.aprovando, c.agora, c.aprovando, c.por, c.agora, c.por, c.id],
  );
}

const inserirEnvio = (ex, chaveHash, impressao, id, agora) => ex.execute('INSERT INTO gf_cadastros_tarologo_envios (chave_hash, impressao, id_cadastro, recebido_em) VALUES (?, ?, ?, ?)', [chaveHash, impressao, id, agora]);

async function atualizarPorLink(ex, id, dados, agora, revisaoEmitida) {
  await ex.execute("UPDATE gf_cadastros_tarologo SET dados = ?, status = 'pending', revisao = revisao + 1, atualizado_em = ?, atualizado_por = 'form-token' WHERE id = ? AND revisao = ?", [JSON.stringify(dados), agora, id, revisaoEmitida]);
  await ex.execute('UPDATE gf_cadastros_tarologo_links SET consumido_em = ? WHERE id_cadastro = ? AND consumido_em IS NULL', [agora, id]);
}

async function gravarLink(ex, id, tokenHash, revisao, expiraEm, agora, por) {
  await ex.execute(
    `INSERT INTO gf_cadastros_tarologo_links (id_cadastro, token_hash, revisao_emitida, expira_em, consumido_em, criado_em, criado_por) VALUES (?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT (id_cadastro) DO UPDATE SET token_hash = EXCLUDED.token_hash, revisao_emitida = EXCLUDED.revisao_emitida, expira_em = EXCLUDED.expira_em, consumido_em = NULL, criado_em = EXCLUDED.criado_em, criado_por = EXCLUDED.criado_por`,
    [id, tokenHash, revisao, expiraEm, agora, por],
  );
}

module.exports = {
  COLUNAS, paraRegistro, lerPorId, lerPorTarot, lerRecentes, lerAprovados, linkValido, travar, porIdTravado, donoDoTarot, envioPorChave, inserirCadastro,
  atualizarCadastro, inserirEnvio, atualizarPorLink, gravarLink, json, iso,
};
