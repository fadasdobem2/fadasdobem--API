'use strict';

/**
 * Verifica as regras que eram classe B na matriz (Maturacao/40) e viraram A (Maturacao/44): Agenda, Horários, Cadastro de tarólogo, Contas,
 * edição de cliente e perfil do tarólogo, contra o OURO do CÓDIGO REAL do front (scripts/apoio-gf-regras-b/ouro-*.json) e contra mutantes que
 * o servidor tem de recusar; mais a tabela de PERMISSÕES POR PERFIL (gate real, 5 perfis). Offline: sem banco. Regerar o ouro:
 *   node scripts/gerar-ouro-gf-regras-b.js --front=<pasta do front>
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { permissoesDoPerfil } = require('../src/gestao-fadas/_comum/politica-acesso');

const apoio = (n) => path.join(__dirname, 'apoio-gf-regras-b', n);
let falhou = 0;
const relatorio = (nome, r, extra = '') => {
  const resumo = Object.entries(r).filter(([k, v]) => typeof v === 'number' && k !== 'falhas').map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`${nome}: ${resumo}${extra}${r.falhas.length ? '' : ' (0 divergências)'}`);
  if (r.falhas.length) { falhou += r.falhas.length; console.error(`  ${r.falhas.length} divergências; primeiras:\n  ${r.falhas.slice(0, 12).join('\n  ')}`); }
};

(async () => {
  const agenda = require(apoio('conferir-agenda')).conferir();
  relatorio('agenda', agenda, ` mutantes recusados=${agenda.mutantes - agenda.mutantesAceitos.length}/${agenda.mutantes}`);
  if (agenda.mutantesAceitos.length || agenda.falhasDeMutante.length) { falhou += 1; console.error(`  mutantes aceitos: ${agenda.mutantesAceitos.join('; ')} ${agenda.falhasDeMutante.join('; ')}`); }
  assert.ok(agenda.aceitos > 8000 && agenda.criacoes >= 150, 'ouro da agenda menor que o esperado');
  relatorio('horarios', require(apoio('conferir-horarios')).conferir());
  relatorio('cadastro de tarologo', require(apoio('conferir-cadastro')).conferir());
  relatorio('contas', require(apoio('conferir-contas')).conferir());
  relatorio('edicao de cliente', require(apoio('conferir-clientes')).conferir());
  relatorio('perfil do tarologo (inativar)', require(apoio('conferir-tarologos')).conferir());

  // Permissões: a capacidade de cada perfil igual à do front (todas as 32 capacidades x 5 perfis) e a tabela por rota pelo gate real.
  const ouroPerm = JSON.parse(fs.readFileSync(apoio('ouro-permissoes.json'), 'utf8'));
  let capacidades = 0; const difCap = [];
  for (const [perfil, caps] of Object.entries(ouroPerm.perfis)) { const s = permissoesDoPerfil(perfil); for (const k of new Set([...Object.keys(caps), ...Object.keys(s)])) { capacidades += 1; if (Boolean(caps[k]) !== Boolean(s[k])) difCap.push(`${perfil}.${k}`); } }
  relatorio('permissoes: capacidades por perfil', { capacidades, falhas: difCap });
  const matriz = await require(apoio('matriz-permissoes')).rodar();
  relatorio('permissoes: rotas pelo gate (5 perfis)', { linhas: matriz.linhas, negados: matriz.negados, permitidos: matriz.permitidos, maisRestritivas: matriz.maisRestritivas.length, falhas: matriz.falhas });
  // Recorte "só recentes" (doc 40, item 37): é apresentação; busca, filtro e data de lançamento mostram o histórico inteiro, então o servidor não corta.
  const rec = ouroPerm.recorte;
  assert.strictEqual(rec.semBusca, 30); assert.ok(rec.filtroInformados === ouroPerm.totalDePagamentos && rec.adminSemCorte === ouroPerm.totalDePagamentos && rec.comBusca > 0);
  console.log(`recorte "so recentes" (front real): sem busca ${rec.semBusca} linhas; com filtro ${rec.filtroInformados} de ${ouroPerm.totalDePagamentos}; com busca ${rec.comBusca}; administradora ${rec.adminSemCorte}`);
  if (falhou) { console.error(`\n${falhou} divergências no total.`); process.exit(1); }
  console.log('\nregras B -> A: tudo igual ao código do front.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
