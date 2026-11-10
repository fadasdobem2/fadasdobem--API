#!/usr/bin/env node
'use strict';

/**
 * Importa a EQUIPE INTERNA de um JSON temporário (fora do repositório) criando contas PENDENTES de acesso pelo serviço oficial de contas
 * (o mesmo do POST /accounts, sem senha: convite aberto no banco, NENHUM e-mail enviado).
 *
 *   node scripts/importar-equipe.js --arquivo <pessoas.json>                      simular (padrão): valida tudo, não grava, não abre banco
 *   node scripts/importar-equipe.js --arquivo <pessoas.json> --simular --com-banco  idem + conflitos com contas existentes (SÓ LEITURA)
 *   node scripts/importar-equipe.js --arquivo <pessoas.json> --gravar [--so-validas] [--ator=<e-mail da administradora>] [--usar-nome=completo|fada]
 *
 * JSON: [{ nome, nomeFada, cargo, email, whatsapp }]. Saída mascara e-mail e telefone. Gravar: recusa se houver problema (a não ser com
 * --so-validas, que cria só as pessoas sem problema), é idempotente (chave de operação fixa por e-mail; repetir não duplica) e cada conta
 * é uma transação do serviço (usuário, papel, gf_contas_ext, convite, gf_operacoes e auditoria juntos). WhatsApp e nome de fada são
 * validados mas NÃO gravados: o serviço oficial de contas não tem esses campos. Só PostgreSQL novo; recusa o legado e GF_EMAIL_ENVIO_ENABLED=true.
 * Código de saída: 0 sem problema; 1 há problema/conflito/falha; 2 recusa de segurança ou uso.
 */

const fs = require('fs');
const path = require('path');

const args = {};
const COM_VALOR = ['arquivo', 'ator', 'usar-nome', 'env'];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
  if (!m) continue;
  if (m[2] === undefined && COM_VALOR.includes(m[1]) && argv[i + 1] && !argv[i + 1].startsWith('--')) { args[m[1]] = argv[i + 1]; i += 1; } else args[m[1]] = m[2] === undefined ? true : m[2];
}

const sair = (cod, msg) => { if (msg) console.error(msg); process.exit(cod); };

(async () => {
  const gravar = Boolean(args.gravar);
  if (gravar && args.simular) sair(2, 'Use --simular OU --gravar, não os dois.');
  const arquivo = args.arquivo && args.arquivo !== true ? args.arquivo : null;
  const usarNome = args['usar-nome'] === 'fada' ? 'fada' : 'completo';
  const guardas = require('./apoio-gf-contas-equipe/guardas');
  if (!arquivo || !fs.existsSync(arquivo)) sair(2, 'Informe --arquivo <pessoas.json> (arquivo existente).');
  if (guardas.dentroDoRepo(arquivo)) sair(2, 'RECUSADO: o arquivo está DENTRO do repositório; contém dados pessoais.');

  const usaBanco = gravar || Boolean(args['com-banco']);
  if (usaBanco) {
    const dotenv = require('dotenv');
    if (args.env && args.env !== true) { try { for (const [k, v] of Object.entries(dotenv.parse(fs.readFileSync(args.env)))) if (process.env[k] === undefined) process.env[k] = v; } catch (_) { sair(2, 'Não consegui ler --env.'); } }
    dotenv.config({ path: path.join(__dirname, '..', '.env') });
    process.env.DB_LOGGING = 'false';
    const recusas = guardas.recusas(args, process.env);
    if (`${process.env.GF_EMAIL_ENVIO_ENABLED || ''}`.toLowerCase() === 'true') recusas.push('GF_EMAIL_ENVIO_ENABLED=true: a importação não pode rodar com envio de e-mail ligado.');
    if (recusas.length) { console.error('RECUSADO:'); recusas.forEach((r) => console.error(`  - ${r}`)); process.exit(2); }
  }

  const ent = require('./apoio-importar-equipe/entrada');
  let pessoas;
  try { pessoas = ent.validarPessoas(ent.lerArquivo(arquivo)); } catch (e) { sair(2, `Arquivo inválido: ${String(e.message).slice(0, 200)}`); }

  let achados = new Map(); let ator = null;
  const banco = usaBanco ? require('./apoio-importar-equipe/banco') : null;
  if (usaBanco) { const c = await banco.checar(pessoas, { ator: args.ator }); achados = c.achados; ator = c.ator; }

  const estadoDe = (p) => {
    const a = achados.get(p.n) || {};
    if (p.problemas.length) return { s: 'PROBLEMA', m: p.problemas.join('; ') };
    if (a.estado === 'conflito') return { s: 'CONFLITO', m: a.motivo };
    if (a.estado === 'ja-importada') return { s: 'JA-IMPORTADA', m: 'conta já criada por esta importação (nada a fazer)' };
    return { s: 'OK', m: `criaria ${p.papel} com acesso pendente` };
  };
  console.log(`${gravar ? 'GRAVAR' : 'SIMULAR (nada é gravado)'} | ${pessoas.length} pessoa(s) | conflitos com contas existentes: ${usaBanco ? 'checados' : 'NÃO checados (use --com-banco)'}`);
  const tot = { OK: 0, PROBLEMA: 0, CONFLITO: 0, 'JA-IMPORTADA': 0 };
  const prontas = [];
  for (const p of pessoas) {
    const e = estadoDe(p); tot[e.s] += 1; if (e.s === 'OK') prontas.push(p);
    console.log(`  #${String(p.n).padStart(2)} ${e.s.padEnd(12)} ${(p.nome.split(' ')[0] || '?').padEnd(10)} cargo=${p.cargoOriginal || '-'} -> ${p.papel || '?'} | ${ent.mascararEmail(p.emailBruto)} | ${ent.mascararFone(p.fone.texto || '')} | ${e.m}`);
  }
  console.log(`Totais: ok ${tot.OK}, problemas ${tot.PROBLEMA}, conflitos ${tot.CONFLITO}, já importadas ${tot['JA-IMPORTADA']}.`);
  const ruins = tot.PROBLEMA + tot.CONFLITO;
  if (!gravar) process.exit(ruins ? 1 : 0);
  if (!ator) sair(2, 'Não há administradora ativa para assinar a operação (informe --ator=<e-mail>).');
  if (ruins && !args['so-validas']) sair(1, 'Nada foi gravado: há problema/conflito. Resolva, ou use --so-validas para criar apenas as pessoas sem problema.');
  console.log(`Criando ${prontas.length} conta(s) pelo serviço oficial (sem enviar e-mail)...`);
  const r = await banco.criar(prontas, ator, usarNome, console.log);
  console.log(`Resumo: criadas ${r.criadas}, falhas ${r.falhas}, puladas por problema/conflito ${ruins}, já importadas ${tot['JA-IMPORTADA']}.`);
  process.exit(r.falhas || ruins ? 1 : 0);
})().catch((e) => { console.error(`ERRO: ${String(e && e.message).slice(0, 300)}`); process.exit(1); });
