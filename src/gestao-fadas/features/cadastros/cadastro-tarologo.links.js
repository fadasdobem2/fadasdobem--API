'use strict';

/**
 * "Criar link para novo perfil" (Form Tarólogo, v706): o contrato de `registration-demo-storage` para `intakeLinks` em Postgres.
 * O link vale 7 dias, aceita UM envio concluído (abrir ou preencher parcialmente não consome), pode ser cancelado pela administração e é
 * distinto do link individual de atualização (`gf_cadastros_tarologo_links`) e do convite de acesso. O token só existe na resposta da criação;
 * o banco guarda a impressão SHA-256. Cada função devolve `{ status, corpo }` no formato do front.
 */

const { createHash, randomBytes, randomUUID } = require('crypto');
const { AUDIT_INSERT, linhaDeAuditoria } = require('../../_comum/auditoria');
const { contaDaRequisicao } = require('../../_comum/conta');
const { lendoNovo } = require('../../novo/leitura');
const { emTransacao, escritaHabilitada } = require('../../novo/escritor');
const store = require('./cadastro-tarologo.store');
const { nomeDe } = require('./cadastros.comum');

const sha = (v) => createHash('sha256').update(v, 'utf8').digest('hex');
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const R = (corpo, status = 200) => ({ status, corpo });
const SETE_DIAS = 7 * 86400000;

// O texto é o do serviço do formulário (D1) para todos os motivos; quem escolhe o aviso da tela é o `code` (used/expired/revoked/invalid).
const TEXTO_410 = 'Este link não está disponível. Peça um novo link à administração.';
/** Resposta 410 com o código que o formulário usa para escolher o aviso. */
const linkIndisponivel = (codigo = 'invalid') => R({ error: TEXTO_410, code: codigo }, 410);
const falhaDeServico = () => R({ error: 'Não foi possível salvar ou carregar o cadastro. Seu rascunho foi mantido. Tente novamente.' }, 503);

/** `linkFailure`: por que o link não vale agora (ou `null`). */
function falhaDoLink(link, agoraIso) {
  if (!link) return 'invalid';
  if (link.consumido_em) return 'used';
  if (link.revogado_em) return 'revoked';
  if (store.iso(link.expira_em) <= agoraIso) return 'expired';
  return null;
}

const metadados = (l) => ({ id: l.id, issuedAt: store.iso(l.emitido_em), expiresAt: store.iso(l.expira_em), ...(l.consumido_em ? { consumedAt: store.iso(l.consumido_em) } : {}), ...(l.revogado_em ? { revokedAt: store.iso(l.revogado_em) } : {}) });

/** GET `?intakeLinks=1` (editor): do mais novo ao mais antigo; sem token, sem hash. */
async function listar() {
  const linhas = await lendoNovo((m) => m.GfCadastrosTarologoNovosLinks.findAll({ order: [['emitido_em', 'DESC'], ['id', 'DESC']], limit: 200 }));
  return R({ links: linhas.map(metadados) });
}

/** POST `create-intake-link` (editor). */
async function criar(req, origem, hoje = new Date()) {
  if (!escritaHabilitada()) return falhaDeServico();
  const token = randomBytes(32).toString('hex');
  const link = { id: randomUUID(), tokenHash: sha(token), emitidoEm: hoje.toISOString(), expiraEm: new Date(hoje.getTime() + SETE_DIAS).toISOString(), por: nomeDe(req) };
  const conta = contaDaRequisicao(req);
  await emTransacao(async (ex) => {
    await store.inserirNovoLink(ex, link);
    if (conta) await ex.execute(AUDIT_INSERT, linhaDeAuditoria({ actorUserId: conta, actorRole: req.perfilGate || 'administradora', action: 'cadastros.tarologo.link-novo.criar', entity: 'cadastro-tarologo-link', entityId: link.id, before: null, after: { expiresAt: link.expiraEm } }, { id: randomUUID(), agora: Date.now(), chave: `cadl:${link.id}`.slice(0, 60) }));
  });
  return R({ id: link.id, issuedAt: link.emitidoEm, expiresAt: link.expiraEm, url: `${origem}/form-tarologo?token=${token}` });
}

/** POST `cancel-intake-link` (editor): idempotente; um link já enviado não se cancela. */
async function cancelar(req, payload, hoje = new Date()) {
  if (typeof payload.id !== 'string' || !ID.test(payload.id)) return R({ error: 'Identificador do link inválido.' }, 400);
  if (!escritaHabilitada()) return falhaDeServico();
  const conta = contaDaRequisicao(req);
  return emTransacao(async (ex) => {
    const l = await store.novoLinkPorId(ex, payload.id);
    if (!l) return R({ error: 'Link não encontrado.', code: 'invalid' }, 404);
    if (l.consumido_em) return R({ error: 'Este formulário já foi enviado.', code: 'used' }, 409);
    if (!l.revogado_em) {
      await store.revogarNovoLink(ex, l.id, hoje.toISOString());
      if (conta) await ex.execute(AUDIT_INSERT, linhaDeAuditoria({ actorUserId: conta, actorRole: req.perfilGate || 'administradora', action: 'cadastros.tarologo.link-novo.cancelar', entity: 'cadastro-tarologo-link', entityId: l.id, before: { revoked: false }, after: { revoked: true } }, { id: randomUUID(), agora: Date.now(), chave: `cadc:${l.id}`.slice(0, 60) }));
    }
    const atual = await store.novoLinkPorId(ex, payload.id);
    return R({ link: metadados(atual) });
  });
}

module.exports = { sha, linkIndisponivel, falhaDoLink, listar, criar, cancelar, metadados };
