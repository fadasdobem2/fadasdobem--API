'use strict';

/**
 * Contexto da Lilly v708: `tarologistReturnMetrics` (R = % de clientes ÚNICAS que voltaram ao MESMO profissional, histórico fechado; 15+15+15 = 1 atendimento;
 * sem dado => omitido, nunca 0) e `operationalDate` pelo calendário operacional (06h). Cruza com o leitor REAL da Lilly quando o clone está disponível.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

module.exports = async (c) => {
  const { r, sequelize, servico, conferir, passo, consulta } = c;
  const AGORA = new Date('2026-11-07T15:00:00.000Z'); // 12:00 em São Paulo: dia operacional 2026-11-07
  const em = (dia, hora = '14:00') => `${dia}T${hora}:00.000Z`;
  let n = 0;
  const co = (tarot, cliente, inicio, minutos, extra = {}) => {
    n += 1;
    const ini = new Date(inicio); const fim = new Date(ini.getTime() + minutos * 60000);
    return sequelize.query(
      `INSERT INTO gf_consultas_ext (id, id_tarologo, id_cliente, status, comissao_percentual, aguardando_inicio, iniciada_em, encerrada_em, tarologo_iniciou_em, duracao_segundos, consulta_origem_id, item, criado_por, operation_key)
       VALUES (:id, :tarot, :cli, :status, 40, FALSE, :ini, :fim, :ini, :dur, :origem, :item::jsonb, 'teste', :op)`,
      { replacements: { id: extra.id || `R-${n}`, tarot, cli: cliente, status: extra.status || 'Concluída', ini: ini.toISOString(), fim: fim.toISOString(), dur: extra.duracao ?? minutos * 60, origem: extra.origem || null, item: JSON.stringify(extra.item || {}), op: `k-ret-${n}` }, logging: false },
    );
  };
  const metricas = async (ligada = true, agora = AGORA) => {
    if (ligada) process.env.GF_LILLY_RETORNO_METRICAS_ENABLED = 'true'; else delete process.env.GF_LILLY_RETORNO_METRICAS_ENABLED;
    const s = (await servico.montarContexto({ event: { id: 'umbler:RET', type: 'message', at: agora.toISOString(), conversationId: 'chat-ret', actor: 'staff', internal: true, data: {} } }, { agora, semCacheRetorno: true })).snapshot;
    return s;
  };

  console.log('contexto: operationalDate e retorno R');
  await passo('operationalDate pelo calendário operacional (06h): 05:59 ainda é o dia anterior, 06:00 já é o dia novo', async () => {
    const antes = await metricas(false, new Date('2026-11-08T08:59:00.000Z')); // 05:59 SP
    const depois = await metricas(false, new Date('2026-11-08T09:00:00.000Z')); // 06:00 SP
    conferir('05:59 => 2026-11-07', antes.operationalDate === '2026-11-07' && antes.operationalStartHour === 6);
    conferir('06:00 => 2026-11-08', depois.operationalDate === '2026-11-08');
    conferir('igual ao calendário da API (_comum/dia-operacional)', depois.operationalDate === c.hojeOperacional(new Date('2026-11-08T09:00:00.000Z')));
  });
  await passo('SEM dado: omitido (nunca 0), mesmo com a fonte ligada; com a fonte desligada também', async () => {
    const vazio = await metricas(true);
    conferir('tabela vazia => sem tarologistReturnMetrics', vazio.tarologistReturnMetrics === undefined && !('tarologistReturnMetrics' in vazio));
  });

  // osiris: A volta (2 atendimentos), B, D, E únicos, C com 15+15+15 seguidos = UM atendimento => 5 clientes, 1 voltou = 20%.
  await co('osiris', 'A', em('2026-10-20'), 30); await co('osiris', 'A', em('2026-11-03'), 30);
  await co('osiris', 'B', em('2026-10-21'), 20); await co('osiris', 'D', em('2026-10-22'), 20); await co('osiris', 'E', em('2026-10-23'), 20);
  await co('osiris', 'C', em('2026-10-25', '14:00'), 15, { id: 'C-1' });
  await co('osiris', 'C', em('2026-10-25', '14:15'), 15, { id: 'C-2', origem: 'C-1', item: { continuation: { kind: 'extension', sourceConsultationId: 'C-1' } } });
  await co('osiris', 'C', em('2026-10-25', '14:30'), 15, { id: 'C-3', origem: 'C-2', item: { continuation: { kind: 'extension', sourceConsultationId: 'C-2' } } });
  // nyx: duas clientes, nenhuma voltou => zero VÁLIDO. luz: só cancelada (não atendida) => sem linha. Hoje (aberto) não entra.
  await co('nyx', 'F', em('2026-10-26'), 20); await co('nyx', 'G', em('2026-10-27'), 20);
  await co('luz', 'H', em('2026-10-28'), 0, { status: 'Anulada', duracao: 0 });
  await co('osiris', 'Z', em('2026-11-07', '13:00'), 20); // hoje (dia operacional ABERTO)
  let m;
  await passo('R por profissional: 3 lançamentos de 15 min seguidos = UM atendimento; zero comprovado aparece; sem atendimento não ganha linha; hoje não entra', async () => {
    const s = await metricas(true);
    m = s.tarologistReturnMetrics;
    conferir('agregado completo, métrica e horário', m && m.complete === true && m.metric === 'returning_clients_percentage' && m.generatedAt === AGORA.toISOString());
    conferir('período FECHADO: do primeiro atendimento até o dia operacional anterior ao de hoje', m && m.periodStart === '2026-10-20' && m.periodEnd === '2026-11-06');
    const osiris = m && m.rows.find((x) => x.tarologistId === 'osiris'); const nyx = m && m.rows.find((x) => x.tarologistId === 'nyx');
    conferir('osiris: 5 clientes únicas, 1 voltou, 20%', osiris && osiris.clients === 5 && osiris.returningClients === 1 && osiris.returnPercentage === 20);
    conferir('nyx: 2 clientes, 0 voltaram => 0 comprovado (aparece)', nyx && nyx.clients === 2 && nyx.returningClients === 0 && nyx.returnPercentage === 0);
    conferir('luz (só consulta anulada) e afila: sem linha', m && !m.rows.some((x) => ['luz', 'afila'].includes(x.tarologistId)));
    conferir('uma linha por profissional', m && new Set(m.rows.map((x) => x.tarologistId)).size === m.rows.length);
  });
  await passo('fonte desligada (padrão): omitido; o resto do snapshot continua', async () => {
    const s = await metricas(false);
    conferir('sem tarologistReturnMetrics', s.tarologistReturnMetrics === undefined);
    conferir('operationalDate segue no envelope', s.operationalDate === '2026-11-07');
  });
  await passo('o leitor REAL da Lilly (professionalReturnPercentage) lê este agregado: 20% e 0%; ausente para quem não tem linha', async () => {
    const arq = process.env.LILLY_SERVER_DIR ? path.join(process.env.LILLY_SERVER_DIR, 'professional-return.mjs') : '/Users/patrick.developer/Desktop/Developer/Projects/Nice/fadasdobemsuspiro/fadasdobemsuspiro/Nice-github/fadasdobem-site/server/lilly/professional-return.mjs';
    if (!fs.existsSync(arq)) { console.log('  (info) clone da Lilly ausente: leitura real pulada'); return; }
    const { professionalReturnPercentage, professionalNameWithReturn } = await import(pathToFileURL(arq).href);
    const ctx = { now: AGORA.toISOString(), operationalDate: '2026-11-07', operationalStartHour: 6, tarologistReturnMetrics: m };
    conferir('osiris => 20', professionalReturnPercentage(ctx, 'osiris') === 20);
    conferir('nyx => 0 (zero válido)', professionalReturnPercentage(ctx, 'nyx') === 0);
    conferir('luz => null (não vira 0)', professionalReturnPercentage(ctx, 'luz') === null);
    conferir('"Osíris (R: 20%)"', professionalNameWithReturn(ctx, { id: 'osiris', name: 'Osíris' }) === 'Osíris (R: 20%)' && professionalNameWithReturn(ctx, { id: 'luz', name: 'Luz' }) === 'Luz');
  });
  await passo('validação do agregado (o mesmo crivo da Lilly): incompleto, período aberto, duplicidade, percentual inconsistente, contagens inválidas e geração no futuro são REJEITADOS', async () => {
    const { validarAgregado } = require(r('src/gestao-fadas/features/lilly/contexto/montador.retorno'));
    const ok = (x) => validarAgregado(x, { agoraIso: AGORA.toISOString(), hoje: '2026-11-07' });
    conferir('o agregado real passa', ok(m) === true);
    const mut = (alt) => ({ ...JSON.parse(JSON.stringify(m)), ...alt });
    conferir('complete:false rejeitado', ok(mut({ complete: false })) === false);
    conferir('métrica trocada rejeitada', ok(mut({ metric: 'outra' })) === false);
    conferir('período até hoje (aberto) rejeitado', ok(mut({ periodEnd: '2026-11-07' })) === false);
    conferir('período invertido rejeitado', ok(mut({ periodStart: '2026-11-06', periodEnd: '2026-10-01' })) === false);
    conferir('geração no futuro rejeitada', ok(mut({ generatedAt: '2026-11-08T00:00:00.000Z' })) === false);
    conferir('profissional duplicado rejeitado', ok(mut({ rows: [...m.rows, m.rows[0]] })) === false);
    conferir('percentual inconsistente com as contagens rejeitado', ok(mut({ rows: [{ ...m.rows[0], returnPercentage: 55 }] })) === false);
    conferir('clients 0 rejeitado (sem dado nunca vira 0%)', ok(mut({ rows: [{ tarologistId: 'x', returnPercentage: 0, clients: 0, returningClients: 0 }] })) === false);
    conferir('voltaram > clientes rejeitado', ok(mut({ rows: [{ tarologistId: 'x', returnPercentage: 100, clients: 1, returningClients: 2 }] })) === false);
    conferir('percentual null rejeitado', ok(mut({ rows: [{ tarologistId: 'x', returnPercentage: null, clients: 1, returningClients: 0 }] })) === false);
    conferir('sem linhas rejeitado', ok(mut({ rows: [] })) === false);
  });
  await passo('histórico só de hoje (período aberto) => omitido', async () => {
    await consulta("DELETE FROM gf_consultas_ext WHERE id LIKE 'R-%' OR id LIKE 'C-%' AND id <> 'C-MT-1' AND id <> 'C-MT-2'");
    await co('osiris', 'Z2', em('2026-11-07', '13:30'), 20);
    conferir('sem tarologistReturnMetrics', (await metricas(true)).tarologistReturnMetrics === undefined);
    delete process.env.GF_LILLY_RETORNO_METRICAS_ENABLED;
  });
};
