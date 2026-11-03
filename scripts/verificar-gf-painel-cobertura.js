'use strict';

/**
 * Guarda de COBERTURA do ouro do fluxo do painel (Maturacao/56 grupo D, PAINEL-02): o `verificar-gf-painel-fluxo.js` prova a igualdade com o `panelFlow` REAL do front;
 * este guarda prova que o ouro EXERCITA cada fila, cada campo da equipe, cada status e grupo da fila geral, a janela de 15 min e as viradas do dia operacional,
 * e imprime o que NÃO é coberto (ver docs). Falha se alguma fila/campo ficar sem nenhum caso. Offline, sem banco.
 */

const fs = require('fs');
const path = require('path');
const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-painel', 'ouro-painel-fluxo.json'), 'utf8'));
const casos = ouro.casos;
const conta = (f) => casos.filter(f).length;
const listas = ['generalAll', 'futureGeneral', 'general', 'free', 'dispatch', 'waitingGeneral', 'callbackGeneral', 'reservedGeneral', 'ready', 'reservedAssignments', 'recededReservations', 'reservationFollowUps', 'unansweredNext'];
const equipeLista = ['actionableQueue', 'queue', 'reports'];
const equipeFlag = ['available', 'operationalActive', 'freeNow', 'hasBooking', 'accepting', 'needsConfirmation'];
const equipeRef = ['unstarted', 'reservation', 'future', 'report'];
const quadro = {};
for (const k of listas) quadro[`fluxo.${k}`] = conta((c) => c.fluxo[k].length > 0);
for (const k of equipeLista) quadro[`equipe.${k}`] = conta((c) => c.fluxo.team.some((r) => r[k].length > 0));
for (const k of equipeFlag) quadro[`equipe.${k}`] = conta((c) => c.fluxo.team.some((r) => r[k]));
for (const k of equipeRef) quadro[`equipe.${k}`] = conta((c) => c.fluxo.team.some((r) => r[k]));
const statusEsperados = ['Avisada', 'Chamar cliente', 'Não pode agora', 'Vai pagar', 'Próximo turno', 'Não voltou', 'Chama depois', 'Não respondeu', 'Pode agora', 'Cliente vai chamar'];
const status = new Set(casos.flatMap((c) => c.tempos.map((t) => t.status))); const grupos = new Set(casos.flatMap((c) => c.tempos.map((t) => t.grupo)));
quadro['tempos.janela de 15 min'] = conta((c) => c.tempos.some((t) => t.waitingWindow)); quadro['tempos.futuro'] = conta((c) => c.tempos.some((t) => t.future)); quadro['tempos.ativa'] = conta((c) => c.tempos.some((t) => t.active));
const relogio = (ms) => new Date(ms - 3 * 3600000).toISOString().slice(11, 16);
quadro['relógio antes das 06:00 (dia operacional anterior)'] = conta((c) => relogio(c.agora) < '06:00'); quadro['relógio depois das 06:00'] = conta((c) => relogio(c.agora) >= '06:00');
quadro['data pedida diferente do dia operacional'] = conta((c) => c.entrada.date !== new Date(c.agora - 9 * 3600000).toISOString().slice(0, 10));
quadro['validações recusadas'] = casos.reduce((s, c) => s + c.validacoes.filter((v) => !v.encaminhar.ok).length, 0); quadro['validações aceitas'] = casos.reduce((s, c) => s + c.validacoes.filter((v) => v.encaminhar.ok).length, 0);
quadro['mutantes recusados pelo front'] = casos.reduce((s, c) => s + c.mutantes.filter((m) => !m.front.ok).length, 0);

let falhas = 0;
for (const [nome, n] of Object.entries(quadro)) { if (n === 0) { falhas += 1; console.error(`SEM COBERTURA: ${nome}`); } }
for (const s of statusEsperados) if (!status.has(s)) { falhas += 1; console.error(`SEM COBERTURA: status ${s}`); }
for (const g of ['waiting', 'callback', 'scheduled']) if (!grupos.has(g)) { falhas += 1; console.error(`SEM COBERTURA: grupo ${g}`); }
if (falhas) { console.error(`FALHOU: ${falhas} itens sem nenhum caso no ouro.`); process.exit(1); }
const menor = Object.entries(quadro).sort((a, b) => a[1] - b[1]).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(', ');
console.log(`OK: ${casos.length} casos do panelFlow real cobrem ${listas.length} listas, ${equipeLista.length + equipeFlag.length + equipeRef.length} campos da equipe, ${status.size} status e ${grupos.size} grupos da fila geral; menos cobertos: ${menor}.`);
console.log('NÃO coberto pelo ouro do fluxo: (1) contadores dos cartões e textos da tela: são montados nos componentes (.tsx) a partir das listas, sem função pura própria; só as LISTAS são provadas (outros módulos puros do painel, como panel-agenda-next-model, panel-reservation-clock e panel-reader-ranking, não têm ouro neste grupo: pendência); (2) calendário de demonstração (DEMO_CALENDAR, desligado em produção); (3) casos em que o panelFlow do front lança (pulados, 1 em 900); (4) fuso: UTC-3 fixo, sem horário de verão pré-2019; (5) `panelReservationStep` e pendências têm ouro próprio (painel-lancamento, painel-pagamentos).');
