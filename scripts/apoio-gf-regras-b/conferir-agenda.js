'use strict';

/** Confere o ouro da AGENDA (Maturacao/44) contra o servidor. Devolve contagens e falhas; sem banco. */

const fs = require('fs');
const path = require('path');
const { reproduzir, resumo, criar, semServidor, GRUPO_DA_ROTA, ATOR } = require('./replay-agenda');
const { aplicarDelta } = require('../../src/gestao-fadas/_comum/dominio/agenda-delta');
const { planoDeContato } = require('../../src/gestao-fadas/_comum/dominio/agenda-regras');

function conferir() {
  const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'ouro-agenda.json'), 'utf8'));
  const r = { aceitos: 0, recusas: 0, frases: 0, bloqueados: 0, nada: 0, falhas: [], porAcao: {} };
  const marca = (c) => { const k = c.acao.split(':')[0]; r.porAcao[k] = (r.porAcao[k] || 0) + 1; };
  ouro.cenarios.forEach((c, i) => {
    marca(c);
    if (c.tipo === 'nada') { r.nada += 1; return; }
    const antes = ouro.estados[c.antes];
    if (c.tipo === 'comando') {
      const s = reproduzir(antes, c.comandos, c.at);
      if (s.item && resumo(s.item) === c.resumo) r.aceitos += 1; else r.falhas.push(`#${i} ${c.acao}: o front grava e o servidor ${s.erro ? `recusou "${s.erro}"` : 'devolveu item diferente'}`);
    } else if (c.tipo === 'recusa') {
      const s = reproduzir(antes, c.comandos, c.at);
      if (s.erro === undefined) r.falhas.push(`#${i} ${c.acao}: o front recusa ("${c.erro}") e o servidor aceitou`); else { r.recusas += 1; if (s.erro !== c.erro && !FRASES_DE_VERSAO.has(c.erro)) r.falhas.push(`#${i} ${c.acao}: frase do front "${c.erro}" servidor "${s.erro}"`); }
    } else if (c.tipo === 'recusa-frase') {
      let obtido = null; try { planoDeContato(c.plano); } catch (e) { obtido = e.message; }
      if (obtido !== c.erro) r.falhas.push(`#${i} ${c.acao}: front "${c.erro}" servidor "${obtido}"`); else r.frases += 1;
    } else if (c.tipo === 'bloqueado-na-tela') { r.bloqueados += 1; } else if (c.tipo === 'versao') { r.versao = (r.versao || 0) + 1; } else if (c.tipo === 'so-no-front') { r.soFront = (r.soFront || 0) + 1; }
  });
  r.criacoes = 0;
  for (const c of ouro.criacoes || []) {
    const s = criar(c.comandos[0], c.abertos, c.at);
    if (s.item && resumo(semServidor(s.item)) === c.resumo) r.criacoes += 1; else r.falhas.push(`criar ${c.acao}: ${s.erro || 'item diferente do front'}`);
  }
  Object.assign(r, mutantes(ouro));
  return r;
}

/** Comandos que o front NUNCA produz: o servidor tem de recusá-los (cada mutante parte de um comando válido do ouro). */
function mutantes(ouro) {
  const primeiro = (prefixo, filtro = () => true) => ouro.cenarios.find((c) => c.tipo === 'comando' && c.acao.startsWith(prefixo) && c.comandos.some((x) => x.kind === 'item') && filtro(c));
  const clonar = (c) => ({ antes: ouro.estados[c.antes], cmd: JSON.parse(JSON.stringify(c.comandos.find((x) => x.kind === 'item'))), at: c.at });
  const aplicar = (m, mut) => { mut(m.cmd.delta); try { aplicarDelta(m.antes, m.cmd.delta, GRUPO_DA_ROTA[m.cmd.route], ATOR, new Date(m.at)); return null; } catch (e) { return e.message; } };
  const lista = []; const falhas = [];
  const add = (nome, c, mut) => { if (!c) { falhas.push(`mutante ${nome}: sem cenário-base`); return; } lista.push({ nome, recusa: aplicar(clonar(c), mut) }); };
  add('contato: tentativa +5', primeiro('toggle:Avisada:toggle', (c) => c.comandos[0].delta.set.contact), (d) => { d.set.contact = { ...d.set.contact, attempt: d.set.contact.attempt + 5 }; });
  add('contato: etiqueta desconhecida', primeiro('toggle:Avisada:toggle', (c) => c.comandos[0].delta.set.contact), (d) => { d.set.contact = { ...d.set.contact, tags: [...d.set.contact.tags, 'Inventada'] }; });
  add('contato: Concluída sem desfecho', primeiro('toggle:Avisada:toggle', (c) => c.comandos[0].delta.set.contact), (d) => { d.set.contact = { ...d.set.contact, tags: ['Concluída'] }; });
  add('contato: tentativa volta atrás', primeiro('toggle:Chamar cliente:toggle', (c) => c.comandos[0].delta.set.contact && c.comandos[0].delta.set.contact.attempt > 1), (d) => { d.set.contact = { ...d.set.contact, attempt: 0 }; });
  add('contato: campo fora do grupo (posição)', primeiro('toggle:Avisada:toggle', (c) => c.comandos[0].delta.set.contact), (d) => { d.set.position = 1; });
  add('contato: campo reservado (publicNumber)', primeiro('toggle:Avisada:toggle', (c) => c.comandos[0].delta.set.contact), (d) => { d.set.publicNumber = 99; });
  add('observação: texto de 8001', primeiro('obs:add'), (d) => { d.set.observations = d.set.observations.map((n, i, a) => (i === a.length - 1 ? { ...n, text: 'x'.repeat(8001) } : n)); });
  add('observação: some uma antiga', primeiro('obs:add', (c) => (ouro.estados[c.antes].observations || []).length > 0), (d) => { d.set.observations = d.set.observations.slice(1); });
  add('observação: evento duplicado', primeiro('obs:add'), (d) => { d.append.observationHistory = [...d.append.observationHistory, d.append.observationHistory[0]]; });
  add('prazo: 0 minutos', primeiro('prazo:'), (d) => { d.append.requestedWaitHistory[0].minutes = 0; });
  add('prazo: 1441 minutos', primeiro('prazo:'), (d) => { d.append.requestedWaitHistory[0].minutes = 1441; });
  add('prazo: minutos fracionados', primeiro('prazo:'), (d) => { d.append.requestedWaitHistory[0].minutes = 2.5; });
  add('prazo: dois no mesmo comando', primeiro('prazo:'), (d) => { d.append.requestedWaitHistory = [...d.append.requestedWaitHistory, { ...d.append.requestedWaitHistory[0], id: 'w-extra' }]; });
  add('saída: motivo fora da lista', primeiro('saida:cancel'), (d) => { d.append.departures[0].reason = 'Inventado'; });
  add('saída: cancelar com motivo de transferência', primeiro('saida:cancel:Desistiu'), (d) => { d.append.departures[0].reason = 'Pediu outro tarólogo'; });
  add('saída: transferir sem destino', primeiro('saida:transfer'), (d) => { d.append.departures[0].targetTarotId = undefined; });
  add('saída: remarcar sem data', primeiro('saida:reschedule'), (d) => { d.append.departures[0].targetDate = '2026-13-45'; });
  add('saída: incidente desconhecido', primeiro('saida:cancel'), (d) => { d.append.departures[0].incident = 'Inventado'; });
  add('resolução: ação da consulta (do servidor)', primeiro('resolucao:Agendamento mantido'), (d) => { d.append.resolutionHistory[0].action = 'Agendamento concluído'; });
  add('resolução: detalhe que não é texto', primeiro('resolucao:Agendamento mantido'), (d) => { d.append.resolutionHistory[0].detail = 5; });
  add('plano: combinado inválido', primeiro('plano:', (c) => c.comandos[0].delta.set.contactPlan), (d) => { d.set.contactPlan = { ...d.set.contactPlan, timing: 'exact', time: '25:99' }; });
  add('plano: quem inválido', primeiro('plano:', (c) => c.comandos[0].delta.set.contactPlan), (d) => { d.set.contactPlan = { ...d.set.contactPlan, who: 'ninguem' }; });
  const aceitos = lista.filter((m) => m.recusa === null).map((m) => m.nome);
  return { mutantes: lista.length, mutantesAceitos: aceitos, falhasDeMutante: falhas };
}
/** Frases de versão que o servidor devolve como 409 (a tela mostra a do front). */
const FRASES_DE_VERSAO = new Set(['Esta observação mudou. Confira o texto atualizado antes de salvar.', 'O prazo foi atualizado. Confira o registro antes de informar outro.']);

module.exports = { conferir };
if (require.main === module) { const r = conferir(); console.log(JSON.stringify({ ...r, falhas: r.falhas.length }), '\n', r.falhas.slice(0, 40).join('\n')); }
