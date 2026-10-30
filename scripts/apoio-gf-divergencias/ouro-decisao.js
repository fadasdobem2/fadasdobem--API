'use strict';

/** Compara o porte da DECISÃO (`divergencias-decisao.js`) com o ouro do código do front. Devolve `{ ok, falhas }`. */

const fs = require('fs');
const path = require('path');
const dec = require('../../src/gestao-fadas/_comum/dominio/divergencias-decisao');

function verificar(arquivo = path.join(__dirname, 'ouro-decisao-front.json')) {
  const ouro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const falhas = []; let ok = 0;
  const marcar = (nome, bom, detalhe = '') => { if (bom) ok += 1; else falhas.push(`${nome} ${detalhe}`.slice(0, 300)); };
  ouro.ausentes.forEach((c, k) => {
    const erro = dec.erroDaConsultaAusente(c.entrada, c.outras, c.agora);
    marcar(`consulta ausente #${k}`, erro === c.erro, `${erro} x ${c.erro}`);
  });
  const divergencia = { id: 'D1', clientId: '900013', client: 'Cliente', consultationId: 'K1', status: 'Em conferência' };
  ouro.correcoes.forEach((c, k) => {
    const antes = Math.round(c.item.durationSeconds / 60 * 100) / 100;
    const decisao = { ...divergencia, decision: `Tempo corrigido de ${antes} para ${c.minutos} minutos. conferido` };
    if (c.resultado.ok) {
      try { dec.conferirEfeitos(divergencia, decisao, c.resultado.ok); marcar(`efeito da correção aceito #${k}`, true); } catch (e) { marcar(`efeito da correção aceito #${k}`, false, e.message); }
      try { dec.conferirEfeitos(divergencia, decisao, c.item); marcar(`correção ausente é recusada #${k}`, false, 'aceito'); } catch (e) { marcar(`correção ausente é recusada #${k}`, e.message === dec.MSG_EFEITO, e.message); }
      try { dec.conferirEfeitos(divergencia, { ...decisao, decision: `Tempo corrigido de ${antes} para ${c.minutos + 1} minutos.` }, c.resultado.ok); marcar(`minutos diferentes recusados #${k}`, false, 'aceito'); } catch (e) { marcar(`minutos diferentes recusados #${k}`, e.message === dec.MSG_EFEITO, e.message); }
      try { dec.conferirEfeitos(divergencia, decisao, { ...c.resultado.ok, clientId: '999' }); marcar(`outra cliente recusada #${k}`, false, 'aceito'); } catch (e) { marcar(`outra cliente recusada #${k}`, /não corresponde à cliente/.test(e.message), e.message); }
    }
  });
  // Vincular e incluir (texto e id lidos do componente).
  const base = { id: 'K9', clientId: '900013', status: 'Concluída', durationSeconds: 600, startedAt: '2026-10-10T12:00:00.000Z', audit: [{ id: 'review-D2-1760000000000', action: 'Dados corrigidos', detail: 'x' }] };
  const aberta = { id: 'D2', clientId: '900013', client: 'Cliente', status: 'Em conferência', issueType: 'Consulta ausente', reportedDate: '2026-10-10', reportedTime: '09:00' };
  const resolver = (extra, consulta) => { try { dec.conferirEfeitos(aberta, { ...aberta, status: 'Resolvida', ...extra }, consulta); return null; } catch (e) { return e.message; } };
  marcar('vincular com o evento review- é aceito', resolver({ consultationId: 'K9', decision: 'Atendimento localizado e vinculado à consulta K9, realizada por X.' }, base) === null);
  marcar('vincular sem o evento é recusado', resolver({ consultationId: 'K9', decision: 'Atendimento localizado e vinculado à consulta K9, realizada por X.' }, { ...base, audit: [] }) === dec.MSG_EFEITO);
  marcar('vincular a consulta não realizada é recusado', resolver({ consultationId: 'K9', decision: 'Atendimento localizado e vinculado à consulta K9.' }, { ...base, status: 'Em curso' }) === dec.MSG_EFEITO);
  marcar('consulta inexistente é recusada', resolver({ consultationId: 'K9', decision: 'Atendimento localizado e vinculado à consulta K9.' }, null) === 'A consulta não foi localizada. Atualize a seleção.');
  marcar('incluir: consulta no horário do relato é aceita', resolver({ consultationId: 'C-1', decision: '' }, { ...base, id: 'C-1', audit: [], startedAt: '2026-10-10T12:00:00.000Z' }) === null);
  marcar('incluir: consulta em outro horário é recusada', resolver({ consultationId: 'C-1', decision: '' }, { ...base, id: 'C-1', audit: [], startedAt: '2026-10-10T13:00:00.000Z' }) === dec.MSG_EFEITO);
  marcar('manter sem inclusão não exige efeito', resolver({ decision: 'Registro mantido após conferência. ok' }, null) === null);
  return { ok, falhas };
}

module.exports = { verificar };
