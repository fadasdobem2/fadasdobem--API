'use strict';

/**
 * Cadastro de tarólogos: o contrato de `/api/tarologos-cadastro` do front (`features/professionals/registration-service.ts`, D1) em
 * Postgres. Cada função devolve `{ status, corpo }` no formato do front (erro = `{ error: "texto" }`, sem código). Quem edita é a
 * administradora (o `editor` da B); o formulário público e o link individual não pedem sessão. A aprovação também grava a projeção no
 * catálogo (`gf_tarologos_perfil`) na MESMA transação, com auditoria. Nada toca o legado.
 */

const { createHash, randomBytes, randomUUID } = require('crypto');
const { AUDIT_INSERT, linhaDeAuditoria } = require('../../_comum/auditoria');
const { contaDaRequisicao } = require('../../_comum/conta');
const { validarCadastro, perfilPublico, projecaoDoLink, projecaoAprovada, CadastroInvalidoError } = require('../../_comum/dominio/cadastro-tarologo');
const { lendoNovo } = require('../../novo/leitura');
const { emTransacao, escritaHabilitada } = require('../../novo/escritor');
const store = require('./cadastro-tarologo.store');
const { nomeDe } = require('./cadastros.comum');
const catalogo = require('./tarologos.store');
const { montarItem } = require('../../_comum/dominio/catalogo-tarologos');

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const sha = (v) => createHash('sha256').update(v, 'utf8').digest('hex');
const revisaoValida = (v) => Number.isSafeInteger(v) && v >= 0;
const R = (corpo, status = 200) => ({ status, corpo });
const conflito = () => R({ error: 'O cadastro mudou desde sua abertura. Seu rascunho foi mantido; recarregue a ficha antes de salvar.' }, 409);
const linkInvalido = () => R({ error: 'Este link não está disponível. Peça um novo link à administração.' }, 410);
const falhaDeServico = () => R({ error: 'Não foi possível salvar ou carregar o cadastro. Seu rascunho foi mantido. Tente novamente.' }, 503);
const confirmacao = (e) => R({ id: e.id_cadastro, status: 'pending', receivedAt: store.iso(e.recebido_em) });

const OFICIAL = { domingo: 'Domingo', segunda: 'Segunda', terca: 'Terça', quarta: 'Quarta', quinta: 'Quinta', sexta: 'Sexta', sabado: 'Sábado' };

/** Fonte do legado só para ligar o id numérico do catálogo (o teste a troca). */
let existeNoLegado = async (id) => {
  const { lendo } = require('../../_comum/legado');
  return lendo(async (m) => Boolean(await m.LegadoTarologo.findOne({ attributes: ['idTarologo'], where: { idTarologo: id } })));
};
const definirVerificadorLegado = (f) => { existeNoLegado = f; };

/** Leituras. `editor`: a sessão é da administradora. */
async function lerLista() {
  const linhas = await lendoNovo((m) => store.lerRecentes(m));
  return R({
    records: linhas.map((l) => {
      const d = store.json(l.dados) || {};
      return { id: l.id, status: l.status, revision: Number(l.revisao), ...(l.tarot_id ? { tarotId: l.tarot_id } : {}), createdAt: store.iso(l.criado_em), updatedAt: store.iso(l.atualizado_em), professionalName: d.professionalName, fullName: d.fullName, email: d.email };
    }),
  });
}

async function lerFicha({ id, tarotId }) {
  if (!ID.test(id || tarotId)) return R({ error: 'Identificador inválido.' }, 400);
  const l = await lendoNovo((m) => (id ? store.lerPorId(m, id) : store.lerPorTarot(m, tarotId)));
  if (l) return R({ record: store.paraRegistro(l) });
  return tarotId ? R({ record: null }) : R({ error: 'Cadastro não encontrado.' }, 404);
}

async function lerAprovados() {
  const linhas = await lendoNovo((m) => store.lerAprovados(m));
  return R({
    profiles: linhas.map((l) => {
      const publico = store.json(l.aprovado_publico); const priv = store.json(l.aprovado_dados) || {};
      return { ...publico, registrationId: l.id, revision: Number(l.aprovado_revisao), commissionRate: priv.commissionRate, paymentBank: priv.bank ? priv.bank.name : '', paymentSchedule: priv.paymentSchedule || null };
    }),
  });
}

async function lerPorToken(token, agora = new Date()) {
  if (!TOKEN.test(token)) return linkInvalido();
  const link = await emTransacaoLeitura((ex) => store.linkValido(ex, sha(token), agora.toISOString()));
  if (!link) return linkInvalido();
  return R({ valid: true, professionalName: link.dados.professionalName, expiresAt: store.iso(link.expira_em), data: projecaoDoLink(link.dados) });
}

/** Leituras que passam por SQL (join do link) usam o executor do banco novo, mesmo com a escrita desligada. */
const emTransacaoLeitura = (fn) => emTransacao(fn);

/** Projeção da ficha aprovada no catálogo de tarólogos (mesma transação). */
async function projetarNoCatalogo(ex, { tarotId, registroId, revisao, publico, por }) {
  const atual = await catalogo.perfilTravado(ex, tarotId);
  const oficial = Object.entries(publico.weeklySchedule).filter(([, h]) => h && h.trim()).map(([dia, h]) => `${OFICIAL[dia]}: ${h}`);
  const campos = {
    nome: publico.professionalName, avatar: publico.avatar || null, cadastro_ativo: atual && atual.cadastro_ativo !== null ? atual.cadastro_ativo : true,
    perfil: { ...((atual && atual.perfil) || {}), biography: publico.biography, definitions: publico.definitions, oracles: publico.oracles, techniques: publico.techniques, spreads: publico.spreads, channels: publico.channels, themes: publico.themes, official: oficial, registrationId: registroId, registrationRevision: revisao },
  };
  if (atual) {
    await ex.execute('UPDATE gf_tarologos_perfil SET nome = ?, avatar = ?, cadastro_ativo = ?, perfil = ?, registro_id = ?, registro_revisao = ?, revisao = revisao + 1, atualizado_em = CURRENT_TIMESTAMP, atualizado_por = ? WHERE tarot_id = ?',
      [campos.nome, campos.avatar, campos.cadastro_ativo, JSON.stringify(campos.perfil), registroId, revisao, por, tarotId]);
  } else {
    const idLegado = /^[1-9]\d{0,9}$/.test(tarotId) && (await existeNoLegado(Number(tarotId))) ? Number(tarotId) : null;
    await ex.execute('INSERT INTO gf_tarologos_perfil (tarot_id, id_legado, nome, avatar, cadastro_ativo, perfil, registro_id, registro_revisao, revisao, atualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
      [tarotId, idLegado, campos.nome, campos.avatar, true, JSON.stringify(campos.perfil), registroId, revisao, por]);
  }
  return montarItem({ legado: null, perfil: { ...(atual || { tarot_id: tarotId, conta_slug: null }), ...campos, registro_id: registroId, registro_revisao: revisao, revisao: atual ? atual.revisao + 1 : 1 }, ext: null });
}

/** PUT (editor): grava a ficha com revisão otimista; aprovando, projeta no catálogo e audita na mesma transação. */
async function salvar(req, payload, hoje = new Date()) {
  if (!revisaoValida(payload.revision) || (payload.status !== 'pending' && payload.status !== 'approved')) return R({ error: 'Revisão ou situação inválida.' }, 400);
  const id = typeof payload.id === 'string' ? payload.id : randomUUID();
  const tarotId = typeof payload.tarotId === 'string' && payload.tarotId.trim() ? payload.tarotId.trim() : null;
  if (!ID.test(id) || (tarotId && !ID.test(tarotId)) || (payload.status === 'approved' && !tarotId)) return R({ error: 'Vincule um identificador profissional válido antes de aprovar.' }, 400);
  let dados;
  try { dados = validarCadastro(payload.data, { hoje: hoje.toISOString().slice(0, 10) }); } catch (e) {
    if (e instanceof CadastroInvalidoError) return R({ error: e.message }, 400);
    throw e;
  }
  if (!escritaHabilitada()) return falhaDeServico();
  const conta = contaDaRequisicao(req);
  const funcao = req.perfilGate || 'administradora';
  const agora = hoje.toISOString();
  const por = nomeDe(req);
  const aprovando = payload.status === 'approved';
  const publico = aprovando ? perfilPublico(dados, tarotId) : null;
  const privado = publico ? Object.fromEntries(Object.entries(dados).filter(([k]) => !(k in publico))) : null;
  return emTransacao(async (ex) => {
    await store.travar(ex, `gf_cadastro:${id}`);
    const anterior = await store.porIdTravado(ex, id);
    if (anterior && anterior.tarot_id && anterior.tarot_id !== tarotId) return R({ error: 'O vínculo profissional desta ficha não pode ser substituído.' }, 409);
    if (tarotId && (await store.donoDoTarot(ex, tarotId, id))) return R({ error: 'Já existe um cadastro para esta profissional. Abra a ficha existente.' }, 409);
    if (anterior ? Number(anterior.revisao) !== payload.revision : payload.revision !== 0) return conflito();
    const c = { id, dados, status: payload.status, tarotId, aprovando, aprovadoDados: privado, aprovadoPublico: publico, agora, por };
    if (anterior) await store.atualizarCadastro(ex, c); else await store.inserirCadastro(ex, c);
    const novaRevisao = (anterior ? Number(anterior.revisao) : 0) + 1;
    if (aprovando) await projetarNoCatalogo(ex, { tarotId, registroId: id, revisao: novaRevisao, publico, por });
    if (conta) {
      await ex.execute(AUDIT_INSERT, linhaDeAuditoria(
        { actorUserId: conta, actorRole: funcao, action: aprovando ? 'cadastros.tarologo.aprovar' : 'cadastros.tarologo.salvar', entity: 'cadastro-tarologo', entityId: id,
          before: anterior ? { status: anterior.status, revisao: Number(anterior.revisao) } : null, after: { status: payload.status, revisao: novaRevisao, tarotId } },
        { id: randomUUID(), agora: Date.now(), chave: `cad:${sha(`${id}:${novaRevisao}`).slice(0, 40)}` },
      ));
    }
    const [linhas] = await ex.execute(`SELECT ${store.COLUNAS} FROM gf_cadastros_tarologo WHERE id = ?`, [id]);
    return R({ record: store.paraRegistro(linhas[0]), ...(publico ? { publicProfile: publico } : {}) });
  });
}

/** POST action `create-update-link` (editor). */
async function criarLink(req, payload, origem, hoje = new Date()) {
  if (payload.action !== 'create-update-link' || typeof payload.id !== 'string' || !ID.test(payload.id) || !revisaoValida(payload.revision)) return R({ error: 'Pedido de link inválido.' }, 400);
  if (!escritaHabilitada()) return falhaDeServico();
  const token = randomBytes(32).toString('hex');
  const expira = new Date(hoje.getTime() + 7 * 86400000).toISOString();
  const por = nomeDe(req);
  return emTransacao(async (ex) => {
    await store.travar(ex, `gf_cadastro:${payload.id}`);
    const c = await store.porIdTravado(ex, payload.id);
    if (!c || Number(c.revisao) !== payload.revision) return conflito();
    await store.gravarLink(ex, payload.id, sha(token), payload.revision, expira, hoje.toISOString(), por);
    return R({ url: `${origem}/form-tarologo?token=${token}`, expiresAt: expira });
  });
}

/** POST público: formulário novo ou link individual, idempotente por `idempotencyKey`. */
async function receberEnvio(payload, hoje = new Date()) {
  if (['id', 'tarotId', 'revision', 'status', 'role', 'approvedData', 'commissionRate', 'paymentSchedule'].some((k) => Object.prototype.hasOwnProperty.call(payload, k))) return R({ error: 'O envio público não pode alterar aprovação, vínculo ou repasse.' }, 400);
  if (typeof payload.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(payload.idempotencyKey)) return R({ error: 'Identificador do envio inválido. Reabra o formulário.' }, 400);
  let dados;
  try { dados = validarCadastro(payload.data, { publica: true, hoje: hoje.toISOString().slice(0, 10) }); } catch (e) {
    if (e instanceof CadastroInvalidoError) return R({ error: e.message }, 400);
    throw e;
  }
  const token = payload.token;
  if (token !== undefined && (typeof token !== 'string' || !TOKEN.test(token))) return linkInvalido();
  if (!escritaHabilitada()) return falhaDeServico();
  const chaveHash = sha(payload.idempotencyKey); const tokenHash = token ? sha(token) : '';
  // A impressão é dos dados como chegaram (antes de herdar o repasse do link), como na B: repetir o mesmo envio dá o mesmo recibo.
  const impressao = sha(JSON.stringify(dados) + tokenHash);
  const agora = hoje.toISOString();
  return emTransacao(async (ex) => {
    await store.travar(ex, `gf_cadastro_envio:${chaveHash}`);
    const previo = await store.envioPorChave(ex, chaveHash);
    if (previo) return previo.impressao === impressao ? confirmacao(previo) : R({ error: 'Este envio já foi utilizado com outros dados. Reabra o formulário para enviar uma nova resposta.' }, 409);
    let id;
    if (tokenHash) {
      const link = await store.linkValido(ex, tokenHash, agora, true);
      if (!link) return linkInvalido();
      await store.travar(ex, `gf_cadastro:${link.id_cadastro}`);
      id = link.id_cadastro;
      dados.commissionRate = link.dados.commissionRate; dados.paymentSchedule = link.dados.paymentSchedule;
      await store.atualizarPorLink(ex, id, dados, agora, link.revisao_emitida);
    } else {
      id = randomUUID();
      await store.inserirCadastro(ex, { id, dados, status: 'pending', tarotId: null, aprovando: false, aprovadoDados: null, aprovadoPublico: null, agora, por: 'public-form' });
    }
    await store.inserirEnvio(ex, chaveHash, impressao, id, agora);
    return confirmacao({ id_cadastro: id, recebido_em: agora });
  });
}

module.exports = { lerLista, lerFicha, lerAprovados, lerPorToken, salvar, criarLink, receberEnvio, definirVerificadorLegado, projecaoAprovada, sha };
