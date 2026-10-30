'use strict';

/** Repete, pelo gate e no Postgres, os passos do ouro do SERVIÇO do cadastro de tarólogo (Maturacao/44) e compara status e corpo normalizado. */

const fs = require('fs');
const path = require('path');
const { normalizar } = require('./servico-ouro');

function diferencas(a, b, caminho = '', saida = []) {
  if (JSON.stringify(a) === JSON.stringify(b) || saida.length > 8) return saida;
  if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diferencas(a[k], b[k], `${caminho}.${k}`, saida); return saida; }
  saida.push(`${caminho}: servidor=${JSON.stringify(a)} front=${JSON.stringify(b)}`); return saida;
}

async function rodarServico({ chamar, como, sequelize, passo, assert }) {
  const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'ouro-servico.json'), 'utf8'));
  await sequelize.query('TRUNCATE gf_cadastros_tarologo_links, gf_cadastros_tarologo_envios, gf_cadastros_tarologo CASCADE');
  await sequelize.query("DELETE FROM gf_auditoria WHERE acao IN ('cadastros.tarologo.salvar', 'cadastros.tarologo.aprovar')"); // as chaves de auditoria são id+revisão: o ouro reusa os mesmos ids
  await sequelize.query("DELETE FROM gf_tarologos_perfil WHERE tarot_id IN ('tarot-cadastro-1', 'tarot-outro')");
  const ids = {}; const tokens = {};
  await passo(`serviço do cadastro de tarólogo: ${ouro.passos.length} passos iguais ao registration-service do front (status e corpo)`, async () => {
    for (const p of ouro.passos) {
      if (p.op === 'avancar') { await sequelize.query("UPDATE gf_cadastros_tarologo_links SET expira_em = now() - interval '1 day'"); continue; }
      como(p.quem === 'adm' ? 'administradora' : 'atendente');
      const sub = (t) => t.replace(/@id:([A-Z])/g, (_, k) => ids[k]).replace(/@token:([A-Z])/g, (_, k) => tokens[k]);
      const corpo = p.corpo ? JSON.parse(sub(JSON.stringify(p.corpo))) : undefined;
      const r = await chamar(p.m, `/tarologos-cadastro${sub(p.query || '')}`, corpo);
      if (p.guardar && p.guardar.id && r.j) ids[p.guardar.id] = r.j.id;
      if (p.guardar && p.guardar.token && r.j && r.j.url) tokens[p.guardar.token] = r.j.url.split('token=')[1];
      const simbolos = [...Object.entries(ids).map(([k, v]) => [`<id:${k}>`, v]), ...Object.entries(tokens).map(([k, v]) => [`<token:${k}>`, v])];
      const obtido = normalizar(r.j, simbolos);
      assert.equal(r.status, p.status, `${p.n}: status ${r.status} (front ${p.status}) ${r.t}`);
      assert.ok(JSON.stringify(obtido) === JSON.stringify(p.esperado) || diferencas(obtido, p.esperado).length === 0, `${p.n}: corpo diferente do front | ${diferencas(obtido, p.esperado).join(' | ')}`);
    }
  });
}

module.exports = { rodarServico };
