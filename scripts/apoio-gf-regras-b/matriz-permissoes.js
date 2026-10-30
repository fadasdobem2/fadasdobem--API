'use strict';

/**
 * Percorre a tabela de permissões por rota (`rotas-permissoes.js`) chamando o GATE de verdade (Express efêmero, sessão falsa, sem banco) com
 * cada um dos 5 perfis. Regra: onde o front esconde (capacidade falsa em `permissionsFor`, ouro do código real), o servidor tem de responder 403;
 * nenhum perfil pode ter MAIS acesso que o front. Onde o front permite e o servidor nega 403 sem ser pelo escopo próprio, a linha é listada como
 * "mais restritiva" (informativo). A taróloga em `propria` age só no seu `tarotId`: o de outro tarólogo também tem de ser 403.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

for (const f of ['AGENDA', 'HORARIOS', 'PRESENCA', 'CADASTROS', 'CONTAS', 'CONFIG', 'CONSULTA', 'PAGAMENTOS', 'PRECOS', 'RESTRICOES', 'FICHA', 'PENDENCIAS', 'RECADOS', 'DIVERGENCIAS', 'ESTADO_FINANCEIRO', 'PAINEL', 'CLIENTES']) process.env[`GF_FATIA_${f}`] = 'true';
process.env.LEGADO_DB_HOST = '127.0.0.1'; process.env.LEGADO_DB_PORT = '1'; process.env.LEGADO_DB_NAME = 'verificacao_offline'; process.env.LEGADO_DB_USER = 'verificacao'; process.env.LEGADO_DB_PASSWORD = '';
delete process.env.GATE_B_ORIGEM; process.env.FADAS_ENVIRONMENT = 'test'; process.env.FADAS_ORIGIN = 'https://gestao.exemplo';

const { criarGate } = require('../../src/gestao-fadas/gate');
const tabela = require('./rotas-permissoes');
const PERFIS = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];
const COOKIE = `__Host-gf_session=${'A'.repeat(43)}`;

async function rodar() {
  const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'ouro-permissoes.json'), 'utf8'));
  let perfilAtual = 'administradora'; let tarotAtual;
  const provedor = { validar: async () => ({ status: 'identity', sessionId: 's1', identity: { userId: '42', displayName: 'Teste', role: perfilAtual, expiresAt: '2030-01-01T00:00:00.000Z', ...(tarotAtual ? { tarotId: tarotAtual } : {}) } }), login: async () => null, logout: async () => null, sessao: async () => null };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: provedor, verificarLegado: async () => true }));
  const servidor = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}/api`;
  const resultado = { linhas: 0, negados: 0, permitidos: 0, falhas: [], maisRestritivas: [] };
  try {
    for (const linha of tabela) {
      for (const perfil of PERFIS) {
        const front = linha.cap === 'so-administradora' ? perfil === 'administradora' : linha.cap === 'so-tarologa' ? false : Boolean(ouro.perfis[perfil][linha.cap]);
        const escopoProprio = perfil === 'tarologa' && linha.propria;
        const esperaPermitir = front || escopoProprio;
        for (const outro of escopoProprio && typeof linha.propria === 'string' ? [false, true] : [false]) {
          perfilAtual = perfil; tarotAtual = perfil === 'tarologa' ? (outro ? 'nyx' : linha.propria === 'osiris' ? 'osiris' : 'osiris') : undefined;
          const r = await fetch(`${base}${linha.caminho}`, { method: linha.metodo, headers: { cookie: COOKIE, 'content-type': 'application/json', origin: 'https://gestao.exemplo' }, ...(linha.metodo === 'GET' ? {} : { body: '{}' }) });
          const status = r.status; resultado.linhas += 1;
          const alvoPermitido = esperaPermitir && !outro;
          if (!alvoPermitido) { resultado.negados += 1; if (status !== 403) resultado.falhas.push(`${perfil}${outro ? ' (outro tarotId)' : ''} ${linha.metodo} ${linha.caminho}: o front esconde e o servidor respondeu ${status} (esperado 403)`); }
          else { resultado.permitidos += 1; if (status === 403) resultado.maisRestritivas.push(`${perfil} ${linha.metodo} ${linha.caminho}`); }
        }
      }
    }
  } finally { await new Promise((r) => servidor.close(r)); try { await require('../../src/models/legado').encerrarLegado(); } catch (_e) { /* sem legado */ } }
  return resultado;
}

module.exports = { rodar };
if (require.main === module) rodar().then((r) => { console.log(JSON.stringify({ ...r, falhas: r.falhas.length, maisRestritivas: r.maisRestritivas.length })); console.log(r.falhas.join('\n')); console.log('mais restritivas:', r.maisRestritivas.join('\n  ')); process.exit(0); });
