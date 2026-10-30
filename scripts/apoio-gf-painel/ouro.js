'use strict';

/** Compara o porte (fila geral, admissão, presença) com o ouro gerado do código do front. Devolve a lista de divergências. */

const fs = require('fs');
const path = require('path');
const { limpar } = require('../../src/gestao-fadas/_comum/dominio/agenda-contato');
const fg = require('../../src/gestao-fadas/_comum/dominio/fila-geral');
const base = require('../../src/gestao-fadas/_comum/dominio/fila-geral-base');
const adm = require('../../src/gestao-fadas/_comum/dominio/admissao');

const igual = (a, b) => JSON.stringify(limpar(a === undefined ? null : a)) === JSON.stringify(limpar(b === undefined ? null : b));

function contador() { let n = 0; return () => `id-${++n}`; }

function verificar(arquivo = path.join(__dirname, 'ouro-fila-geral.json')) {
  const ouro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const falhas = []; let ok = 0;
  const conferir = (nome, real, esperado) => { if (igual(real, esperado)) ok += 1; else falhas.push(`${nome}: porte ${JSON.stringify(real)} x front ${JSON.stringify(esperado)}`); };
  ouro.casos.forEach((c, k) => {
    const rot = (x) => `caso ${k} ${x}`;
    c.agenda.forEach((a, i) => {
      conferir(rot(`ativa ${a.id}`), fg.reservaAtiva(a, ouro.dia, c.agora), c.ativa[i]);
      const r = base.recessoComum(a);
      conferir(rot(`recesso ${a.id}`), r === undefined ? null : r, c.recesso[i]);
      conferir(rot(`liberadaPropria ${a.id}`), fg.liberarReservaPropria(a, 'reader', 'Equipe', c.agora), c.liberadaPropria[i]);
    });
    const alvo = c.agenda.find((a) => a.id === c.alvo);
    conferir(rot('reservas'), fg.reservas(c.agenda, 'reader', ouro.dia, c.consultas, c.agora).map((a) => a.id), c.reservas);
    conferir(rot('conflito'), (fg.conflitoDeReserva(c.agenda, c.consultas, 'reader', ouro.dia, alvo.clientId, alvo.id, c.agora) || {}).id || null, c.conflito);
    conferir(rot('conflito2'), (fg.conflitoDeReserva(c.agenda, c.consultas, 'reader', ouro.dia, 'x', undefined, c.agora) || {}).id || null, c.conflito2);
    conferir(rot('continuacao'), [undefined, 'k1', 'k2'].map((s) => (base.conflitoDeContinuacao(c.consultas, 'reader', s) || {}).id || null), c.continuacao);
    if (c.preparada.ok) conferir(rot('preparada'), fg.prepararReserva(alvo, ouro.dia, c.agora, 'Equipe', contador()), c.preparada.ok);
    conferir(rot('liberada'), c.agenda.map((a) => (a.id === alvo.id ? fg.liberarReserva(a, 'Equipe', c.agora) : a)), c.liberada);
    if (c.reservada.ok) conferir(rot('reservada'), fg.reservarCliente(alvo, 'reader', 'Equipe', ouro.dia, c.agora, contador()), c.reservada.ok.find((a) => a.id === alvo.id));
    if (c.encaminhada.ok) {
      const posicao = fg.proximaPosicaoDe(c.agenda, 'reader', ouro.dia);
      conferir(rot('encaminhada'), fg.encaminharParaTarologa(alvo, 'reader', 'Equipe', ouro.dia, c.agora, posicao, contador()), c.encaminhada.ok.find((a) => a.id === alvo.id));
    }
  });
  ouro.casosAdmissao.forEach((c, k) => {
    const vigente = adm.admissaoVigente(c.eventos, 'reader', ouro.dia, c.agora) || null;
    conferir(`admissao ${k} vigente`, vigente, c.vigente);
    conferir(`admissao ${k} erro`, adm.erroDeAdmissao(vigente || undefined, c.antes || undefined, c.alvo, c.agora), c.admissao);
    conferir(`admissao ${k} inicio`, adm.erroDeInicio(vigente || undefined, c.antes || undefined, c.alvo, c.agora), c.inicio);
    if (vigente) conferir(`admissao ${k} retorno`, adm.retornoAberto(vigente, c.agora), c.retornoAberto);
  });
  ouro.casosPresenca.forEach((c, k) => {
    conferir(`presenca ${k} escolha`, adm.escolhaDePresenca(c.perfil, ouro.dia), c.escolha);
    conferir(`presenca ${k} inicio`, adm.erroDeInicioPorPresenca(c.perfil, ouro.dia), c.inicio);
    conferir(`presenca ${k} admissao`, adm.erroDeAdmissaoPorPresenca(c.perfil, c.antes || undefined, c.alvo), c.admissao);
  });
  return { ok, falhas, total: ok + falhas.length };
}

module.exports = { verificar };
if (require.main === module) { const r = verificar(); console.log(`${r.ok}/${r.total}`); r.falhas.slice(0, 25).forEach((f) => console.log(f.slice(0, 600))); process.exit(r.falhas.length ? 1 : 0); }
