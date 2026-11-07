'use strict';

/** Guarda de idempotência (POST /lilly/actions) e conciliação (GET /lilly/actions/{chave}), com executores de teste no registro. */

module.exports = async ({ r, avulso, chamar, consulta, conferir, passo }) => {
  const registro = require(r('src/gestao-fadas/features/lilly/acoes/acoes.registro'));
  const { AcaoRecusadaError } = require(r('src/gestao-fadas/features/lilly/acoes/acoes.erros'));
  const acoesRepo = require(r('src/gestao-fadas/features/lilly/dados/acoes.repo'));
  const { gravarNotaHorario } = require(r('src/gestao-fadas/features/lilly/notas/notas-horario.servico'));

  const chamadas = { schedule: 0, payment: 0, update_client: 0, remove_appointment: 0 };
  let estadoVisto = null;
  registro.limpar();
  registro.registrar('schedule', {
    validar: async () => ({ allowed: true, context: { complete: true } }),
    async executar(acao, { executor, chave }) {
      chamadas.schedule += 1;
      estadoVisto = (await acoesRepo.lerAcao(executor, chave.interna)).estado; // 'em_execucao' já gravado ANTES do efeito
      return { id: `ag-${chamadas.schedule}`, position: 3 };
    },
  });
  registro.registrar('payment', { // recusa de negócio DEPOIS de gravar algo: o efeito inteiro deve ser desfeito
    validar: async () => ({ allowed: false, reason: 'Sem autorização.' }),
    async executar(acao, { executor }) {
      chamadas.payment += 1;
      await gravarNotaHorario(executor, { id: 'nota-desfeita', tarologistId: '9001', date: '2026-11-07', status: 'waiting', text: 'x', at: '2026-11-07T10:00:00Z' });
      throw new AcaoRecusadaError('LILLY_PAYMENT_NOT_AUTHORIZED', 'Pagamento sem autorização.', 422);
    },
  });
  registro.registrar('update_client', { // efeito fora do banco novo que falha de forma incerta
    transacional: false,
    validar: async () => ({ allowed: true }),
    async executar() { chamadas.update_client += 1; throw new Error('rede caiu no meio'); },
  });
  registro.registrar('remove_appointment', { validar: async () => ({ allowed: true }), executar: async () => { chamadas.remove_appointment += 1; throw new Error('bug do executor'); } });
  registro.registrar('note', { validar: async () => ({ allowed: true, contactId: 'ct-1' }) });

  const acao = (extra = {}) => ({ kind: 'schedule', conversationId: 'chat-1', clientId: '900101', tarologistId: 'afila', payload: { date: '2026-11-07', position: 'last' }, ...extra });
  const exec = (a, chave) => chamar('POST', '/lilly/actions', { corpo: { action: a }, chave });
  const conc = (chave) => chamar('GET', `/lilly/actions/${encodeURIComponent(chave)}`);
  const linhas = async (chave) => Number((await consulta('SELECT count(*) AS n FROM gf_lilly_acoes WHERE chave_original = :c', { c: chave }))[0].n);

  console.log('Ações: guarda e conciliação');
  await passo('flag desligada: 403 e NENHUM efeito nem linha guardada', async () => {
    const x = await exec(acao(), 'evt-1:acao:chat-1');
    conferir('403', x.status === 403 && x.corpo.error.code === 'LILLY_ACTIONS_DISABLED');
    conferir('executor não rodou e nada gravado', chamadas.schedule === 0 && (await linhas('evt-1:acao:chat-1')) === 0);
  });

  process.env.GF_LILLY_ACOES_ENABLED = 'true';
  await passo('primeira execução: committed:true com o resultado; "em_execucao" gravado antes do efeito', async () => {
    const x = await exec(acao(), 'evt-1:acao:chat-1');
    conferir('200 committed', x.status === 200 && x.corpo.committed === true && x.corpo.result.id === 'ag-1' && x.corpo.result.position === 3);
    conferir('em_execucao antes do efeito', estadoVisto === 'em_execucao');
    conferir('confirmada depois', (await acoesRepo.lerAcao(avulso, 'evt-1:acao:chat-1')).estado === 'confirmada');
  });
  await passo('mesma chave + mesmo corpo: repete a resposta SEM novo efeito', async () => {
    const x = await exec(acao(), 'evt-1:acao:chat-1');
    conferir('mesma resposta', x.status === 200 && x.corpo.result.id === 'ag-1' && chamadas.schedule === 1);
  });
  await passo('mesma chave + corpo com campos voláteis diferentes (status, erro, resultado, evidência): também repete', async () => {
    const x = await exec(acao({ status: 'sending', error: 'timeout', result: { id: 'zzz' }, completionPending: true, sourceEventId: 'evt-9', phraseEvidence: ['a'] }), 'evt-1:acao:chat-1');
    conferir('repetiu, sem 409', x.status === 200 && x.corpo.result.id === 'ag-1' && chamadas.schedule === 1);
  });
  await passo('mesma chave + corpo diferente: 409 OPERATION_KEY_CONFLICT, sem efeito', async () => {
    const x = await exec(acao({ payload: { date: '2026-11-08', position: 'first' } }), 'evt-1:acao:chat-1');
    conferir('409', x.status === 409 && x.corpo.error.code === 'OPERATION_KEY_CONFLICT' && chamadas.schedule === 1);
  });
  await passo('chave longa (> 128, com símbolos) é guardada pelo hash, com a original preservada', async () => {
    const longa = `evento-${'x'.repeat(300)}:sufixo/ç:chat-1`;
    const x = await exec(acao(), longa);
    conferir('executou', x.status === 200 && x.corpo.committed === true);
    const l = (await consulta('SELECT chave_interna, chave_original FROM gf_lilly_acoes WHERE chave_original = :c', { c: longa }))[0];
    conferir('interna sha256 e original inteira', /^sha256:[0-9a-f]{64}$/.test(l.chave_interna) && l.chave_original === longa);
    conferir('repetição devolve o mesmo', (await exec(acao(), longa)).corpo.result.id === x.corpo.result.id);
  });

  await passo('recusa definitiva: 422 guardada como "recusada", efeito desfeito, repetição devolve a mesma recusa sem executar', async () => {
    const a = acao({ kind: 'payment' });
    const x = await exec(a, 'evt-2:pagamento:chat-1');
    conferir('422', x.status === 422 && x.corpo.error.code === 'LILLY_PAYMENT_NOT_AUTHORIZED');
    conferir('efeito desfeito (nota não existe)', Number((await consulta("SELECT count(*) AS n FROM gf_lilly_notas_horario WHERE id = 'nota-desfeita'"))[0].n) === 0);
    conferir('estado recusada', (await acoesRepo.lerAcao(avulso, 'evt-2:pagamento:chat-1')).estado === 'recusada');
    const y = await exec(a, 'evt-2:pagamento:chat-1');
    conferir('mesma recusa, executor 1x', y.status === 422 && y.corpo.error.code === 'LILLY_PAYMENT_NOT_AUTHORIZED' && chamadas.payment === 1);
    const z = await conc('evt-2:pagamento:chat-1');
    conferir('GET: recusada = not_executed', z.status === 200 && z.corpo.committed === false && z.corpo.state === 'not_executed');
  });

  await passo('erro inesperado do executor: 500, nada guardado (a repetição pode tentar de novo)', async () => {
    const x = await exec(acao({ kind: 'remove_appointment' }), 'evt-3:remover:chat-1');
    conferir('500', x.status === 500 && x.corpo.error.code === 'LILLY_INTERNAL');
    conferir('sem linha', (await linhas('evt-3:remover:chat-1')) === 0);
    await exec(acao({ kind: 'remove_appointment' }), 'evt-3:remover:chat-1');
    conferir('tentou de novo', chamadas.remove_appointment === 2);
  });

  await passo('executor não-transacional que falha incerto: fica "incerta", GET uncertain, repetição 503 sem novo efeito', async () => {
    const a = acao({ kind: 'update_client' });
    const x = await exec(a, 'evt-4:cadastro:chat-1');
    conferir('500', x.status === 500);
    conferir('estado incerta', (await acoesRepo.lerAcao(avulso, 'evt-4:cadastro:chat-1')).estado === 'incerta');
    conferir('GET uncertain', (await conc('evt-4:cadastro:chat-1')).corpo.state === 'uncertain');
    const y = await exec(a, 'evt-4:cadastro:chat-1');
    conferir('503 em andamento, 1 efeito', y.status === 503 && y.corpo.error.code === 'LILLY_ACTION_IN_PROGRESS' && chamadas.update_client === 1);
  });

  await passo('kind sem executor = 422; kind só-Umbler = 422 em actions e allowed:true em validate', async () => {
    conferir('payout sem executor', (await exec({ kind: 'reschedule', conversationId: 'c' }, 'evt-5:x:chat-1')).status === 422);
    conferir('note não executa', (await exec({ kind: 'note', conversationId: 'c' }, 'evt-5:y:chat-1')).status === 422);
    const v = await chamar('POST', '/lilly/actions/validate', { corpo: { action: { kind: 'note' } } });
    conferir('validate note', v.status === 200 && v.corpo.allowed === true && v.corpo.contactId === 'ct-1');
    const w = await chamar('POST', '/lilly/actions/validate', { corpo: { action: { kind: 'payment' } } });
    conferir('validate recusa com motivo', w.status === 200 && w.corpo.allowed === false && w.corpo.reason === 'Sem autorização.');
    const s = await chamar('POST', '/lilly/actions/validate', { corpo: { action: { kind: 'schedule' } } });
    conferir('validate schedule', s.corpo.allowed === true && s.corpo.context.complete === true);
    conferir('validate sem executor', (await chamar('POST', '/lilly/actions/validate', { corpo: { action: { kind: 'reschedule' } } })).corpo.allowed === false);
  });

  await passo('conciliação nos 3 estados + pending', async () => {
    const conf = await conc('evt-1:acao:chat-1');
    conferir('confirmada: committed:true + result', conf.corpo.committed === true && conf.corpo.result.id === 'ag-1');
    const nunca = await conc('chave-nunca-vista-1');
    conferir('nunca vista: not_executed', nunca.status === 200 && nunca.corpo.committed === false && nunca.corpo.state === 'not_executed');
    await acoesRepo.reservar(avulso, { chaveInterna: 'evt-6:andando:chat-1', chaveOriginal: 'evt-6:andando:chat-1', hash: 'a'.repeat(64), kind: 'schedule' });
    conferir('em_execucao recente: pending', (await conc('evt-6:andando:chat-1')).corpo.state === 'pending');
    await consulta("UPDATE gf_lilly_acoes SET atualizado_em = now() - interval '10 minutes' WHERE chave_interna = 'evt-6:andando:chat-1'");
    const antiga = await conc('evt-6:andando:chat-1');
    conferir('em_execucao antiga: uncertain', antiga.status === 200 && antiga.corpo.committed === false && antiga.corpo.state === 'uncertain');
  });
};
