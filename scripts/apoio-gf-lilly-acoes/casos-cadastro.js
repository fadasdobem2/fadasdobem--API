'use strict';

/** register_client (só completa ID existente; sem ID = 4xx) e update_client (treatAs, onlyIfEmpty, sourceMessageIds). */

module.exports = async ({ igual, acao, exec, validar, consulta, contar, conferir, passo, chave, legadoTratarPor }) => {
  const registro = (extra = {}) => acao('register_client', {
    clientId: '900102', conversationId: 'chat-2',
    payload: { name: 'Maria da Silva', identificationName: 'Maria Silva', treatAs: 'Mari', birthDate: '1990-05-17', phone: '+55 11 91234-5678', normalizeName: true, preservePreferences: true, allowMissingEmail: true, allowMissingBirthDate: true, channel: 'WhatsApp', ddd: '11', minutes: 30, ...extra },
  });
  const obj = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  const extensao = async (id) => (await consulta('SELECT perfil_pagamento, dados, revisao FROM gf_clientes_ext WHERE id_cliente = :id', { id }))[0];

  console.log('register_client');
  await passo('SEM ID: validate allowed:false (200) e execução 422 LILLY_CLIENT_CREATION_NOT_ENABLED, nada gravado', async () => {
    const semId = acao('register_client', { clientId: undefined, payload: { name: 'Fulana Nova', normalizeName: true } });
    const v = await validar(semId);
    conferir('validate recusa com motivo', v.status === 200 && v.corpo.allowed === false && /depende de decisão/.test(v.corpo.reason));
    const x = await exec(semId, chave('reg'));
    conferir('422 definitivo (não 5xx)', x.status === 422 && x.corpo.error.code === 'LILLY_CLIENT_CREATION_NOT_ENABLED' && /Cadastro novo ainda depende de decisão/.test(x.corpo.error.message));
    conferir('nada gravado em gf_clientes_ext', (await contar('gf_clientes_ext')) === 0);
  });
  await passo('ID que não existe: 422 e nada criado (mesmo com a ação de cadastro novo ligada ou não)', async () => {
    const x = await exec(acao('register_client', { clientId: '999999', payload: { name: 'Fantasma' } }), chave('reg'));
    conferir('4xx', x.status >= 400 && x.status < 500 && x.corpo.error.code.startsWith('LILLY_CLIENT_'));
    process.env.GF_LILLY_CADASTRO_LEGADO_ENABLED = 'true';
    const y = await exec(acao('register_client', { clientId: undefined, payload: { name: 'Fulana' } }), chave('reg'));
    conferir('flag NOVA ligada = 422 "não implementado", sem escrita no legado', y.status === 422 && y.corpo.error.code === 'LILLY_CLIENT_CREATION_NOT_IMPLEMENTED');
    delete process.env.GF_LILLY_CADASTRO_LEGADO_ENABLED;
    conferir('nada gravado', (await contar('gf_clientes_ext')) === 0);
  });
  const k1 = chave('reg');
  let primeiro;
  await passo('ID existente: completa o cadastro (nome de identificação, tratar por, nascimento, WhatsApp, Pré-pago) e devolve o result do contrato', async () => {
    const v = await validar(registro());
    conferir('validate permite', v.corpo.allowed === true);
    primeiro = await exec(registro(), k1);
    const res = primeiro.corpo.result;
    conferir('200 committed com id', primeiro.status === 200 && primeiro.corpo.committed === true && res.id === '900102');
    conferir('paymentType e postpaid sempre presentes', res.paymentType === 'Pré-pago' && res.postpaid === false);
    conferir('campos do cadastro', res.identificationName === 'Maria Silva' && res.name === 'Maria da Silva' && res.birthDate === '1990-05-17' && res.phone === '+55 11 91234-5678' && res.ddd === '11' && res.minutes === 30);
    const e = await extensao('900102');
    const d = obj(e.dados);
    conferir('gf_clientes_ext', e.perfil_pagamento === 'Pré-pago' && d.name === 'Maria Silva' && d.treatAs === 'Mari' && d.birthDate === '17/05/1990');
    conferir('auditoria da Lilly + do serviço', (await contar('gf_auditoria', "acao = 'lilly.register_client' AND entidade_id = '900102'")) === 1 && (await contar('gf_auditoria', "acao = 'cadastros.cliente.editar'")) === 1);
  });
  await passo('repetição (mesma chave e corpo): mesmo result, SEM segundo efeito; corpo diferente: 409', async () => {
    const antes = await extensao('900102');
    const rep = await exec(registro(), k1);
    conferir('mesmo resultado', rep.status === 200 && igual(rep.corpo, primeiro.corpo));
    const depois = await extensao('900102');
    conferir('revisão intacta e uma auditoria', Number(depois.revisao) === Number(antes.revisao) && (await contar('gf_auditoria', "acao = 'lilly.register_client'")) === 1);
    const outro = await exec(registro({ identificationName: 'Outra Pessoa' }), k1);
    conferir('409 OPERATION_KEY_CONFLICT', outro.status === 409 && outro.corpo.error.code === 'OPERATION_KEY_CONFLICT');
  });
  await passo('cliente já com tratar por: preservePreferences NÃO sobrescreve; e vínculo de outra cliente na conversa recusa', async () => {
    const x = await exec(registro({ identificationName: 'Nome Que Nao Vale', treatAs: 'Outro' }), chave('reg'));
    conferir('committed sem mudar nome nem tratar por', x.status === 200 && x.corpo.result.identificationName === 'Maria Silva');
    const d = obj((await extensao('900102')).dados);
    conferir('tratar por e nome preservados', d.treatAs === 'Mari' && d.name === 'Maria Silva');
    const outra = await exec(acao('register_client', { clientId: '900102', conversationId: 'chat-1', payload: { name: 'X' } }), chave('reg'));
    conferir('conversa vinculada a outra cliente: 4xx', outra.status === 422 && /outra cliente/.test(outra.corpo.error.message));
  });

  console.log('update_client');
  const preferencia = (extra = {}) => acao('update_client', { clientId: '900101', conversationId: 'chat-1', payload: { clientId: '900101', treatAs: 'Bia', onlyIfEmpty: true, sourceMessageIds: ['m-1', 'm-2'], preservePreferences: true, ...extra } });
  const k2 = chave('upd');
  await passo('treatAs vazio: grava e devolve {id}; guarda sourceMessageIds na auditoria', async () => {
    const x = await exec(preferencia(), k2);
    conferir('result.id = clientId da ação', x.status === 200 && x.corpo.result.id === '900101' && x.corpo.result.treatAs === 'Bia');
    const d = obj((await extensao('900101')).dados);
    conferir('gravado em gf_clientes_ext', d.treatAs === 'Bia');
    conferir('sourceMessageIds na auditoria', (await contar('gf_auditoria', "acao = 'lilly.update_client' AND motivo = 'sourceMessageIds:m-1,m-2'")) === 1);
  });
  await passo('onlyIfEmpty: campo preenchido (por inferência anterior) NÃO é sobrescrito; sem mudança = sem gravar no serviço', async () => {
    const antes = (await extensao('900101')).revisao;
    const x = await exec(preferencia({ treatAs: 'Outra' }), chave('upd'));
    conferir('committed, nada mudou', x.status === 200 && x.corpo.result.id === '900101' && x.corpo.result.changed.length === 0);
    conferir('revisão intacta', Number((await extensao('900101')).revisao) === Number(antes) && obj((await extensao('900101')).dados).treatAs === 'Bia');
  });
  await passo('tratar por que já vem do legado também conta como preenchido', async () => {
    legadoTratarPor['900111'] = 'Lu';
    const x = await exec(acao('update_client', { clientId: '900111', conversationId: 'chat-a', payload: { clientId: '900111', treatAs: 'Luana', onlyIfEmpty: true } }), chave('upd'));
    conferir('não sobrescreve', x.status === 200 && x.corpo.result.changed.length === 0 && (await contar('gf_clientes_ext', "id_cliente = '900111'")) === 0);
  });
  await passo('repetição idempotente e corpo diferente 409; cliente inexistente 4xx', async () => {
    const auditorias = () => contar('gf_auditoria', "acao = 'lilly.update_client' AND entidade_id = '900101'");
    const antes = await auditorias();
    const rep = await exec(preferencia(), k2);
    conferir('mesma resposta, sem auditoria nova', rep.status === 200 && rep.corpo.result.treatAs === 'Bia' && (await auditorias()) === antes);
    const dif = await exec(preferencia({ treatAs: 'Zé' }), k2);
    conferir('409', dif.status === 409);
    const nx = await exec(acao('update_client', { clientId: '999999', payload: { clientId: '999999', treatAs: 'X' } }), chave('upd'));
    conferir('inexistente = 404 definitivo', nx.status === 404);
  });
};
