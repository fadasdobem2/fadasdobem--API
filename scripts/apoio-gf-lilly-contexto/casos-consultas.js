'use strict';

/** Consultas: tradução de status e de canal (tabela documentada), consulta preparada sem `startedAt`. */

module.exports = async ({ r, snap, body, conferir, passo }) => {
  const { traduzirCanal, TABELA_DE_CANAIS, CANAIS_DA_LILLY } = require(r('src/gestao-fadas/features/lilly/contexto/consultas.canal'));
  const { traduzirStatus } = require(r('src/gestao-fadas/features/lilly/contexto/montador.consultas'));

  console.log('Consultas');
  await passo('status: Em curso (preparada x em andamento), Concluída, Cancelada, Anulada, Finalizada pelo tarólogo e desconhecido', async () => {
    const t = (status, aguardando) => traduzirStatus({ status, aguardando_inicio: aguardando });
    conferir('preparada', t('Em curso', true) === 'prepared');
    conferir('em andamento', t('Em curso', false) === 'in_progress');
    conferir('concluída', t('Concluída', false) === 'completed');
    conferir('cancelada e anulada nunca viram completed', t('Cancelada', false) === 'cancelled' && t('Anulada', false) === 'cancelled');
    conferir('finalizada pelo tarólogo = ended (doc 60 §10)', t('Finalizada pelo tarólogo', false) === 'ended');
    conferir('estado desconhecido não vira nenhum dos quatro', t('Qualquer', false) === 'unknown');
  });
  await passo('canal: o painel usa "WhatsApp Áudio/Ligação/Texto" e a Lilly os recusa; todos traduzem para valores aceitos', async () => {
    const aceitos = new Set(CANAIS_DA_LILLY);
    conferir('toda a tabela cai no vocabulário da Lilly', Object.values(TABELA_DE_CANAIS).every((v) => aceitos.has(v)));
    conferir('WhatsApp Áudio', traduzirCanal('WhatsApp Áudio') === 'WhatsApp: texto/áudio');
    conferir('WhatsApp Texto', traduzirCanal('WhatsApp Texto') === 'WhatsApp: texto/áudio');
    conferir('WhatsApp Ligação', traduzirCanal('WhatsApp Ligação') === 'WhatsApp');
    conferir('PABX e Telefone', traduzirCanal('PABX') === 'PABX' && traduzirCanal('Telefone') === 'PABX');
    conferir('WhatsApp', traduzirCanal('WhatsApp') === 'WhatsApp');
    conferir('desconhecido/vazio = ausente (nunca inventa)', traduzirCanal('Chat') === undefined && traduzirCanal('') === undefined && traduzirCanal(null) === undefined);
    conferir('os valores do painel não saem crus', !Object.keys(TABELA_DE_CANAIS).filter((k) => /Áudio|Ligação|Texto/.test(k)).some((k) => aceitos.has(k)));
  });
  await passo('consultations do snapshot: preparada sem startedAt, em andamento com minutos/pausas, encerrada com duração', async () => {
    const x = await snap(body());
    const c = Object.fromEntries(x.snapshot.consultations.map((y) => [y.id, y]));
    conferir('as cinco do dia', Object.keys(c).sort().join() === 'c-1,c-2,c-3,c-4,c-5');
    conferir('c-1 preparada: preparedAt, SEM startedAt, canal traduzido, minutos', c['c-1'].status === 'prepared' && c['c-1'].startedAt === undefined && c['c-1'].preparedAt === '2026-11-07T14:46:00.000Z' && c['c-1'].channel === 'WhatsApp: texto/áudio' && c['c-1'].minutes === 30 && c['c-1'].appointmentId === 'ag-1');
    conferir('c-1 versão para o expectedVersion', Number.isInteger(c['c-1'].version) && c['c-1'].awaitingTarologistStart === true);
    conferir('c-2 em andamento: startedAt do tarólogo, canal WhatsApp, 20 minutos, pausa', c['c-2'].status === 'in_progress' && c['c-2'].startedAt === '2026-11-07T14:02:00.000Z' && c['c-2'].channel === 'WhatsApp' && c['c-2'].minutes === 20 && c['c-2'].pauseHistory.length === 1);
    conferir('c-3 concluída: fim e duração', c['c-3'].status === 'completed' && c['c-3'].endedAt === '2026-11-07T10:30:00.000Z' && c['c-3'].durationSeconds === 1800 && c['c-3'].channel === 'PABX');
    conferir('c-4 finalizada pelo tarólogo = ended, relatório de minutos, Telefone->PABX', c['c-4'].status === 'ended' && c['c-4'].tarologistFinishReport.minutes === 20 && c['c-4'].channel === 'PABX');
    conferir('c-5 anulada = cancelled, canal desconhecido ausente', c['c-5'].status === 'cancelled' && c['c-5'].channel === undefined);
    conferir('nada de observação nem comissão', !JSON.stringify(x.snapshot.consultations).includes('OBS-CONSULTA') && x.snapshot.consultations.every((y) => y.commission === undefined && y.observation === undefined));
  });
};
