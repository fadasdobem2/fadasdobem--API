'use strict';

/**
 * `tarologists` do snapshot (Maturacao/59, 3.3): catálogo (legado `tbl_tarologos` + extensões, `tarologos.service.catalogo`), presença
 * (`gf_presenca_estado`, vocabulário traduzido) e o horário de hoje/amanhã (`schedules`). Entram os de cadastro ativo e os citados no
 * snapshot (fila, consultas, evento). O id `afila` (fila geral) nunca é tarólogo.
 *  - SEM FONTE (Maturacao/60, 10): `conversationId`, `umblerContactId`, `umblerChannelId`, `aliases`. `gf_lilly_vinculos`
 *    liga CLIENTE a conversa (coluna `id_cliente`); não há vínculo de tarólogo em lugar nenhum, então esses campos saem AUSENTES.
 */

const { LIMITES } = require('./contexto.limites');
const { LimiteExcedido } = require('./contexto.cobertura');

const FILA_GERAL = 'afila';
const sem = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/**
 * `nameArticle` EXPLÍCITO do cadastro (`directory.nameArticle`: perfil editado ou coluna `gf_tarologos_ext.name_article`): 'o', 'a' ou null (neutro,
 * declarado). Ausente quando o cadastro nunca o informou. NUNCA deduzido do nome, da foto ou do perfil de acesso (docs/banco/22 da Nice).
 */
function tratamentoExplicito(t) {
  const d = t && t.directory;
  if (!d || !Object.prototype.hasOwnProperty.call(d, 'nameArticle')) return undefined;
  return d.nameArticle === 'o' || d.nameArticle === 'a' ? d.nameArticle : d.nameArticle === null ? null : undefined;
}

/** Turno do Gestão -> `status` que a Lilly entende (`offline/ended`, `paused`; "Disponível" fica `available`: sem sinal de saída). */
function statusDePresenca(p) {
  if (p.shift_status === 'Em pausa') return 'paused';
  if (p.shift_status === 'Offline') return p.shift_exit === 'ended' || p.shift_exit === 'shift-ended' ? 'ended' : 'offline';
  if (p.shift_status === 'Disponível') return 'available';
  return undefined;
}

const primeira = (escalas, id, data) => escalas.filter((e) => e.tarologistId === id && e.date === data && e.status !== 'off' && e.startsAt).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

/**
 * v711: `serviceModes` (padrão do cadastro) e `serviceModesToday` (formas do dia, `gf_formas_atendimento_dia`) quando existem; a Lilly decide o canal com elas.
 * @param {{ catalogo: object[], presencas: object[], escalas: object[], citados: Set<string>, hoje: string, amanha: string, formas?: object[] }} e
 */
function montarTarologos({ catalogo, presencas, escalas, citados, hoje, amanha, formas = [] }) {
  const formasDoDia = new Map(formas.map((f) => [`${f.tarologo_id}`, f]));
  const presenca = new Map(presencas.map((p) => [`${p.id_tarologo}`, p]));
  const lista = catalogo.filter((t) => `${t.id}` !== FILA_GERAL && (t.registrationActive !== false || citados.has(`${t.id}`)));
  if (lista.length > LIMITES.TAROLOGOS) throw new LimiteExcedido('tarologists');
  return lista.map((t) => {
    const id = `${t.id}`;
    const p = presenca.get(id);
    const hojeP = primeira(escalas, id, hoje);
    const amanhaP = primeira(escalas, id, amanha);
    const turno = hojeP[0];
    const temEscalaAmanha = escalas.some((e) => e.tarologistId === id && e.date === amanha); // sem escala definida: não afirma que não trabalha
    const tratamento = tratamentoExplicito(t);
    const meios = formasDoDia.get(id);
    const habituais = t.directory && Array.isArray(t.directory.serviceModes) ? t.directory.serviceModes : undefined;
    return { ...(tratamento !== undefined ? { nameArticle: tratamento } : {}),
      ...(habituais ? { serviceModes: habituais } : {}),
      ...(t.directory && t.directory.umblerContact && t.directory.umblerContact.contactId ? { umblerContact: t.directory.umblerContact } : {}),
      ...(meios ? { serviceModesToday: { date: meios.data_operacional, modes: typeof meios.formas === 'string' ? JSON.parse(meios.formas) : meios.formas, updatedAt: new Date(meios.atualizado_em).toISOString(), updatedBy: meios.atualizado_por } } : {}), ...sem({
      id,
      name: t.name,
      status: p ? statusDePresenca(p) : undefined,
      presenceUpdatedAt: p && p.atualizado_em ? new Date(p.atualizado_em).toISOString() : undefined,
      scheduleId: turno ? turno.id : undefined,
      scheduleDate: turno ? hoje : undefined,
      expectedAt: turno ? turno.startsAt : undefined,
      startsAt: turno ? turno.startsAt : undefined,
      endsAt: hojeP.length ? hojeP[hojeP.length - 1].endsAt : undefined,
      worksTomorrow: temEscalaAmanha ? amanhaP.length > 0 : undefined,
      tomorrowDate: temEscalaAmanha ? amanha : undefined,
    }) };
  });
}

module.exports = { montarTarologos, statusDePresenca, FILA_GERAL };
