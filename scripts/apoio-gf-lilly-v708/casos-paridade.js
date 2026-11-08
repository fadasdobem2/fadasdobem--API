'use strict';

/** Paridade com o CÓDIGO REAL da Lilly (clone somente leitura): nome conhecido, campos que faltam e a assinatura da autorização do cadastro. */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

module.exports = async (c) => {
  const { r, conferir, passo, evento, avulso } = c;
  const dir = process.env.LILLY_SERVER_DIR || '/Users/patrick.developer/Desktop/Developer/Projects/Nice/fadasdobemsuspiro/fadasdobemsuspiro/Nice-github/fadasdobem-site/server/lilly';
  const arq = path.join(dir, 'registration-policy.mjs');
  console.log('paridade com o código real da Lilly');
  if (!fs.existsSync(arq)) { console.log('  (info) clone da Lilly ausente: paridade pulada'); return; }
  const lilly = await import(pathToFileURL(arq).href);
  const campos = require(r('src/gestao-fadas/features/lilly/executores/cliente.campos'));
  const { conferirAprovacao, assinaturaDosDados } = require(r('src/gestao-fadas/features/lilly/executores/cliente.aprovacao'));

  await passo('nome conhecido: a API e a Lilly concordam em todos os casos', async () => {
    const nomes = ['', '  ', 'Ana', 'Maria Souza', 'ID 95000', 'id95000', 'Aguardando dados para cadastro', 'AGUARDANDO DADOS', 'Cliente', 'cliente · 95000', 'Lead', 'sem nome', 'Nome a confirmar', 'Cadastro pendente', '12345', 'Desconhecida', 'João da Silva', 'Ana-Clara'];
    const diverge = nomes.filter((n) => lilly.registrationNameKnown(n) !== campos.nomeConhecido(n));
    conferir(`${nomes.length} nomes iguais`, diverge.length === 0, JSON.stringify(diverge));
  });
  await passo('campos que faltam: mesma lista e mesma ordem que registrationMissingFields', async () => {
    const fone = '+5511987654321';
    const pessoas = [
      { name: '', birthDate: null, email: '', noEmail: false }, { name: 'Maria Souza', birthDate: null, email: '', noEmail: false }, { name: 'Maria Souza', birthDate: '1990-05-17', email: '', noEmail: false },
      { name: 'Maria Souza', birthDate: '1990-05-17', email: '', noEmail: true }, { name: 'Maria Souza', birthDate: '1990-05-17', email: 'maria@x.co', noEmail: false }, { name: 'Maria Souza', birthDate: '1990-02-31', email: 'maria@x.co', noEmail: false },
      { name: 'Maria Souza', birthDate: '1990-05-17', email: 'sem-arroba', noEmail: false }, { name: 'ID 95000', birthDate: '1990-05-17', email: 'a@b.co', noEmail: false },
    ];
    for (const p of pessoas) {
      const dela = lilly.registrationMissingFields(p, fone);
      const nossa = campos.faltando({ nome: p.name, telefone: fone, nascimento: campos.dataValida(p.birthDate) ? p.birthDate : null, email: p.email, semEmail: p.noEmail });
      conferir(`${JSON.stringify(p)} => [${dela.join(', ')}]`, JSON.stringify(dela) === JSON.stringify(nossa), JSON.stringify(nossa));
    }
    conferir('sem telefone verificado: "telefone" falta nos dois', JSON.stringify(lilly.registrationMissingFields({ name: 'Ana Lima', birthDate: '1990-01-01', email: 'a@b.co' }, '')) === JSON.stringify(campos.faltando({ nome: 'Ana Lima', telefone: '', nascimento: '1990-01-01', email: 'a@b.co' })));
  });
  await passo('autorização do cadastro gerada pela Lilly de verdade (authorizeRegistrationAction) é aceita pela API; mudar um dado depois é recusado', async () => {
    const conversationId = 'chat-par';
    await evento('umbler:AUT-PAR', { conversationId, contactId: 'ct-par', staff: true });
    const state = { conversations: { [conversationId]: {} }, proposals: {} };
    const event = { id: 'umbler:AUT-PAR', at: new Date().toISOString(), conversationId, actor: 'staff', internal: true, clientId: '', data: { staffAuthorized: true, staffId: 'membro-autorizada' } };
    const payload = { name: 'Maria Souza', fullName: 'Maria Souza', birthDate: '1990-05-17', email: '', noEmail: true, phone: '+5511987654321', situacao_cadastral: 'completo', allowMissingName: false, identificationName: 'Maria Souza', treatAs: 'Maria', sourceContactId: 'ct-par', sourceConversationId: conversationId };
    const proposta = lilly.registrationProposal(state, [], { ...event, clientId: '' }, payload, null);
    const acao = { id: 'registration-1', conversationId, payload: structuredClone(payload) };
    const feito = lilly.authorizeRegistrationAction(state, acao, event, proposta);
    conferir('a Lilly gerou registrationApproval', feito === true && acao.registrationApproval && acao.registrationApproval.proposalId === proposta.id && acao.payload.proposalId === proposta.id);
    conferir('a assinatura é a mesma que a API calcula', acao.registrationApproval.payloadSignature === assinaturaDosDados(acao.payload));
    conferir('a API aceita a prova real', (await conferirAprovacao(avulso, acao)).motivo === null);
    const alterada = { ...acao, payload: { ...acao.payload, birthDate: '1991-05-17' } };
    conferir('dado alterado depois da autorização: a API recusa', Boolean((await conferirAprovacao(avulso, alterada)).motivo));
  });
};
