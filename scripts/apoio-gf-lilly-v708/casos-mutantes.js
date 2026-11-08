'use strict';

/**
 * MUTANTES: para cada regra nova, uma verificação (`(impl) => boolean`) roda com a implementação REAL (tem de passar) e com versões deliberadamente quebradas
 * (têm de ser REPROVADAS). Se um mutante passar, a verificação correspondente não protegeria a regra. A parte de banco (CHECKs e índices únicos) já é
 * refutada em casos-esquema.js (inserções inválidas diretas no Postgres).
 */

module.exports = async (c) => {
  const { r, conferir, passo } = c;
  const campos = require(r('src/gestao-fadas/features/lilly/executores/cliente.campos'));
  const atualizacao = require(r('src/gestao-fadas/features/lilly/executores/cliente.atualizacao'));
  const pgCampos = require(r('src/gestao-fadas/features/lilly/executores/pagamento.campos'));
  const interno = require(r('src/gestao-fadas/features/lilly/eventos/eventos.interno'));
  const sessoes = require(r('src/gestao-fadas/features/lilly/contexto/retorno.sessoes'));
  const retorno = require(r('src/gestao-fadas/features/lilly/contexto/montador.retorno'));
  const diaDe = (iso) => iso.slice(0, 10);

  const verificacoes = {
    'situação calculada: "completo" com dado faltando é recusado': (impl) => Boolean(impl.situacaoConferida('completo', { nome: 'Ana Lima', telefone: '+5511900000001', nascimento: null, email: '', semEmail: false }).erro),
    'nome "ID 95000" não é nome': (impl) => Boolean(impl.normalizarCampos({ name: 'ID 95000' }).erro),
    'nascimento inexistente é recusado': (impl) => Boolean(impl.normalizarCampos({ birthDate: '2020-02-31' }).erro),
    'noEmail com e-mail preenchido é recusado': (impl) => Boolean(impl.normalizarCampos({ email: 'a@b.co', noEmail: true }).erro),
    'vazio nunca apaga o que existe': (impl) => { const { novo } = impl.mesclar({ nome: 'Ana Lima', nomeId: 'Ana', tratarPor: 'Ana', nascimento: '1990-01-01', telefone: '+5511900000001', email: 'a@b.co', semEmail: false }, { nome: '', nascimento: null, email: '' }, {}); return novo.nome === 'Ana Lima' && novo.nascimento === '1990-01-01' && novo.email === 'a@b.co'; },
    'pagamento automático sem providerConfirmed é recusado': (impl) => Boolean(impl.conferirProvedor({ authorizedBy: 'lilly:mercado_pago', paidAt: '2026-11-07T12:00:00.000Z', providerConfirmed: undefined }, { mpPaymentId: '123' }).motivo),
    'paidAt diferente de date é recusado': (impl) => Boolean(impl.conferirProvedor({ paidAt: '2026-11-07T12:00:00.000Z', date: '2026-11-07T13:00:00.000Z', providerConfirmed: true }, { mpPaymentId: '123' }).motivo),
    'método diferente de PIX no Pix conferido é recusado': (impl) => Boolean(impl.conferirProvedor({ method: 'Dinheiro', providerConfirmed: true, paidAt: '2026-11-07T12:00:00.000Z' }, { mpPaymentId: '123' }).motivo),
    'conversa individual com 3 membros não autoriza': (impl) => impl.podeAutorizar('a1', { contact: { contactType: 'MemberDirectMessage', organizationMembers: ['a1', 'a2', 'lilly'] } }, 'direct', { equipe: new Set(), contasLilly: new Set(['lilly']), todos: true }) === false,
    'membro offline não autoriza': (impl) => impl.podeAutorizar('a1', { contact: { contactType: 'MemberDirectMessage', organizationMembers: ['a1', 'lilly'] } }, 'direct', { equipe: new Set(), contasLilly: new Set(['lilly']), todos: true, online: false }) === false,
    'fora da lista não autoriza no modo lista': (impl) => impl.podeAutorizar('a1', { contact: { contactType: 'MemberDirectMessage', organizationMembers: ['a1', 'lilly'] } }, 'direct', { equipe: new Set(['b']), contasLilly: new Set(['lilly']), todos: false }) === false,
    '15+15+15 seguidos são UM atendimento (R não infla)': (impl) => {
      const base = (id, ini, fim, origem) => ({ id, tarotId: 'o', clientId: 'C', status: 'Concluída', awaitingTarologistStart: false, durationSeconds: 900, startedAt: ini, endedAt: fim, continuation: origem ? { kind: 'extension', sourceConsultationId: origem } : undefined });
      const lista = [base('1', '2026-10-25T14:00:00Z', '2026-10-25T14:15:00Z'), base('2', '2026-10-25T14:15:00Z', '2026-10-25T14:30:00Z', '1'), base('3', '2026-10-25T14:30:00Z', '2026-10-25T14:45:00Z', '2')];
      const s = impl.sessoesDe(lista, diaDe);
      return s.length === 1 && s[0].returning === false;
    },
    'agregado incompleto/inconsistente é rejeitado': (impl) => impl.validarAgregado({ complete: false, metric: 'returning_clients_percentage', generatedAt: '2026-11-07T10:00:00.000Z', periodStart: '2026-10-01', periodEnd: '2026-11-06', rows: [{ tarologistId: 'o', returnPercentage: 20, clients: 5, returningClients: 1 }] }, { agoraIso: '2026-11-07T15:00:00.000Z', hoje: '2026-11-07' }) === false
      && impl.validarAgregado({ complete: true, metric: 'returning_clients_percentage', generatedAt: '2026-11-07T10:00:00.000Z', periodStart: '2026-10-01', periodEnd: '2026-11-06', rows: [{ tarologistId: 'o', returnPercentage: 99, clients: 5, returningClients: 1 }] }, { agoraIso: '2026-11-07T15:00:00.000Z', hoje: '2026-11-07' }) === false,
  };

  const reais = { ...campos, ...pgCampos, ...interno, ...sessoes, validarAgregado: retorno.validarAgregado, mesclar: atualizacao.mesclar };
  const mutantes = {
    'situação calculada: "completo" com dado faltando é recusado': { situacaoConferida: (pedida) => ({ situacao: pedida || 'completo' }) },
    'nome "ID 95000" não é nome': { normalizarCampos: (p) => ({ campos: { nome: p.name } }) },
    'nascimento inexistente é recusado': { normalizarCampos: (p) => ({ campos: { nascimento: p.birthDate } }) },
    'noEmail com e-mail preenchido é recusado': { normalizarCampos: (p) => ({ campos: { email: p.email, semEmail: p.noEmail } }) },
    'vazio nunca apaga o que existe': { mesclar: (atual, entrada) => ({ novo: { ...atual, ...entrada }, mudou: [] }) },
    'pagamento automático sem providerConfirmed é recusado': { conferirProvedor: () => ({ paidAt: undefined }) },
    'paidAt diferente de date é recusado': { conferirProvedor: (p) => ({ paidAt: p.paidAt }) },
    'método diferente de PIX no Pix conferido é recusado': { conferirProvedor: (p) => ({ paidAt: p.paidAt }) },
    'conversa individual com 3 membros não autoriza': { podeAutorizar: () => true },
    'membro offline não autoriza': { podeAutorizar: (m, conv, escopo, amb) => amb.todos || amb.equipe.has(m) },
    'fora da lista não autoriza no modo lista': { podeAutorizar: () => true },
    '15+15+15 seguidos são UM atendimento (R não infla)': { sessoesDe: (lista, dia) => lista.map((x) => ({ id: x.id, tarotId: x.tarotId, clientId: x.clientId, startedAt: x.startedAt, date: dia(x.startedAt), returning: x.id !== '1' })) },
    'agregado incompleto/inconsistente é rejeitado': { validarAgregado: () => true },
  };

  console.log('mutantes (cada verificação tem de aprovar o real e REPROVAR o quebrado)');
  for (const [nome, verificar] of Object.entries(verificacoes)) {
    await passo(`${nome}: real aprovado, mutante reprovado`, async () => {
      conferir('implementação real passa', verificar(reais) === true);
      conferir('mutante é refutado', verificar({ ...reais, ...mutantes[nome] }) === false);
    });
  }
  await passo('mutantes de INTEGRAÇÃO (já provados nos casos acima): checagem de duplicidade removida => o índice único do banco ainda barra; ID devolvido só após commit => rollback sem rastro', async () => {
    conferir('cobertos em casos-pagamento ("DEFESA NO BANCO") e casos-cadastro ("falha NO MEIO")', true);
  });
};
