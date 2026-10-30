'use strict';

/**
 * Teste DIFERENCIAL das gravações do Gestão Fadas: a A contra a B, offline (sem rede, sem banco). As fixtures de ouro em
 * src/gestao-fadas/fontes/ouro-validacao/ foram geradas pelo código real da B (scripts/gerar-ouro-gf-diferencial-b.js);
 * aqui só se confere a A contra elas:
 *   1. validação de entrada (fuzz determinístico: corpos, segmentos, history-access): aceito/recusado, status, código,
 *      texto e entrada entregue ao store;
 *   2. DTOs de resposta (acordo, abertura) a partir das mesmas linhas de banco simuladas, chave por chave e na mesma ordem;
 *   3. regras do store: traço de SQL (ordem dos FOR UPDATE inclusive), saídas e tabelas finais em cenários compartilhados.
 *   node scripts/verificar-gf-diferencial-b.js
 */

// As linhas simuladas têm o formato do MySQL (nomes vêm de gf_auth_accounts): o diferencial roda no modo mysql.
process.env.GF_NOVOS_DADOS = 'mysql';

const fs = require('node:fs');
const path = require('node:path');

const ouroDir = path.join(__dirname, '..', 'src', 'gestao-fadas', 'fontes', 'ouro-validacao');
const ouro = (nome) => JSON.parse(fs.readFileSync(path.join(ouroDir, nome), 'utf8'));
const { verificarGravacoes, verificarAmpliacao } = require('./apoio-gf-diferencial/dif-validacao');
const { verificarDto } = require('./apoio-gf-diferencial/dif-dto');
const { verificarStore } = require('./apoio-gf-diferencial/dif-store');

let falhas = 0;
function relatar(titulo, r) {
  const ruim = r.divergencias.length;
  console.log(`  ${ruim ? 'FALHOU' : 'ok    '} ${titulo}: ${r.iguais}/${r.total} iguais${r.aceitos !== undefined ? `, ${r.aceitos} aceitos` : ''}${r.conhecidas ? `, ${r.conhecidas} divergências conhecidas (achado da B, ver dif-validacao.js)` : ''}`);
  for (const d of r.divergencias.slice(0, 8)) console.log(`    - ${d}`);
  if (ruim > 8) console.log(`    ... mais ${ruim - 8}`);
  if (ruim) falhas += 1;
}

async function main() {
  console.log('Diferencial A x B (offline)');
  const validacao = ouro('validacao.json');
  relatar('validação das gravações (commission, schedule, openings, confirm, correct)', await verificarGravacoes(validacao));
  relatar('history-access (corpo, id, motivo, repetição por chave)', await verificarAmpliacao(ouro('ampliacao.json')));
  relatar('DTOs de acordo e abertura (mesmas linhas de banco)', await verificarDto(ouro('dto.json')));
  relatar('regras do store (traço de SQL, saídas, tabelas)', await verificarStore(ouro('store.json')));
  if (falhas) {
    console.log(`\n${falhas} grupo(s) com divergência.`);
    process.exit(1);
  }
  console.log('\nTudo igual à B (fora as divergências conhecidas).');
}
main().catch((e) => { console.error(e); process.exit(1); });
