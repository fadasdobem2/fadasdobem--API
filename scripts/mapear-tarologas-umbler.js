'use strict';

/**
 * Mapeia cada taróloga ativa ao contato dela na Umbler, pelo telefone (item 1 e 3 da lista de integração da Lilly). SOMENTE LEITURA por padrão:
 *   node scripts/mapear-tarologas-umbler.js [--saida relatorio.json] [--tarologas arquivo.json] [--pausa-ms 250]
 * Lê as tarólogas ativas do Gestão (ou de `--tarologas`), procura cada telefone com o provider da Umbler (GET /v1/contacts/phone/), escreve o relatório
 * JSON (padrão `scripts/saida/tarologas-umbler.json`, fora do git) e mostra a tabela. Telefones sempre mascarados. Nada é gravado, nem na Umbler.
 *   node scripts/mapear-tarologas-umbler.js --aplicar aprovado.json --ator <uuid-do-usuario-da-A> [--simular]
 * Grava `umblerContact` só dos itens com `"aprovar": true`. Precisa de GESTAO_FADAS_ESCRITA_ENABLED=true e do banco novo. Ver README da feature Lilly.
 * Variáveis: UMBLER_API_TOKEN e UMBLER_ORGANIZATION_ID (leitura). Para aplicar, nenhuma credencial da Umbler é usada.
 */

const fs = require('fs');
const path = require('path');
const { mapear, tabela } = require('./apoio-mapear-tarologas-umbler/mapeamento');
const { mascarar } = require('./apoio-mapear-tarologas-umbler/telefone');

function argumentos(argv) {
  const a = { simular: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--simular') a.simular = true;
    else if (['--saida', '--tarologas', '--pausa-ms', '--aplicar', '--ator'].includes(k)) { a[k.slice(2).replace(/-ms$/, 'Ms')] = argv[i + 1]; i += 1; } else throw new Error(`Argumento desconhecido: ${k}`);
  }
  return a;
}

async function modoRelatorio(a) {
  const fontes = require('./apoio-mapear-tarologas-umbler/fontes');
  const tarologas = a.tarologas ? fontes.doArquivo(a.tarologas) : await fontes.doBanco();
  // Só a leitura por telefone é entregue ao mapeamento: a escrita da Umbler (nota) nem fica ao alcance.
  const { buscarContatoPorTelefone } = require('../src/providers/umbler/umbler.client');
  const relatorio = await mapear({ tarologas, provider: { buscarContatoPorTelefone }, pausaMs: Number(a.pausaMs || 250) });
  const saida = a.saida || path.join(__dirname, 'saida', 'tarologas-umbler.json');
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, `${JSON.stringify(relatorio, null, 2)}\n`);
  console.log(tabela(relatorio));
  console.log(`\nRelatório (sem telefones completos): ${saida}\nNada foi gravado.`);
}

async function modoAplicar(a) {
  const fontes = require('./apoio-mapear-tarologas-umbler/fontes');
  const { aplicar, lerAprovados } = require('./apoio-mapear-tarologas-umbler/aplicar');
  const { gravarPerfil } = fontes.gf('features/cadastros/tarologos.service');
  const r = await aplicar({ itens: lerAprovados(a.aplicar), ator: a.ator, simular: a.simular, catalogo: fontes.catalogoAtual, gravarPerfil });
  console.log(`${a.simular ? 'SIMULAÇÃO (nada gravado). ' : ''}Gravados: ${r.gravados.length}; já iguais: ${r.jaIguais.length}; simulados: ${r.simulados.length}; ignorados: ${r.ignorados.length}.`);
  for (const i of r.ignorados) console.log(`  ignorado ${i.tarotId}: ${i.motivo}`);
}

if (require.main === module) {
  (async () => {
    const a = argumentos(process.argv.slice(2));
    if (a.aplicar) await modoAplicar(a); else await modoRelatorio(a);
    process.exit(0);
  })().catch((e) => { console.error(`Falhou: ${mascararMensagem(e && e.message)}`); process.exit(1); });
}

/** Mensagens de erro nunca levam telefone completo para o log. */
function mascararMensagem(m) { return `${m || 'erro'}`.replace(/\+?\d[\d\s().-]{8,}\d/g, (t) => mascarar(t)); }

module.exports = { argumentos, mascararMensagem };
