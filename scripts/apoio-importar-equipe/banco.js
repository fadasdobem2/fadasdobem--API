'use strict';

/**
 * Parte com banco da importação da equipe: conflitos (somente leitura) e criação PELO SERVIÇO OFICIAL (`contas.service.criar` sem senha:
 * conta nasce com acesso pendente + convite aberto no banco, SEM enviar e-mail; o envio fica a cargo de GF_EMAIL_ENVIO_ENABLED, que este
 * script nem consulta). Só PostgreSQL novo. Cada conta é uma transação do serviço (efeito + gf_contas_ext + gf_operacoes + gf_auditoria).
 */

const { QueryTypes } = require('sequelize');
const { chaveOperacao, nomeDaConta } = require('./entrada');

/** Conflitos de cada pessoa com o que já existe. Devolve { ator, achados: Map<n,{estado,motivo}> }. Não grava nada. */
async function checar(pessoas, { ator: atorEmail } = {}) {
  const { sequelize } = require('../../src/config/database');
  const store = require('../../src/gestao-fadas/features/contas/contas.store');
  await sequelize.authenticate();
  const linhas = await store.lerLinhas();
  const admins = linhas.filter((l) => l.perfil === 'administradora' && l.ativo);
  const ator = atorEmail ? admins.find((l) => String(l.email).toLowerCase() === String(atorEmail).toLowerCase()) : admins[0];
  const fones = await sequelize.query("SELECT regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') AS a, regexp_replace(COALESCE(s.whatsapp, ''), '\\D', '', 'g') AS b, regexp_replace(COALESCE(s.whatsapp2, ''), '\\D', '', 'g') AS c FROM users u LEFT JOIN staff_profiles s ON s.user_id = u.id WHERE u.deleted_at IS NULL", { type: QueryTypes.SELECT });
  const foneEmUso = new Set(fones.flatMap((f) => [f.a, f.b, f.c]).filter(Boolean));
  const achados = new Map();
  for (const p of pessoas) {
    if (!p.email || p.problemas.some((x) => /e-mail/.test(x))) continue;
    const [feita] = await sequelize.query("SELECT 1 AS x FROM gf_operacoes WHERE escopo = 'contas.criar' AND chave = :k LIMIT 1", { type: QueryTypes.SELECT, replacements: { k: chaveOperacao(p.email) } });
    if (feita) { achados.set(p.n, { estado: 'ja-importada' }); continue; }
    if (await store.emailEmUso(p.email)) { achados.set(p.n, { estado: 'conflito', motivo: 'e-mail já existe como conta/usuário (não sobrescrevo)' }); continue; }
    if (p.fone.chave && (foneEmUso.has(p.fone.chave) || foneEmUso.has(p.fone.chave.replace(/^55/, '')))) achados.set(p.n, { estado: 'conflito', motivo: 'WhatsApp já cadastrado em outra conta' });
  }
  return { ator, achados };
}

/** Cria as contas pendentes pelo serviço oficial. `prontas` já passaram por validação e conflitos. */
async function criar(prontas, ator, usarNome, log) {
  process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; // PostgreSQL novo; o MySQL legado nunca é tocado
  const servico = require('../../src/gestao-fadas/features/contas/contas.service');
  const r = { criadas: 0, falhas: 0 };
  for (const p of prontas) {
    const req = { user: { id: ator.id, role: 'GESTORA' }, accessContext: { roleIds: ['admin'] }, params: {}, headers: {},
      body: { operationKey: chaveOperacao(p.email), name: nomeDaConta(p, usarNome), email: p.email, role: p.papel } }; // sem password => acesso pendente
    try { await servico.criar(req); r.criadas += 1; log(`  criada  #${p.n}: ${p.papel}, acesso pendente`); }
    catch (e) { r.falhas += 1; log(`  FALHOU  #${p.n}: ${(e && e.statusCode) || ''} ${String((e && e.message) || 'erro').slice(0, 140)}`); }
  }
  return r;
}

module.exports = { checar, criar };
