#!/usr/bin/env node
'use strict';

/**
 * Smoke test pós-implantação da API A. SOMENTE LEITURA: só faz GET e lê (opcionalmente) o arquivo de ambiente.
 * Não grava, não faz login, não imprime segredos, não conecta em banco.
 *
 * Uso:
 *   node deploy/checar-implantacao.js --etapa=0 [--base=http://127.0.0.1:4010]
 *        [--env-arquivo=/etc/fadasdobem-api/api.env]   confere as flags GF_LEGADO_* e a trava (mostra só ligado/desligado)
 *        [--cookie-arquivo=/caminho/cookie.txt]        arquivo (fora do repo) com o valor do cabeçalho Cookie de uma sessão já aberta;
 *                                                      habilita a conferência de realFeatures em GET /api/auth/session
 *        [--local]                                     ambiente de ensaio: /dados-teste existindo vira AVISO, não FALHA
 *        [--timeout=8000]
 *
 * Como confere as fatias SEM login: cada fatia desligada responde 404 NOT_FOUND antes da sessão; ligada, responde 401
 * (sem sessão). Isso diferencia ligada de desligada só com GET.
 *
 * Saída: uma linha OK / FALHA / AVISO / PULADO por item e um resumo. Código de saída: 0 sem falha; 1 com falha; 2 uso ou rede.
 */

const fs = require('fs');
const path = require('path');

const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

const ETAPA = Number(ARGS.etapa);
const BASE = String(ARGS.base || 'http://127.0.0.1:4010').replace(/\/+$/, '');
const TEMPO = Number(ARGS.timeout) || 8000;
const LOCAL = Boolean(ARGS.local);

if (!Number.isInteger(ETAPA) || ETAPA < 0 || ETAPA > 3) {
  console.error('Uso: node deploy/checar-implantacao.js --etapa=0|1|2|3 [--base=URL] [--env-arquivo=ARQ] [--cookie-arquivo=ARQ] [--local]');
  process.exit(2);
}

/** Fatias do painel: flag, rota GET usada como sonda (404 = desligada, 401 = ligada) e o nome em realFeatures da sessão. */
const FATIAS = [
  { flag: 'GF_FATIA_HORARIOS', sonda: '/api/schedules', feature: 'schedules' },
  { flag: 'GF_FATIA_PRESENCA', sonda: '/api/presence', feature: 'presence' },
  { flag: 'GF_FATIA_AGENDA', sonda: '/api/agenda', feature: 'agenda' },
  { flag: 'GF_FATIA_CONSULTA', sonda: '/api/consultations', feature: 'consultation' },
  { flag: 'GF_FATIA_CADASTROS', sonda: '/api/catalog/tarologists', feature: 'cadastros' },
  { flag: 'GF_FATIA_PRECOS', sonda: '/api/pricing', feature: 'pricing' },
  { flag: 'GF_FATIA_PAGAMENTOS', sonda: '/api/payments', feature: 'payments' },
  { flag: 'GF_FATIA_RESTRICOES', sonda: null, feature: 'restrictions' },
  { flag: 'GF_FATIA_PAINEL', sonda: null, feature: 'panel' },
  { flag: 'GF_FATIA_CLIENTES', sonda: null, feature: 'clients' },
  { flag: 'GF_FATIA_RECADOS', sonda: '/api/notes', feature: 'notes' },
  { flag: 'GF_FATIA_CONTAS', sonda: '/api/accounts', feature: 'accounts' },
  { flag: 'GF_FATIA_CONFIG', sonda: null, feature: 'config' },
  { flag: 'GF_FATIA_DIVERGENCIAS', sonda: '/api/divergences', feature: 'divergences' },
  { flag: 'GF_FATIA_PENDENCIAS', sonda: '/api/pending-routing', feature: 'pending' },
  { flag: 'GF_FATIA_FICHA', sonda: '/api/client-guidance', feature: 'clientFile' },
  { flag: 'GF_FATIA_ESTADO_FINANCEIRO', sonda: '/api/financial-reasons', feature: 'financialState' },
];

/** Escrita no legado por etapa (doc Maturacao/54). Etapa 0: tudo desligado. */
const LEGADO_POR_ETAPA = {
  GF_LEGADO_ESCRITA_ENABLED: [false, true, true, true],
  GF_LEGADO_CLIENTES: [false, true, true, true],
  GF_LEGADO_TAROLOGOS: [false, true, true, true],
  GF_LEGADO_CONSULTAS: [false, false, true, true],
  GF_LEGADO_STATUS_TAROLOGO: [false, false, true, true],
  GF_LEGADO_NOTAS: [false, false, true, true],
  GF_LEGADO_PAGAMENTOS: [false, false, false, true],
};

const resultados = [];
const item = (estado, nome, detalhe = '') => {
  resultados.push({ estado, nome });
  console.log(`  ${estado.padEnd(6)} ${nome}${detalhe ? ` - ${detalhe}` : ''}`);
};

class RedeError extends Error {}

async function pegar(caminho, cabecalhos = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TEMPO);
  try {
    const r = await fetch(BASE + caminho, { method: 'GET', redirect: 'manual', signal: ctl.signal, headers: { accept: 'application/json', ...cabecalhos } });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (_) { /* não é JSON */ }
    return { status: r.status, json };
  } catch (e) {
    const causa = (e && e.cause && (e.cause.code || e.cause.message)) || e.name || 'erro';
    throw new RedeError(e.name === 'AbortError' ? `sem resposta em ${TEMPO} ms` : `falha de rede (${causa})`);
  } finally {
    clearTimeout(t);
  }
}

/** Lê só os NOMES e valores do arquivo de ambiente; nada é impresso além de ligado/desligado. */
function lerAmbiente(arquivo) {
  const texto = fs.readFileSync(arquivo, 'utf8');
  const env = {};
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(linha);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}
const ligada = (v) => `${v || ''}`.trim().toLowerCase() === 'true';

async function conferirSaude() {
  console.log('Saúde');
  const r = await pegar('/api/ops/health');
  const j = r.json || {};
  if (r.status === 200 && j.status === 'ready') item('OK', 'GET /api/ops/health pronto', `ambiente ${j.environment || 'não informado'}`);
  else item('FALHA', 'GET /api/ops/health pronto', `HTTP ${r.status}, motivo ${j.reasonCode || 'desconhecido'} (database-unavailable = legado inacessível; schema-incompatible = faltam tabelas gf_ no legado)`);
  const c = j.checks || {};
  if (c.configuration === 'ok' && c.database === 'ok' && c.schema === 'ok') item('OK', 'configuração, banco e esquema do legado conferem');
  else item('FALHA', 'configuração, banco e esquema do legado conferem', `configuration=${c.configuration} database=${c.database} schema=${c.schema}`);
  if (LOCAL) item('PULADO', 'ambiente anunciado coerente com produção', 'modo --local');
  else if (j.environment === 'prd') item('OK', 'ambiente anunciado é prd');
  else item('AVISO', 'ambiente anunciado é prd', `veio ${j.environment || 'vazio'}; em produção defina FADAS_ENVIRONMENT=production`);
}

async function conferirPublico() {
  console.log('Rotas públicas e exposição');
  const w = await pegar('/api/welcome');
  const ok = w.status === 200 && w.json && w.json.content && Array.isArray(w.json.content.greetings);
  item(ok ? 'OK' : 'FALHA', 'GET /api/welcome responde com as boas-vindas', `HTTP ${w.status}`);
  const d = await pegar('/dados-teste');
  if (d.status === 404) item('OK', '/dados-teste NÃO existe (404)');
  else if (LOCAL) item('AVISO', '/dados-teste existe neste ambiente local', `HTTP ${d.status}; em produção deve ser 404 (DADOS_TESTE_ENABLED=false)`);
  else item('FALHA', '/dados-teste NÃO existe (404)', `HTTP ${d.status}: a página de senha de teste está exposta`);
  const s = await pegar('/api/auth/session');
  item(s.status === 401 ? 'OK' : 'AVISO', 'sessão sem login responde 401 (login nativo ativo)', `HTTP ${s.status}`);
}

async function conferirFatias() {
  console.log(`Fatias do painel (etapa ${ETAPA}: todas ligadas; 404 = desligada, 401 = ligada)`);
  for (const f of FATIAS) {
    if (!f.sonda) { item('PULADO', `${f.flag}`, 'sem rota GET própria; confira por realFeatures (--cookie-arquivo) ou pelo arquivo de ambiente'); continue; }
    const r = await pegar(f.sonda);
    if (r.status === 401 || r.status === 403) item('OK', `${f.flag} ligada`, `${f.sonda} -> ${r.status}`);
    else if (r.status === 404) item('FALHA', `${f.flag} ligada`, `${f.sonda} -> 404 (fatia desligada)`);
    else item('AVISO', `${f.flag} ligada`, `${f.sonda} -> HTTP ${r.status} inesperado`);
  }
}

async function conferirSessao() {
  console.log('realFeatures da sessão');
  if (!ARGS['cookie-arquivo']) { item('PULADO', 'realFeatures anunciadas batem com a etapa', 'informe --cookie-arquivo=<arquivo com o cabeçalho Cookie de uma sessão já aberta>'); return; }
  let cookie;
  try { cookie = fs.readFileSync(ARGS['cookie-arquivo'], 'utf8').trim(); } catch (_) { item('FALHA', 'ler --cookie-arquivo', 'arquivo ilegível'); return; }
  const r = await pegar('/api/auth/session', { cookie });
  const rf = r.json && r.json.realFeatures;
  if (r.status !== 200 || !rf) { item('FALHA', 'realFeatures anunciadas batem com a etapa', `sessão devolveu HTTP ${r.status}; abra uma sessão nova e atualize o arquivo`); return; }
  const faltando = FATIAS.filter((f) => rf[f.feature] !== true).map((f) => f.feature);
  item(faltando.length ? 'FALHA' : 'OK', 'realFeatures anunciadas batem com a etapa (todas as fatias ligadas)', faltando.length ? `não anunciadas: ${faltando.join(', ')}` : `${FATIAS.length} fatias anunciadas`);
}

function conferirAmbiente() {
  console.log(`Arquivo de ambiente e escrita no legado (etapa ${ETAPA})`);
  if (!ARGS['env-arquivo']) {
    item('PULADO', `GF_LEGADO_* conforme a etapa ${ETAPA}`, 'informe --env-arquivo=/etc/fadasdobem-api/api.env (rode na VPS); sem isso NÃO está provado que a escrita no legado está desligada');
    return;
  }
  let env;
  try { env = lerAmbiente(path.resolve(ARGS['env-arquivo'])); } catch (e) { item('FALHA', 'ler o arquivo de ambiente', e.code === 'EACCES' ? 'sem permissão de leitura (rode com sudo ou como o dono)' : 'arquivo ilegível'); return; }
  try {
    const modo = fs.statSync(path.resolve(ARGS['env-arquivo'])).mode & 0o777;
    item((modo & 0o007) === 0 ? 'OK' : 'FALHA', 'arquivo de ambiente sem leitura para "outros"', `modo ${modo.toString(8)}`);
  } catch (_) { /* ignora */ }

  for (const [flag, porEtapa] of Object.entries(LEGADO_POR_ETAPA)) {
    const esperado = porEtapa[ETAPA];
    const real = ligada(env[flag]);
    item(real === esperado ? 'OK' : 'FALHA', `${flag} ${esperado ? 'ligada' : 'desligada'}`, `está ${real ? 'ligada' : 'desligada'}`);
  }
  const bancos = `${env.GF_LEGADO_ESCRITA_BANCOS || ''}`.split(',').map((b) => b.trim()).filter(Boolean);
  if (ETAPA === 0) item(bancos.length === 0 ? 'OK' : 'FALHA', 'GF_LEGADO_ESCRITA_BANCOS vazia (trava fechada)', `${bancos.length} nome(s) listado(s)`);
  else item(bancos.length ? 'OK' : 'FALHA', 'GF_LEGADO_ESCRITA_BANCOS preenchida (trava aberta de forma deliberada)', `${bancos.length} nome(s) listado(s)`);
  item(ligada(env.LEGADO_DB_READ_ONLY === undefined ? 'true' : env.LEGADO_DB_READ_ONLY) === (ETAPA === 0) ? 'OK' : 'FALHA',
    `LEGADO_DB_READ_ONLY ${ETAPA === 0 ? 'true (somente leitura)' : 'false (escrita permitida pela sessão)'}`);
  item(ligada(env.DADOS_TESTE_ENABLED) ? 'FALHA' : 'OK', 'DADOS_TESTE_ENABLED desligada');
  item(env.NODE_ENV === 'production' ? 'OK' : 'FALHA', 'NODE_ENV=production');
  item(`${env.GATE_SESSAO || ''}`.toLowerCase() === 'nativa' ? 'OK' : 'FALHA', 'GATE_SESSAO=nativa');
  item(`${env.GF_NOVOS_DADOS || 'postgres'}`.toLowerCase() === 'mysql' ? 'FALHA' : 'OK', 'dados novos no PostgreSQL (GF_NOVOS_DADOS)');
  const fatiasEnv = FATIAS.filter((f) => !ligada(env[f.flag])).map((f) => f.flag);
  item(fatiasEnv.length ? 'FALHA' : 'OK', 'todas as GF_FATIA_* ligadas no arquivo', fatiasEnv.length ? fatiasEnv.join(', ') : '');
  const segredos = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'CSRF_SECRET'].filter((n) => !env[n] || env[n].includes('<SEGREDO>'));
  item(segredos.length ? 'FALHA' : 'OK', 'JWT e CSRF preenchidos (valores não exibidos)', segredos.join(', '));
}

(async () => {
  console.log(`Conferência de implantação - etapa ${ETAPA} - ${BASE}${LOCAL ? ' (modo local)' : ''}`);
  try {
    await conferirSaude();
    await conferirPublico();
    await conferirFatias();
    await conferirSessao();
  } catch (e) {
    if (e instanceof RedeError) {
      console.error(`\nNão foi possível alcançar a API em ${BASE}: ${e.message}.`);
      console.error('Confira se o serviço está no ar (systemctl status fadasdobem-api), a porta, o Nginx e o endereço informado em --base.');
      process.exit(2);
    }
    throw e;
  }
  conferirAmbiente();

  const cont = (e) => resultados.filter((r) => r.estado === e).length;
  console.log(`\nResumo: ${cont('OK')} OK, ${cont('FALHA')} FALHA, ${cont('AVISO')} AVISO, ${cont('PULADO')} PULADO`);
  if (cont('FALHA')) { console.log('RESULTADO: FALHA. Não avance de etapa antes de resolver.'); process.exit(1); }
  console.log(cont('PULADO') ? 'RESULTADO: sem falhas, mas há itens PULADOS (não provados).' : 'RESULTADO: OK.');
})().catch((e) => { console.error('Erro inesperado:', e && e.message ? e.message : e); process.exit(2); });
