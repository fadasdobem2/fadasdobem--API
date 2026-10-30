'use strict';

/** Compara o porte dos Recados com o ouro gerado do código do front: toda transição legítima da tela é aceita e reproduzida; o resto é recusado. */

const fs = require('fs');
const path = require('path');
const d = require('../../src/gestao-fadas/_comum/dominio/recados');
const { aplicar, IGNORADAS } = require('../../src/gestao-fadas/_comum/dominio/recados-aplicar');

const sem = (n) => { const c = { ...n }; for (const k of IGNORADAS) delete c[k]; return c; };
const servidor = (a) => ({ id: a.id, papel: a.role, nome: a.name, tarotId: a.tarotId });

function verificar(arquivo = path.join(__dirname, 'ouro-recados-front.json')) {
  const ouro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const falhas = []; let ok = 0;
  const marcar = (nome, bom, extra) => { if (bom) ok += 1; else falhas.push(`${nome}: ${extra || ''}`.slice(0, 400)); };
  for (const c of ouro.casos) {
    const conta = servidor(ouro.contas[c.perfil]);
    const pedido = c.depois || c.pedidoRuim;
    if (!pedido) continue;
    const antes = (c.antes || []).find((n) => n.id === pedido.id);
    const agora = (pedido.importance && pedido.importance.at) || pedido.updatedAt || pedido.at || '2026-10-12T11:00:00.000Z';
    let r; let falhou = null;
    try { r = aplicar({ antes, pedido, conta, agora, todas: c.antes || [], pessoalAntes: null }); } catch (e) { falhou = e; }
    if (c.erro) { marcar(`${c.nome} (recusa do front)`, Boolean(falhou && falhou instanceof d.RecadoInvalidoError), falhou ? falhou.message : 'o porte aceitou'); continue; }
    if (falhou) { marcar(c.nome, false, `o porte recusou: ${falhou.message}`); continue; }
    if (c.tipo === 'pessoal') {
      const p = r.pessoal;
      marcar(c.nome, Boolean(p.lido || p.fixado || p.prioridade || p.arquivado), JSON.stringify(p));
    } else marcar(c.nome, d.igual(sem(r.item), sem(pedido)), `porte ${JSON.stringify(sem(r.item))} x front ${JSON.stringify(sem(pedido))}`);
  }
  for (const v of ouro.visibilidade) {
    const a = servidor(ouro.contas[v.conta]);
    marcar(`visivel ${v.nota.id} ${v.conta}`, d.visivel(v.nota, a) === v.ok, 'visibilidade diferente');
  }
  return { ok, falhas, total: ok + falhas.length };
}
module.exports = { verificar };
