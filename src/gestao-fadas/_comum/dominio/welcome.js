'use strict';

/**
 * Domínio puro das boas-vindas (tela de entrada). Porte de `features/auth/welcome-model.ts` do front (conteúdo padrão,
 * `migrateWelcomeAudiences` e `validateWelcome`) com as MESMAS mensagens; o ouro vem do código do front
 * (scripts/gerar-ouro-gf-config.js). Nada de I/O.
 */

const PERIODOS = ['morning', 'afternoon', 'evening', 'dawn'];
const PUBLICOS = ['atendimento', 'tarologo'];
const NOMES_PUBLICO = { atendimento: 'Atendimento', tarologo: 'Tarólogo' };
const NOMES_PERIODO = { morning: 'Manhã', afternoon: 'Tarde', evening: 'Noite', dawn: 'Madrugada' };
const TITULO_PADRAO = 'Biscoitinho da Sorte';

class WelcomeInvalidoError extends Error {
  constructor(mensagem) { super(mensagem); this.name = 'WelcomeInvalidoError'; }
}

const SAUDACOES_LEGADAS = [
  { id: 'morning-1', period: 'morning', title: 'Que bom ter você aqui.', text: 'A casa vai ganhando vida com a chegada de cada um.', active: true },
  { id: 'afternoon-1', period: 'afternoon', title: 'Entre, fique à vontade.', text: 'Ainda temos uma tarde inteira de encontros pela frente.', active: true },
  { id: 'evening-1', period: 'evening', title: 'Nossa luz continua acesa.', text: 'Tem gente chegando, histórias começando e você por aqui.', active: true },
  { id: 'dawn-1', period: 'dawn', title: 'A casa está quietinha.', text: 'A esta hora, nossa companhia tem um aconchego diferente.', active: true },
];
const TEXTOS_DA_SORTE = [
  'Uma boa notícia pode chegar sem fazer alarde.', 'Alguém vai gostar de saber de você.', 'A sorte pode estar numa conversa que você quase deixou para depois.',
  'Há um reencontro procurando espaço na sua agenda.', 'Uma gentileza sua ainda vai voltar em forma de surpresa.', 'A resposta pode vir de quem você menos espera.',
  'Tem coisa boa chegando sem hora marcada.', 'Um convite pequeno pode render uma grande história.', 'Hoje, alguém pode lembrar de você e sorrir.',
  'Uma coincidência pode deixar o seu dia mais interessante.', 'Nem toda visita avisa. A sorte, por exemplo.', 'Um assunto antigo ainda pode ganhar um final feliz.',
];
const MENSAGENS_LEGADAS = TEXTOS_DA_SORTE.map((text, i) => ({ id: `fortune-${i + 1}`, title: TITULO_PADRAO, text, active: true }));
const SAUDACOES_TAROLOGO = [
  { id: 'tarologo-morning-1', audience: 'tarologo', period: 'morning', title: 'Tem gente esperando pela sua leitura.', text: 'As cartas ainda estão na mesa, mas as histórias de hoje já começaram.', active: true },
  { id: 'tarologo-afternoon-1', audience: 'tarologo', period: 'afternoon', title: 'Uma boa conversa começa nas cartas.', text: 'Entre uma história e outra, que esta tarde também traga bons encontros para você.', active: true },
  { id: 'tarologo-evening-1', audience: 'tarologo', period: 'evening', title: 'A noite chegou. As cartas têm companhia.', text: 'Há quem guarde para esta hora a conversa que esperou o dia inteiro para ter.', active: true },
  { id: 'tarologo-dawn-1', audience: 'tarologo', period: 'dawn', title: 'Ainda há histórias acordadas.', text: 'Nesta hora mais quieta, cada consulta encontra seu próprio ritmo.', active: true },
];

/** `DEFAULT_WELCOME` do front (mesma ordem de chaves). */
const WELCOME_PADRAO = {
  greetings: [...SAUDACOES_LEGADAS.map((r) => ({ ...r, audience: 'atendimento' })), ...SAUDACOES_TAROLOGO],
  messages: PUBLICOS.flatMap((audience) => MENSAGENS_LEGADAS.map((r) => ({ ...r, id: audience === 'atendimento' ? r.id : `tarologo-${r.id}`, audience }))),
};
const copia = (v) => JSON.parse(JSON.stringify(v));
const padrao = () => copia(WELCOME_PADRAO);

const publicoDe = (row) => row.audience ?? 'atendimento';

/** `migrateWelcomeAudiences`: conteúdo antigo sem público ganha o público e recebe os textos padrão do tarólogo. */
function migrarPublicos(content) {
  const rows = [...content.greetings, ...content.messages];
  const legado = rows.length > 0 && rows.every((row) => row.audience === undefined);
  const next = {
    greetings: content.greetings.map((row) => ({ ...row, audience: publicoDe(row) })),
    messages: content.messages.map((row) => ({ ...row, audience: publicoDe(row), title: row.title ?? TITULO_PADRAO })),
  };
  if (legado) {
    const ids = new Set(rows.map((row) => row.id));
    const unico = (row) => {
      let id = row.id; let sufixo = 0;
      while (ids.has(id)) { sufixo += 1; id = `${row.id}-migrado-${sufixo}`; }
      ids.add(id); return { ...row, id };
    };
    next.greetings.push(...padrao().greetings.filter((row) => row.audience === 'tarologo').map(unico));
    next.messages.push(...padrao().messages.filter((row) => row.audience === 'tarologo').map(unico));
  }
  return next;
}

/** `validateWelcome`: devolve o conteúdo normalizado ou lança `WelcomeInvalidoError` com a mensagem do front. */
function validar(value) {
  const erro = (m) => new WelcomeInvalidoError(m);
  if (!value || typeof value !== 'object') throw erro('Conteúdo inválido.');
  const source = value;
  if (!Array.isArray(source.greetings) || !Array.isArray(source.messages) || source.greetings.length > 600 || source.messages.length > 1000) throw erro('Use até 300 saudações e 500 mensagens por público.');
  const ids = new Set();
  const ler = (text, max, label, opcional = false) => {
    if (typeof text !== 'string' || text.length > max || (!opcional && !text.trim())) throw erro(`${label}: preencha um texto de até ${max} caracteres.`);
    return text.trim();
  };
  const identidade = (row) => {
    if (!row || typeof row.id !== 'string' || !/^[\w-]{1,90}$/.test(row.id) || ids.has(row.id) || typeof row.active !== 'boolean') throw erro('Há uma linha inválida ou repetida.');
    ids.add(row.id);
    if (row.audience !== undefined && !PUBLICOS.includes(row.audience)) throw erro('Selecione Atendimento ou Tarólogo como público do texto.');
    return { id: row.id, active: row.active, audience: row.audience };
  };
  const greetings = source.greetings.map((row) => {
    const base = identidade(row);
    if (!PERIODOS.includes(row.period)) throw erro('Selecione o período da saudação.');
    return { ...base, period: row.period, title: ler(row.title, 90, 'Frase grande'), text: ler(row.text, 220, 'Saudação abaixo', true) };
  });
  const messages = source.messages.map((row) => ({ ...identidade(row), title: row.title === undefined ? TITULO_PADRAO : ler(row.title, 90, 'Título da mensagem'), text: ler(row.text, 280, 'Mensagem') }));
  const content = migrarPublicos({ greetings, messages });
  for (const audience of PUBLICOS) {
    const g = content.greetings.filter((row) => row.audience === audience); const m = content.messages.filter((row) => row.audience === audience);
    if (g.length > 300 || m.length > 500) throw erro(`Use até 300 saudações e 500 mensagens para ${NOMES_PUBLICO[audience]}.`);
    for (const period of PERIODOS) if (!g.some((row) => row.period === period && row.active)) throw erro(`Mantenha ao menos uma saudação ativa para ${NOMES_PERIODO[period].toLocaleLowerCase('pt-BR')} de ${NOMES_PUBLICO[audience]}.`);
    if (!m.some((row) => row.active)) throw erro(`Mantenha ao menos uma mensagem ativa para ${NOMES_PUBLICO[audience]}.`);
  }
  return content;
}

/** O que a tela de entrada recebe: só as linhas ativas. */
const publico = (content) => ({ greetings: content.greetings.filter((r) => r.active), messages: content.messages.filter((r) => r.active) });

module.exports = { WELCOME_PADRAO, padrao, validar, migrarPublicos, publico, WelcomeInvalidoError, PERIODOS, PUBLICOS };
