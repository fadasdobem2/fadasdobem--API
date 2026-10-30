'use strict';

/**
 * Verificação OFFLINE do módulo `src/gestao-fadas` (sem banco legado, sem Redis):
 *   - dia operacional (06:00 a 06:00, São Paulo) e validações de entrada;
 *   - o módulo só é montado com GESTAO_FADAS_ENABLED=true;
 *   - toda rota exige login (401 sem cookie), inclusive /status.
 *
 *   node scripts/verificar-gestao-fadas.js
 */

const assert = require('assert');

process.env.LEGADO_DB_HOST = process.env.LEGADO_DB_HOST || '127.0.0.1';
process.env.LEGADO_DB_NAME = process.env.LEGADO_DB_NAME || 'verificacao_offline';
process.env.LEGADO_DB_USER = process.env.LEGADO_DB_USER || 'verificacao';

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const errorHandler = require('../src/middlewares/errorHandler.middleware');
const notFound = require('../src/middlewares/notFound.middleware');

const dia = require('../src/gestao-fadas/_comum/dia-operacional');
const v = require('../src/gestao-fadas/_comum/validacao');

let ok = 0;
const passou = (m) => {
  ok += 1;
  console.log(`  ok  ${m}`);
};

function montar(habilitado) {
  process.env.GESTAO_FADAS_ENABLED = habilitado ? 'true' : 'false';
  delete require.cache[require.resolve('../src/routes')];
  delete require.cache[require.resolve('../src/gestao-fadas')];
  const routes = require('../src/routes');
  const app = express();
  app.use(cookieParser());
  app.use('/api', routes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

(async () => {
  /* Dia operacional */
  assert.strictEqual(dia.hojeOperacional(new Date('2026-10-29T08:59:00Z')), '2026-10-28'); // 05:59 em SP
  assert.strictEqual(dia.hojeOperacional(new Date('2026-10-29T09:00:00Z')), '2026-10-29'); // 06:00 em SP
  assert.strictEqual(dia.hojeOperacional(new Date('2026-10-30T02:59:00Z')), '2026-10-29'); // 23:59 em SP
  assert.deepStrictEqual(dia.intervaloDoDia('2026-10-29'), { inicio: '2026-10-29 06:00:00', fim: '2026-10-30 06:00:00' });
  assert.deepStrictEqual(dia.intervaloDoDia('2026-10-31'), { inicio: '2026-10-31 06:00:00', fim: '2026-11-01 06:00:00' });
  assert.deepStrictEqual(dia.intervaloDoDia('2026-12-31'), { inicio: '2026-12-31 06:00:00', fim: '2027-01-01 06:00:00' });
  assert.deepStrictEqual(dia.intervaloDoPeriodo('2026-10-27', '2026-10-29'), { inicio: '2026-10-27 06:00:00', fim: '2026-10-30 06:00:00' });
  passou('dia operacional: 05:59 ainda é o dia anterior; 06:00 vira o dia; viradas de mês e ano');

  /* Validações */
  assert.strictEqual(v.idLegado('12'), 12);
  for (const ruim of ['0', '-1', 'abc', '1.5', '99999999999', '', undefined, '1 OR 1=1']) assert.throws(() => v.idLegado(ruim), /inválido/);
  assert.deepStrictEqual(v.periodo({ inicio: '2026-10-01', fim: '2026-10-31' }, 31), { inicio: '2026-10-01', fim: '2026-10-31' });
  assert.throws(() => v.periodo({ inicio: '2026-10-01', fim: '2026-11-15' }, 31), /no máximo 31 dias/);
  assert.throws(() => v.periodo({ inicio: '2026-10-31', fim: '2026-10-01' }), /anterior/);
  assert.throws(() => v.dataCivil('2026-02-30', 'inicio'), /não é uma data válida/);
  assert.throws(() => v.dataCivil('29/10/2026', 'inicio'), /AAAA-MM-DD/);
  assert.deepStrictEqual(v.paginacao({ pagina: '3', limite: '9999' }, { max: 50 }), { pagina: 3, limite: 50, offset: 100 });
  assert.strictEqual(v.likeLiteral('50%_x'), '%50\\%\\_x%');
  passou('validações: IDs, datas, período máximo, paginação e escape de LIKE');

  /* Gate: módulo desligado */
  const desligado = montar(false);
  const r0 = await request(desligado).get('/api/v1/gestao-fadas/status');
  assert.strictEqual(r0.status, 404, 'com a flag desligada a rota não pode existir');
  passou('GESTAO_FADAS_ENABLED desligada: rotas do módulo não existem (404)');

  /* Gate: módulo ligado, sem login. As rotas vêm do próprio roteador (nenhuma fica de fora). */
  const ligado = montar(true);
  const roteador = require('../src/gestao-fadas/gestao-fadas.routes');
  const rotas = [];
  (function andar(pilha, prefixo) {
    for (const camada of pilha) {
      if (camada.route) {
        for (const metodo of Object.keys(camada.route.methods)) rotas.push({ metodo, caminho: prefixo + camada.route.path });
      } else if (camada.name === 'router' && camada.handle.stack) {
        const m = camada.regexp.toString().match(/\\\/([a-z-]+)\\\/\?\(\?=/i);
        andar(camada.handle.stack, prefixo + (m ? `/${m[1]}` : ''));
      }
    }
  })(roteador.stack, '');
  assert.ok(rotas.length >= 13, `o roteador deveria ter pelo menos 13 rotas, achei ${rotas.length}`);
  for (const rota of rotas) {
    const url = `/api/v1/gestao-fadas${rota.caminho.replace(/\/+$/, '').replace(/:[A-Za-z]+/g, '1')}`;
    const r = await request(ligado)[rota.metodo](url);
    assert.strictEqual(r.status, 401, `${rota.metodo.toUpperCase()} ${url} sem login deveria ser 401, veio ${r.status}`);
    assert.strictEqual(r.body.sucesso, false);
  }
  passou(`módulo ligado: as ${rotas.length} rotas (GET e POST) respondem 401 sem login (nenhum dado vaza)`);

  console.log(`\nVERIFICAÇÃO OK (${ok} grupos de checagem). Nenhuma conexão com o legado foi aberta.`);
  process.exit(0);
})().catch((e) => {
  console.error('\nFALHOU:', e.stack || e.message);
  process.exit(1);
});
