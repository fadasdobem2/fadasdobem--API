'use strict';

/** Cenários de recados por departamento, identidade do agendamento e datas de recibo do painel (ouro da área 5 v706). */

const C = require('./cenarios');

const DEPTOS = ['atendimento', 'financeiro', 'administrativo', 'supervisao', 'tarologos'];

function contasDeRecado() {
  const out = [];
  for (const papel of C.PAPEIS) {
    out.push(C.contaDe(papel, papel === 'tarologa' ? { tarotId: 'osiris' } : {}));
    out.push(C.contaDe(papel, { id: `${papel}-2`, departments: ['financeiro'], ...(papel === 'tarologa' ? { tarotId: 'osiris' } : {}) }));
    out.push(C.contaDe(papel, { id: `${papel}-3`, department: 'administrativo', departments: ['x'], ...(papel === 'tarologa' ? { tarotId: 'osiris' } : {}) }));
    out.push(C.contaDe(papel, { id: `${papel}-4`, active: false, ...(papel === 'tarologa' ? { tarotId: 'osiris' } : {}) }));
  }
  return out;
}

function notasDeRecado(contas) {
  const base = { tarot: 'X', text: 'Oi', at: '2026-10-12T10:00:00.000Z', by: 'Fulana', source: 'staff' };
  const notas = [{ ...base, id: 'legado', tarotId: 'osiris' }, { ...base, id: 'legado-nyx', tarotId: 'nyx' }];
  for (const k of ['board', 'message']) for (let i = 0; i < 14; i += 1) {
    const departments = k === 'message' ? undefined : C.pick([undefined, [], ['atendimento'], ['financeiro'], ['supervisao', 'tarologos'], ['tarologos'], ['administrativo'], [...DEPTOS]]);
    const quem = C.pick(contas);
    notas.push({ ...base, id: `${k}${i}`, tarotId: C.pick(['osiris', 'nyx', 'departments:x']), delivery: { kind: k, audience: k === 'message' ? 'person' : 'staff', senderId: C.chance(0.25) ? quem.id : 'outro', recipientIds: C.pick([[], [quem.id], [contas[0].id, quem.id]]), excludedIds: C.chance(0.2) ? [quem.id] : [], label: 'x', ...(departments === undefined ? {} : { departments }) } });
  }
  return notas;
}

function gerarRecados(casos, { dep, note, limpo, tentar }) {
  const contas = contasDeRecado(); const notas = notasDeRecado(contas);
  for (const conta of contas) {
    casos.recados.push({ tipo: 'conta', conta, esperado: { permitidos: limpo(dep.allowedNoteDepartments(conta, conta.role)), proprios: limpo(dep.accountNoteDepartments(conta)), outros: dep.canViewOtherDepartments(conta, conta.role) } });
    for (const nota of notas) {
      casos.recados.push({ tipo: 'nota', conta, nota, esperado: { permitida: dep.noteInAllowedDepartments(nota, conta, conta.role), daConta: dep.noteInAccountDepartments(nota, conta, conta.role), ver: note.canViewOperationalNote(nota, conta, conta.role, conta.tarotId),
        visao: [false, true].flatMap((outros) => [false, true].map((enviadas) => dep.noteMatchesDepartmentView(nota, conta, conta.role, outros, enviadas))) } });
    }
  }
  const clientes = [{ id: '900100', name: 'Ana' }, { id: '900200', name: '  ' }];
  for (const subject of [...note.NOTE_SUBJECTS, 'Diversos', 'Horário', 'Inexistente']) for (const extra of [{}, { clientId: '900100', clientName: 'Ana' }, { clientId: ' 900100 ', clientName: ' Ana ' }, { clientId: '', clientName: 'Ana' }, { clientId: '900200', clientName: 'x' }, { clientId: 'zz', clientName: 'x' }, { clientId: 'a'.repeat(201), clientName: 'x' }, { clientId: '1', clientName: 'n'.repeat(301) }]) {
    for (const datas of [['2026-10-12', '2026-10-12'], ['2026-10-13', '2026-10-12'], ['2026-02-30', '2026-03-01']]) {
      const det = { subject, startDate: datas[0], endDate: datas[1], ...extra };
      casos.recados.push({ tipo: 'detalhes', det, clientes, esperado: { valida: tentar(() => note.validateNoteDetails(det)), incompleta: tentar(() => note.validateNoteDetails(det, { allowIncompleteClient: true })), resolvida: tentar(() => note.resolveNoteClientDetails(det, clientes)) } });
    }
  }
}

const DIA = '2026-10-12';
function itemDeAgenda(n, clientId, leadId) {
  const it = { id: `ag${n}`, clientId, client: 'Cliente', tarotId: 'afila', date: DIA, time: '09:00', createdAt: C.iso(C.BASE - 3 * 3600000), position: 1, response: 'Aguardando resposta', channel: 'WhatsApp', observation: '', contact: { attempt: 1, date: DIA, tags: C.pick([[], ['Avisada'], ['Chama depois']]) }, contactHistory: [] };
  if (leadId !== undefined) it.leadId = leadId;
  if (C.chance(0.3)) it.paymentExpectedAmount = 88.8;
  if (C.chance(0.2)) it.paymentPending = true;
  return it;
}
function gerarIdentidade(casos, { flow, fund, model, limpo, tentar }) {
  const ids = [['c1', undefined], ['c1', 'L1'], ['', 'L1'], ['', undefined], ['  ', 'L1'], ['c1', '  ']];
  for (let k = 0; k < 240; k += 1) {
    const [clientId, leadId] = ids[k % ids.length]; const item = itemDeAgenda(k, clientId, leadId);
    const pagamentos = [C.pagamento('p0', 'c1', C.pick([44.4, 88.8, 35]), { ...(C.chance(0.2) ? { unidentified: true } : {}) }), C.pagamento('p1', '', 20, { unidentified: true })];
    const consultas = C.chance(0.5) ? [{ id: 'k1', clientId: C.pick(['c1', '']), tarotId: 'r1', tarot: 'L', client: 'C', status: 'Em curso', startedAt: C.iso(C.BASE - 600000), durationSeconds: 300, audit: [] }] : [];
    const perfil = C.chance(0.6) ? { id: 'c1', name: 'Cliente', credit: C.pick([0, 20, 44.4]), movements: [] } : undefined;
    const entrada = { payments: pagamentos, consultations: consultas, date: DIA, now: C.BASE, intakeEvents: [] };
    casos.identidade.push({ item, perfil: perfil || null, entrada, esperado: {
      passo: tentar(() => flow.panelReservationStep(item, entrada, perfil)),
      financiamento: tentar(() => { const f = fund.agendaLaunchFunding(item, { payments: pagamentos, consultations: consultas, now: C.BASE }, perfil); const { coverage: cv, ...resto } = f; return { ...resto, coverage: { balance: cv.balance, postpaid: cv.postpaid, benefitMinutes: cv.benefitMinutes, hasConfirmedReceipt: cv.hasConfirmedReceipt, confirmedAvailableBalance: cv.confirmedAvailableBalance, awaitingConfirmation: cv.awaitingConfirmation, canConsult: cv.canConsult, canLaunch: cv.canLaunch, label: cv.label } }; }),
      pagamento: limpo(model.agendaPaymentState(item, pagamentos, consultas)) } });
  }
}

function gerarDatas(casos, { flow, limpo, tentar }) {
  const dias = (n) => new Date(Date.parse(`${DIA}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  for (let k = 0; k < 120; k += 1) {
    const pagamentos = Array.from({ length: 1 + C.inteiro(4) }, (_, i) => C.pagamento(`p${i}`, C.pick(['c1', 'c2', 'c3']), C.pick([44.4, 88.8, 35, 120]), { paidAt: C.iso(C.BASE - C.inteiro(5) * 86400000 - C.inteiro(6) * 3600000), informedAt: C.iso(C.BASE - 3600000) }));
    const agenda = C.chance(0.3) ? [itemDeAgenda(1, 'c2', undefined)] : [];
    const perfis = { c1: { id: 'c1', name: 'Ana', credit: 0, movements: [] }, c2: { id: 'c2', name: 'Bia', credit: 0, movements: [] }, c3: { id: 'c3', name: 'Cris', credit: 0, movements: [] } };
    const datas = C.pick([undefined, [DIA], [dias(-1)], [dias(-3), DIA], [dias(-2), dias(-1), DIA], []]);
    const args = [pagamentos, [], agenda, perfis, {}, DIA, C.BASE, undefined, datas];
    casos.datas.push({ args, esperado: tentar(() => flow.unassignedPayments(...args)) });
  }
}

/** Imagem fictícia com o cabeçalho certo (ou errado) do tipo; `size` é o tamanho real dos bytes. */
function imagem(id, tipo, defeito) {
  const cab = { 'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/webp': Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP')]) }[tipo];
  const bytes = Buffer.concat([defeito === 'cabecalho' ? Buffer.from('XXXXXXXXXXXX') : cab, Buffer.alloc(C.pick([10, 30, 100]), 7)]);
  const dataUrl = `data:${defeito === 'tipo' ? 'image/png' : tipo};base64,${bytes.toString('base64')}`;
  return { id, name: `${id}.img`, mimeType: tipo, size: defeito === 'tamanho' ? bytes.length + 1 : bytes.length, dataUrl: defeito === 'base64' ? `${dataUrl}*` : dataUrl };
}

/** Transferência de saldo com autorização da cliente (texto/imagem): aceita, repetida, outra autorização na repetição e entradas inválidas. */
function gerarTransferencia(casos, { transf, limpo, tentar }) {
  const tipos = ['image/png', 'image/jpeg', 'image/webp'];
  for (let k = 0; k < 160; k += 1) {
    const pagamentos = [C.pagamento('pg0', 'c1', 88.8, { purchase: { minutes: 30, amount: 88.8, table: 'regular' } }), C.pagamento('pg1', 'c1', 59.2, { purchase: { minutes: 20, amount: 59.2, table: 'regular' } })];
    const estado = { payments: pagamentos, consultations: [] };
    const imgs = Array.from({ length: C.pick([0, 0, 1, 2, 3, 4]) }, (_, i) => imagem(C.chance(0.1) ? 'repetida' : `img${i}`, C.pick(tipos), C.pick([undefined, undefined, undefined, undefined, 'cabecalho', 'tipo', 'tamanho', 'base64'])));
    const aut = C.chance(0.75) ? { version: C.pick([1, 1, 1, 2]), text: C.pick(['', 'Ana autorizou por WhatsApp.', '  Ana autorizou.  ']), images: imgs, internalNote: C.pick(['', 'Conferido com a Bia.', 'x'.repeat(4001)]), ...(C.chance(0.2) ? { formatting: { bold: [] } } : {}) } : undefined;
    const entrada = { id: `TR-${k}`, sourceClientId: 'c1', targetClientId: 'c2', amount: C.pick([10, 20, 44.4, 88.8, 120]), note: C.pick(['Pedido da titular.', '']), ...(aut ? { authorization: aut } : C.chance(0.1) ? { authorization: C.pick([null, 'x', []]) } : {}) };
    const contexto = { profiles: { c1: { id: 'c1', name: 'Ana', credit: 0, movements: [] }, c2: { id: 'c2', name: 'Bia', credit: 0, movements: [] } }, names: { c1: 'Ana', c2: 'Bia' }, regularMinuteValue: 2.96, actor: 'Clara', role: 'assistente', at: '2026-10-12T15:00:00.000Z' };
    const res = tentar(() => transf.transferClientBalance(estado, entrada, contexto));
    casos.transferencia.push({ estado, entrada, contexto, esperado: res.ok ? { ok: res.ok.payments } : res });
    if (res.ok) {
      const feito = transf.transferClientBalance(estado, entrada, contexto);
      for (const variante of [entrada, { ...entrada, authorization: aut ? { ...aut, internalNote: `${aut.internalNote} (outra)` } : { version: 1, text: 'Nova', images: [], internalNote: '' } }]) {
        casos.transferencia.push({ estado: limpo(feito), entrada: variante, contexto, esperado: (() => { const r = tentar(() => transf.transferClientBalance(feito, variante, contexto)); return r.ok ? { ok: r.ok.payments } : r; })() });
      }
    }
  }
}

module.exports = { gerarRecados, gerarIdentidade, gerarDatas, gerarTransferencia };
