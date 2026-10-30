'use strict';

/**
 * Linhas de banco simuladas (nomes de coluna das gf_repasse_*) para o item 2: o mesmo conjunto alimenta a leitura da B e a
 * do serviço da A. Determinístico (PRNG fixo); as linhas vão EMBARALHADAS, para a ordem de saída depender do ORDER BY
 * de cada lado e não da ordem em que as linhas foram escritas.
 */

function prng(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONTAS = { 'conta-1': 'Laya Souza', 'conta-2': 'Nice', 'conta-3': 'Ana "A" Lima' };

function cenario(sorteio, indice) {
  const pick = (l) => l[Math.floor(sorteio() * l.length)];
  const num = (a, b) => a + Math.floor(sorteio() * (b - a + 1));
  const dinheiro = () => `${num(0, 999)}.${String(num(0, 99)).padStart(2, '0')}`;
  const dia = () => `2026-${String(num(1, 12)).padStart(2, '0')}-${String(num(1, 28)).padStart(2, '0')}`;
  const conta = () => pick(Object.keys(CONTAS));
  const bigint = (n) => (sorteio() < 0.5 ? n : String(n));
  const tarot = String(num(1, 9999));
  let ms = 1_700_000_000_000 + indice * 100_000;
  const linhas = { percentuais: [], calendarios: [], aberturas: [], dividas: [], parcelas: [], ajustes: [], pendencias: [] };
  const sufixo = `${indice}`;

  const nRev = pick([0, 0, 1, 1, 2, 3]);
  for (let rev = 1; rev <= nRev; rev += 1) {
    const ultimo = rev === nRev;
    const situacao = !ultimo ? pick(['confirmada', 'descartada']) : pick(['confirmada', 'rascunho', 'rascunho', 'descartada']);
    const id = `ab-${sufixo}-${rev}`;
    const chave = `chave-${sufixo}-${rev}`;
    const dia0 = num(1, 20);
    ms += 1000;
    linhas.aberturas.push({
      id, tarot_id: tarot, revisao: rev, situacao, corrige_revisao: rev > 1 ? rev - 1 : null, motivo_correcao: rev > 1 ? pick(['erro de digitação', null]) : null,
      ultimo_pagamento_data: `2026-10-${String(dia0).padStart(2, '0')}`, ultimo_pagamento_valor: dinheiro(), planilha_referencia: `L${num(1, 99)}`,
      quitado_ate: `2026-10-${String(dia0 + 1).padStart(2, '0')} 06:00:00`, saldo_remanescente: sorteio() < 0.2 ? `-${dinheiro()}` : dinheiro(),
      saldo_composicao: pick([null, 'composição do saldo']), corte_migracao: `2026-10-${String(dia0 + 4).padStart(2, '0')} 06:00:00`,
      percentual_conferido: pick(['30.00', '35.50', '100.00', '0.00', '12.05']), lancado_por: conta(), lancado_em: bigint(ms),
      confirmado_por: situacao === 'confirmada' ? conta() : null, confirmado_em: situacao === 'confirmada' ? bigint(ms + 500) : null, operation_key: chave,
    });
    for (let d = 0; d < num(0, 3); d += 1) {
      const dividaId = `dv-${sufixo}-${rev}-${d}`;
      const valor = dinheiro();
      ms += 10;
      linhas.dividas.push({
        id: dividaId, tarot_id: tarot, tipo: pick(['loan', 'advance']), origem: 'migracao', abertura_id: id, valor, entrega_original: pick([null, dia()]), entregue_em: null,
        referencia_data: dia(), situacao: pick(['valido', 'substituido']), corrige_id: rev > 1 && sorteio() < 0.6 ? `dv-${sufixo}-${rev - 1}-${d}` : null,
        motivo_correcao: null, planilha_referencia: pick(['E1', null]), observacao: pick([null, 'obs']), registrado_por: conta(), registrado_em: bigint(ms),
        operation_key: sorteio() < 0.8 ? `childhash-${sufixo}-${rev}-${d}` : `outra-${sufixo}-${rev}-${d}`,
      });
      for (let p = 1; p <= num(1, 3); p += 1) linhas.parcelas.push({ divida_id: dividaId, sequencia: p, data: dia(), valor: dinheiro() });
    }
    for (let a = 0; a < num(0, 2); a += 1) {
      ms += 10;
      const data = dia();
      linhas.ajustes.push({
        id: `aj-${sufixo}-${rev}-${a}`, tarot_id: tarot, tipo: pick(['bonus', 'outro', 'desconto']), valor: dinheiro(), descricao: pick(['bônus', 'taxa "x"', 'ç']),
        data, periodo_inicio: data, periodo_fim: data, abertura_id: id, situacao: 'valido', corrige_id: null, motivo_correcao: null, registrado_por: conta(),
        registrado_em: bigint(ms), operation_key: `ajk-${sufixo}-${rev}-${a}`,
      });
    }
    for (let p = 0; p < num(0, 2); p += 1) {
      const resolvida = sorteio() < 0.5;
      linhas.pendencias.push({
        id: `pe-${sufixo}-${rev}-${p}`, abertura_id: id, descricao: 'pendência', valor: pick([null, dinheiro()]),
        resolvida_em: resolvida ? bigint(ms + 900) : null, resolvida_por: resolvida ? conta() : null,
      });
    }
  }
  for (let r = 0; r < num(0, 4); r += 1) {
    ms += 1000;
    linhas.percentuais.push({
      id: `pc-${sufixo}-${r}`, tarot_id: tarot, percentual: pick(['30.00', '35.00', '40.50', '0.00', '100.00']), vigente_desde: `2026-10-${String(num(1, 28)).padStart(2, '0')} ${pick(['06:00:00', '12:30:15', '23:59:59'])}`,
      motivo: pick([null, 'ajuste']), registrado_por: conta(), registrado_em: bigint(ms), operation_key: `pck-${sufixo}-${r}`,
    });
  }
  for (let r = 0; r < num(0, 4); r += 1) {
    ms += 1000;
    const tipo = pick(['weekday', 'monthdays', 'none']);
    linhas.calendarios.push({
      id: `ca-${sufixo}-${r}`, tarot_id: tarot, tipo, dia_semana: tipo === 'weekday' ? pick(['segunda', 'terca', 'quarta', 'quinta', 'sexta']) : null,
      dias_mes: tipo === 'monthdays' ? pick(['5', '5,20', '1,15,31']) : null, politica_fim_semana: tipo === 'monthdays' ? pick(['keep', 'next-business-day']) : null,
      vigente_desde: `2026-10-${String(num(1, 28)).padStart(2, '0')} 08:00:00`, motivo: pick([null, 'x']), registrado_por: conta(), registrado_em: bigint(ms), operation_key: `cak-${sufixo}-${r}`,
    });
  }
  // Uma linha de outro tarólogo, que nenhuma leitura pode devolver.
  linhas.percentuais.push({ id: `pc-${sufixo}-fora`, tarot_id: `${tarot}0`, percentual: '99.00', vigente_desde: '2026-10-01 00:00:00', motivo: null, registrado_por: 'conta-1', registrado_em: 1_700_000_000_001, operation_key: `fora-${sufixo}` });
  for (const nome of Object.keys(linhas)) for (let i = linhas[nome].length - 1; i > 0; i -= 1) { const j = Math.floor(sorteio() * (i + 1)); [linhas[nome][i], linhas[nome][j]] = [linhas[nome][j], linhas[nome][i]]; }
  return { tarotId: tarot, linhas, contas: CONTAS };
}

/** Cenários válidos e uns poucos com linha fora do formato (os dois lados têm de recusar, sem devolver valor presumido). */
function gerarCenariosDto() {
  const sorteio = prng(77);
  const bons = Array.from({ length: 80 }, (_, i) => cenario(sorteio, i + 1));
  const ruins = [];
  for (const [i, defeito] of [
    (l) => { l.percentuais[0].percentual = '35'; }, (l) => { l.percentuais[0].registrado_em = 'abc'; }, (l) => { l.calendarios[0].tipo = 'monthdays'; l.calendarios[0].dias_mes = '5,5'; },
    (l) => { l.aberturas[0].saldo_remanescente = '1.5'; }, (l) => { l.dividas[0].valor = '10'; }, (l) => { l.aberturas[0].situacao = 'outra'; },
    (l) => { l.parcelas[0].data = '2026-1-1'; }, (l) => { l.ajustes[0].tipo = 'x'; },
  ].entries()) {
    // procura um cenário com a linha que o defeito precisa
    const c = bons.find((b, k) => k > i && b.linhas.percentuais.length > 1 && b.linhas.calendarios.length && b.linhas.aberturas.length && b.linhas.dividas.length && b.linhas.parcelas.length && b.linhas.ajustes.length);
    if (!c) continue;
    const copia = JSON.parse(JSON.stringify(c));
    try { defeito(copia.linhas); } catch { continue; }
    ruins.push({ ...copia, defeito: i });
  }
  return [...bons, ...ruins];
}

module.exports = { gerarCenariosDto };
