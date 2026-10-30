'use strict';

/** O formato que o gerador do ouro do fluxo grava e o verificador reproduz (Maturacao/39): igual nos dois. */
const idsDe = (l) => (l || []).map((x) => x.id);
/** O formato que o gerador grava e o verificador reproduz (precisa ficar igual nos dois). */
const resumoDoFluxo = (f) => ({
  team: f.team.map((r) => ({ id: r.id, status: r.status, available: r.available, operationalActive: r.operationalActive, freeNow: r.freeNow, hasBooking: r.hasBooking, accepting: r.accepting, needsConfirmation: r.needsConfirmation,
    unstarted: r.unstarted ? r.unstarted.id : null, reservation: r.reservation ? r.reservation.id : null, future: r.future ? r.future.id : null, report: r.report ? r.report.id : null, reports: idsDe(r.reports), actionableQueue: idsDe(r.actionableQueue), queue: idsDe(r.queue), hours: r.hours })),
  generalAll: idsDe(f.generalAll), futureGeneral: idsDe(f.futureGeneral), general: idsDe(f.general), free: idsDe(f.free), dispatch: idsDe(f.dispatch), waitingGeneral: idsDe(f.waitingGeneral), callbackGeneral: idsDe(f.callbackGeneral), reservedGeneral: idsDe(f.reservedGeneral),
  ready: idsDe(f.ready), reservedAssignments: f.reservedAssignments.map((r) => [r.reader.id, r.item.id, r.source]), recededReservations: f.recededReservations.map((r) => [r.reader.id, r.item.id, r.source, r.receded.label, r.receded.lane]),
  reservationFollowUps: f.reservationFollowUps.map((r) => [r.reader.id, r.item.id]),
  unansweredNext: f.unansweredNext.map((r) => [r.readerId, r.head.id, r.following ? r.following.id : null, r.position ?? null, r.otherUnanswered, r.unansweredAhead]),
});
module.exports = { resumoDoFluxo };
