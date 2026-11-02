'use strict';

/**
 * Página `/dados-teste`: tudo que se precisa para testar o ambiente local (endereços, contas de teste e senha,
 * o que cada perfil enxerga, banco, comandos e rotas). SÓ existe fora de produção e com DADOS_TESTE_ENABLED=true;
 * mostra a senha de teste, por isso nunca deve ser ligada em ambiente real.
 */

const { Router } = require('express');
const { lerSenhaTeste, CONTAS } = require('./contas-teste');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const VISAO = {
  administradora: 'Tudo: consultas, recebimentos, tarólogos, clientes (com histórico), repasse (acordo e abertura) e exportações.',
  assistente: 'Consultas, recebimentos, tarólogos, clientes e leitura de repasse. Não altera acordo nem abertura.',
  supervisora: 'Clientes (pode ampliar o histórico). Consultas, recebimentos, tarólogos e repasse respondem 403.',
  atendente: 'Clientes no recorte do atendimento. Consultas, recebimentos, tarólogos e repasse respondem 403.',
  tarologa: 'Sem acesso às telas operacionais do suspiro pelo gate (a área da taróloga é do sistema completo).',
};

function pagina(env) {
  const SENHA_PADRAO = lerSenhaTeste();
  const porta = env.PORT || '4010';
  const api = `http://127.0.0.1:${porta}`;
  const front = env.FADAS_ORIGIN || 'http://127.0.0.1:5180';
  const flags = [
    ['GESTAO_FADAS_ENABLED', env.GESTAO_FADAS_ENABLED], ['GESTAO_FADAS_GATE_ENABLED', env.GESTAO_FADAS_GATE_ENABLED], ['GATE_SESSAO', env.GATE_SESSAO || 'proxy-b'],
    ['FADAS_ENVIRONMENT', env.FADAS_ENVIRONMENT], ['GESTAO_FADAS_ESCRITA_ENABLED', env.GESTAO_FADAS_ESCRITA_ENABLED], ['Banco da API (Postgres)', env.DB_NAME],
    ['Legado (somente leitura)', env.LEGADO_DB_NAME ? `${env.LEGADO_DB_NAME} (DEV)` : 'não configurado'], ['Redis', `${env.REDIS_HOST || '-'}:${env.REDIS_PORT || '-'}`],
  ];
  const linhasContas = CONTAS.map((c) => `<tr><td><b>${esc(c.nome)}</b><br><small>${esc(c.nota)}</small></td>
    <td><code>${esc(c.email)}</code> <button data-copia="${esc(c.email)}">copiar</button>${c.usuarioMock ? `<br><small>no mock: usuário <code>${esc(c.usuarioMock)}</code></small>` : ''}</td>
    <td>${esc(c.perfil)}${c.rbac.length ? `<br><small>RBAC: ${esc(c.rbac.join(', '))}</small>` : ''}</td>
    <td>${c.ativa ? '<span class="ok">ativa</span>' : '<span class="no">inativa (login recusado)</span>'}</td>
    <td><small>${esc(VISAO[c.perfil])}</small></td></tr>`).join('');
  const linhasFlags = flags.map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(v ?? '(vazio)')}</td></tr>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dados de teste</title>
<style>
:root{--bg:#faf8fc;--card:#fff;--ink:#2a2338;--mut:#6b6280;--line:#e5e0ee;--acc:#5b3d9e;--ok:#1f7a4d;--no:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#17131f;--card:#201a2c;--ink:#ece8f5;--mut:#a79fba;--line:#352d46;--acc:#b79cf2;--ok:#5fd39a;--no:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}h1{margin:0 0 4px}h2{margin:32px 0 10px;font-size:18px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;overflow-x:auto}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-weight:600;font-size:13px}
code,pre{font-family:ui-monospace,monospace;font-size:13px}pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;overflow-x:auto}
small{color:var(--mut)}a{color:var(--acc)}button{font:inherit;font-size:12px;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:6px;padding:2px 8px;cursor:pointer}
.ok{color:var(--ok);font-weight:600}.no{color:var(--no);font-weight:600}.pill{display:inline-block;padding:1px 8px;border-radius:99px;border:1px solid var(--line);font-size:12px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}.card{border:1px solid var(--line);border-radius:10px;padding:12px}
.aviso{border-left:4px solid var(--no);padding:8px 12px;background:var(--bg);border-radius:6px}
</style></head><body><main>
<h1>Dados de teste</h1><p><small>Ambiente local. Valores só de teste, nada de produção. Esta página só existe fora de produção.</small></p>
<div class="aviso">Banco legado: o de <b>DEV</b>, somente leitura. A gravação no legado está ${env.GESTAO_FADAS_ESCRITA_ENABLED === 'true' ? '<b>LIGADA</b>' : 'desligada'}.</div>

<h2>Endereços</h2><section><div class="grid">
<div class="card"><b>Front real</b> <span class="pill" data-ping="${esc(front)}">verificando</span><br><a href="${esc(front)}" target="_blank" rel="noopener">${esc(front)}</a><br><small>build Node em modo real; <code>/api</code> vai à API.</small></div>
<div class="card"><b>Front demonstração</b> <span class="pill" data-ping="http://127.0.0.1:5173">verificando</span><br><a href="http://127.0.0.1:5173" target="_blank" rel="noopener">http://127.0.0.1:5173</a><br><small>dados de exemplo do mock (não usa a API).</small></div>
<div class="card"><b>API A</b> <span class="pill" data-ping="${esc(api)}/api/ping">verificando</span><br><a href="${esc(api)}/api/ops/health" target="_blank" rel="noopener">${esc(api)}/api/ops/health</a><br><small>contrato HTTP da B em <code>/api/auth</code>, <code>/api/operations</code>, <code>/api/payouts</code>.</small></div>
</div></section>

<h2>Contas de teste</h2><section>
<p>Senha de todas: <code id="senha">${esc(SENHA_PADRAO)}</code> <button data-copia="${esc(SENHA_PADRAO)}">copiar</button> <small>(o login da API usa o e-mail; no mock era usuário ${esc(CONTAS.filter((c) => c.usuarioMock).map((c) => c.usuarioMock).join(' e '))}).</small></p>
<table><thead><tr><th>Conta</th><th>Acesso</th><th>Perfil</th><th>Situação</th><th>O que enxerga</th></tr></thead><tbody>${linhasContas}</tbody></table></section>

<h2>Dados reais do legado de DEV para olhar</h2><section><ul>
<li>Cliente <code>900013</code> (ficha, consultas e recebimentos): <code>/api/operations/clients/900013</code></li>
<li>Tarólogo <code>9001</code> (acordo e aberturas de repasse): <code>/api/payouts/agreements/9001</code></li>
<li>Listas: <code>/api/operations/consultations</code>, <code>/api/operations/receipts</code>, <code>/api/operations/receipts/undated</code>, <code>/api/operations/tarologists</code>, <code>/api/operations/clients?q=maria</code></li>
<li>Os dados do legado de DEV são fictícios; o banco de produção não é acessado por este ambiente.</li></ul></section>

<h2>Configuração em uso</h2><section><table><tbody>${linhasFlags}</tbody></table></section>

<h2>Testar na linha de comando</h2><section><pre>curl -s -c jar.txt -X POST ${esc(api)}/api/auth/login \\
  -H 'content-type: application/json' -H 'origin: ${esc(front)}' \\
  -d '{"identifier":"laya@fadasdobem.test","password":"${esc(SENHA_PADRAO)}"}'
curl -s -b jar.txt ${esc(api)}/api/auth/session
curl -s -b jar.txt ${esc(api)}/api/operations/consultations</pre></section>

<h2>Comandos (pasta Fadasdobem--API)</h2><section><pre>npm run api:local -- --cnf=&lt;Arquivos/mysql-acessos.cnf&gt; --secao=client-dev            # sobe a API
npm run api:local -- --cnf=... --secao=client-dev --migrar                              # migra e semeia as contas
npm run front:gate -- --api=${esc(api)} --front=&lt;NovoCodigo/fadasdobemsuspiro--FRONT&gt;   # sobe o front real
npm run verificar:legado &amp;&amp; npm run verificar:financeiro                                 # verificações</pre></section>

<h2>Limitações conhecidas do ambiente</h2><section><ul>
<li>Telas sem rota na API ainda mostram o que o front trouxer do mock até a integração delas.</li>
<li>Tarólogas do mock são slugs (osiris, nyx...); o vínculo com os IDs do legado (ex.: 9001) ainda não existe.</li>
<li>Gravações (repasse, exportação, ampliar histórico) dependem de <code>GESTAO_FADAS_ESCRITA_ENABLED</code> e de uma conta de auditoria; estão desligadas por padrão.</li></ul></section>
</main>
<script>
document.querySelectorAll('[data-copia]').forEach(function(b){b.addEventListener('click',function(){navigator.clipboard&&navigator.clipboard.writeText(b.dataset.copia);var t=b.textContent;b.textContent='copiado';setTimeout(function(){b.textContent=t},1200)})});
document.querySelectorAll('[data-ping]').forEach(function(p){var ac=new AbortController();setTimeout(function(){ac.abort()},4000);
fetch(p.dataset.ping,{mode:'no-cors',signal:ac.signal}).then(function(){p.textContent='no ar';p.className='pill ok'}).catch(function(){p.textContent='fora do ar';p.className='pill no'})});
</script></body></html>`;
}

function criarRotaDadosTeste(env = process.env) {
  const router = Router();
  router.get('/', (_req, res) => {
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src http://127.0.0.1:* http://localhost:*; base-uri 'none'" });
    res.send(pagina(env));
  });
  return router;
}

/** Monta em `/dados-teste` só fora de produção e com DADOS_TESTE_ENABLED=true. */
function dadosTesteHabilitado(env = process.env) {
  return env.NODE_ENV !== 'production' && env.DADOS_TESTE_ENABLED === 'true';
}

module.exports = { criarRotaDadosTeste, dadosTesteHabilitado };
