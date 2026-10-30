'use strict';

/**
 * Gera o OURO das regras classe B (Maturacao/44) a partir do CÓDIGO REAL do front, por grupo, em scripts/apoio-gf-regras-b/ouro-<grupo>.json:
 *   node scripts/gerar-ouro-gf-regras-b.js --front=<pasta do front> [--grupo=agenda,horarios,cadastros,contas,clientes]
 * Relógio injetado, sem Intl na regra do servidor; todo valor é fictício.
 */

const fs = require('fs');
const path = require('path');
const { abrir } = require('./apoio-gf-regras-b/front');
const { reproduzir, resumo } = require('./apoio-gf-regras-b/replay-agenda');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const GRUPOS = { agenda: './apoio-gf-regras-b/agenda-ouro', horarios: './apoio-gf-regras-b/horarios-ouro', cadastro: './apoio-gf-regras-b/cadastro-ouro', contas: './apoio-gf-regras-b/contas-ouro', clientes: './apoio-gf-regras-b/clientes-ouro', tarologos: './apoio-gf-regras-b/tarologos-ouro' };
const escolhidos = (arg('grupo') || Object.keys(GRUPOS).join(',')).split(',').filter(Boolean);

async function main() {
  if (!arg('front')) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
  const ctx = await abrir(arg('front'));
  try {
    for (const nome of escolhidos) {
      ctx.reiniciarIds();
      const r = await require(GRUPOS[nome]).gerar(ctx);
      if (nome === 'agenda') {
        // Gravamos o resumo do item do front (não o item inteiro) e conferimos já aqui o que o servidor faz com cada comando.
        let ok = 0; const quebras = [];
        for (const c of r.cenarios) {
          if (c.tipo !== 'comando') continue;
          const s = reproduzir(r.estados[c.antes], c.comandos, c.at);
          const igual = s.item && resumo(s.item) === resumo(c.depois);
          if (igual) ok += 1; else quebras.push({ acao: c.acao, erro: s.erro, antes: c.antes });
          c.resumo = resumo(c.depois); c.depoisCompleto = igual ? undefined : c.depois;
          delete c.depois;
        }
        const por = {}; for (const c of r.cenarios) por[c.tipo] = (por[c.tipo] || 0) + 1;
        console.log(`agenda: ${r.cenarios.length} cenários ${JSON.stringify(por)}; servidor igual ao front em ${ok}; divergências ${quebras.length}`);
        const porAcao = {}; for (const q of quebras) { const k = `${q.acao.split(':').slice(0, 2).join(':')} | ${q.erro || 'item diferente'}`; porAcao[k] = (porAcao[k] || 0) + 1; }
        console.log(Object.entries(porAcao).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `  ${v}x ${k}`).join('\n'));
      }
      fs.writeFileSync(path.join(__dirname, 'apoio-gf-regras-b', `ouro-${nome}.json`), JSON.stringify({ geradoDe: nome, ...r }));
    }
  } finally { await ctx.fechar(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
