'use strict';

/**
 * Serviço de e-mails do Gestão (v711), porte de `handleEmail` (features/email/email-service.ts do front) sobre o banco novo. Recebe o recurso,
 * o método, o corpo e o ator JÁ resolvidos pelo gate (a identidade vem só da sessão do servidor). Devolve `{ status, corpo }`.
 * Recursos: availability, settings (GET/PUT), history, test, invitation (envia o convite pela finalidade "usuarios"), recovery (público; sempre
 * "accepted") e inspect/accept (públicos; o link do convite). O envio real só liga com `GF_EMAIL_ENVIO_ENABLED=true`.
 * Nada devolve, registra ou audita segredo, texto de mensagem ou erro de provedor.
 */

const { randomUUID } = require('crypto');
const { FINALIDADES, emptyEmailSettings, validMailbox, validMailId } = require('../../_comum/dominio/email-modelo');
const { decifrarSegredo } = require('./email.cripto');
const { prepareEmailSettings } = require('./email.config');
const { EmailErro, entrada } = require('./email.erro');

const MSG = Object.freeze({
  naoConfigurado: 'O envio de e-mails ainda não foi configurado neste ambiente.',
  desligado: 'O envio de e-mails está desligado neste ambiente.',
  admin: 'A configuração de e-mails exige acesso administrativo.',
  dados: 'Dados inválidos.',
  falhou: 'O serviço não confirmou o envio. Confira a conexão e tente novamente.',
  semConvites: 'Convites não integrados neste ambiente.',
  semRecuperacao: 'Recuperação não integrada neste ambiente.',
  origem: 'Endereço público do sistema não configurado.',
});
const RECUPERACAO = { id: 'self-recovery', role: 'administradora' };

function corpoObjeto(corpo) {
  if (corpo === undefined || corpo === null) throw entrada('Informe os dados.');
  if (typeof corpo !== 'object' || Array.isArray(corpo)) throw entrada(MSG.dados);
  return corpo;
}

function origemPublica(env) {
  try {
    const o = new URL(env.origem || '');
    if (o.protocol !== 'https:' || o.username || o.password || o.search || o.hash) throw new Error();
    return o;
  } catch { throw new EmailErro(MSG.origem, 503); }
}

function textoDoConvite(emitido, origem) {
  const link = new URL('/', origem);
  link.hash = new URLSearchParams({ convite: emitido.token }).toString();
  const primeiro = emitido.kind === 'first-access';
  return {
    subject: primeiro ? 'Seu acesso ao Fadas do Bem' : 'Nova senha do Fadas do Bem',
    text: `Olá, ${emitido.name}.\n\n${primeiro ? 'Escolha sua senha para acessar o sistema.' : 'Use o link para escolher uma nova senha.'}\n${link.href}\n\nO link é de uso único e vale por 48 horas. Somente o convite mais recente funciona.\n\nFadas do Bem`,
  };
}

/** Teste e convite: confere o remetente da finalidade, monta a mensagem, entrega e registra o recibo (aceite não é entrega). */
async function enviar(d, { recurso, corpo, ator }) {
  const salvo = await d.repo.read();
  if (!salvo) throw new EmailErro('Configure o e-mail antes de enviar.', 409);
  const finalidade = recurso === 'invitation' ? 'usuarios' : corpo.purpose;
  if (!FINALIDADES.includes(finalidade)) throw entrada('Selecione a finalidade.');
  const sender = salvo.settings.purposes[finalidade];
  const conexao = salvo.settings.connections.find((c) => c.id === sender.connectionId);
  if (!conexao || !sender.from || !salvo.secrets[conexao.id]) throw new EmailErro('Configure o remetente e a conexão desta área.', 409);
  let emitido;
  let para; let assunto; let texto;
  if (recurso === 'invitation') {
    if (!d.convites) throw new EmailErro(MSG.semConvites, 503);
    if (!validMailId(corpo.accountId)) throw entrada('Selecione a conta.');
    const origem = origemPublica(d.env);
    emitido = await d.convites.issue(corpo.accountId, ator.id, d.agora());
    ({ subject: assunto, text: texto } = textoDoConvite(emitido, origem));
    para = emitido.email;
  } else {
    if (!validMailbox(corpo.to)) throw entrada('Informe o e-mail que receberá o teste.');
    para = corpo.to; assunto = 'Teste de envio - Fadas do Bem'; texto = 'Este é o teste de envio solicitado pela administração do Fadas do Bem.';
  }
  const id = d.uuid(); const at = new Date(d.agora()).toISOString();
  let recibo = { id, status: 'accepted', at };
  try {
    const segredo = decifrarSegredo(salvo.secrets[conexao.id], d.env.chave, conexao.id);
    await d.enviar(conexao, segredo, { id, to: para, subject: assunto, text: texto, sender });
  } catch { recibo = { id, status: 'failed', at, error: MSG.falhou }; }
  await d.repo.audit({ ...recibo, actorId: ator.id, purpose: String(finalidade), kind: recurso, accountId: emitido ? emitido.accountId : undefined });
  const extra = emitido ? { accountId: emitido.accountId, kind: emitido.kind, expiresAt: emitido.expiresAt } : {};
  return { status: recibo.status === 'failed' ? 502 : 200, corpo: { ...recibo, ...extra } };
}

/** Recuperação pública: nunca revela se a conta existe nem o erro do provedor. */
async function recuperar(d, corpo) {
  if (!d.convites) throw new EmailErro(MSG.semRecuperacao, 503);
  if (validMailbox(corpo.email)) {
    try {
      const id = await d.convites.findByEmail(corpo.email);
      if (id) await enviar(d, { recurso: 'invitation', corpo: { accountId: id }, ator: RECUPERACAO });
    } catch { /* A recuperação pública não revela existência de conta nem erro de provedor. */ }
  }
  return { status: 200, corpo: { status: 'accepted' } };
}

async function configuracao(d, { metodo, corpo, ator }) {
  if (metodo === 'GET') { const salvo = await d.repo.read(); return { status: 200, corpo: { settings: salvo ? salvo.settings : emptyEmailSettings(), configured: Boolean(salvo) } }; }
  const b = corpoObjeto(corpo);
  const anterior = await d.repo.read();
  const novo = await prepareEmailSettings(anterior, b.settings, b.secrets, d.env.chave);
  if (!(await d.repo.save(novo, novo.settings.revision - 1, ator.id, new Date(d.agora()).toISOString()))) throw entrada('A configuração mudou. Recarregue antes de salvar.', 409);
  return { status: 200, corpo: { settings: novo.settings, configured: true } };
}

/** `deps`: repo, enviar, convites, env { chave, origem, envioLigado, armazenamento }, agora, uuid. */
async function tratar(deps, req) {
  const d = { agora: Date.now, uuid: randomUUID, ...deps };
  const { recurso, metodo, ator } = req;
  if (recurso === 'availability' && metodo === 'GET') {
    return { status: 200, corpo: { enabled: Boolean(d.env.armazenamento) && Boolean(d.env.chaveOk), invitations: Boolean(d.convites) } };
  }
  try {
    if (!d.env.armazenamento) throw new EmailErro(MSG.naoConfigurado, 503);
    // Link de convite já emitido não depende das credenciais de e-mail (correção v711 da Nice, 4c547e2): só do banco.
    if (['inspect', 'accept'].includes(recurso) && metodo === 'POST') {
      const b = corpoObjeto(req.corpo);
      if (!d.convites) throw new EmailErro(MSG.semConvites, 503);
      if (recurso === 'inspect') return { status: 200, corpo: await d.convites.inspect(String(b.token ?? ''), d.agora()) };
      await d.convites.accept(String(b.token ?? ''), String(b.password ?? ''), d.agora());
      return { status: 200, corpo: { status: 'accepted' } };
    }
    if (!d.env.chaveOk) throw new EmailErro(MSG.naoConfigurado, 503);
    if (['test', 'invitation', 'recovery'].includes(recurso) && metodo === 'POST' && !d.env.envioLigado) throw new EmailErro(MSG.desligado, 503);
    if (recurso === 'recovery' && metodo === 'POST') return await recuperar(d, corpoObjeto(req.corpo));
    if (!ator || ator.role !== 'administradora') throw new EmailErro(MSG.admin, 403);
    if (recurso === 'settings' && ['GET', 'PUT'].includes(metodo)) return await configuracao(d, req);
    if (recurso === 'history' && metodo === 'GET') return { status: 200, corpo: { events: await d.repo.recent() } };
    if ((recurso === 'test' || recurso === 'invitation') && metodo === 'POST') return await enviar(d, { recurso, corpo: corpoObjeto(req.corpo), ator });
    return { status: 405, corpo: { error: 'Operação não disponível.' } };
  } catch (e) {
    if (e instanceof EmailErro) return { status: e.status, corpo: { error: e.message } };
    return { status: 503, corpo: { error: 'Não foi possível concluir a operação de e-mail.' } };
  }
}

module.exports = { tratar, textoDoConvite, MSG };
