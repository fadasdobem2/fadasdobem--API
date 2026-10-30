'use strict';

/**
 * Regras sem banco do que o servidor REFAZ (Maturacao/38): leitura do comando (`ciclo.comandos.js`) e comparação (`ciclo.refazer.js`) sobre os
 * REGISTROS QUE O FRONT REAL PRODUZIU no ouro (aceitos), mutantes que têm de ser recusados, o encerramento pela equipe, a edição e a ocupação.
 */

const fs = require('fs');
const path = require('path');
const comandos = require('../../../src/gestao-fadas/features/consultas-ciclo/ciclo.comandos');
const { comparavel } = require('../../../src/gestao-fadas/features/consultas-ciclo/ciclo.refazer');
const aval = require('../../../src/gestao-fadas/_comum/dominio/consulta-conferencia-avaliacao');
const equipe = require('../../../src/gestao-fadas/_comum/dominio/consulta-encerramento-equipe');
const edicao = require('../../../src/gestao-fadas/_comum/dominio/consulta-edicao');
const { fabrica } = { fabrica: require('./fabrica') };

const carregar = (nome) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', `ouro-regras-${nome}-front.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

function verificar() {
  const falhas = []; let ok = 0;
  const conferir = (nome, bom, detalhe = '') => { if (bom) ok += 1; else falhas.push(`${nome} ${detalhe}`.slice(0, 300)); };

  // 1. Registros que o front real produziu: o servidor lê o comando certo e refaz IGUAL.
  const conf = carregar('conferencia');
  const porNome = {};
  conf.casos.forEach((c, k) => {
    const emitido = ['aprovar', 'decisao', 'rejeitar', 'fluxo-aprovar'].includes(c.t) && c.r.ok && c.r.ok.audit && c.r.ok.audit.length > c.item.audit.length;
    if (!emitido || c.args.comBeneficios) return;
    if (c.t === 'aprovar' && c.r.ok === c.item) return;
    const cen = conf.cenarios[c.c]; const antes = clone(c.item); const pedido = clone(c.r.ok);
    if (JSON.stringify(pedido.audit) === JSON.stringify(antes.audit)) return;
    const fin = { payments: cen.pagamentos, consultations: cen.consultas.map((x) => (x.id === 'K1' ? antes : x)), profile: cen.perfil };
    const cmd = comandos.ler(antes, pedido, { papel: 'atendente', versao: antes.updatedAt, fin });
    const esperado = { aprovar: ['aprovar-encerramento', 'decisao-financeira'], 'fluxo-aprovar': ['aprovar-encerramento', 'decisao-financeira'], decisao: ['decisao-financeira'], rejeitar: ['rejeitar-correcao'] }[c.t];
    if (!cmd || !esperado.includes(cmd.nome)) { conferir(`conferência #${k} ${c.t}`, false, `comando ${cmd && cmd.nome}`); return; }
    porNome[cmd.nome] = (porNome[cmd.nome] || 0) + 1;
    let feito; try { feito = cmd.calcular(pedido.updatedAt, pedido.audit[pedido.audit.length - 1].actor); } catch (e) {
      // A tela só deixa conferir quando a avaliação não aponta erro (as duas telas); aqui o servidor recusa com a mesma frase.
      conferir(`conferência #${k} ${c.t} recusada pela avaliação`, c.t !== 'fluxo-aprovar' && cmd.nome === 'aprovar-encerramento' && /^(O saldo confirmado não cobre (os adicionais|esse tempo adicional)|Há outra consulta em curso desta cliente\. Peça)/.test(e.message), e.message); return;
    }
    conferir(`conferência #${k} ${c.t} igual`, comparavel(feito, antes.audit.length) === comparavel(pedido, antes.audit.length));
    // Mutante: o navegador mexe nos minutos informados, no estado ou no valor, e o servidor NÃO aceita.
    const mutantes = [(x) => { x.durationSeconds += 60; }, (x) => { x.status = x.status === 'Concluída' ? 'Cancelada' : 'Concluída'; }, (x) => { x.performedDurationSeconds = (x.performedDurationSeconds || 0) + 600; },
      (x) => { x.finishReview = x.finishReview ? { ...x.finishReview, reportedMinutes: 1 } : { at: x.updatedAt, by: 'X', reportSubmittedAt: x.updatedAt, reportedMinutes: 1, result: 'approved' }; }];
    mutantes.forEach((m, i) => { const t = clone(pedido); m(t); conferir(`conferência #${k} ${c.t} mutante ${i}`, comparavel(feito, antes.audit.length) !== comparavel(t, antes.audit.length)); });
  });
  conferir('conferência: os 3 comandos foram lidos', ['aprovar-encerramento', 'decisao-financeira', 'rejeitar-correcao'].every((n) => porNome[n] > 20), JSON.stringify(porNome));

  const des = carregar('desfechos'); const vin = carregar('vinculos');
  const lidos = {};
  des.casos.forEach((c, k) => {
    if (!['solicitar', 'decidir-lista'].includes(c.t) || c.r.ok === undefined || !c.r.ok || c.t === 'solicitar' && c.papel === 'tarologa') return;
    const cen = des.cenarios[c.c]; const antes = clone(c.item); const pedido = clone(c.r.ok);
    if (pedido.audit.length === antes.audit.length || antes.audit.length !== c.item.audit.length) return;
    const lista = cen.consultas.map((x) => (x.id === antes.id ? antes : x));
    const cmd = comandos.ler(antes, pedido, { papel: c.papel, versao: antes.updatedAt, fin: { payments: cen.pagamentos, consultations: lista, profile: cen.perfil } });
    const esperado = c.t === 'solicitar' ? 'solicitar-cancelamento' : null;
    if (!cmd || (esperado && cmd.nome !== esperado)) { conferir(`desfecho #${k}`, false, `comando ${cmd && cmd.nome}`); return; }
    lidos[cmd.nome] = (lidos[cmd.nome] || 0) + 1;
    let feito; try { feito = cmd.calcular(pedido.updatedAt, pedido.audit[pedido.audit.length - 1].actor); } catch (e) { conferir(`desfecho #${k} ${cmd.nome}`, false, e.message); return; }
    conferir(`desfecho #${k} ${cmd.nome} igual`, comparavel(feito, antes.audit.length) === comparavel(pedido, antes.audit.length));
  });
  conferir('desfechos: cancelar e decidir lidos', lidos['solicitar-cancelamento'] > 20 && lidos['decidir-cancelamento'] > 5, JSON.stringify(lidos));
  let compensados = 0;
  vin.casos.forEach((c, k) => {
    if (c.t !== 'compensacao' || !c.r.ok) return;
    const cen = vin.cenarios[c.c]; const antes = clone(c.item); const pedido = clone(c.r.ok.next);
    const cmd = comandos.ler(antes, pedido, { papel: 'atendente', versao: antes.updatedAt, fin: { payments: cen.pagamentos, consultations: cen.consultas.map((x) => (x.id === antes.id ? antes : x)), profile: cen.perfil } });
    if (!cmd || cmd.nome !== 'compensacao') { conferir(`compensação #${k}`, false, `comando ${cmd && cmd.nome}`); return; }
    compensados += 1;
    let feito; try { feito = cmd.calcular(pedido.updatedAt, pedido.audit[pedido.audit.length - 1].actor); } catch (e) { conferir(`compensação #${k}`, false, e.message); return; }
    conferir(`compensação #${k} igual`, comparavel(feito, antes.audit.length) === comparavel(pedido, antes.audit.length));
    const t = clone(pedido); t.bonusGrant.minutes += 1; conferir(`compensação #${k} mutante`, comparavel(feito, antes.audit.length) !== comparavel(t, antes.audit.length));
  });
  conferir('compensações lidas', compensados > 20, String(compensados));

  // 2. Encerramento pela equipe (transcrito do componente): estados e frases.
  const { variantesDaConferencia, ISO } = fabrica;
  const v = variantesDaConferencia()[1]; const k1 = v.consultas.find((x) => x.id === 'K1');
  const em = ISO(0, 40); const fin = { payments: v.pagamentos, consultations: v.consultas, profile: v.perfil };
  const entrada = (extra = {}) => ({ outcome: 'Concluída', minutes: 25, startedAt: k1.startedAt, isReview: false, version: k1.updatedAt, complaint: '', complaintDetails: { complaint: '', complaintReasons: [], shareComplaint: false }, ...extra });
  const tenta = (e, item = k1) => { try { return { ok: equipe.encerrar(clone(item), e, { ator: 'Khloe', papel: 'atendente', em, fin }) }; } catch (x) { return { erro: x.message }; } };
  let r = tenta(entrada());
  conferir('encerrar: Concluída dentro do limite fecha com o tempo e a auditoria', r.ok && r.ok.status === 'Concluída' && r.ok.durationSeconds === 1500 && r.ok.audit.length === 1 && r.ok.audit[0].action === 'Consulta concluída' && /^25 minutos realizados/.test(r.ok.audit[0].detail), JSON.stringify(r).slice(0, 200));
  r = tenta(entrada({ outcome: 'Cancelada', complaint: 'Reclamou.', complaintDetails: { complaint: 'Reclamou.', complaintReasons: [], shareComplaint: false }, bonusEnabled: true, bonusMinutes: 10 }));
  conferir('encerrar: Cancelada com bônus abre a revisão da administradora e concede o bônus', r.ok && r.ok.status === 'Cancelada' && r.ok.cancellationReview.status === 'pending' && r.ok.bonusGrant.minutes === 10, JSON.stringify(r).slice(0, 200));
  r = tenta(entrada({ outcome: 'Cancelada', complaint: '', complaintDetails: { complaint: '', complaintReasons: [], shareComplaint: false } }));
  conferir('encerrar: Cancelada sem queixa recusa com a frase do front', r.erro === 'Cole a queixa da cliente ou assinale um motivo.', JSON.stringify(r));
  r = tenta(entrada({ outcome: 'Devolvida', minutes: 12 }));
  conferir('encerrar: Devolvida libera a cobertura sem repasse', r.ok && r.ok.status === 'Devolvida' && /sem repasse e com a cobertura liberada/.test(r.ok.audit[0].detail), JSON.stringify(r).slice(0, 200));
  r = tenta(entrada({ outcome: 'Não houve', minutes: 99 }));
  conferir('encerrar: Não houve zera o tempo', r.ok && r.ok.durationSeconds === 0 && r.ok.audit[0].action === 'Não houve', JSON.stringify(r).slice(0, 200));
  r = tenta(entrada({ minutes: 45 }));
  conferir('encerrar: acima do máximo vai à conferência (Finalizada pelo tarólogo, relato da atendente)', r.ok && r.ok.status === 'Finalizada pelo tarólogo' && r.ok.tarologistFinishReport.reporterRole === 'atendimento', JSON.stringify(r).slice(0, 200));
  r = tenta(entrada({ outcome: 'Anulada' }));
  conferir('encerrar: desfecho que a tela não oferece é recusado', r.erro === 'Conclusão da consulta: selecione uma opção válida.', JSON.stringify(r));
  r = tenta(entrada({ version: 'velha' }));
  conferir('encerrar: versão velha recusa', r.erro === 'A consulta foi atualizada. Abra o encerramento novamente para conferir o tempo.', JSON.stringify(r));
  r = tenta(entrada({ minutes: 0 }));
  conferir('encerrar: tempo zero recusa', r.erro === 'Informe uma duração válida.', JSON.stringify(r));
  r = tenta(entrada({ startedAt: ISO(5) }));
  conferir('encerrar: início no futuro recusa', r.erro === 'O início da consulta não pode estar no futuro.', JSON.stringify(r));

  // 3. Edição.
  const e0 = { ...k1, status: 'Concluída', durationSeconds: 1200, endedAt: ISO(0, 20) };
  const cfg = { papel: 'atendente', agora: ISO(1), fin: undefined };
  const tentaEd = (depois, extra = {}) => { try { edicao.conferirEdicao(e0, depois, { ...cfg, ...extra }); return null; } catch (x) { return x.message; } };
  conferir('edição: só a observação passa', tentaEd({ ...e0, observation: 'nova' }) === null);
  conferir('edição: tempo mudado sem motivo recusa', tentaEd({ ...e0, durationSeconds: 1500, endedAt: ISO(0, 25) }) === 'Motivo da alteração do tempo: preencha este campo.');
  conferir('edição: tempo mudado com motivo passa', tentaEd({ ...e0, durationSeconds: 1500, endedAt: ISO(0, 25), readerCorrection: { at: ISO(1), reason: 'Ajuste' } }) === null);
  const comQueixa = { ...e0, cancellationReview: { status: 'paid', readerStatus: 'Concluída', complaint: 'x' } };
  const tentaQ = (depois, papel) => { try { edicao.conferirEdicao(comQueixa, depois, { ...cfg, papel }); return null; } catch (x) { return x.message; } };
  conferir('edição: consulta com queixa só pela administradora', tentaQ({ ...comQueixa, tarotId: 'nyx' }, 'atendente') === 'Só a administradora pode alterar cliente, tarólogo, tempo ou valores desta consulta com queixa registrada. Você pode atualizar as observações.' && tentaQ({ ...comQueixa, tarotId: 'nyx' }, 'administradora') === null && tentaQ({ ...comQueixa, observation: 'só nota' }, 'atendente') === null);
  conferir('edição: início no futuro recusa', tentaEd({ ...e0, startedAt: ISO(9) }) === 'O início da consulta não pode estar no futuro.');
  conferir('edição: Não houve só reabrindo', (() => { try { edicao.conferirEdicao({ ...e0, status: 'Não houve' }, { ...e0, status: 'Não houve', tarotId: 'nyx' }, cfg); return 'aceitou'; } catch (x) { return x.message; } })() === 'Use Reabrir para iniciar uma nova consulta.');
  return { ok, falhas };
}

module.exports = { verificar };
