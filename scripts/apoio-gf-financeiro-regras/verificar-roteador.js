'use strict';

/**
 * Confere o ROTEADOR do servidor (`pagamentos-refazer.js`) com o que o front real produziu: para cada operação aceita nos ouros (movimento,
 * ocorrências, transferência), o registro do navegador é `depois`; o servidor tem de RECONHECER a operação, refazê-la com o contexto real e devolver
 * o registro IGUAL (mesmo instante e autor) e, com outro instante e autor, o mesmo registro com os do servidor. Mutantes (registro adulterado) são recusados.
 */
const { lerOuro } = require('./comparar');
const { igual } = require('../../src/gestao-fadas/_comum/dominio/pagamentos-igual');
const refazer = require('../../src/gestao-fadas/_comum/dominio/pagamentos-refazer');
const { permissoesDoPerfil } = require('../../src/gestao-fadas/_comum/politica-acesso');

const ator = (nome, perfil) => ({ nome, perfil, p: permissoesDoPerfil(perfil) });
const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e.message, tipo: e.name }; } };

function verificar() {
  const falhas = []; let ok = 0; let total = 0; const familias = {}; let mutantes = 0;
  const conferir = (rotulo, antes, depois, contexto, perfil, esperadoTipo, extra = {}) => {
    total += 1;
    const quem = ator(depois.updatedBy, perfil);
    const r = tentar(() => refazer.refazerRevisao(antes, depois, quem, depois.updatedAt, contexto));
    if (r.erro || !r.ok) { falhas.push(`${rotulo}: ${r.erro || 'não reconheceu a operação'}`); return; }
    if (!igual(r.ok.registro, depois)) { falhas.push(`${rotulo}: registro refeito diferente do do front`); return; }
    if (esperadoTipo && !r.ok.tipo.startsWith(esperadoTipo)) { falhas.push(`${rotulo}: tipo ${r.ok.tipo}`); return; }
    // outro instante e autor: o servidor carimba os DELE
    const t2 = '2026-10-31T09:30:00.000Z';
    const r2 = tentar(() => refazer.refazerRevisao(antes, depois, ator('Servidora', perfil), t2, contexto));
    if (r2.erro || r2.ok.registro.updatedAt !== t2 || r2.ok.registro.updatedBy !== 'Servidora') { falhas.push(`${rotulo}: carimbo do servidor ${r2.erro || ''}`); return; }
    // mutante: o navegador mexe no valor de um movimento novo / numa data
    if (extra.mutar) { const m = extra.mutar(depois); mutantes += 1; if (!tentar(() => refazer.refazerRevisao(antes, m, quem, depois.updatedAt, contexto)).erro) { falhas.push(`${rotulo}: mutante aceito`); return; } }
    familias[r.ok.tipo] = (familias[r.ok.tipo] || 0) + 1; ok += 1;
  };

  // movimentos (novo direto, crédito restante, correção)
  lerOuro('movimento').cenarios.forEach((c, i) => {
    if (!c.esperado.ok || c.esperado.ok === null) return;
    const depois = c.esperado.ok; if (depois === c.antes) return;
    if (c.tipo === 'corrigir') { if (JSON.stringify(depois.movements) === JSON.stringify(c.antes.movements)) return;
      conferir(`corrigir#${i}`, c.antes, depois, c.contexto || { payments: [c.antes], consultations: [], profile: null }, 'administradora', 'movimento-corrigido', { mutar: (d) => ({ ...d, movements: d.movements.map((m, k) => (k === 0 ? { ...m, amount: m.amount + 1 } : m)) }) }); }
    else if (c.tipo === 'registrar') conferir(`registrar#${i}`, c.antes, depois, { payments: [c.antes], consultations: [], profile: null }, 'assistente', 'movimento-novo', { mutar: (d) => ({ ...d, movements: d.movements.map((m, k) => (k === d.movements.length - 1 ? { ...m, bankEffect: m.bankEffect - 1 } : m)) }) });
    else if (c.tipo === 'credito') conferir(`credito#${i}`, c.antes, depois, c.contexto, 'administradora', 'movimento-novo');
  });
  // ocorrências
  lerOuro('ocorrencias').cenarios.forEach((c, i) => {
    if (!c.esperado.ok) return;
    const id = c.entrada.paymentId;
    const antes = c.estado.payments.find((p) => p.id === id); const depois = c.esperado.ok.find((p) => p.id === id);
    if (!antes || !depois || JSON.stringify(antes) === JSON.stringify(depois)) return;
    const profile = (c.entrada.creditProfile) || { clientId: antes.clientId, credit: 0, minuteBenefits: [], movements: [] };
    conferir(`ocorrencia-${c.tipo}#${i}`, antes, depois, { payments: c.estado.payments, consultations: c.estado.consultations, profile }, c.papel, 'ocorrencia', { mutar: (d) => ({ ...d, financialOccurrences: d.financialOccurrences.map((o, k) => (k === d.financialOccurrences.length - 1 ? { ...o, note: `${o.note} X` } : o)) }) });
  });
  // transferências (uma conferência por perna)
  lerOuro('transferencia').cenarios.forEach((c, i) => {
    if (c.tipo !== 'transferir' || !c.esperado.ok) return;
    c.esperado.ok.forEach((depois) => {
      const antes = c.estado.payments.find((p) => p.id === depois.id);
      if (!antes || JSON.stringify(antes) === JSON.stringify(depois)) return;
      const nomes = Object.fromEntries(Object.keys(c.contexto.names).map((id) => [id, true]));
      conferir(`transferencia#${i}`, antes, depois, { payments: c.estado.payments, consultations: c.estado.consultations, profile: c.contexto.profiles[antes.clientId], perfis: c.contexto.profiles, nomes, valorRegular: c.contexto.regularMinuteValue }, c.contexto.role, 'transferencia',
        { mutar: (d) => ({ ...d, movements: d.movements.map((m) => (m.kind === 'balance-transfer' ? { ...m, amount: m.amount + 1 } : m)) }) });
    });
  });
  return { nome: 'roteador (operação do navegador refeita no servidor)', total, ok, recusas: mutantes, falhas, aceitos: ok, extra: `  famílias: ${Object.entries(familias).map(([k, v]) => `${k}=${v}`).join(' ')}; mutantes recusados: ${mutantes}` };
}
module.exports = { verificar };
