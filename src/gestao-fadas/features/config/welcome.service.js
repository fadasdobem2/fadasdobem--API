'use strict';

/**
 * Boas-vindas editáveis (Configurações > Tela de entrada). Contrato de `features/auth/welcome-service.ts` do front:
 *   leitura pública (só linhas ativas), leitura do editor (tudo + `revision`) e PUT `{ revision, content }` com revisão otimista.
 * Armazenamento: `gf_welcome` (id `principal`, jsonb, `revisao`). Sem registro salvo vale o texto padrão com `revision: 0`.
 * Gravar exige a revisão lida (409 se outra pessoa gravou antes) e a auditoria `config.welcome` entra na MESMA transação.
 * Só a administradora edita. Erros são `{ error: 'texto' }` (formato do front para esta tela).
 */

const { randomUUID } = require('crypto');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { emTransacao, escritaHabilitada } = require('../../novo/escritor');
const { lendoNovo } = require('../../novo/leitura');
const welcome = require('../../novo/welcome');
const { AUDIT_INSERT, linhaDeAuditoria } = require('../../_comum/auditoria');
const dom = require('../../_comum/dominio/welcome');

const MSG = Object.freeze({
  semSessao: 'Sua sessão precisa ser confirmada para editar os textos.',
  semPermissao: 'Esta conta não tem permissão administrativa para editar os textos.',
  indisponivelLer: 'Não foi possível acessar os textos salvos. Tente novamente.',
  indisponivelGravar: 'Não foi possível salvar ou carregar os textos. Seu rascunho foi mantido. Tente novamente.',
  conflito: 'Não foi possível salvar os textos. Seu rascunho foi mantido; recarregue os textos salvos e tente novamente.',
  revisaoInvalida: 'Revisão inválida. Recarregue os textos salvos.',
  corpoInvalido: 'Conteúdo inválido.',
});

class WelcomeHttpError extends Error {
  constructor(status, mensagem, extra = {}) { super(mensagem); this.status = status; this.extra = extra; }
}

/** Registro salvo ou o padrão: `{ revision, content }`. */
async function lerRegistro() {
  if (!novosDadosNoPostgres()) throw new WelcomeHttpError(503, MSG.indisponivelLer);
  try {
    const linha = await lendoNovo((m) => m.GfWelcome.findOne({ where: { id: welcome.ID_PADRAO } }));
    if (!linha) return { revision: 0, content: dom.padrao() };
    return { revision: Number(linha.revisao), content: dom.validar(typeof linha.conteudo === 'string' ? JSON.parse(linha.conteudo) : linha.conteudo) };
  } catch (e) {
    if (e instanceof WelcomeHttpError) throw e;
    console.error('[welcome] leitura indisponível');
    throw new WelcomeHttpError(503, MSG.indisponivelLer);
  }
}

/** `GET /welcome`: só linhas ativas. */
async function lerPublico() {
  const r = await lerRegistro();
  return { revision: r.revision, content: dom.publico(r.content) };
}

/** Só a administradora lê o editor e grava. `perfil` vem da sessão (`req.perfilGate`); sem sessão: `needsSignIn`. */
function exigirAdministradora(perfil) {
  if (!perfil) throw new WelcomeHttpError(403, MSG.semSessao, { needsSignIn: true });
  if (perfil !== 'administradora') throw new WelcomeHttpError(403, MSG.semPermissao);
}

/** `PUT /welcome` `{ revision, content }` -> `{ content, revision: revision + 1 }`. */
async function gravar({ perfil, usuarioId, corpo }) {
  exigirAdministradora(perfil);
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new WelcomeHttpError(400, MSG.corpoInvalido);
  if (!Number.isSafeInteger(corpo.revision) || corpo.revision < 0) throw new WelcomeHttpError(400, MSG.revisaoInvalida);
  let content;
  try { content = dom.validar(corpo.content); } catch (e) {
    if (e instanceof dom.WelcomeInvalidoError) throw new WelcomeHttpError(400, e.message);
    throw e;
  }
  if (!escritaHabilitada() || !novosDadosNoPostgres()) throw new WelcomeHttpError(503, MSG.indisponivelGravar);
  try {
    return await emTransacao(async (ex) => {
      const antes = await welcome.ler(ex);
      try {
        await welcome.gravar(ex, { conteudo: content, revisaoLida: corpo.revision, usuarioId });
      } catch (e) {
        if (e instanceof welcome.WelcomeConflitoError) throw new WelcomeHttpError(409, MSG.conflito);
        throw e;
      }
      await ex.execute(AUDIT_INSERT, linhaDeAuditoria(
        { actorUserId: usuarioId, actorRole: perfil, action: 'config.welcome', entity: 'welcome', entityId: welcome.ID_PADRAO,
          before: { revision: antes ? antes.revisao : 0 }, after: { revision: corpo.revision + 1, saudacoes: content.greetings.length, mensagens: content.messages.length } },
        { id: randomUUID(), agora: Date.now(), chave: `cfg:welcome:${randomUUID()}` },
      ));
      return { content, revision: corpo.revision + 1 };
    });
  } catch (e) {
    if (e instanceof WelcomeHttpError) throw e;
    console.error('[welcome] gravação indisponível');
    throw new WelcomeHttpError(503, MSG.indisponivelGravar);
  }
}

module.exports = { lerPublico, lerRegistro, gravar, exigirAdministradora, WelcomeHttpError, MSG };
