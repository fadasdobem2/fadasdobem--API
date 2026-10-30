'use strict';

/** Apoio do filho de scripts/verificar-gf-banco-novo.js: contadores de passos e criação de usuários da A no banco descartável. */

const path = require('path');
const { randomUUID } = require('crypto');

const raiz = path.join(__dirname, '..', '..');
let ok = 0;
const falhas = [];

function conferir(nome, condicao, detalhe) {
  if (condicao) { ok += 1; console.log(`  ok  ${nome}`); } else { falhas.push(nome); console.log(`  FALHOU  ${nome}  ${detalhe || ''}`); }
}
async function passo(nome, fn) {
  try { const r = await fn(); ok += 1; console.log(`  ok  ${nome}${r ? ` (${r})` : ''}`); } catch (e) {
    falhas.push(nome); console.log(`  FALHOU  ${nome}: ${e.codigo || e.name}: ${String(e.message).slice(0, 220)}`);
  }
}
const resumo = () => ({ ok, falhas });

/** Cria um usuário da A (e o perfil de equipe com nome) e devolve o id. */
async function criarUsuario(nome) {
  const { User, StaffProfile } = require(path.join(raiz, 'src', 'models'));
  const id = randomUUID();
  await User.create({ id, email: `${nome.toLowerCase().replace(/\W+/g, '.')}.${id.slice(0, 6)}@teste.local`, role: 'GESTORA', is_active: true });
  await StaffProfile.create({ user_id: id, display_name: nome });
  return id;
}

async function contagens(sequelize, tabelas) {
  const saida = {};
  for (const t of tabelas) { const [[l]] = await sequelize.query(`SELECT COUNT(*) AS n FROM ${t}`); saida[t] = Number(l.n); }
  return saida;
}

const TABELAS_GF = ['gf_auditoria', 'gf_repasse_percentuais', 'gf_repasse_calendarios', 'gf_repasse_aberturas', 'gf_repasse_abertura_pendencias',
  'gf_repasse_dividas', 'gf_repasse_divida_parcelas', 'gf_repasse_ajustes', 'gf_operacoes', 'gf_welcome'];

module.exports = { raiz, conferir, passo, resumo, criarUsuario, contagens, TABELAS_GF };
