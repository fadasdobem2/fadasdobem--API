'use strict';

const assert = require('assert');
const { dados } = require('./ambiente');
const review = (r, status) => {
  status(r, 409, 'CLIENT_DUPLICATE_REVIEW');
  const revisao = r.j.duplicateReview;
  assert.match(revisao?.token, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(revisao.candidates) && revisao.candidates.length);
  return revisao;
};

module.exports = async (a, { passo, status }) => {
  await passo('telefone do legado somente leitura também exige revisão sem criar duplicata silenciosa', async () => {
    const antes = await a.contagem();
    const revisao = review(await a.criar(dados({ phones: ['+55 11 97777-9999'] })), status);
    assert.ok(revisao.candidates.some((c) => c.clientId === '900014' && c.reasons.includes('whatsapp')));
    assert.equal(await a.contagem(), antes); assert.equal(a.chamadas.escritas, 0);
  });
  await passo('CPF existente bloqueia criação inclusive após confirmar a revisão', async () => {
    const antes = await a.contagem();
    const changes = dados({ cpf: '52998224725' }); const chave = a.chave();
    const revisao = review(await a.criar(changes, chave), status);
    assert.equal(revisao.blockedByCpf, true); assert.ok(revisao.candidates.some((c) => c.reasons.includes('cpf')));
    review(await a.criar(changes, chave, undefined, { duplicateReviewToken: revisao.token }), status);
    assert.equal(await a.contagem(), antes);
  });
  await passo('telefone coincidente pede revisão; confirmação explícita cria outra cliente com a mesma chave', async () => {
    const original = dados({ name: 'Origem Telefone' });
    const criada = await a.criar(original); status(criada, 200);
    const changes = dados({ phones: original.phones }); const chave = a.chave(); const antes = await a.contagem();
    const revisao = review(await a.criar(changes, chave), status);
    assert.equal(revisao.blockedByCpf, false);
    assert.ok(revisao.candidates.some((c) => c.clientId === criada.j.clientId && c.reasons.includes('whatsapp')));
    assert.equal(await a.contagem(), antes);
    const extra = { duplicateReviewToken: revisao.token };
    const confirmada = await a.criar(changes, chave, undefined, extra); status(confirmada, 200);
    assert.notEqual(confirmada.j.clientId, criada.j.clientId); assert.equal(await a.contagem(), antes + 1);
    const replay = await a.criar(changes, chave, undefined, extra); status(replay, 200); assert.deepEqual(replay.j, confirmada.j);
    assert.equal(await a.contagem(), antes + 1);
  });
  await passo('novo candidato invalida revisão anterior e exige conferência atualizada', async () => {
    const original = dados({ name: 'Origem Revisão' }); status(await a.criar(original), 200);
    const changes = dados({ phones: original.phones }); const chave = a.chave();
    const antes = review(await a.criar(changes, chave), status);
    const outra = dados({ phones: original.phones }); const outraChave = a.chave();
    const revisaoOutra = review(await a.criar(outra, outraChave), status);
    status(await a.criar(outra, outraChave, undefined, { duplicateReviewToken: revisaoOutra.token }), 200);
    const qtd = await a.contagem();
    const atual = review(await a.criar(changes, chave, undefined, { duplicateReviewToken: antes.token }), status);
    assert.notEqual(atual.token, antes.token); assert.equal(atual.candidates.length, 2);
    assert.equal(await a.contagem(), qtd);
  });
  await passo('duas criações concorrentes do mesmo telefone não atravessam a revisão de duplicidade', async () => {
    const um = dados({ name: 'Concorrente Um' }); const dois = dados({ name: 'Concorrente Dois', phones: um.phones });
    const qtd = await a.contagem();
    const respostas = await Promise.all([a.criar(um), a.criar(dois)]);
    assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 409]);
    review(respostas.find((r) => r.status === 409), status);
    assert.equal(await a.contagem(), qtd + 1);
  });
  await passo('e-mail e nome coincidentes também aparecem na revisão de duplicidade', async () => {
    const original = dados({ fullName: 'Carolina Documento Teste', name: 'Carolina Documento', email: 'duplicidade@example.invalid' });
    const criada = await a.criar(original); status(criada, 200);
    const porEmail = review(await a.criar(dados({ email: original.email })), status);
    assert.ok(porEmail.candidates.some((c) => c.clientId === criada.j.clientId && c.reasons.includes('email')));
    const porNome = review(await a.criar(dados({ fullName: original.fullName, name: original.name })), status);
    assert.ok(porNome.candidates.some((c) => c.clientId === criada.j.clientId && c.reasons.includes('name')));
  });
  await passo('nota inicial indisponível ou inválida recusa todo o cadastro sem perda parcial', async () => {
    const qtd = await a.contagem();
    status(await a.criar(dados(), a.chave(), undefined, { initialNote: { text: 'Observação inicial' } }), 422, 'RULE_VIOLATION');
    process.env.GF_FATIA_FICHA = 'true';
    try {
      status(await a.criar(dados(), a.chave(), undefined, { initialNote: { text: '' } }), 422, 'RULE_VIOLATION');
      status(await a.criar(dados(), a.chave(), undefined, { initialNote: { text: 'x'.repeat(4001) } }), 422, 'RULE_VIOLATION');
    } finally { delete process.env.GF_FATIA_FICHA; }
    assert.equal(await a.contagem(), qtd);
  });
  await passo('nota inicial, autora, formatação e cadastro confirmam juntos; repetir não duplica nota', async () => {
    process.env.GF_FATIA_FICHA = 'true';
    try {
      const changes = dados(); const chave = a.chave();
      const text = 'Observação de teste'; const formatting = { version: 1, text, ranges: [{ start: 0, end: 10, bold: true }] };
      const extra = { initialNote: { text, formatting } };
      const criada = await a.criar(changes, chave, undefined, extra); status(criada, 200);
      assert.equal(criada.j.initialNote.clientId, criada.j.clientId);
      assert.equal(criada.j.initialNote.authorRole, 'administradora'); assert.equal(criada.j.initialNote.author, 'Equipe teste manual');
      assert.equal(criada.j.initialNote.text, text); assert.deepEqual(criada.j.initialNote.formatting, formatting);
      const repetida = await a.criar(changes, chave, undefined, extra); status(repetida, 200); assert.deepEqual(repetida.j, criada.j);
      const linhas = await a.sql('SELECT item FROM gf_clientes_notas WHERE id_cliente = ?', [criada.j.clientId]);
      assert.equal(linhas.length, 1);
      const nota = typeof linhas[0].item === 'string' ? JSON.parse(linhas[0].item) : linhas[0].item;
      assert.deepEqual(nota, criada.j.initialNote);
      const auditorias = await a.sql("SELECT entidade_id, ator_conta_id FROM gf_auditoria WHERE acao = 'cadastros.cliente.criar' AND entidade_id = ?", [criada.j.clientId]);
      assert.equal(auditorias.length, 1); assert.equal(auditorias[0].ator_conta_id, a.usuario);
    } finally { delete process.env.GF_FATIA_FICHA; }
  });
  await passo('falha ao gravar nota reverte cliente e operação; a mesma tentativa pode ser refeita', async () => {
    const antes = await a.contagem(); const chave = a.chave(); const changes = dados(); const extra = { initialNote: { text: 'Nota da transação interrompida' } };
    process.env.GF_FATIA_FICHA = 'true';
    await a.sql("CREATE FUNCTION fdb_cmn_recusar_nota() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha simulada de nota'; END $$");
    try {
      await a.sql('CREATE TRIGGER fdb_cmn_recusar_nota BEFORE INSERT ON gf_clientes_notas FOR EACH ROW EXECUTE FUNCTION fdb_cmn_recusar_nota()');
      try { status(await a.criar(changes, chave, undefined, extra), 503, 'SERVICE_UNAVAILABLE'); }
      finally { await a.sql('DROP TRIGGER IF EXISTS fdb_cmn_recusar_nota ON gf_clientes_notas'); }
      assert.equal(await a.contagem(), antes);
      assert.equal(Number((await a.sql('SELECT COUNT(*) AS n FROM gf_operacoes WHERE chave = ?', [chave]))[0].n), 0);
      const repetida = await a.criar(changes, chave, undefined, extra); status(repetida, 200);
      assert.equal(await a.contagem(), antes + 1); assert.equal(repetida.j.initialNote.text, extra.initialNote.text);
    } finally { await a.sql('DROP FUNCTION IF EXISTS fdb_cmn_recusar_nota()'); delete process.env.GF_FATIA_FICHA; }
  });
};
