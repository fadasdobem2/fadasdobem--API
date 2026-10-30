'use strict';

/** Recusas de segurança do `criar-contas-equipe`: ambiente, banco, caminhos. Nada aqui abre conexão. */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const BANCOS_LEGADO = ['fadasdobem', 'fadasdobem01', 'fadasdobem02', 'fadasdobem_add3', 'fadasdobem_add4', 'fadasdobem_add5'];

const dentroDoRepo = (arquivo) => { const rel = path.relative(RAIZ, path.resolve(arquivo)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };

/** Devolve a lista de motivos de recusa (vazia = pode seguir). */
function recusas(args, env) {
  const m = [];
  if (env.NODE_ENV === 'production' && !args['confirmo-producao']) m.push('NODE_ENV=production exige --confirmo-producao (confirme que é o PostgreSQL novo da API A e que existe backup).');
  if (`${env.DADOS_TESTE_ENABLED || ''}`.toLowerCase() === 'true') m.push('DADOS_TESTE_ENABLED=true: ambiente de teste com senha pública; recusado.');
  if (`${env.GF_NOVOS_DADOS || ''}`.toLowerCase() === 'mysql') m.push('GF_NOVOS_DADOS=mysql: as contas ficam no PostgreSQL; este comando não grava no MySQL.');
  const nome = `${env.DB_NAME || ''}`.trim().toLowerCase();
  const url = `${env.DATABASE_URL || ''}`.trim();
  if (BANCOS_LEGADO.includes(nome)) m.push(`o banco conectado (${nome}) é o legado ASP; recusado.`);
  if (`${env.DB_PORT || ''}`.trim() === '3306' || /^mysql/i.test(url)) m.push('a conexão aponta para MySQL (legado); este comando só grava no PostgreSQL novo.');
  if (nome && nome === `${env.LEGADO_DB_NAME || ''}`.trim().toLowerCase()) m.push('DB_NAME é igual a LEGADO_DB_NAME; recusado.');
  if (!nome && !url) m.push('banco não configurado (DB_NAME ou DATABASE_URL).');
  return m;
}

function conferirCaminhos(args) {
  const m = [];
  if (!args.arquivo && !args._[0]) m.push('informe o arquivo de contas: node scripts/criar-contas-equipe.js <contas.json|csv> --saida=<credenciais.csv>');
  const entrada = args._[0] || args.arquivo;
  if (entrada) {
    if (!fs.existsSync(entrada)) m.push('arquivo de contas não encontrado.');
    else if (dentroDoRepo(entrada)) m.push('o arquivo de contas está DENTRO do repositório; mantenha fora (contém e-mails da equipe).');
  }
  if (!args.saida || args.saida === true) m.push('informe --saida=<arquivo de credenciais> (fora do repositório, ainda inexistente).');
  else {
    if (dentroDoRepo(args.saida)) m.push('--saida está DENTRO do repositório; recusado (guarda senhas).');
    if (fs.existsSync(args.saida)) m.push('--saida já existe; informe um caminho novo (não sobrescrevo credenciais).');
    if (!fs.existsSync(path.dirname(path.resolve(args.saida)))) m.push('a pasta de --saida não existe.');
  }
  return m;
}

module.exports = { recusas, conferirCaminhos, dentroDoRepo, BANCOS_LEGADO, RAIZ };
