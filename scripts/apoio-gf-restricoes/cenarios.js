'use strict';

/** Cenários do ouro das Restrições da v706 (relato da restrição e inclusão pela taróloga). Determinísticos. */

const AT = '2026-10-30T15:00:00.000Z';
const R = (id, clientId, tarotId, requestedBy, active = true) => ({ id, clientId, tarotId, requestedBy, reason: 'Motivo', active, createdAt: '2026-10-20T12:00:00.000Z', createdBy: 'Laya', updatedAt: '2026-10-20T12:00:00.000Z', updatedBy: 'Laya', history: [{ action: 'created', at: '2026-10-20T12:00:00.000Z', actor: 'Laya', reason: 'Motivo' }] });
const base = [R('r1', '900100', '9001', 'tarologist'), R('r2', '900100', '9002', 'client'), R('r3', '900101', '9001', 'tarologist', false)];
const consultas = [{ tarotId: '9001', clientId: '900200', status: 'Concluída' }, { tarotId: '9001', clientId: '900201', status: 'Erro' }, { tarotId: '9002', clientId: '900202', status: 'Concluída' }, { tarotId: '9001', clientId: ' 900203 ', status: 'Concluída' }];
const entrada = (extra) => ({ role: 'tarologa', ownTarotId: '9001', clientId: '900200', tarotId: '9001', reason: 'Não quer mais atender a cliente.', actor: 'Osíris', at: AT, id: 'novo', requestedBy: 'tarologist', ...extra });

function gerar() {
  const casos = [];
  const permitidos = ['900200', '900203', '900100', '900101'];
  const relato = (reasonCode, message = 'Mensagem da cliente.', occurredOn = '2026-10-29') => ({ reasonCode, message, occurredOn });
  for (const role of ['tarologa', 'atendente', 'assistente', 'administradora', 'supervisora']) {
    for (const quem of ['tarologist', 'client']) {
      const tarot = role === 'tarologa' ? '9001' : '9002';
      for (const [cliente, remove] of [['900200', false], ['900100', false], ['900300', false], ['900100', true], ['900101', false]]) {
        for (const details of [undefined, relato('naoa'), relato('outr'), relato('canc'), relato('gost'), relato('naoq'), relato('zzz'), relato('outr', '   '), relato('outr', 'x'.repeat(5001)), relato('outr', 'x'.repeat(5000)), relato('outr', 'ok', '2026-10-31'), relato('outr', 'ok', '2026-10-30'), relato('outr', 'ok', '2026-02-30'), relato('outr', 'ok', 'ontem'), relato('naoa', 'ok', '2026-10-29')]) {
          casos.push({ tipo: 'alterar', linhas: base, entrada: entrada({ role, ownTarotId: role === 'tarologa' ? '9001' : undefined, tarotId: tarot, requestedBy: quem, clientId: cliente, remove, details, allowedClientIds: role === 'tarologa' ? permitidos : undefined }) });
        }
      }
    }
  }
  casos.push({ tipo: 'alterar', linhas: base, entrada: entrada({ reason: '  ', details: relato('outr'), allowedClientIds: permitidos }) });
  casos.push({ tipo: 'alterar', linhas: base, entrada: entrada({ allowedClientIds: undefined }) });
  casos.push({ tipo: 'alterar', linhas: base, entrada: entrada({ clientId: '900100', allowedClientIds: permitidos }) });
  for (const t of ['9001', '9002', '9009', undefined]) casos.push({ tipo: 'proprios', consultas, linhas: [...base, R('r4', '900500', '9001', 'client')], tarotId: t });
  return casos;
}

module.exports = { gerar, base };
