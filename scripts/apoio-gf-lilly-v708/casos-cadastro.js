'use strict';

/**
 * register_client v708: quem pagou sem passar os dados vira cadastro no BANCO NOVO com nomes vazios, nascimento NULL e `dados_pendentes`; o ID real
 * só sai depois do commit; idempotência; duplicidade; vínculo; contexto; autorização (`registrationApproval`). Nada no legado.
 */

const { createHash } = require('crypto');

module.exports = async (c) => {
  const { r, acao, exec, validar, conciliar, consulta, contar, conferir, passo, chave, igual, evento, servico, IDS, vinculos, avulso } = c;
  const pendente = (extra = {}, sobre = {}) => acao('register_client', {
    clientId: undefined, conversationId: 'chat-n1',
    payload: { name: '', fullName: '', identificationName: '', treatAs: '', birthDate: null, email: '', noEmail: false, phone: '+55 11 98765-0001', situacao_cadastral: 'dados_pendentes', allowMissingName: true,
      sourceContactId: 'ct-n1', sourceConversationId: 'chat-n1', normalizeName: true, preservePreferences: true, allowMissingEmail: true, allowMissingBirthDate: true, ...extra },
    ...sobre,
  });
  const novos = () => contar('gf_clientes_novos');
  const linha = async (id) => (await consulta('SELECT * FROM gf_clientes_novos WHERE id_cliente = :id', { id }))[0];
  const ext = async (id) => (await consulta('SELECT * FROM gf_clientes_ext WHERE id_cliente = :id', { id }))[0];
  const snap = async (conversationId) => (await servico.montarContexto({ event: { id: 'umbler:CTX', type: 'message', at: new Date().toISOString(), conversationId, actor: 'client', internal: false, data: {} } }, { agora: new Date(), semCacheRetorno: true })).snapshot;
  Object.assign(c, { pendente, linha, ext, snap, novos });

  console.log('register_client (banco novo)');
  await passo('cadastro novo DESLIGADO (padrão): como antes, 4xx e nada gravado', async () => {
    const a = pendente();
    const v = await validar(a);
    conferir('validate recusa', v.status === 200 && v.corpo.allowed === false);
    const x = await exec(a, chave('reg'));
    conferir('422 LILLY_CLIENT_CREATION_NOT_ENABLED', x.status === 422 && x.corpo.error.code === 'LILLY_CLIENT_CREATION_NOT_ENABLED');
    conferir('nada gravado', (await novos()) === 0);
  });

  process.env.GF_LILLY_CADASTRO_NOVO_ENABLED = 'true';
  await evento('umbler:N1', { conversationId: 'chat-n1', contactId: 'ct-n1' });
  const k1 = chave('reg');
  let primeiro;
  await passo('pagou sem dados: cria no banco novo com nomes VAZIOS, nascimento NULL, situação dados_pendentes; ID real só depois do commit', async () => {
    const a = pendente();
    const v = await validar(a);
    conferir('validate permite', v.status === 200 && v.corpo.allowed === true);
    conferir('validate não gravou nada', (await novos()) === 0);
    primeiro = await exec(a, k1);
    const res = primeiro.corpo.result;
    conferir('200 committed com ID real da faixa nova', primeiro.status === 200 && primeiro.corpo.committed === true && /^1\d{9}$/.test(res.id) && Number(res.id) >= 1000000000);
    conferir('result: pendente, Pré-pago, sem nome inventado', res.situacao_cadastral === 'dados_pendentes' && res.paymentType === 'Pré-pago' && res.postpaid === false && !res.name && !res.identificationName && !res.birthDate && res.noEmail === false && res.phone === '+5511987650001');
    const l = await linha(res.id);
    conferir('gf_clientes_novos: nomes vazios e nascimento NULL (nada inventado)', l && l.nome === '' && l.nome_id === '' && l.nome2 === '' && l.data_nascimento === null && l.telefone === '+5511987650001' && l.origem === 'lilly');
    const e = await ext(res.id);
    conferir('extensão: situação dados_pendentes, Pré-pago SEPARADO da situação, sem linha no legado', e && e.situacao_cadastral === 'dados_pendentes' && e.perfil_pagamento === 'Pré-pago' && e.legado_estado === 'sem_registro' && e.sem_email === false);
    conferir('o ID commitado é o que está no banco (devolvido depois do commit)', (await novos()) === 1);
    const vi = await vinculos.buscarAtivoDaConversa(avulso, 'chat-n1');
    conferir('vínculo cliente x contato x conversa criado e verificado (a Lilly precisa dele para ligar o Pix)', vi && vi.clientId === res.id && vi.contactId === 'ct-n1' && vi.verified === true);
    conferir('auditoria da Lilly', (await contar('gf_auditoria', "acao = 'lilly.register_client' AND entidade_id = :id", { id: res.id })) === 1);
    IDS.pendente = res.id;
  });
  await passo('repetição com a mesma Idempotency-Key: MESMO ID, sem segundo cadastro; corpo diferente: 409; GET concilia', async () => {
    const rep = await exec(pendente(), k1);
    conferir('mesmo resultado', rep.status === 200 && igual(rep.corpo, primeiro.corpo));
    conferir('um cadastro só', (await novos()) === 1 && (await contar('gf_clientes_ext', "id_cliente = :id", { id: IDS.pendente })) === 1);
    conferir('corpo diferente: 409', (await exec(pendente({ phone: '+55 11 98765-0009' }), k1)).status === 409);
    const g = await conciliar(k1);
    conferir('GET: committed com o ID real', g.status === 200 && g.corpo.committed === true && g.corpo.result.id === IDS.pendente);
    conferir('GET de chave desconhecida: not_executed', (await conciliar('nunca-vista-1234')).corpo.state === 'not_executed');
  });
  await passo('NÃO duplica: outra chave com o mesmo telefone ou na mesma conversa => 409, nada criado', async () => {
    await evento('umbler:N2', { conversationId: 'chat-n2', contactId: 'ct-n2' });
    const mesmoFone = await exec(pendente({ sourceContactId: 'ct-n2', sourceConversationId: 'chat-n2' }, { conversationId: 'chat-n2' }), chave('reg'));
    conferir('telefone já cadastrado: 409 LILLY_CLIENT_DUPLICATE_PHONE', mesmoFone.status === 409 && mesmoFone.corpo.error.code === 'LILLY_CLIENT_DUPLICATE_PHONE');
    const mesmaConversa = await exec(pendente({ phone: '+55 11 98765-0002' }), chave('reg'));
    conferir('conversa já vinculada: 409 LILLY_CLIENT_ALREADY_LINKED', mesmaConversa.status === 409 && mesmaConversa.corpo.error.code === 'LILLY_CLIENT_ALREADY_LINKED');
    legadoComTelefone(c, '1198765 0777');
    const noLegado = await exec(pendente({ phone: '+55 11 99876-0777', sourceContactId: 'ct-n2', sourceConversationId: 'chat-n2' }, { conversationId: 'chat-n2' }), chave('reg'));
    conferir('telefone que já é de cliente do LEGADO (somente leitura): 409, não cria outro ID', noLegado.status === 409 && noLegado.corpo.error.code === 'LILLY_CLIENT_DUPLICATE_PHONE' && /900101/.test(noLegado.corpo.error.message));
    conferir('continua um cadastro', (await novos()) === 1);
  });
  await passo('falha NO MEIO da gravação: nada fica e nenhum ID é devolvido (o ID só existe depois do commit)', async () => {
    const k = chave('reg-falha');
    const { AUDIT_INSERT, linhaDeAuditoria } = require(r('src/gestao-fadas/_comum/auditoria'));
    const opKey = `lilly:${createHash('sha256').update(`${k}|register_client`, 'utf8').digest('hex').slice(0, 40)}`;
    await evento('umbler:N3', { conversationId: 'chat-n3', contactId: 'ct-n3' });
    // Colisão proposital na auditoria (chave de operação única): a gravação já passou pelo INSERT do cadastro quando a auditoria falha.
    await avulso.execute(AUDIT_INSERT, linhaDeAuditoria({ actorUserId: process.env.LILLY_SERVICE_USER_ID, actorRole: 'atendente', action: 'teste.colisao', entity: 'cliente', entityId: 'x' }, { id: require('crypto').randomUUID(), agora: Date.now(), chave: opKey }));
    const x = await exec(pendente({ phone: '+55 11 98765-0033', sourceContactId: 'ct-n3', sourceConversationId: 'chat-n3' }, { conversationId: 'chat-n3' }), k);
    conferir('resposta de falha (não é committed:true e não traz ID)', x.status >= 400 && x.corpo.committed !== true && !(x.corpo.result && x.corpo.result.id));
    conferir('rollback: nenhum cadastro, extensão nem vínculo novo', (await novos()) === 1 && (await contar('gf_lilly_vinculos', "umbler_conversation_id = 'chat-n3'")) === 0);
    conferir('GET: not_executed (a Lilly pode repetir sem medo)', (await conciliar(k)).corpo.state === 'not_executed');
  });
  await passo('contexto devolve a cliente com situacao_cadastral, sem nome inventado, com o vínculo (a Lilly relê depois do commit)', async () => {
    const s = await snap('chat-n1');
    const cl = s.clients.find((x) => x.id === IDS.pendente);
    conferir('cliente no contexto com situacao_cadastral dados_pendentes', cl && cl.situacao_cadastral === 'dados_pendentes');
    conferir('nomes ausentes (nunca o ID no lugar do nome) e telefone formatado', cl && cl.name === undefined && cl.fullName === undefined && cl.identificationName === undefined && cl.phone === '+55 11 98765-0001' && cl.noEmail === false);
    conferir('nascimento ausente (nunca data fictícia)', cl && cl.birthDate === undefined);
    conferir('vínculo no contexto', s.links.some((l) => l.clientId === IDS.pendente && l.conversationId === 'chat-n1' && l.verified === true && l.active === true));
    conferir('tipo de pagamento Pré (separado da situação)', cl && cl.paymentType === 'pre');
  });

  console.log('register_client: validações da API (autoridade das regras)');
  await passo('recusas 422 (e validate allowed:false): situação que não confere, nome-placeholder, data inválida, e-mail, noEmail com e-mail, telefone sem DDD', async () => {
    const casos = [
      ['"completo" com dados faltando', { situacao_cadastral: 'completo' }, 'LILLY_CLIENT_STATUS_MISMATCH'],
      ['"dados_pendentes" com tudo preenchido', { name: 'Maria Souza', fullName: 'Maria Souza', birthDate: '1990-05-17', email: 'maria@teste.local', situacao_cadastral: 'dados_pendentes' }, 'LILLY_CLIENT_STATUS_MISMATCH'],
      ['nome "ID 95000"', { name: 'ID 95000', fullName: 'ID 95000' }, 'LILLY_CLIENT_INVALID'],
      ['nome "AGUARDANDO DADOS PARA CADASTRO"', { name: 'AGUARDANDO DADOS PARA CADASTRO', fullName: 'AGUARDANDO DADOS PARA CADASTRO' }, 'LILLY_CLIENT_INVALID'],
      ['name x fullName diferentes', { name: 'Ana Lima', fullName: 'Ana Souza' }, 'LILLY_CLIENT_INVALID'],
      ['nascimento 31/02', { birthDate: '2020-02-31' }, 'LILLY_CLIENT_INVALID'],
      ['nascimento no futuro', { birthDate: '2999-01-01' }, 'LILLY_CLIENT_INVALID'],
      ['e-mail inválido', { email: 'nao-e-email' }, 'LILLY_CLIENT_INVALID'],
      ['noEmail com e-mail', { email: 'a@b.co', noEmail: true }, 'LILLY_CLIENT_INVALID'],
      ['telefone sem DDD', { phone: '98765-4321' }, 'LILLY_CLIENT_INVALID'],
      ['situação desconhecida', { situacao_cadastral: 'pronto' }, 'LILLY_CLIENT_INVALID'],
      ['conversa de origem diferente da ação', { sourceConversationId: 'outra-conversa' }, 'LILLY_CLIENT_INVALID'],
    ];
    for (const [nome, extra, code] of casos) {
      const a = pendente({ phone: '+55 11 98765-0044', ...extra });
      const v = await validar(a);
      const x = await exec(a, chave('reg'));
      conferir(`${nome}: validate recusa e execução 422 ${code}`, v.corpo.allowed === false && x.status === 422 && x.corpo.error.code === code);
    }
    conferir('nada foi criado', (await novos()) === 1);
  });

  console.log('register_client: autorização do cadastro (registrationApproval)');
  await passo('com GF_LILLY_CADASTRO_EXIGE_APROVACAO: sem prova, flag solta, evento de cliente, assinatura que não confere => 403; prova de atendente => cria', async () => {
    process.env.GF_LILLY_CADASTRO_EXIGE_APROVACAO = 'true';
    const { assinaturaDosDados } = require(r('src/gestao-fadas/features/lilly/executores/cliente.aprovacao'));
    await evento('umbler:N4', { conversationId: 'chat-n4', contactId: 'ct-n4' });
    await evento('umbler:AUT-OK', { conversationId: 'chat-n4', contactId: 'ct-n4', staff: true });
    await evento('umbler:AUT-CLI', { conversationId: 'chat-n4', contactId: 'ct-n4' });
    const base = pendente({ phone: '+55 11 98765-0055', sourceContactId: 'ct-n4', sourceConversationId: 'chat-n4', proposalId: 'registration-proposal:chat-n4:1' }, { conversationId: 'chat-n4' });
    const prova = (evId, payload = base.payload) => ({ proposalId: 'registration-proposal:chat-n4:1', authorizedEventId: evId, authorizedBy: 'membro-autorizada', payloadSignature: assinaturaDosDados(payload) });
    const sem = await exec(base, chave('reg'));
    conferir('sem registrationApproval: 403', sem.status === 403 && sem.corpo.error.code === 'LILLY_REGISTRATION_APPROVAL_MISSING');
    const solta = await exec({ ...base, payload: { ...base.payload, humanConfirmed: true, approved: true } }, chave('reg'));
    conferir('flag inventada no payload não vale: 403', solta.status === 403);
    const deCliente = await exec({ ...base, registrationApproval: prova('umbler:AUT-CLI') }, chave('reg'));
    conferir('evento de cliente (não staffAuthorized): 403', deCliente.status === 403);
    const naoExiste = await exec({ ...base, registrationApproval: prova('umbler:NAO-EXISTE') }, chave('reg'));
    conferir('evento inexistente: 403', naoExiste.status === 403);
    const mudou = await exec({ ...base, registrationApproval: prova('umbler:AUT-OK', { ...base.payload, birthDate: '1990-01-01' }) }, chave('reg'));
    conferir('assinatura dos dados não confere com o payload (dados mudaram depois): 403', mudou.status === 403);
    const outroAutor = await exec({ ...base, registrationApproval: { ...prova('umbler:AUT-OK'), authorizedBy: 'outra-pessoa' } }, chave('reg'));
    conferir('autorizador diferente do evento: 403', outroAutor.status === 403);
    conferir('nada criado até aqui', (await novos()) === 1);
    const v = await validar({ ...base, registrationApproval: prova('umbler:AUT-OK') });
    conferir('validate com a prova correta permite', v.corpo.allowed === true);
    const ok = await exec({ ...base, registrationApproval: prova('umbler:AUT-OK') }, chave('reg'));
    conferir('prova de atendente na MESMA conversa, com assinatura certa: cria', ok.status === 200 && /^1\d{9}$/.test(ok.corpo.result.id));
    IDS.aprovada = ok.corpo.result.id;
    delete process.env.GF_LILLY_CADASTRO_EXIGE_APROVACAO;
  });
};

/** Troca a busca por telefone do legado simulado: o número já pertence à cliente 900101 (somente leitura). */
function legadoComTelefone({ definirFontes, legado }, _texto) {
  const u = legado.usuarios.find((x) => `${x.id}` === '900101');
  u.cel = '99876-0777'; u.ddd = '11'; u.ddd_real = 11;
  definirFontes({ ...legado.fontes, usuariosPorIds: legado.fontes.usuariosPorIds, usuariosPorTelefone: legado.fontes.usuariosPorTelefone, pagamentosLegado: async () => ({ informed: [], confirmed: [] }) });
}
