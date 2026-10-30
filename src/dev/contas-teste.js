'use strict';

/**
 * Contas de TESTE do ambiente local (espelham as contas do mock do front em features/demo/data.ts e
 * features/auth/auth-experience.tsx). Fonte única do seed (`scripts/seed-gestao-fadas-local.js`) e da página
 * `/dados-teste`. Valores só de teste, nunca usar fora do ambiente local.
 */

const fs = require('fs');
const path = require('path');

/**
 * A senha de teste NÃO fica no repositório. Vem de `SEED_LOCAL_SENHA` ou do arquivo local (fora do git)
 * `.local-dev/senha-teste.txt`, com a primeira linha sendo a senha (12+ caracteres).
 */
function lerSenhaTeste() {
  if (process.env.SEED_LOCAL_SENHA) return process.env.SEED_LOCAL_SENHA;
  try {
    const arq = path.join(__dirname, '..', '..', '.local-dev', 'senha-teste.txt');
    const v = fs.readFileSync(arq, 'utf8').split('\n')[0].trim();
    if (v) return v;
  } catch (_) { /* cai no erro abaixo */ }
  throw new Error('Defina SEED_LOCAL_SENHA ou crie .local-dev/senha-teste.txt com a senha de teste local (fora do git).');
}

/** Senha única das contas de teste (12+ caracteres, com maiúscula, minúscula, número e símbolo). */
const SENHA_PADRAO = lerSenhaTeste();

/**
 * `usuarioMock`: o usuário do mock do front (login "laya" / "osiris"); `perfil`: o perfil da B que o gate devolve;
 * `rbac`/`produto`: o que a A grava; `tarot`: slug da taróloga no mock; `ativa: false` espelha a conta inativa do mock.
 */
const CONTAS = [
  { chave: 'laya', usuarioMock: 'laya', nome: 'Administradora Demo', email: 'laya@fadasdobem.test', perfil: 'administradora', rbac: ['admin'], produto: 'GESTORA', ativa: true, nota: 'Admin do mock (usr-laya).' },
  { chave: 'assistente', nome: 'Assistente Demo', email: 'assistente@fadasdobem.test', perfil: 'assistente', rbac: ['assistente'], produto: 'GESTORA', ativa: true, nota: 'Financeiro/assistente (usr-assistente).' },
  { chave: 'clara', nome: 'Supervisora Demo', email: 'clara@fadasdobem.test', perfil: 'supervisora', rbac: ['supervisora'], produto: 'ATENDENTE', ativa: true, nota: 'Supervisora (usr-clara).' },
  { chave: 'khloe', nome: 'Atendente Demo', email: 'khloe@fadasdobem.test', perfil: 'atendente', rbac: ['atendente'], produto: 'ATENDENTE', ativa: true, nota: 'Atendente (usr-khloe).' },
  { chave: 'osiris', usuarioMock: 'osiris', nome: 'Osíris', email: 'osiris@fadasdobem.test', perfil: 'tarologa', rbac: [], produto: 'TAROLOGA', ativa: true, tarot: 'osiris', comissao: '30.00', nota: 'Taróloga com login no mock (usr-osiris).' },
  { chave: 'nyx', nome: 'Nyx Luna', email: 'nyx@fadasdobem.test', perfil: 'tarologa', rbac: [], produto: 'TAROLOGA', ativa: true, tarot: 'nyx', comissao: '30.00', nota: 'Taróloga (usr-nyx).' },
  { chave: 'iolanda', nome: 'Iolanda', email: 'iolanda@fadasdobem.test', perfil: 'tarologa', rbac: [], produto: 'TAROLOGA', ativa: false, tarot: 'iolanda', comissao: '30.00', nota: 'Taróloga INATIVA: o login deve ser recusado (usr-iolanda).' },
  { chave: 'estrela', nome: 'Estrela', email: 'estrela@fadasdobem.test', perfil: 'tarologa', rbac: [], produto: 'TAROLOGA', ativa: true, tarot: 'estrela', comissao: '30.00', nota: 'Perfil fictício para testar a área da taróloga (usr-estrela).' },
];

/** Contas genéricas criadas antes por perfil; o seed as remove para não duplicar. */
const EMAILS_ANTIGOS = ['administradora', 'assistente', 'supervisora', 'atendente'].map((p) => `${p}@fadasdobem.test`).filter((e) => !CONTAS.some((c) => c.email === e));

module.exports = { SENHA_PADRAO, CONTAS, EMAILS_ANTIGOS };
