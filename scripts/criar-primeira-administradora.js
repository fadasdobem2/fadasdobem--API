#!/usr/bin/env node
'use strict';

/**
 * Cria a PRIMEIRA administradora de um ambiente novo (banco PostgreSQL da API A vazio de contas).
 * Existe porque `criar-contas-equipe` exige uma administradora ativa para assinar a operação, e `seed:access` só atribui o
 * papel a um usuário que já existe. Depois desta conta, as demais saem por `npm run contas:equipe`.
 *
 *   node scripts/criar-primeira-administradora.js --nome="Nome" --email=<e-mail> --saida=<credenciais.csv> [--executar] [--confirmo-producao]
 *
 * Modo ENSAIO por padrão (só mostra o que faria). Recusa se já existe alguma administradora ativa (use contas:equipe) ou se o e-mail
 * já está em uso. Mesmas recusas de ambiente/banco do `criar-contas-equipe` (nunca MySQL legado; nunca com DADOS_TESTE_ENABLED=true).
 * A senha temporária é aleatória e forte, só em memória e no arquivo --saida (modo 600, novo, fora do repositório); nunca impressa.
 * Pré-requisito: `npm run migrate` e `npm run seed:access` já rodados (o papel "admin" precisa existir).
 */

const fs = require('fs');
const bcrypt = require('bcryptjs');

const args = { _: [] };
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2]; else args._.push(a);
}

(async () => {
  const guardas = require('./apoio-gf-contas-equipe/guardas');
  const entrada = require('./apoio-gf-contas-equipe/entrada');

  const recusas = guardas.recusas(args, process.env);
  if (!args.saida || args.saida === true) recusas.push('informe --saida=<arquivo de credenciais> (fora do repositório, ainda inexistente).');
  else {
    if (fs.existsSync(args.saida)) recusas.push('--saida já existe; informe um caminho novo (não sobrescrevo credenciais).');
    if (guardas.conferirCaminhos({ ...args, _: [__filename] }).some((r) => /--saida está DENTRO/.test(r))) recusas.push('--saida está DENTRO do repositório; recusado (guarda senhas).');
  }
  const { contas, erros } = entrada.validar([{ nome: args.nome === true ? '' : args.nome, email: args.email === true ? '' : args.email, papel: 'administradora' }]);
  erros.forEach((e) => recusas.push(e));
  if (recusas.length) { console.error('RECUSADO:'); recusas.forEach((r) => console.error(`  - ${r}`)); process.exit(2); }
  const conta = contas[0];

  process.env.DB_LOGGING = 'false';
  const { sequelize } = require('../src/config/database');
  const { User, AccessRole } = require('../src/models');
  const store = require('../src/gestao-fadas/features/contas/contas.store');
  const dom = require('../src/gestao-fadas/_comum/dominio/contas');
  await sequelize.authenticate();

  const linhas = await store.lerLinhas();
  if (linhas.some((l) => l.perfil === 'administradora' && l.ativo)) {
    console.error('RECUSADO: já existe uma administradora ativa. Use "npm run contas:equipe" com --ator=<e-mail dela>.');
    process.exit(2);
  }
  if (await store.emailEmUso(conta.email)) { console.error('RECUSADO: esse e-mail já está em uso.'); process.exit(2); }
  const papel = dom.PAPEIS_DA_A.administradora;
  if (!(await AccessRole.findOne({ where: { id: papel.rbac[0] } }))) { console.error('RECUSADO: papel "admin" ausente. Rode antes "npm run seed:access".'); process.exit(2); }

  console.log(`${args.executar ? 'EXECUÇÃO' : 'ENSAIO (nada será gravado; use --executar para gravar)'}: criaria a primeira administradora ${conta.email}.`);
  if (!args.executar) { process.exit(0); }

  const senha = entrada.senhaTemporaria();
  const custo = require('../src/features/auth/auth.constants').AUTH_CONFIG.bcryptCostPassword || 12;
  const hash = await bcrypt.hash(senha, custo);
  await sequelize.transaction(async (t) => {
    const usuario = await User.create({ email: conta.email, password_hash: hash, role: papel.produto, is_active: true, email_verified_at: new Date() }, { transaction: t });
    await store.definirPapeis(usuario, papel.rbac, t);
    await store.nomeStaff(usuario.id, conta.nome, t);
  });
  const fd = fs.openSync(args.saida, 'wx', 0o600);
  fs.fchmodSync(fd, 0o600);
  fs.writeSync(fd, `# Senha TEMPORARIA. Entregue em canal seguro, troque no primeiro acesso e APAGUE este arquivo.\nnome;email;papel;senha_temporaria\n${conta.nome};${conta.email};Administradora;${senha}\n`);
  fs.fsyncSync(fd); fs.closeSync(fd);
  console.log('Primeira administradora criada. Senha temporária gravada SOMENTE no arquivo de saída (modo 600).');
  await sequelize.close().catch(() => {});
  process.exit(0); // o Redis compartilhado mantém o processo aberto
})().catch((e) => { console.error(`ERRO: ${String(e && e.message).slice(0, 300)}`); process.exit(1); });
