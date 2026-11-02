'use strict';

/** Compara o porte (`_comum/dominio/migracao-planilha.js` + `financeiro-saldo.js`) com o ouro gerado do CÓDIGO do front. Devolve `{ ok, falhas }`. */

const fs = require('fs');
const path = require('path');
const dom = require('../../src/gestao-fadas/_comum/dominio/migracao-planilha');
const saldo = require('../../src/gestao-fadas/_comum/dominio/financeiro-saldo');

function verificar(arquivo = path.join(__dirname, 'ouro-migracao-front.json')) {
  const ouro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const falhas = []; let ok = 0;
  const marcar = (nome, bom, detalhe = '') => { if (bom) ok += 1; else if (falhas.length < 40) falhas.push(`${nome} ${detalhe}`); };

  ouro.contas.forEach((c, k) => {
    marcar(`válido #${k}`, dom.historicoValido(c.historico) === c.valido);
    if (!c.valido) return;
    const e = c.esperado;
    const linhas = dom.linhasDaConta(c.clientId, c.pagamentos, c.consultas);
    marcar(`abertura #${k}`, dom.aberturaEmCentavos(c.historico) === e.abertura, `${dom.aberturaEmCentavos(c.historico)} x ${e.abertura}`);
    // As linhas do servidor são as da conta do front, mesma quantidade e mesmos valores (a ordem não importa para o corte, só o conjunto).
    const nossos = linhas.map((l) => Math.round(l.value * 100)).sort((a, b) => a - b);
    const deles = [...e.valores].sort((a, b) => a - b);
    marcar(`valores das linhas #${k}`, JSON.stringify(nossos) === JSON.stringify(deles), `${nossos} x ${deles}`);
    const offset = dom.offsetDaAbertura(c.historico, linhas);
    marcar(`offset #${k}`, Math.round(offset * 100) === Math.round(e.offset * 100), `${offset} x ${e.offset}`);
    const conta = saldo.contaDaCliente(c.clientId, c.pagamentos, c.consultas, offset);
    marcar(`saldo da conta #${k}`, Math.round(conta.balance * 100) === Math.round(e.saldoDaConta * 100), `${conta.balance} x ${e.saldoDaConta}`);
    // Saldo da ficha = abertura da planilha + linhas depois do corte (migrationCurrentStory).
    const depois = linhas.filter((l) => dom.depoisDoCorte(c.historico, l));
    const ficha = (dom.aberturaEmCentavos(c.historico) + depois.reduce((s, l) => s + Math.round(l.value * 100), 0)) / 100;
    marcar(`saldo da ficha #${k}`, Math.round(ficha * 100) === Math.round(e.saldoDaFicha * 100), `${ficha} x ${e.saldoDaFicha}`);
    marcar(`conta = ficha #${k}`, Math.round(conta.balance * 100) === Math.round(ficha * 100), `${conta.balance} x ${ficha}`);
    marcar(`linhas depois do corte #${k}`, depois.length === e.linhasDepoisDoCorte && linhas.length - depois.length === e.linhasAntes);
  });

  ouro.validade.forEach((v, k) => marcar(`validade #${k}`, dom.historicoValido(v.historico) === v.valido, `${dom.historicoValido(v.historico)} x ${v.valido}`));
  ouro.datas.forEach((d) => marcar(`parseMigrationDate "${d.texto}"`, dom.parseMigrationDate(d.texto) === d.valor, `${dom.parseMigrationDate(d.texto)} x ${d.valor}`));

  ouro.lotes.forEach((l, k) => {
    let nosso;
    try { nosso = { ...dom.aplicarLote(l.antes, JSON.parse(JSON.stringify(l.lote))) }; } catch (e) { nosso = { erro: e.message }; }
    if (l.erro) { marcar(`lote #${k} recusa`, nosso.erro === l.erro, `${nosso.erro} x ${l.erro}`); return; }
    if (nosso.erro) { marcar(`lote #${k} aceita`, false, nosso.erro); return; }
    const final = {};
    for (const [id, rows] of Object.entries(l.antes)) final[id] = rows.map((x) => x.sourceKey);
    for (const h of nosso.novos) (final[h.clientId] = final[h.clientId] || []).push(h.sourceKey);
    marcar(`lote #${k} resultado`, JSON.stringify(Object.entries(final).sort()) === JSON.stringify(Object.entries(l.depois).sort()), `${JSON.stringify(final)} x ${JSON.stringify(l.depois)}`);
  });
  return { ok, falhas };
}

module.exports = { verificar };
if (require.main === module) { const s = verificar(); console.log(`${s.ok} ok, ${s.falhas.length} falhas`); s.falhas.forEach((f) => console.log(' ', f)); process.exit(s.falhas.length ? 1 : 0); }
