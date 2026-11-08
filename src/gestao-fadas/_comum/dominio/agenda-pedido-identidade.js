'use strict';

/**
 * Identificação de quem pede consulta (domínio puro), v706 da Nice. Porte de `features/agenda/agenda-intake-model.ts`:
 * `normalizeIntakeWhatsapp`, `validateIntakeIdentity`, `nextAgendaContactCode`, `formatAgendaContactCode`, `activeAgendaContact`,
 * `resolveIntakeContact`, `duplicateIntakeRequest`. Ouro: scripts/gerar-ouro-gf-agenda-pedido.js.
 */

/** Só telefone completo: o número local brasileiro precisa do DDD; o estrangeiro, do DDI explícito. */
function normalizarWhatsapp(valor) {
  const texto = `${valor}`.trim();
  if (!texto || !/^\+?[\d\s().-]+$/.test(texto)) return undefined;
  let digitos = texto.replace(/\D/g, '');
  const explicito = texto.startsWith('+') || digitos.startsWith('00');
  if (digitos.startsWith('00')) digitos = digitos.slice(2);
  if (explicito && !digitos.startsWith('55')) return /^[1-9]\d{9,14}$/.test(digitos) && !/(\d)\1{7}/.test(digitos) ? `+${digitos}` : undefined;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) digitos = digitos.slice(2);
  else if (explicito) return undefined;
  if (!/^[1-9]\d[2-9]\d{7,8}$/.test(digitos) || /^(\d)\1+$/.test(digitos.slice(2))) return undefined;
  return `+55${digitos}`;
}

/** @param candidatos `[{ id, phone }]` (as clientes que a taróloga já atendeu). */
function validarIdentidadeDoPedido(identidade, candidatos) {
  const id = identidade.clientId.trim();
  const bruto = identidade.whatsapp.trim();
  const fone = normalizarWhatsapp(bruto);
  const porId = id ? candidatos.find((r) => r.id === id) : undefined;
  if (bruto && !fone) return { error: 'Informe o WhatsApp completo, com DDD e os 8 ou 9 números locais.' };
  if (!id && !fone) return { error: 'Informe o ID ou um WhatsApp completo com DDD.' };
  const iguais = fone ? candidatos.filter((r) => normalizarWhatsapp(r.phone) === fone) : [];
  if (iguais.length > 1) return { error: 'Esse WhatsApp não identifica uma única cliente. Confira o ID e o contato.' };
  if (porId && fone && ((iguais[0] && iguais[0].id !== porId.id) || (normalizarWhatsapp(porId.phone) && normalizarWhatsapp(porId.phone) !== fone))) return { error: 'O ID e o WhatsApp não correspondem à mesma cliente. Confira os dados.' };
  if (porId) return { client: porId };
  if (!fone) return { error: 'ID não localizado no seu histórico. Informe também um WhatsApp completo com DDD.' };
  if (id && iguais[0] && iguais[0].id !== id) return { error: 'O ID e o WhatsApp não correspondem à mesma cliente. Confira os dados.' };
  return { client: iguais[0] };
}

/** O código fica reservado após a conversão: nunca conta só a lista visível. */
function proximoCodigoDeContato(contatos) {
  const maior = contatos.reduce((max, c) => Math.max(max, Number((/^I[CL]\s*(\d+)$/i.exec(c.displayCode || '') || [])[1] || 0)), 0);
  return `IL ${String(maior + 1).padStart(4, '0')}`;
}
const { encerrado } = require('./agenda-contato');
const { mesmaOcorrencia } = require('./agenda-ocorrencia');
const codigoDeContatoFormatado = (codigo) => (codigo ? codigo.replace(/^IC\s*/i, 'ID Contato ').replace(/^IL\s*/i, 'IL ') : '') || 'Contato';
const contatoAtivo = (c) => !c.archived && !c.clientId && c.classification !== 'client';

const AMBIGUO = 'Confira o ID e o WhatsApp com a equipe antes de enviar esse pedido.';
/** Consulta interna do serviço: nunca é exibida a uma taróloga fora do escopo das clientes que ela atendeu. */
function resolverContato(identidade, contatos, perfis, diretorio) {
  const fone = normalizarWhatsapp(identidade.whatsapp);
  const id = identidade.clientId.trim();
  const conhecido = id && (diretorio[id] || perfis[id]) ? id : undefined;
  const donos = fone
    ? [...new Set([
      ...Object.keys({ ...diretorio, ...perfis }).filter((k) => normalizarWhatsapp((perfis[k] && perfis[k].whatsapp) || '') === fone),
      ...contatos.filter((c) => c.clientId && (diretorio[c.clientId] || perfis[c.clientId]) && normalizarWhatsapp(c.whatsapp) === fone).map((c) => c.clientId)])]
    : [];
  const porFone = fone ? contatos.filter((c) => !c.archived && normalizarWhatsapp(c.whatsapp) === fone) : [];
  if (porFone.length > 1) return { ambiguous: true, error: 'Não foi possível identificar um contato único. Confira o ID e o WhatsApp com a equipe.' };
  const guardado = conhecido ? normalizarWhatsapp((perfis[conhecido] && perfis[conhecido].whatsapp) || '') : undefined;
  const conflito = Boolean((conhecido && fone && ((guardado && guardado !== fone) || donos.some((k) => k !== conhecido))) || (id && !conhecido && donos.length));
  const ambiguo = donos.length > 1 || conflito;
  const clientId = ambiguo ? undefined : conhecido || donos[0];
  const porCliente = clientId ? contatos.filter((c) => !c.archived && c.clientId === clientId) : [];
  if (porCliente.length > 1) return { ambiguous: true, error: 'Há mais de um contato para essa identificação. Confira o vínculo com a equipe.' };
  if (porCliente[0] && porFone[0] && porCliente[0].id !== porFone[0].id) return { ambiguous: true, error: 'O ID e o WhatsApp pertencem a contatos distintos. Confira os registros com a equipe.' };
  const contato = porCliente[0] || porFone[0];
  if (contato && ((contato.clientId && clientId && contato.clientId !== clientId) || (ambiguo && contato.clientId))) return { ambiguous: true, error: AMBIGUO };
  const doContato = contato && contato.clientId;
  if (doContato && id && id !== doContato) return { ambiguous: true, error: AMBIGUO };
  return { clientId: clientId || doContato, contact: contato, ambiguous: ambiguo };
}

/** O mesmo pedido da mesma pessoa à mesma taróloga no mesmo dia (pedido desagendado não conta). */
function pedidoDuplicado(pedidos, candidato, contatos = [], agenda = [], agora = Date.now()) {
  const quem = (p) => {
    const c = contatos.find((x) => x.id === p.contactId);
    const id = p.submittedIdentity;
    return {
      phone: normalizarWhatsapp(c ? c.whatsapp : ((id && id.whatsapp) ?? '')),
      name: (c ? c.name : ((id && id.name) ?? p.client)).trim().toLocaleLowerCase('pt-BR'),
    };
  };
  const origem = quem(candidato);
  return pedidos.find((p) => {
    // Site v710: pedido cujo agendamento ligado já foi encerrado não repete; outro horário explícito é outro atendimento (`sameAgendaOccurrence`).
    const ligado = agenda.find((i) => i.requestId === p.id || i.id === p.agendaId);
    if (ligado && encerrado(ligado)) return false;
    if (p.tarotId !== candidato.tarotId || p.date !== candidato.date || (p.stage || 'ask') === 'descheduled' || !mesmaOcorrencia(p, candidato, candidato.date, agora)) return false;
    if (candidato.clientId && p.clientId) return p.clientId === candidato.clientId;
    if (candidato.contactId && p.contactId) return p.contactId === candidato.contactId;
    const atual = quem(p);
    return Boolean(origem.phone && atual.phone === origem.phone && atual.name === origem.name);
  });
}

module.exports = { normalizarWhatsapp, validarIdentidadeDoPedido, proximoCodigoDeContato, codigoDeContatoFormatado, contatoAtivo, resolverContato, pedidoDuplicado };
