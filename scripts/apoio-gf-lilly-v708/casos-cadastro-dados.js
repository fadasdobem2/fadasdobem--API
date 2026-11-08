'use strict';

/**
 * update_client v708: os dados que chegam em partes completam o MESMO ID (nunca outro cadastro); `noEmail` persiste e volta nas leituras; vazio nunca
 * apaga; a situação é calculada; cliente do legado ganha situação/"sem e-mail" só na extensão; NULL continua NULL (sem backfill).
 */

module.exports = async (c) => {
  const { acao, exec, validar, consulta, contar, conferir, passo, chave, evento, IDS, linha, ext, snap, novos, pendente } = c;
  const atualizar = (id, payload, conversationId = 'chat-n1') => acao('update_client', { clientId: id, conversationId, payload: { clientId: id, preservePreferences: true, ...payload } });

  console.log('update_client v708 (mesmo ID, dados em partes)');
  await passo('nome chega: atualiza o MESMO ID, segue dados_pendentes (faltam nascimento e e-mail); identificação e tratar-por vêm da Lilly', async () => {
    const a = atualizar(IDS.pendente, { name: 'maria da silva souza', fullName: 'maria da silva souza', identificationName: 'Maria Souza', treatAs: 'Maria', phone: '+55 11 98765-0001', birthDate: null, email: '', noEmail: false, situacao_cadastral: 'dados_pendentes' });
    const v = await validar(a);
    conferir('validate permite', v.corpo.allowed === true && v.corpo.clientId === IDS.pendente);
    const x = await exec(a, chave('upd'));
    conferir('committed com o MESMO id', x.status === 200 && x.corpo.result.id === IDS.pendente && x.corpo.result.situacao_cadastral === 'dados_pendentes');
    const l = await linha(IDS.pendente);
    conferir('nome e identificação gravados; nascimento segue NULL', l.nome === 'maria da silva souza' && l.nome_id === 'Maria Souza' && l.nome2 === 'Maria' && l.data_nascimento === null);
    conferir('continua UM cadastro e um vínculo', (await novos()) >= 1 && (await contar('gf_clientes_novos', 'telefone = :t', { t: '+5511987650001' })) === 1);
    const s = await snap('chat-n1');
    const cl = s.clients.find((y) => y.id === IDS.pendente);
    conferir('contexto: nome agora aparece, situação segue pendente', cl && cl.fullName === 'maria da silva souza' && cl.identificationName === 'Maria Souza' && cl.situacao_cadastral === 'dados_pendentes');
  });
  await passo('campo novo VAZIO nunca apaga o que existe; preferência humana só muda se estiver vazia (preservePreferences)', async () => {
    const x = await exec(atualizar(IDS.pendente, { name: '', fullName: '', identificationName: 'Outro Nome', treatAs: 'Outra', birthDate: null, email: '', noEmail: false, situacao_cadastral: 'dados_pendentes' }), chave('upd'));
    const l = await linha(IDS.pendente);
    conferir('committed sem mudar nada', x.status === 200 && x.corpo.result.changed.length === 0);
    conferir('nome, identificação e tratar-por preservados', l.nome === 'maria da silva souza' && l.nome_id === 'Maria Souza' && l.nome2 === 'Maria');
  });
  await passo('"completo" sem os dados todos: 422 LILLY_CLIENT_STATUS_MISMATCH (a API é a autoridade da situação)', async () => {
    const x = await exec(atualizar(IDS.pendente, { situacao_cadastral: 'completo' }), chave('upd'));
    conferir('422', x.status === 422 && x.corpo.error.code === 'LILLY_CLIENT_STATUS_MISMATCH');
    conferir('situação não mudou', (await ext(IDS.pendente)).situacao_cadastral === 'dados_pendentes');
  });
  await passo('nascimento e e-mail chegam depois: vira "completo" no MESMO ID, preservando ID, vínculo e histórico', async () => {
    const antes = Number((await ext(IDS.pendente)).revisao);
    const x = await exec(atualizar(IDS.pendente, { name: 'Maria da Silva Souza', fullName: 'Maria da Silva Souza', birthDate: '1990-05-17', email: 'maria@teste.local', noEmail: false, situacao_cadastral: 'completo' }), chave('upd'));
    conferir('committed completo no mesmo id', x.status === 200 && x.corpo.result.id === IDS.pendente && x.corpo.result.situacao_cadastral === 'completo');
    const l = await linha(IDS.pendente); const e = await ext(IDS.pendente);
    conferir('nascimento civil, e-mail e nome corrigido gravados', l.data_nascimento === '1990-05-17' && l.email === 'maria@teste.local' && l.nome === 'Maria da Silva Souza');
    conferir('extensão: completo, revisão subiu, Pré-pago intacto', e.situacao_cadastral === 'completo' && Number(e.revisao) > antes && e.perfil_pagamento === 'Pré-pago' && e.sem_email === false);
    const s = await snap('chat-n1'); const cl = s.clients.find((y) => y.id === IDS.pendente);
    conferir('contexto devolve nascimento, e-mail e situação completo para a Lilly comparar sem regravar', cl && cl.birthDate === '1990-05-17' && cl.email === 'maria@teste.local' && cl.situacao_cadastral === 'completo' && cl.noEmail === false);
    conferir('vínculo e cadastro únicos', (await contar('gf_lilly_vinculos', "id_cliente = :id", { id: IDS.pendente })) === 1 && (await novos()) >= 1);
  });

  console.log('noEmail persistido e devolvido');
  await passo('cria já completa com noEmail:true: sem e-mail, sem_email=true na extensão, devolvido nas leituras seguintes', async () => {
    await evento('umbler:N5', { conversationId: 'chat-n5', contactId: 'ct-n5' });
    const a = pendente({ name: 'Joana Pereira', fullName: 'Joana Pereira', identificationName: 'Joana Pereira', treatAs: 'Joana', birthDate: '1985-02-03', email: '', noEmail: true, phone: '+55 21 97777-0005', situacao_cadastral: 'completo', allowMissingName: false, sourceContactId: 'ct-n5', sourceConversationId: 'chat-n5' }, { conversationId: 'chat-n5' });
    const x = await exec(a, chave('reg'));
    conferir('committed completo', x.status === 200 && x.corpo.result.situacao_cadastral === 'completo' && x.corpo.result.noEmail === true);
    IDS.semEmail = x.corpo.result.id;
    const e = await ext(IDS.semEmail); const l = await linha(IDS.semEmail);
    conferir('sem_email=true e e-mail NULL', e.sem_email === true && l.email === null && l.nome === 'Joana Pereira');
    const cl = (await snap('chat-n5')).clients.find((y) => y.id === IDS.semEmail);
    conferir('contexto: noEmail true, sem e-mail, completo (declaração explícita, não e-mail vazio)', cl && cl.noEmail === true && cl.email === undefined && cl.situacao_cadastral === 'completo');
  });
  await passo('e-mail vazio SOZINHO não comprova ausência: sem noEmail a cliente continua pendente (e "completo" é recusado)', async () => {
    const a = pendente({ name: 'Rita Alves', fullName: 'Rita Alves', birthDate: '1980-01-01', email: '', noEmail: false, phone: '+55 21 97777-0006', situacao_cadastral: 'completo', allowMissingName: false, sourceContactId: 'ct-n6', sourceConversationId: 'chat-n6' }, { conversationId: 'chat-n6' });
    const x = await exec(a, chave('reg'));
    conferir('422 STATUS_MISMATCH', x.status === 422 && x.corpo.error.code === 'LILLY_CLIENT_STATUS_MISMATCH');
  });
  await passo('depois chega o e-mail: noEmail volta a false e o e-mail é gravado (declaração anterior substituída)', async () => {
    const x = await exec(atualizar(IDS.semEmail, { email: 'joana@teste.local', noEmail: false, situacao_cadastral: 'completo' }, 'chat-n5'), chave('upd'));
    conferir('committed', x.status === 200 && x.corpo.result.noEmail === false);
    conferir('e-mail gravado e sem_email=false', (await linha(IDS.semEmail)).email === 'joana@teste.local' && (await ext(IDS.semEmail)).sem_email === false);
  });

  console.log('cliente do LEGADO (somente leitura): situação e "sem e-mail" só na extensão do banco novo');
  await passo('update_client de cliente com ID do legado grava situacao_cadastral/sem_email em gf_clientes_ext e NADA em usuarios', async () => {
    await c.vincular('900101', 'chat-1', 'ct-1');
    const x = await exec(acao('update_client', { clientId: '900101', conversationId: 'chat-1', payload: { clientId: '900101', email: '', noEmail: true, situacao_cadastral: 'dados_pendentes', treatAs: 'Aninha', onlyIfEmpty: true } }), chave('upd'));
    conferir('committed com o id', x.status === 200 && x.corpo.result.id === '900101' && x.corpo.result.situacao_cadastral === 'dados_pendentes' && x.corpo.result.noEmail === true);
    const e = await ext('900101');
    conferir('extensão: dados_pendentes e sem_email', e && e.situacao_cadastral === 'dados_pendentes' && e.sem_email === true);
    const cl = (await snap('chat-1')).clients.find((y) => y.id === '900101');
    conferir('contexto: situação devolvida', cl && cl.situacao_cadastral === 'dados_pendentes' && cl.noEmail === true);
  });
  await passo('NUNCA backfill: as demais clientes seguem com situação NULL e o contexto não inventa situação para elas', async () => {
    {
      const comSituacao = (await consulta('SELECT id_cliente FROM gf_clientes_ext WHERE situacao_cadastral IS NOT NULL ORDER BY id_cliente')).map((l) => l.id_cliente);
      conferir('só quem passou pelo fluxo tem situação', comSituacao.every((id) => [IDS.pendente, IDS.semEmail, IDS.aprovada, '900101', '777001'].includes(id)), JSON.stringify(comSituacao));
      await exec(acao('update_client', { clientId: '900102', conversationId: 'chat-2', payload: { clientId: '900102', treatAs: 'Bi', onlyIfEmpty: true } }), chave('upd'));
      const e2 = await ext('900102');
      conferir('cliente que não mandou situação continua NULL', !e2 || e2.situacao_cadastral === null);
      await c.vincular('900102', 'chat-2', 'ct-chat-2');
      const cl = (await snap('chat-2')).clients.find((y) => y.id === '900102');
      conferir('a cliente antiga está no contexto', Boolean(cl));
      conferir('contexto sem situacao_cadastral para NULL (não avaliada)', cl && cl.situacao_cadastral === undefined);
      conferir('cadastro antigo continua sem nome completo, nascimento nem e-mail no snapshot (privacidade)', cl && !('fullName' in cl) && !('birthDate' in cl) && !('email' in cl) && !('noEmail' in cl));
    }
  });
  await passo('situação inválida no update (ex.: perfil Pré-pago no lugar): 422; Pré/Pós não vira situação', async () => {
    const x = await exec(atualizar(IDS.pendente, { situacao_cadastral: 'Pré-pago' }), chave('upd'));
    conferir('422', x.status === 422 && x.corpo.error.code === 'LILLY_CLIENT_INVALID');
  });
};
