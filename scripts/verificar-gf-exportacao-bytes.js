'use strict';

/**
 * Verificação OFFLINE (sem banco, sem rede, sem o repo da B) de que o .xlsx dos builders da A é BYTE A BYTE o da B.
 * As fixtures em src/gestao-fadas/fontes/ouro-exportacao/ guardam as linhas de entrada (cortes no formato dos models) e o
 * sha256 do arquivo que os builders da B geraram para elas (readAt fixo, sem relógio). Aqui a A gera o seu e compara.
 *
 *   node scripts/verificar-gf-exportacao-bytes.js
 */

const assert = require('node:assert/strict');
const { createHash } = require('crypto');
const ouro = require('../src/gestao-fadas/fontes/ouro-exportacao/exportacao-ouro.json');

process.env.LEGADO_DB_HOST = process.env.LEGADO_DB_HOST || '127.0.0.1';
process.env.LEGADO_DB_NAME = process.env.LEGADO_DB_NAME || 'verificacao_offline';
process.env.LEGADO_DB_USER = process.env.LEGADO_DB_USER || 'verificacao';

const { realExportFile } = require('../src/gestao-fadas/_comum/exportacao');
const { exportacaoDeConsultas } = require('../src/gestao-fadas/features/consultas/consultas.exportacao');
const { exportacaoDeRecebimentos } = require('../src/gestao-fadas/features/pagamentos/pagamentos.exportacao');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const copia = (x) => JSON.parse(JSON.stringify(x));
let ok = 0;
let falhas = 0;

function caso(nome, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  ok  ${nome}`);
  } catch (e) {
    falhas += 1;
    console.log(`  FALHOU  ${nome}\n${e && e.message}`);
  }
}

const grupos = [
  ['consultas', ouro.consultas, exportacaoDeConsultas],
  ['recebimentos', ouro.recebimentos, exportacaoDeRecebimentos],
];

assert.ok(ouro.consultas.length >= 5 && ouro.recebimentos.length >= 4, 'fixtures de ouro incompletas');

for (const [tipo, lista, construir] of grupos) {
  for (const c of lista) {
    caso(`${tipo}: ${c.nome} (sha256 e nome do arquivo iguais aos da B)`, () => {
      const sheet = construir(copia(c.entrada));
      const bytes = Buffer.from(realExportFile(sheet));
      assert.equal(sheet.filename, c.filename);
      assert.equal(bytes.length, c.tamanho);
      assert.equal(sha(bytes), c.sha256);
    });
  }
}

// Controle negativo: a verificação enxerga uma mudança de um centavo e de uma palavra (não é uma comparação vazia).
caso('controle: mudar um valor de consulta muda o hash', () => {
  const c = ouro.consultas[0];
  const entrada = copia(c.entrada);
  entrada.cut.finished[0].recordedAmount = '100.01';
  assert.notEqual(sha(Buffer.from(realExportFile(exportacaoDeConsultas(entrada)))), c.sha256);
});
caso('controle: mudar a situação de um recebimento muda o hash', () => {
  const c = ouro.recebimentos[0];
  const entrada = copia(c.entrada);
  entrada.cut.receipts[0].situation = 'informado';
  assert.notEqual(sha(Buffer.from(realExportFile(exportacaoDeRecebimentos(entrada)))), c.sha256);
});

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
