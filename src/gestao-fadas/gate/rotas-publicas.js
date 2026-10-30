'use strict';

/**
 * Rotas públicas da B que o gate ainda não cobria: `/welcome` e `/tarologos-cadastro` (sem sessão, como a B).
 *
 * Porte do que a B serve em Node (`node-target/app/api/welcome/route.ts` e `.../tarologos-cadastro/route.ts`), que NÃO
 * usa os services de D1 (`welcome-service.ts`, `registration-service.ts`): não existe armazenamento de edição neste
 * ambiente, e a A também não tem. Nada é gravado e nenhum cabeçalho de identidade (`oai-authenticated-user-*`) é lido.
 *
 *   GET /welcome                 200 `{ revision: 0, content: { greetings, messages } }` só com os ativos do padrão
 *   GET /welcome?editor=1        503 (edição não integrada)
 *   PUT /welcome                 503 (edição não integrada)
 *   GET|POST|PUT /tarologos-cadastro   503 (recebimento de cadastros não integrado)
 *   OPTIONS                      204 + Allow; HEAD acompanha o GET; qualquer outro método: 405 sem corpo (o framework da B)
 *
 * O conteúdo padrão é o `DEFAULT_WELCOME` de `features/auth/welcome-model.ts`, montado do mesmo jeito (mesma ordem de
 * chaves, para o JSON sair byte a byte igual ao da B).
 */

const { Router } = require('express');

const TITULO_MENSAGEM = 'Biscoitinho da Sorte';
const PUBLICOS = ['atendimento', 'tarologo'];

/** `LEGACY_WELCOME` da B. */
const SAUDACOES_LEGADAS = [
  { id: 'morning-1', period: 'morning', title: 'Que bom ter você aqui.', text: 'A casa vai ganhando vida com a chegada de cada um.', active: true },
  { id: 'afternoon-1', period: 'afternoon', title: 'Entre, fique à vontade.', text: 'Ainda temos uma tarde inteira de encontros pela frente.', active: true },
  { id: 'evening-1', period: 'evening', title: 'Nossa luz continua acesa.', text: 'Tem gente chegando, histórias começando e você por aqui.', active: true },
  { id: 'dawn-1', period: 'dawn', title: 'A casa está quietinha.', text: 'A esta hora, nossa companhia tem um aconchego diferente.', active: true },
];
const TEXTOS_DA_SORTE = [
  'Uma boa notícia pode chegar sem fazer alarde.',
  'Alguém vai gostar de saber de você.',
  'A sorte pode estar numa conversa que você quase deixou para depois.',
  'Há um reencontro procurando espaço na sua agenda.',
  'Uma gentileza sua ainda vai voltar em forma de surpresa.',
  'A resposta pode vir de quem você menos espera.',
  'Tem coisa boa chegando sem hora marcada.',
  'Um convite pequeno pode render uma grande história.',
  'Hoje, alguém pode lembrar de você e sorrir.',
  'Uma coincidência pode deixar o seu dia mais interessante.',
  'Nem toda visita avisa. A sorte, por exemplo.',
  'Um assunto antigo ainda pode ganhar um final feliz.',
];
const MENSAGENS_LEGADAS = TEXTOS_DA_SORTE.map((text, i) => ({ id: `fortune-${i + 1}`, title: TITULO_MENSAGEM, text, active: true }));

/** `TAROLOGIST_GREETINGS` da B. */
const SAUDACOES_TAROLOGO = [
  { id: 'tarologo-morning-1', audience: 'tarologo', period: 'morning', title: 'Tem gente esperando pela sua leitura.', text: 'As cartas ainda estão na mesa, mas as histórias de hoje já começaram.', active: true },
  { id: 'tarologo-afternoon-1', audience: 'tarologo', period: 'afternoon', title: 'Uma boa conversa começa nas cartas.', text: 'Entre uma história e outra, que esta tarde também traga bons encontros para você.', active: true },
  { id: 'tarologo-evening-1', audience: 'tarologo', period: 'evening', title: 'A noite chegou. As cartas têm companhia.', text: 'Há quem guarde para esta hora a conversa que esperou o dia inteiro para ter.', active: true },
  { id: 'tarologo-dawn-1', audience: 'tarologo', period: 'dawn', title: 'Ainda há histórias acordadas.', text: 'Nesta hora mais quieta, cada consulta encontra seu próprio ritmo.', active: true },
];

/** `DEFAULT_WELCOME` da B. */
const WELCOME_PADRAO = {
  greetings: [...SAUDACOES_LEGADAS.map((r) => ({ ...r, audience: 'atendimento' })), ...SAUDACOES_TAROLOGO],
  messages: PUBLICOS.flatMap((audience) => MENSAGENS_LEGADAS.map((r) => ({ ...r, id: audience === 'atendimento' ? r.id : `tarologo-${r.id}`, audience }))),
};

const CAB_WELCOME = { 'Cache-Control': 'no-store', Vary: 'Cookie' };
const CAB_CADASTRO = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const MSG_WELCOME_INDISPONIVEL = 'A edição dos textos da entrada ainda não está integrada neste ambiente. A entrada usa os textos padrão.';
const MSG_CADASTRO_INDISPONIVEL = 'O recebimento de cadastros ainda não está integrado neste ambiente.';

/** Corpo do GET público: revisão 0 e só as linhas ativas do padrão. */
const corpoWelcomePublico = () => ({
  revision: 0,
  content: { greetings: WELCOME_PADRAO.greetings.filter((r) => r.active), messages: WELCOME_PADRAO.messages.filter((r) => r.active) },
});

/** JSON como a B (`Response.json`): `application/json` sem charset, sem ETag e sem X-Powered-By. */
function enviar(res, status, corpo, cabecalhos) {
  res.removeHeader('X-Powered-By');
  res.status(status);
  // `res.set` do Express acrescenta `; charset=utf-8` ao Content-Type; a B manda só `application/json`.
  for (const [k, v] of Object.entries({ 'Content-Type': 'application/json', ...cabecalhos })) res.setHeader(k, v);
  return res.end(JSON.stringify(corpo));
}

/** `?editor=1` como a B lê (`URLSearchParams.get`, primeiro valor). */
function modoEditor(req) {
  const i = req.originalUrl.indexOf('?');
  return i >= 0 && new URLSearchParams(req.originalUrl.slice(i + 1)).get('editor') === '1';
}

/** Método fora dos exportados pela rota: o framework da B responde 405 vazio, sem `Allow` e sem Content-Type. */
function metodoAusente(res) {
  res.removeHeader('X-Powered-By');
  res.status(405);
  return res.end();
}

/** OPTIONS automático do framework da B: 204 com `Allow`. */
function opcoes(res, permitido) {
  res.removeHeader('X-Powered-By');
  res.status(204);
  res.set('Allow', permitido);
  return res.end();
}

function criarRotasPublicas() {
  const router = Router();

  router.all('/welcome', (req, res) => {
    if (req.method === 'OPTIONS') return opcoes(res, 'GET, HEAD, OPTIONS, PUT');
    if (req.method === 'PUT') return enviar(res, 503, { error: MSG_WELCOME_INDISPONIVEL }, CAB_WELCOME);
    if (req.method !== 'GET' && req.method !== 'HEAD') return metodoAusente(res);
    if (modoEditor(req)) return enviar(res, 503, { error: MSG_WELCOME_INDISPONIVEL }, CAB_WELCOME);
    return enviar(res, 200, corpoWelcomePublico(), CAB_WELCOME);
  });

  router.all('/tarologos-cadastro', (req, res) => {
    if (req.method === 'OPTIONS') return opcoes(res, 'GET, HEAD, OPTIONS, POST, PUT');
    if (!['GET', 'HEAD', 'POST', 'PUT'].includes(req.method)) return metodoAusente(res);
    return enviar(res, 503, { error: MSG_CADASTRO_INDISPONIVEL }, CAB_CADASTRO);
  });

  return router;
}

module.exports = { criarRotasPublicas, WELCOME_PADRAO, corpoWelcomePublico, MSG_WELCOME_INDISPONIVEL, MSG_CADASTRO_INDISPONIVEL };
