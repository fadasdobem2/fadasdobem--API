'use strict';

/**
 * Teste REAL (somente leitura) dos serviços do módulo gestao-fadas contra um banco de DESENVOLVIMENTO.
 * Credenciais SOMENTE por variáveis de ambiente (nada no código):
 *   LEGADO_DB_HOST=... LEGADO_DB_PORT=3306 LEGADO_DB_NAME=... LEGADO_DB_USER=... LEGADO_DB_PASSWORD=... node scripts/testar-gestao-fadas-banco.js
 * NUNCA aponte para produção sem decisão registrada. Não faz nenhuma tentativa de escrita. Não imprime dados pessoais.
 */
const faltando = ['LEGADO_DB_HOST', 'LEGADO_DB_NAME', 'LEGADO_DB_USER', 'LEGADO_DB_PASSWORD'].filter((k) => !process.env[k]);
if (faltando.length) {
  console.error('Faltam variáveis de ambiente:', faltando.join(', '));
  process.exit(2);
}
const raiz = require('path').join(__dirname, '..');
const { iniciarLegado, encerrarLegado } = require(raiz + '/src/models/legado');
const F = raiz + '/src/gestao-fadas/features';
const forma = (v) => Array.isArray(v) ? `array(${v.length})` : v && typeof v === 'object' ? `{${Object.keys(v).slice(0, 12).join(',')}}` : typeof v;
async function passo(nome, fn) {
  try { const r = await fn(); console.log(`  OK    ${nome}\n          ${typeof r === 'string' ? r : forma(r)}`); return r; }
  catch (e) { console.log(`  FALHA ${nome}\n          ${e.name}${e.statusCode ? ' ' + e.statusCode : ''}: ${String(e.message).replace(/'[^']*'@'[^']*'/g, "'***'@'***'").slice(0, 170)}`); return null; }
}
(async () => {
  const { models } = iniciarLegado();
  const per = { start: '2026-10-20', end: '2026-10-29' };
  console.log('== Consultas');
  const cons = await passo('consultas.listar (20/10 a 29/10)', () => require(F + '/consultas/consultas.service').listar(per, new Date()));
  if (cons) console.log(`          emCurso=${cons.inProgress.length} finalizadas=${cons.finished.length} abertasDesdeAntes=${(cons.openSinceEarlier.items || cons.openSinceEarlier).length} totals=${JSON.stringify(cons.totals)} page=${JSON.stringify(cons.page)}`);
  if (cons && cons.finished[0]) console.log('          campos de 1 consulta:', Object.keys(cons.finished[0]).join(','), '| tipos:', JSON.stringify(Object.fromEntries(Object.entries(cons.finished[0]).filter(([k]) => /amount|minutes|Amount|Minutes|start|end/i.test(k)).map(([k, v]) => [k, typeof v + (typeof v === 'string' ? `(${v.length}c)` : '')]))));
  console.log('\n== Pagamentos (recebimentos, regra R5)');
  const pag = await passo('pagamentos.listar by=paid', () => require(F + '/pagamentos/pagamentos.service').listar({ ...per, by: 'paid' }));
  if (pag) console.log(`          recebimentos=${pag.receipts.length} summary=${JSON.stringify(pag.summary)}`);
  const sd = await passo('pagamentos.listarSemDataPaga', () => require(F + '/pagamentos/pagamentos.service').listarSemDataPaga({}));
  if (sd) console.log(`          semData=${sd.receipts.length} counts=${JSON.stringify(sd.counts)}`);
  console.log('\n== Tarólogos');
  const tars = await passo('tarologos.listar', () => require(F + '/tarologos/tarologos.service').listar({}));
  const tid = tars && tars[0] ? tars[0].id : null;
  if (tars) console.log(`          total=${tars.length} ativos=${tars.filter((t) => t.active === true).length}`);
  if (tid) await passo(`tarologos.obter(${tid})`, () => require(F + '/tarologos/tarologos.service').obter(tid, {}));
  await passo('tarologos.listar ?incluir=extensao (tabela gf_tarologos_ext não existe no 01)', () => require(F + '/tarologos/tarologos.service').listar({ incluir: 'extensao' }));
  console.log('\n== Repasse (gf_repasse_* existem, vazias)');
  if (tid) { await passo(`repasse.acordo(${tid})`, () => require(F + '/repasse/repasse.service').acordo(tid)); await passo(`repasse.aberturas(${tid})`, () => require(F + '/repasse/repasse.service').aberturas(tid)); }
  console.log('\n== Clientes');
  const model = require(F + '/clientes/clientes.model');
  const cs = require(F + '/clientes/clientes.service');
  const nowLocal = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 19);
  const plano = (() => { try { return model.planRealClientList('administradora', {}, nowLocal); } catch (e) { console.log('  (plano falhou:', e.message.slice(0, 100), ')'); return null; } })();
  if (plano) { const lista = await passo('clientes.listar (administradora, recorte padrão)', () => cs.listar(plano.plan || plano)); if (lista) console.log(`          clientes=${(lista.clients || []).length}`); }
  const cli = await models.LegadoUsuario.findOne({ where: { nivel: 0 }, attributes: ['id'], raw: true });
  if (cli) await passo(`clientes.obter(id ${cli.id})`, () => cs.obter({ role: 'administradora', clientId: String(cli.id), nowLocal }));
  console.log('\n== Formato bruto devolvido pelo driver (typeCast de datas, DECIMAL)');
  const amostra = await models.LegadoConsulta.findOne({ attributes: ['iniConsulta', 'fimConsulta', 'valor_consulta', 'tmpConsulta'], order: [['idConsulta', 'DESC']], raw: true });
  if (amostra) console.log('          ', JSON.stringify(Object.fromEntries(Object.entries(amostra).map(([k, v]) => [k, `${typeof v}${typeof v === 'string' ? ':' + v.length + 'c' : ''}`]))), '| ex. data:', String(amostra.iniConsulta).replace(/\d/g, '9'));
  await encerrarLegado();
})().catch((e) => { console.log('ERRO GERAL:', e.name, String(e.message).slice(0, 200)); process.exit(1); });
