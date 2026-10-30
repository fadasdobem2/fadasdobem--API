'use strict';

/**
 * Cria/atualiza as contas de login reaproveitando o serviço de Contas (`features/contas/contas.service`): senha só como hash bcrypt, regras
 * de senha forte e e-mail único do front, auditoria e idempotência do serviço. A senha temporária só existe em memória e no arquivo de
 * credenciais (modo 600); NUNCA vai ao terminal, ao log nem à auditoria. Só escreve no PostgreSQL novo (nunca no legado).
 */

const fs = require('fs');
const crypto = require('crypto');
const { senhaTemporaria } = require('./entrada');

const ROTULO = { administradora: 'Administradora', assistente: 'Assistente', supervisora: 'Supervisora', atendente: 'Atendente', tarologa: 'Taróloga' };
const motivoDe = (e) => {
  if (e && e.statusCode) return `${e.statusCode} ${String(e.message || '').slice(0, 160)}`;
  return `${(e && e.name) || 'erro'} (detalhe omitido por segurança)`;
};

function abrirCredenciais(caminho) {
  const fd = fs.openSync(caminho, 'wx', 0o600); // 'wx': falha se já existir
  fs.fchmodSync(fd, 0o600);
  fs.writeSync(fd, '# Senhas TEMPORARIAS. Entregue uma a uma, em canal seguro, e APAGUE este arquivo. Peca a troca da senha no primeiro acesso.\nnome;email;papel;senha_temporaria\n');
  return fd;
}

async function executar({ contas, args, log = console.log, fechar = true }) {
  const gravar = Boolean(args.executar);
  const redefinir = Boolean(args['redefinir-senha']);
  process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; // gravação no PostgreSQL novo (o MySQL legado nunca é tocado aqui)
  const { sequelize } = require('../../src/config/database');
  const { AccessRole } = require('../../src/models');
  const store = require('../../src/gestao-fadas/features/contas/contas.store');
  const servico = require('../../src/gestao-fadas/features/contas/contas.service');
  const dom = require('../../src/gestao-fadas/_comum/dominio/contas');

  await sequelize.authenticate();
  const linhas = await store.lerLinhas();
  const porEmail = new Map(linhas.map((l) => [String(l.email).toLocaleLowerCase('pt-BR'), l]));

  // A autoria da operação é de uma administradora ativa existente (auditoria exige um usuário real).
  const admins = linhas.filter((l) => l.perfil === 'administradora' && l.ativo);
  const ator = args.ator && args.ator !== true ? admins.find((l) => String(l.email).toLocaleLowerCase('pt-BR') === String(args.ator).toLowerCase()) : admins[0];
  if (!ator) throw new Error('não há administradora ativa para assinar a operação (informe --ator=<e-mail de uma administradora ativa>; a primeira administradora vem do seed:access).');
  log(`Ator da operação (auditoria): ${ator.email}`);

  const precisaPapeis = [...new Set(contas.map((c) => dom.PAPEIS_DA_A[c.papel] && dom.PAPEIS_DA_A[c.papel].rbac[0]).filter(Boolean))];
  const existentes = (await AccessRole.findAll({ where: { id: precisaPapeis } })).map((r) => r.id);
  const faltam = precisaPapeis.filter((p) => !existentes.includes(p));
  if (faltam.length) throw new Error(`papéis de acesso ausentes (${faltam.join(', ')}): rode antes "npm run seed:access".`);

  const req = (corpo, id) => ({ user: { id: ator.id, role: 'GESTORA' }, accessContext: { roleIds: ['admin'] }, body: corpo, params: id ? { id } : {}, headers: {} });
  const chave = (p) => `${p}-${crypto.randomUUID()}`;
  const resumo = { criada: 0, ensaio: 0, existente: 0, senhaRedefinida: 0, problema: 0 };
  let fd = null;
  const gravarCredencial = (c, papel, senha) => {
    if (fd === null) fd = abrirCredenciais(args.saida);
    fs.writeSync(fd, `${c.nome};${c.email};${ROTULO[papel] || papel};${senha}\n`);
    fs.fsyncSync(fd);
  };

  try {
    for (const c of contas) {
      const atual = porEmail.get(c.email);
      try {
        if (atual) {
          const diverge = atual.perfil !== c.papel ? ` (papel atual ${atual.perfil}, no arquivo ${c.papel}: NÃO alterado)` : '';
          if (!redefinir) { resumo.existente += 1; log(`  mantida   ${c.email}: já existe${diverge}`); continue; }
          if (!gravar) { resumo.ensaio += 1; log(`  ensaio    ${c.email}: redefiniria a senha (gera nova senha temporária)${diverge}`); continue; }
          const senha = senhaTemporaria();
          await servico.trocarSenha(req({ operationKey: chave('equipe-senha'), expectedRevision: atual.revisao, password: senha }, atual.id));
          gravarCredencial(c, atual.perfil, senha);
          resumo.senhaRedefinida += 1; log(`  senha     ${c.email}: senha redefinida (sessões encerradas); credencial no arquivo de saída`);
          continue;
        }
        if (await store.emailEmUso(c.email)) { resumo.problema += 1; log(`  PROBLEMA  ${c.email}: e-mail já usado por outra conta fora da equipe`); continue; }
        if (!gravar) { resumo.ensaio += 1; log(`  ensaio    ${c.email}: criaria ${c.papel}${c.tarotId ? ` (tarotId ${c.tarotId}, vínculo conferido só na execução)` : ''}`); continue; }
        const senha = senhaTemporaria();
        const corpo = { operationKey: chave('equipe-criar'), name: c.nome, email: c.email, role: c.papel, password: senha, ...(c.tarotId ? { tarotId: c.tarotId } : {}), ...(c.legacyId ? { legacyId: c.legacyId } : {}) };
        await servico.criar(req(corpo));
        gravarCredencial(c, c.papel, senha); // se a gravação do arquivo falhar, a conta existe: use --redefinir-senha
        resumo.criada += 1; log(`  criada    ${c.email}: ${c.papel}`);
      } catch (e) {
        resumo.problema += 1; log(`  PROBLEMA  ${c.email}: ${motivoDe(e)}`);
      }
    }
  } finally {
    if (fd !== null) fs.closeSync(fd);
    if (fechar) await sequelize.close().catch(() => {});
  }
  return resumo;
}

module.exports = { executar };
