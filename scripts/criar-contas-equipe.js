#!/usr/bin/env node
'use strict';

/**
 * Cria/atualiza as contas de login da equipe a partir de um arquivo JSON ou CSV FORA do repositório.
 * Reaproveita o serviço de Contas (src/gestao-fadas/features/contas). Modo ENSAIO por padrão: só mostra o que faria.
 *
 *   npm run contas:equipe -- <contas.json|csv> --saida=<credenciais.csv> [--executar] [--redefinir-senha]
 *                            [--ator=<e-mail da administradora>] [--env=<arquivo de ambiente>] [--confirmo-producao]
 *
 * Arquivo de contas (campos): nome, email, papel (administradora|supervisora|atendente|assistente; tarologa exige tarotId),
 * opcionais tarotId e legacyId (usuarios.id do ASP; necessário para as notas da ficha na etapa 2).
 * Segurança: senha temporária aleatória forte por conta, gravada SÓ no arquivo --saida (modo 600, novo, fora do repositório);
 * nunca impressa, nunca em log nem na auditoria. Idempotente: conta existente é mantida (senha só com --redefinir-senha).
 * Recusa: NODE_ENV=production sem --confirmo-producao; banco legado/MySQL; DADOS_TESTE_ENABLED=true.
 * Código de saída: 0 sem problema; 1 problema em alguma conta ou no arquivo; 2 recusa de segurança/uso.
 */

const fs = require('fs');
const path = require('path');

const args = { _: [] };
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2]; else args._.push(a);
}

(async () => {
  const dotenv = require('dotenv');
  // Ordem: ambiente já definido > --env > .env do repositório (nenhum sobrescreve o anterior).
  if (args.env && args.env !== true) {
    try { for (const [k, v] of Object.entries(dotenv.parse(fs.readFileSync(args.env)))) if (process.env[k] === undefined) process.env[k] = v; } catch (_) { console.error('Não consegui ler --env.'); process.exit(2); }
  }
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
  process.env.DB_LOGGING = 'false'; // nada de SQL (com hashes) em log

  const guardas = require('./apoio-gf-contas-equipe/guardas');
  const recusas = [...guardas.recusas(args, process.env), ...guardas.conferirCaminhos(args)];
  if (recusas.length) { console.error('RECUSADO:'); recusas.forEach((r) => console.error(`  - ${r}`)); process.exit(2); }

  const entrada = require('./apoio-gf-contas-equipe/entrada');
  let linhas;
  try { linhas = entrada.lerArquivo(args._[0] || args.arquivo); } catch (e) { console.error(`Arquivo de contas inválido: ${e.message}`); process.exit(1); }
  const { contas, erros } = entrada.validar(linhas);
  if (erros.length) { console.error('Arquivo de contas com problemas (nada foi feito):'); erros.forEach((e) => console.error(`  - ${e}`)); process.exit(1); }

  console.log(`${args.executar ? 'EXECUÇÃO' : 'ENSAIO (nada será gravado; use --executar para gravar)'}: ${contas.length} conta(s) no arquivo.`);
  const { executar } = require('./apoio-gf-contas-equipe/executar');
  const r = await executar({ contas, args });
  console.log(`Resumo: criadas ${r.criada}, mantidas ${r.existente}, senhas redefinidas ${r.senhaRedefinida}, no ensaio ${r.ensaio}, problemas ${r.problema}.`);
  if (r.criada || r.senhaRedefinida) console.log('Senhas temporárias gravadas SOMENTE no arquivo de saída (modo 600). Entregue com segurança e apague o arquivo.');
  process.exit(r.problema ? 1 : 0); // o Redis compartilhado mantém o processo aberto
})().catch((e) => { console.error(`ERRO: ${String(e && e.message).slice(0, 300)}`); process.exit(1); });
