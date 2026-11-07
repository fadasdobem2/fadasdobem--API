'use strict';

/**
 * `clients` e `phoneLookup` do snapshot (Maturacao/59, 3.2; Maturacao/60, seção 9).
 *  - Identificação por telefone: pré-filtro pelos 8 últimos dígitos (legado `usuarios` + WhatsApp editado em `gf_clientes_ext`) e decisão por
 *    `clientPhoneMatches` do painel (mais o nono dígito, marcado `phoneMatch:'ninth_digit'`). `phoneLookup {phone, complete:true}` SÓ quando
 *    a busca cobriu todas as candidatas: erro, passar de 50 candidatas, telefone sem DDD ou `ddd` x `ddd_real` divergentes = incompleta.
 *  - Saldo e Pré/Pós só das clientes em foco (as da conversa). Saldo que não pôde ser lido FICA AUSENTE (nunca vira 0) e rebaixa a cobertura.
 */

const { LIMITES } = require('./contexto.limites');
const { LimiteExcedido } = require('./contexto.cobertura');
const { comoCasa, normalizarObservado, telefonesDoCadastro, textoParaLilly, ultimos8 } = require('./contexto.telefone');
const { comExtensao, clienteParaLilly } = require('./contexto.cadastro');

const porId = (linhas, campo) => new Map(linhas.map((l) => [`${l[campo]}`, l]));

/**
 * Busca COMPLETA por telefone. Devolve `{ candidatas: Map(id -> { casamento, telefone }), linhas, phoneLookup, completa }`.
 * Lança em falha de fonte (o chamador torna o assunto incompleto e descarta tudo).
 */
async function buscarPorTelefone(telefoneBruto, f) {
  const observado = normalizarObservado(telefoneBruto);
  if (!observado) return { candidatas: new Map(), linhas: [], phoneLookup: { phone: `${telefoneBruto}`.trim(), complete: false }, completa: false, motivo: 'telefone-sem-ddd' };
  const d8 = ultimos8(observado);
  const max = LIMITES.CANDIDATAS_TELEFONE;
  const [legado, extensoes] = await Promise.all([f.usuariosPorTelefone(d8, max), f.clientesExtPorTelefone(d8, max)]);
  if (legado.length > max || extensoes.length > max) throw new LimiteExcedido('phoneLookup');

  const idsExt = extensoes.map((e) => `${e.id_cliente}`);
  const linhasExt = idsExt.length ? await f.usuariosPorIds(idsExt) : [];
  const exts = porId(extensoes, 'id_cliente');
  const todas = [...new Map([...legado, ...linhasExt].map((l) => [`${l.id}`, l])).values()].map((l) => comExtensao(l, exts.get(`${l.id}`)));
  if (todas.length > max) throw new LimiteExcedido('phoneLookup');

  const candidatas = new Map();
  let ambigua = false;
  for (const linha of todas) {
    const { telefones, ambigua: dubia } = telefonesDoCadastro(linha);
    let melhor = '';
    for (const t of telefones) {
      const c = comoCasa(observado, t);
      if (c === 'exact') { melhor = 'exact'; break; }
      if (c === 'ninth_digit' && !melhor) melhor = 'ninth_digit';
    }
    if (dubia) ambigua = true; // não dá para afirmar o DDD: a busca não é completa
    if (melhor) candidatas.set(`${linha.id}`, { casamento: melhor === 'ninth_digit' ? 'ninth_digit' : '', telefone: melhor === 'ninth_digit' ? observado : '' });
  }
  return { candidatas, linhas: todas, phoneLookup: { phone: observado, complete: !ambigua }, completa: !ambigua, motivo: ambigua ? 'ddd-divergente' : '' };
}

/** Saldo e perfil das clientes em foco. `falhas` conta quem ficou sem saldo (campo ausente, nunca 0). */
async function dadosFinanceiros(focoIds, f) {
  const mapa = new Map();
  let falhas = 0;
  for (const id of focoIds) {
    try { mapa.set(id, await f.saldoDaCliente(id)); } catch (e) { falhas += 1; }
  }
  return { mapa, falhas };
}

/** Última consulta no Postgres por cliente em foco (as do legado são anteriores; sem consulta nova o campo fica ausente). */
async function ultimasConsultas(focoIds, f) {
  const mapa = new Map();
  for (const l of await f.ultimaConsultaPorCliente(focoIds)) if (!mapa.has(`${l.id_cliente}`)) mapa.set(`${l.id_cliente}`, new Date(l.iniciada_em).toISOString());
  return mapa;
}

/**
 * @param {{ focoIds: string[], filaIds: string[], candidatas?: object, linhasDaBusca?: object[], contatos: Map<string,string>, profileBase?: string }} entrada
 * @returns {{ clients: object[], saldosSemLeitura: number }}
 */
async function montarClientes({ focoIds, filaIds, busca, contatos, profileBase }, f) {
  const candidatas = busca ? busca.candidatas : new Map();
  const todosIds = [...new Set([...focoIds, ...candidatas.keys(), ...filaIds])];
  if (todosIds.length > LIMITES.CLIENTES) throw new LimiteExcedido('clients');
  const linhasDaBusca = busca ? busca.linhas : [];
  const jaTem = new Set(linhasDaBusca.map((l) => `${l.id}`));
  const faltam = todosIds.filter((id) => !jaTem.has(id));
  const legado = faltam.length ? await f.usuariosPorIds(faltam) : [];
  const exts = porId(todosIds.length ? await f.clientesExt(todosIds) : [], 'id_cliente');
  const linhas = [...linhasDaBusca, ...legado.map((l) => comExtensao(l, exts.get(`${l.id}`)))];
  // Só entram os pedidos: o legado pode devolver linhas de uma busca por telefone que não casaram.
  const queroIds = new Set(todosIds);
  const { mapa: saldos, falhas } = await dadosFinanceiros(focoIds, f);
  const ultimas = focoIds.length ? await ultimasConsultas(focoIds, f) : new Map();
  const clients = linhas.filter((l) => queroIds.has(`${l.id}`)).sort((a, b) => Number(a.id) - Number(b.id)).map((linha) => {
    const id = `${linha.id}`;
    const emFoco = focoIds.includes(id);
    const cand = candidatas.get(id);
    const fin = saldos.get(id);
    const perfilExt = exts.get(id) && exts.get(id).perfil_pagamento;
    return clienteParaLilly(linha, {
      perfil: (fin && fin.paymentProfile) || perfilExt, saldo: fin ? fin.balance : undefined, ultimaConsulta: emFoco ? ultimas.get(id) : undefined,
      contactId: contatos.get(id), profileBase, casamento: cand && cand.casamento, telefoneDoCasamento: cand && cand.telefone ? textoParaLilly(cand.telefone) : undefined,
    });
  });
  return { clients, saldosSemLeitura: falhas };
}

module.exports = { buscarPorTelefone, montarClientes };
