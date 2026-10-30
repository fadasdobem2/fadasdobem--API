'use strict';

/**
 * Domínio puro dos Recados (Maturacao/29 seção 12): porte do que o SERVIDOR precisa conferir de `painel/operational-note-model.ts` do front.
 * Visibilidade (`canViewOperationalNote`), raiz da conversa (`noteConversationRoot`), validação de texto (`validateObservation`) e de período
 * (`validateNoteDetails`), e a montagem do recado que cada conta lê (leituras de todos; fixar, prioridade e arquivo só da própria conta).
 * Nada de banco aqui. Mensagens iguais às `throw new Error` do front, para a tela mostrar o mesmo texto.
 */

const { permissoesDoPerfil } = require('../politica-acesso');

class RecadoInvalidoError extends Error {}
const erro = (mensagem) => new RecadoInvalidoError(mensagem);

const ASSUNTOS = ['Mudança de horário', 'Escala', 'Folga', 'Consulta', 'Conexão', 'Equipamento', 'Licença'];
const LIMITE_TEXTO = 4000;

/** `validateText` (domain/input-validation.ts) com `multiline`: devolve o texto aparado ou lança com o rótulo na frente. */
function validarTexto(valor, rotulo, obrigatorio = false) {
  const falha = (m) => { throw erro(`${rotulo}: ${m}`); };
  if (typeof valor !== 'string') return falha('informe um texto válido.');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(valor)) return falha('há um caractere de controle inválido. Apague e digite novamente o trecho colado.');
  for (const c of valor) { const p = c.codePointAt(0); if (p >= 0xD800 && p <= 0xDFFF) return falha('há um caractere incompleto. Apague e digite novamente o trecho colado.'); }
  const texto = valor.trim();
  if (obrigatorio && !texto) return falha('preencha este campo.');
  if (Array.from(texto).length > LIMITE_TEXTO) return falha(`use no máximo ${LIMITE_TEXTO} caracteres. O texto não foi cortado.`);
  return texto;
}

const dataValida = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;

/** `validateNoteDetails`. */
function validarPeriodo(d) {
  if (d.subject !== 'Diversos' && d.subject !== 'Horário' && !ASSUNTOS.includes(d.subject)) throw erro('Escolha a que se refere o recado.');
  if (!dataValida(d.startDate) || !dataValida(d.endDate)) throw erro('Informe as datas de início e fim do recado.');
  if (d.endDate < d.startDate) throw erro('A data final não pode ser anterior à inicial.');
  return d;
}

/** `operationalNoteDetails`: assunto e período do recado (data do recado, ou do instante em São Paulo, quando faltam). */
function detalhes(n) {
  const sp = (iso) => new Date(Date.parse(iso) - 3 * 3600000).toISOString().slice(0, 10);
  const startDate = n.startDate ?? n.date ?? sp(n.at);
  return { subject: n.subject ?? 'Diversos', startDate, endDate: n.endDate ?? startDate };
}

const equipe = (papel) => Boolean(papel && permissoesDoPerfil(papel).canManageConsultations);

/** `canViewOperationalNote` com conta: `conta = { id, papel, tarotId }`. */
function visivel(nota, conta) {
  if (!nota.delivery) return conta.papel === 'tarologa' ? Boolean(conta.tarotId && nota.tarotId === conta.tarotId) : equipe(conta.papel);
  const d = nota.delivery;
  if (d.kind === 'board') return equipe(conta.papel);
  if (d.senderId === conta.id) return true;
  return !(d.excludedIds || []).includes(conta.id) && (d.recipientIds || []).includes(conta.id);
}

/** `noteConversationRoot`: sobe pelas respostas até a raiz (undefined em laço ou pai de outro tarólogo). */
function raiz(notas, id) {
  let n = notas.find((x) => x.id === id);
  const visto = new Set();
  while (n && n.replyToId) {
    if (visto.has(n.id)) return undefined;
    visto.add(n.id);
    const pai = notas.find((x) => x.id === n.replyToId);
    if (!pai || pai.tarotId !== n.tarotId) return undefined;
    n = pai;
  }
  return n;
}

/** Só o que cada conta pode ler: a raiz da conversa é visível a ela (`visibleOperationalNotes`). */
const visiveisPara = (notas, conta) => notas.filter((n) => { const r = raiz(notas, n.id); return Boolean(r && visivel(r, conta)); });

/** Texto estável (chaves em ordem): o jsonb do Postgres não guarda a ordem das chaves, então comparar é por valor. */
function estavel(v) {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const igual = (a, b) => estavel(a) === estavel(b);

const versaoDe = (n) => n.updatedAt ?? n.at;

/**
 * O recado como a conta o lê. `pessoais` são as linhas de `gf_recados_pessoais` do recado: as leituras vão para todos (quem enviou vê quem leu);
 * fixar, prioridade e arquivo só da própria conta.
 */
function montar(item, pessoais, contaId) {
  const lidas = {}; let ultima = null;
  const mine = { pin: null, prio: null, arq: null };
  for (const p of pessoais) {
    if (p.lido_em && p.lido_versao) {
      const lida = { at: new Date(p.lido_em).toISOString(), by: p.lido_por, version: p.lido_versao };
      lidas[p.id_conta] = lida;
      if (p.lido_versao === versaoDe(item) && (!ultima || Date.parse(lida.at) >= Date.parse(ultima.lida.at))) ultima = { lida, conta: p.id_conta };
    }
    if (p.id_conta === contaId) {
      if (p.fixado_em) mine.pin = { at: new Date(p.fixado_em).toISOString() };
      if (p.prioridade_em) mine.prio = { at: new Date(p.prioridade_em).toISOString() };
      if (p.arquivado) mine.arq = p.arquivado;
    }
  }
  const saida = { ...item };
  if (Object.keys(lidas).length) saida.readsByAccount = lidas;
  if (ultima) { saida.readAt = ultima.lida.at; saida.readBy = ultima.lida.by; saida.readById = ultima.conta; }
  if (mine.pin) saida.pinnedByAccount = { [contaId]: mine.pin };
  if (mine.prio) saida.prioritizedByAccount = { [contaId]: mine.prio };
  if (mine.arq) saida.archivedByAccount = { [contaId]: mine.arq };
  return saida;
}

module.exports = { RecadoInvalidoError, erro, ASSUNTOS, validarTexto, validarPeriodo, dataValida, detalhes, equipe, visivel, raiz, visiveisPara, estavel, igual, versaoDe, montar };
