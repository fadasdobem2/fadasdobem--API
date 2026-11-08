'use strict';

/**
 * Núcleo do mapeamento taróloga x contato Umbler (SOMENTE LEITURA): para cada taróloga ativa, procura o contato por telefone e classifica
 * (`encontrado`, `ambiguo`, `nao_encontrado`, `sem_telefone`, `telefone_invalido`, `erro`, `ja_vinculado`). O relatório (JSON e tabela) leva o telefone
 * SEMPRE mascarado; nada é gravado aqui. O provider entra por parâmetro (teste usa um falso; o real é o de src/providers/umbler).
 */

const { chave, mascarar } = require('./telefone');
const { procurar } = require('./umbler');

const ESPERA = (ms) => new Promise((r) => setTimeout(r, ms));
const STATUS = ['encontrado', 'ja_vinculado', 'ambiguo', 'nao_encontrado', 'sem_telefone', 'telefone_invalido', 'erro'];

/** Telefones distintos da taróloga (o mesmo número escrito de duas formas conta uma vez; a primeira origem fica). */
function telefonesDistintos(telefones) {
  const vistos = new Map();
  for (const t of telefones || []) {
    const k = chave(t.telefone);
    if (k && !vistos.has(k)) vistos.set(k, t);
  }
  return [...vistos.values()];
}

/** Uma taróloga: procura cada telefone, junta os contatos distintos e classifica. */
async function mapearUma(provider, t, { pausaMs = 0 } = {}) {
  const fones = telefonesDistintos(t.telefones);
  const item = { tarotId: `${t.tarotId}`, nome: t.nome, revisao: t.revisao, telefones: fones.map((f) => ({ origem: f.origem, mascarado: mascarar(f.telefone) })), candidatos: [], proposta: null, aprovar: false };
  if (!fones.length) return { ...item, status: 'sem_telefone', observacao: 'A taróloga não tem telefone/WhatsApp no cadastro.' };
  const porContato = new Map();
  const falhas = [];
  let semForma = 0;
  for (const f of fones) {
    const r = await procurar(provider, f.telefone);
    if (r.resultado === 'sem_variante') semForma += 1;
    if (r.resultado === 'erro') falhas.push({ origem: f.origem, ...r.erro });
    for (const c of r.contatos) {
      const via = { origem: f.origem, mascarado: mascarar(f.telefone), variante: r.variante };
      const atual = porContato.get(c.contactId);
      if (atual) atual.via.push(via); else porContato.set(c.contactId, { ...c, via: [via] });
    }
    if (pausaMs) await ESPERA(pausaMs);
  }
  item.candidatos = [...porContato.values()];
  if (falhas.length) item.falhas = falhas;
  const vinculado = t.umblerContact && t.umblerContact.contactId ? `${t.umblerContact.contactId}` : null;
  if (vinculado) item.vinculoAtual = { contactId: vinculado, ...(t.umblerContact.conversationId ? { conversationId: `${t.umblerContact.conversationId}` } : {}) };
  if (item.candidatos.length > 1) return { ...item, status: 'ambiguo', observacao: 'Mais de um contato na Umbler para os telefones desta taróloga. Escolha em `proposta` e aprove, ou deixe de fora.' };
  if (item.candidatos.length === 1) {
    const [c] = item.candidatos;
    item.proposta = { contactId: c.contactId, ...(c.chatId ? { conversationId: c.chatId } : {}) };
    if (vinculado === c.contactId) return { ...item, status: 'ja_vinculado', observacao: 'O cadastro já tem este contato.' };
    const obs = [c.chatId ? '' : 'A resposta da Umbler não trouxe o chat; só o contato será gravado.', vinculado ? `O cadastro tem outro contato (${vinculado}); só troca com "sobrescrever": true.` : '', falhas.length ? 'Consulta parcial: algum telefone falhou.' : ''].filter(Boolean).join(' ');
    return { ...item, status: 'encontrado', ...(obs ? { observacao: obs } : {}) };
  }
  if (falhas.length) return { ...item, status: 'erro', observacao: 'A consulta à Umbler falhou; nada foi concluído para esta taróloga.' };
  if (semForma === fones.length) return { ...item, status: 'telefone_invalido', observacao: 'Nenhum telefone com DDD reconhecível.' };
  return { ...item, status: 'nao_encontrado', observacao: 'Nenhum contato na Umbler para os telefones do cadastro.' };
}

/** Mapeia todas, em sequência (um pedido por vez, com pausa opcional). Devolve o relatório. */
async function mapear({ tarologas, provider, pausaMs = 0, agora = () => new Date() }) {
  const itens = [];
  for (const t of tarologas) itens.push(await mapearUma(provider, t, { pausaMs }));
  const resumo = Object.fromEntries(STATUS.map((s) => [s, itens.filter((i) => i.status === s).length]));
  return {
    geradoEm: agora().toISOString(), somenteLeitura: true,
    instrucoes: 'Nada foi gravado. Para gravar, copie este arquivo, ponha "aprovar": true nos itens aprovados (em ambíguos, escolha o contato em "proposta") e rode com --aplicar.',
    resumo: { total: itens.length, ...resumo }, itens,
  };
}

const pad = (v, n) => `${v ?? ''}`.padEnd(n).slice(0, n);

/** Tabela legível (telefone mascarado). */
function tabela(relatorio) {
  const linhas = [`${pad('ID', 6)} ${pad('Taróloga', 22)} ${pad('Telefone', 18)} ${pad('Situação', 17)} ${pad('Contato Umbler', 26)} ${pad('Nome na Umbler', 20)} Chat`];
  for (const i of relatorio.itens) {
    const c = i.candidatos[0];
    linhas.push(`${pad(i.tarotId, 6)} ${pad(i.nome, 22)} ${pad((i.telefones[0] && i.telefones[0].mascarado) || '-', 18)} ${pad(i.status, 17)} ${pad(i.candidatos.length > 1 ? `${i.candidatos.length} contatos` : (c && c.contactId) || '-', 26)} ${pad(i.candidatos.length > 1 ? '(ambíguo)' : (c && c.nome) || '-', 20)} ${i.candidatos.length > 1 ? '-' : (c && c.chatId) || '-'}`);
  }
  const r = relatorio.resumo;
  linhas.push('', `Total ${r.total}: ${STATUS.map((s) => `${s} ${r[s]}`).join(', ')}.`);
  return linhas.join('\n');
}

module.exports = { mapear, mapearUma, tabela, telefonesDistintos, STATUS };
