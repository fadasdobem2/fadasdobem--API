'use strict';

/**
 * Verificador OFFLINE do COMPONENTE da consulta (Maturacao/56 grupo D3): o servidor (`consulta-encerramento-equipe.js`, `consulta-desfechos.js`) tem de dar a MESMA resposta que o
 * código REAL de `finishConsultation` e `confirmAnnul` (executado pelo harness a partir de `consultations-experience.tsx`, ouro `ouro-componente-front.json`): o mesmo registro
 * gravado (campo a campo) ou a mesma frase de recusa. Sem banco, sem relógio do sistema (`em` vem do caso).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const equipe = require('../src/gestao-fadas/_comum/dominio/consulta-encerramento-equipe');
const des = require('../src/gestao-fadas/_comum/dominio/consulta-desfechos');

const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-consulta', 'ouro-componente-front.json'), 'utf8'));
const clonar = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const normalizar = (c) => { if (!c) return c; const n = clonar(c); if (n.audit) n.audit = n.audit.map((e) => (String(e.id).startsWith('audit-') ? { ...e, id: 'audit-*' } : e)); return n; };
const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
let falhas = 0; const mostrar = (m) => { falhas += 1; if (falhas <= 12) console.error(m); };
const cont = { finalizarGravou: 0, finalizarRecusa: 0, finalizarCampos: 0, finalizarUncaught: 0, anularGravou: 0, anularRecusa: 0, anularDecisao: 0, semEquivalente: 0, horaDaTela: 0, fraseDaTela: 0 };

// recusas da tela que o servidor trata por OUTRO mecanismo (versão otimista no corpo do pedido, ciclo.*) ou que são só da tela
const FRASE_TELA_ANULAR = 'Só a administradora pode anular consultas.';
const FRASE_SERVIDOR_DECIDIR = 'Somente a administradora pode decidir o pagamento deste cancelamento.';
const SO_DA_TELA = new Set(['A consulta mudou. Feche e abra a decisão novamente.']);

for (const [n, c] of ouro.casos.entries()) {
  const f = c.front; const rot = `caso ${n} (${c.tipo} ${c.nome})`;
  const alvo = c.consultas.find((k) => k.id === c.alvoId);
  const perfil = clonar(c.perfil);
  const em = c.agora;
  if (c.tipo === 'finalizar') {
    const st = c.estado;
    if (!f.toast && !f.erroInterno && Object.keys(f.campos).length && !f.consulta) {
      if (f.campos.startTime && !f.inicio) { cont.horaDaTela += 1; continue; } // horário inválido: o servidor só recebe ISO
    }
    const e = { outcome: st.finishOutcome, minutes: st.finishOutcome === 'Não houve' ? 0 : Number(st.finishMinutes.replace(',', '.')), startedAt: f.inicio || alvo.startedAt, isReview: st.finishOpenedAsReview, reviewReason: st.finishReviewReason,
      complaint: st.finishComplaint, complaintDetails: st.finishComplaintDetails, bonusEnabled: st.finishBonusEnabled, bonusMinutes: Number(String(st.finishBonusMinutes).replace(',', '.')), benefitSelection: st.finishBenefitSelection, version: st.finishReviewVersion };
    const r = tentar(() => equipe.encerrar(clonar(alvo), e, { ator: c.ator, papel: c.papel, em, fin: { payments: clonar(c.pagamentos), consultations: clonar(c.consultas), profile: perfil } }));
    if (f.consulta) {
      cont.finalizarGravou += 1;
      if (r.erro) mostrar(`${rot}: o front gravou, o servidor recusou "${r.erro}"`);
      else { try { assert.deepStrictEqual(normalizar(r.ok), f.consulta); } catch (_x) { mostrar(`${rot}: registro diferente\n  front    ${JSON.stringify(f.consulta).slice(0, 900)}\n  servidor ${JSON.stringify(normalizar(r.ok)).slice(0, 900)}`); } }
    } else if (f.toast || f.erroInterno) {
      if (f.erroInterno) cont.finalizarUncaught += 1; else cont.finalizarRecusa += 1;
      const esperado = f.toast || f.erroInterno;
      if (r.ok) mostrar(`${rot}: o front recusou "${esperado}", o servidor aceitou`);
      else if (r.erro !== esperado) mostrar(`${rot}: frase diferente\n  front    ${esperado}\n  servidor ${r.erro}`);
    } else if (Object.keys(f.campos).length) {
      cont.finalizarCampos += 1;
      if (r.ok) mostrar(`${rot}: o front acusou ${JSON.stringify(f.campos)}, o servidor aceitou`);
      else if (!Object.values(f.campos).includes(r.erro)) mostrar(`${rot}: campos do front ${JSON.stringify(f.campos)}, servidor "${r.erro}"`);
    } else cont.semEquivalente += 1;
  } else {
    const st = c.estado;
    if (f.toast && SO_DA_TELA.has(f.toast)) { cont.semEquivalente += 1; continue; }
    if (st.annulTargetPresente === false) { cont.semEquivalente += 1; continue; }
    const lista = clonar(c.consultas); const pagamentos = clonar(c.pagamentos);
    let r;
    if (alvo.cancellationReview) r = tentar(() => des.decidirNaLista(lista, { id: alvo.id, updatedAt: alvo.updatedAt }, { decision: 'unpaid', observation: st.annulReason, actor: c.ator, at: em, role: c.papel }, pagamentos));
    else r = tentar(() => des.anular(clonar(alvo), { reason: st.annulReason, complaintDetails: st.annulComplaintDetails }, lista, pagamentos, c.ator, em, c.papel));
    if (f.consulta) {
      if (alvo.cancellationReview) cont.anularDecisao += 1; else cont.anularGravou += 1;
      if (r.erro) mostrar(`${rot}: o front gravou, o servidor recusou "${r.erro}"`);
      else { const obt = r.ok; try { assert.deepStrictEqual(normalizar(obt), f.consulta); } catch (_x) { mostrar(`${rot}: registro diferente\n  front    ${JSON.stringify(f.consulta).slice(0, 800)}\n  servidor ${JSON.stringify(normalizar(obt)).slice(0, 800)}`); } }
    } else if (f.toast || f.erroInterno) {
      cont.anularRecusa += 1; const esperado = f.toast || f.erroInterno;
      if (r.ok) mostrar(`${rot}: o front recusou "${esperado}", o servidor aceitou`);
      else if (r.erro !== esperado) {
        // DIFERENÇA CONHECIDA E ACEITA: anular consulta com cancelamento pendente por quem não é administradora. O front barra ANTES, na própria tela ("Só a administradora pode anular consultas.");
        // o servidor barra na decisão ("Somente a administradora pode decidir o pagamento deste cancelamento."). Mesma recusa, frase diferente (o servidor não sabe de qual diálogo veio).
        if (alvo.cancellationReview && esperado === FRASE_TELA_ANULAR && r.erro === FRASE_SERVIDOR_DECIDIR) cont.fraseDaTela += 1;
        else mostrar(`${rot}: frase diferente\n  front    ${esperado}\n  servidor ${r.erro}`);
      }
    } else cont.semEquivalente += 1;
  }
}
if (falhas) { console.error(`FALHOU: ${falhas} divergências entre o servidor e o componente real.`); process.exit(1); }
console.log(`OK: ${ouro.casos.length} casos do componente real: finalizar (${cont.finalizarGravou} registros idênticos, ${cont.finalizarRecusa} recusas e ${cont.finalizarCampos} campos inválidos com a mesma frase, ${cont.finalizarUncaught} exceções não tratadas da tela com a mesma frase) e anular (${cont.anularGravou} diretas e ${cont.anularDecisao} por decisão idênticas, ${cont.anularRecusa} recusas com a mesma frase); ${cont.fraseDaTela} recusas iguais com frase diferente (anular com cancelamento pendente por quem não é administradora, documentado); ${cont.horaDaTela} só da tela e ${cont.semEquivalente} sem equivalente no servidor.`);
