'use strict';

/**
 * FILHO de scripts/verificar-gf-lilly-integracao.js: roda contra o Postgres DESCARTÁVEL (fdb_lillyi_*) já migrado. Cada arquivo `casos-*.js`
 * cuida de um assunto e recebe o contexto do ambiente. Legado, Umbler e IA são falsos; nenhum dado real.
 */

const { conferir, passo, resumo } = require('../apoio-gf-banco-novo/comum');
const { criarAmbiente } = require('./ambiente');

const CASOS = (process.env.CASOS_INTEGRACAO || 'casos-snapshot,casos-eventos,casos-validate,casos-execute-flag,casos-execute-agenda,casos-execute-cadastro,casos-execute-consulta,casos-execute-pagamento,casos-reconcilia,casos-erros,casos-runtime').split(',');

(async () => {
  const log = console.log;
  const erro = console.error;
  let amb;
  try {
    amb = await criarAmbiente();
    await require('./semear-extra').semearExtra(amb);
    log('Ambiente: router real da Lilly (API) + FadasAdapter real (Nice) + Postgres descartável semeado.');
    const ctx = { ...amb, conferir, passo, log };
    console.info = () => {}; console.warn = () => {};
    for (const caso of CASOS) { console.error = () => {}; await require(`./${caso}`)(ctx); console.error = erro; }
  } catch (e) {
    console.error = erro; log(`  FALHOU  inesperado: ${e.stack}`); resumo().falhas.push('inesperado');
  }
  console.error = erro;
  if (amb) await amb.fechar();
  const { ok, falhas } = resumo();
  log(`\n${ok} verificações passaram, ${falhas.length} falharam.`);
  process.exit(falhas.length ? 1 : 0);
})();
