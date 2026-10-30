'use strict';

/**
 * Catálogo de tarólogos (Maturacao/29 seção 9). Leitura: `tbl_tarologos` (legado, só leitura) + `gf_tarologos_ext` + o perfil editável
 * `gf_tarologos_perfil` (Postgres novo). Gravação: só no Postgres, idempotente por `operationKey`, com revisão otimista
 * (`expectedRevision`, 409 `VERSION_CHANGED`) e auditoria na MESMA transação. O legado NUNCA é escrito.
 *   - equipe lê todos (`canViewTarologists`); a taróloga só o seu (o `tarotId` da sessão);
 *   - edita o perfil: administradora e assistente (`canEditProfessionalProfile`) em qualquer um; a taróloga só o próprio
 *     (sem mexer em situação do cadastro); vincular a conta: só a administradora.
 */

const AppError = require('../../../utils/AppError');
const { foto, CadastroInvalidoError } = require('../../_comum/dominio/cadastro-tarologo');
const { validarDiretorio, montarItem, aplicarEdicao, semPrivados, conferirInativacao } = require('../../_comum/dominio/catalogo-tarologos');
const ciclo = require('../consultas-ciclo/ciclo.store');
const { lendo } = require('../../_comum/legado');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { lendoNovo } = require('../../novo/leitura');
const c = require('./cadastros.comum');
const store = require('./tarologos.store');
const espelho = require('../../legado-escrita/entidades');
const legadoEsc = require('../../legado-escrita');
const lp = require('../../legado-escrita/legado-primeiro');
const { MapeamentoError } = require('../../legado-escrita/mapeamento');

const COLUNAS_LEGADO = ['idTarologo', 'nmuTarologo', 'ativo'];

/** Fonte do legado (somente leitura). O teste troca por uma lista fixa (`definirFonteLegado`). */
let fonteLegado = {
  listar: () => lendo(async (m) => (await m.LegadoTarologo.findAll({ attributes: COLUNAS_LEGADO, order: [['nmuTarologo', 'ASC'], ['idTarologo', 'ASC']] })).map((l) => l.get({ plain: true }))),
  obter: (id) => lendo(async (m) => {
    const l = await m.LegadoTarologo.findOne({ attributes: COLUNAS_LEGADO, where: { idTarologo: id } });
    return l ? l.get({ plain: true }) : null;
  }),
};
const definirFonteLegado = (f) => { fonteLegado = f; };

const idCatalogo = (v) => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw c.invalido('tarotId');
  return v;
};

/** Catálogo inteiro (ou de um tarólogo) já montado. */
async function catalogo() {
  const [legado, novos] = await Promise.all([fonteLegado.listar(), lendoNovo((m) => store.lerTudo(m))]);
  const porLegado = new Map(novos.perfis.filter((p) => p.id_legado !== null).map((p) => [Number(p.id_legado), p]));
  const extPorId = new Map(novos.exts.map((e) => [Number(e.id_tarologo), e]));
  const itens = legado.map((l) => montarItem({ legado: l, perfil: porLegado.get(Number(l.idTarologo)) || null, ext: extPorId.get(Number(l.idTarologo)) || null }));
  const vistos = new Set(itens.map((i) => i.id));
  for (const p of novos.perfis) if (!vistos.has(p.tarot_id) && p.id_legado === null) itens.push(montarItem({ legado: null, perfil: p, ext: null }));
  return itens;
}

const recorte = (item, privados) => (privados ? item : { ...item, directory: semPrivados(item.directory) });

/** `GET /catalog/tarologists`: `{ readAt, tarologists, revisions }`. */
async function ler(req) {
  if (!novosDadosNoPostgres()) throw c.indisponivel();
  const q = c.quem(req);
  if (q.perfil === 'tarologa' ? !q.proprio : !q.p.canViewTarologists) throw c.negado(false);
  let itens = await catalogo();
  if (q.perfil === 'tarologa') itens = itens.filter((i) => i.id === q.proprio);
  // Contatos e nascimento só para a gestão do cadastro e para a própria taróloga; a equipe de atendimento recebe o diretório sem eles.
  const privados = q.perfil === 'tarologa' || Boolean(q.p.canEditProfessionalProfile);
  const tarologists = itens.map((i) => recorte(i, privados));
  return { readAt: new Date().toISOString(), tarologists, revisions: Object.fromEntries(itens.map((i) => [i.id, i.revision])) };
}

function corpoPerfil(corpo, ehTarologa) {
  if (!c.ehObjeto(corpo)) throw c.invalido('corpo');
  const saida = { operationKey: c.chaveOperacao(corpo.operationKey), expectedRevision: c.revisao(corpo.expectedRevision) };
  try {
    if (corpo.name !== undefined) {
      if (typeof corpo.name !== 'string' || !corpo.name.trim() || corpo.name.trim().length > 120) throw new CadastroInvalidoError('Informe o nome profissional.');
      saida.nome = corpo.name.trim();
    }
    if (corpo.avatar !== undefined) saida.avatar = corpo.avatar === null || corpo.avatar === '' ? null : foto(corpo.avatar, 'Foto');
    if (corpo.registrationActive !== undefined) {
      if (typeof corpo.registrationActive !== 'boolean') throw c.invalido('registrationActive');
      if (ehTarologa) throw c.negado(true);
      saida.registrationActive = corpo.registrationActive;
    }
    saida.directory = validarDiretorio(corpo.directory);
  } catch (e) { throw c.traduzir(e); }
  return saida;
}

/** Bloqueia o usuário da A ligado ao slug (`specialists.slug`) e revoga os refresh tokens; devolve os ids bloqueados. */
async function bloquearContaDoTarologo(ex, t, slug, ator) {
  const { Specialist, User } = require('../../../models');
  const esp = await Specialist.findOne({ where: { slug }, transaction: t });
  if (!esp) return [];
  const usuario = await User.findByPk(esp.user_id, { transaction: t, lock: t.LOCK.UPDATE });
  if (!usuario) return [];
  if (usuario.is_active) await usuario.update({ is_active: false, blocked_at: new Date() }, { transaction: t });
  const contas = require('../contas/contas.store');
  await contas.revogarSessoes(usuario.id, t);
  await contas.gravarExt(ex, usuario.id, {}, ator);
  return [usuario.id];
}

/** `PUT /catalog/tarologists/:tarotId/profile`. */
async function gravarPerfil(req) {
  const tarotId = idCatalogo(req.params.tarotId);
  const q = c.quem(req);
  const propriaTarologa = q.perfil === 'tarologa' && q.proprio && q.proprio === tarotId;
  if (!propriaTarologa && !(q.perfil !== 'tarologa' && q.p.canEditProfessionalProfile)) throw c.negado(true);
  const corpo = corpoPerfil(req.body, q.perfil === 'tarologa');
  return c.gravar(req, {
    escopo: 'cadastros.tarologo.perfil', operationKey: corpo.operationKey, corpo: { ...corpo, tarotId }, entidade: 'tarologo-perfil', entidadeId: tarotId, acao: 'cadastros.tarologo.perfil',
    comContas: corpo.registrationActive === false,
    producao: async (ex, t) => {
      const atual = await store.perfilTravado(ex, tarotId);
      if ((atual ? atual.revisao : 0) !== corpo.expectedRevision) throw c.conflitoVersao();
      // Inativar o cadastro com consulta em curso: a recusa do front (`prepareRegistrationChange`).
      if (corpo.registrationActive === false) { const aviso = conferirInativacao(false, await ciclo.resumoParaPresenca(ex, tarotId)); if (aviso) throw c.regra(aviso); }
      let idLegado = atual ? atual.id_legado : null;
      let legado = null;
      if (!atual) {
        if (!/^[1-9]\d{0,9}$/.test(tarotId)) throw c.naoEncontrado();
        legado = await fonteLegado.obter(Number(tarotId));
        if (!legado) throw c.naoEncontrado();
        idLegado = Number(tarotId);
      } else if (idLegado !== null) legado = await fonteLegado.obter(Number(idLegado));
      const campos = aplicarEdicao(atual, { nome: corpo.nome, avatar: corpo.avatar, registrationActive: corpo.registrationActive, directory: corpo.directory });
      // LEGADO PRIMEIRO (Maturacao/46): nome e situação do cadastro vão para `tbl_tarologos` ANTES do commit (só onde o tarólogo já existe no legado); o Postgres não guarda cópia.
      // Nome que não cabe na coluna (mais de 35 caracteres; a tela aceita 120) NÃO é cortado: fica só no Postgres, como pendente com `erro` "recusada" (pergunta Q11).
      const camposLegado = idLegado !== null && lp.ativo('tarologos') ? [...(corpo.nome !== undefined ? ['nome'] : []), ...(corpo.registrationActive !== undefined ? ['cadastro_ativo'] : [])] : [];
      let escrito = null; let recusada = null; let legadoAtual = legado;
      if (camposLegado.length) {
        const partes = []; const perfilLeg = { nome: corpo.nome, cadastro_ativo: corpo.registrationActive };
        for (const campo of camposLegado) { try { const l = legadoEsc.tarologos.linhaDoTarologo(perfilLeg, [campo]); if (l) partes.push(l); } catch (e) { if (!(e instanceof MapeamentoError)) throw e; recusada = e.message; } }
        if (partes.length) {
          const linha = { colunas: Object.assign({}, ...partes.map((l) => l.colunas)), campos: partes.flatMap((l) => l.campos) };
          escrito = await espelho.tarologos.primeiro(ex, tarotId, idLegado, linha, { operationKey: corpo.operationKey, escopo: 'cadastros.tarologo.perfil' });
          if (escrito.campos.includes('nome')) campos.nome = null;
          if (escrito.campos.includes('cadastro_ativo')) campos.cadastro_ativo = null;
          legadoAtual = { ...legado, ...(escrito.depois.nmuTarologo !== undefined ? { nmuTarologo: escrito.depois.nmuTarologo } : {}), ...(escrito.depois.ativo !== undefined ? { ativo: escrito.depois.ativo } : {}) };
        }
      }
      if (atual) await store.atualizar(ex, tarotId, campos, c.nomeDe(req), corpo.operationKey); else await store.inserir(ex, tarotId, idLegado, campos, c.nomeDe(req), corpo.operationKey);
      let pendentesResposta;
      if (camposLegado.length) {
        pendentesResposta = ['nome', 'cadastro_ativo'].filter((k) => campos[k] !== null && campos[k] !== undefined);
        await espelho.tarologos.marcar(ex, tarotId, recusada ? 'erro' : (pendentesResposta.length ? 'nao_espelhada' : 'espelhada'), recusada ? `recusada: ${recusada}` : (pendentesResposta.length ? 'campos antigos só no Postgres (carga pendente)' : 'legado primeiro'), pendentesResposta);
      }
      // `prepareRegistrationChange`: inativar o cadastro bloqueia o acesso ligado (blockedAccountIds) e encerra as sessões, como `POST /accounts/:id/active`.
      // Reativar o cadastro NÃO reativa a conta (o front devolve a lista vazia; a administradora libera em Contas).
      let contasBloqueadas = [];
      if (t && atual && atual.conta_slug) contasBloqueadas = await bloquearContaDoTarologo(ex, t, atual.conta_slug, require('../../_comum/conta').contaDaRequisicao(req));
      // Espelho no legado (Maturacao/45): só nome e situação do cadastro têm casa em `tbl_tarologos`; intenção na mesma transação, escrita depois do commit.
      if (!lp.ativo('tarologos')) await espelho.tarologos.registrar(ex, tarotId, [...(corpo.nome !== undefined ? ['nome'] : []), ...(corpo.registrationActive !== undefined ? ['cadastro_ativo'] : [])]);
      const depois = { ...(atual || { tarot_id: tarotId, id_legado: idLegado, conta_slug: null, registro_id: null, registro_revisao: null }), ...campos, ...(pendentesResposta ? { legado_pendentes: pendentesResposta } : {}), revisao: (atual ? atual.revisao : 0) + 1 };
      const item = montarItem({ legado: legadoAtual, perfil: depois, ext: null });
      const antes = atual ? { nome: atual.nome, cadastro_ativo: atual.cadastro_ativo, perfil: atual.perfil, ...(escrito ? { legado: escrito.antes } : {}) } : (escrito ? { legado: escrito.antes } : null);
      return { antes, depois: { nome: campos.nome, cadastro_ativo: campos.cadastro_ativo, perfil: campos.perfil, ...(escrito ? { legado: escrito.depois } : {}), ...(contasBloqueadas.length ? { contasBloqueadas, sessoesEncerradas: true } : {}) }, resposta: { readAt: new Date().toISOString(), revision: item.revision, tarologist: item } };
    },
  });
}

/** `PUT /catalog/tarologists/:tarotId/account`: liga (ou solta) a conta da taróloga (`specialists.slug`). Só a administradora. */
async function vincularConta(req) {
  const tarotId = idCatalogo(req.params.tarotId);
  const q = c.quem(req);
  if (q.perfil !== 'administradora') throw c.negado(true);
  const b = req.body;
  if (!c.ehObjeto(b)) throw c.invalido('corpo');
  const operationKey = c.chaveOperacao(b.operationKey);
  const expectedRevision = c.revisao(b.expectedRevision);
  const slug = b.accountSlug === null ? null : (typeof b.accountSlug === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(b.accountSlug) ? b.accountSlug : (() => { throw c.invalido('accountSlug'); })());
  return c.gravar(req, {
    escopo: 'cadastros.tarologo.conta', operationKey, corpo: { tarotId, expectedRevision, slug }, entidade: 'tarologo-conta', entidadeId: tarotId, acao: 'cadastros.tarologo.conta',
    producao: async (ex) => {
      const atual = await store.perfilTravado(ex, tarotId);
      if ((atual ? atual.revisao : 0) !== expectedRevision) throw c.conflitoVersao();
      let legado = null;
      if (!atual) {
        if (!/^[1-9]\d{0,9}$/.test(tarotId)) throw c.naoEncontrado();
        legado = await fonteLegado.obter(Number(tarotId));
        if (!legado) throw c.naoEncontrado();
      } else if (atual.id_legado !== null) legado = await fonteLegado.obter(Number(atual.id_legado));
      if (slug) {
        const dono = await store.donoDoSlug(ex, slug);
        if (dono && dono !== tarotId) throw c.regra('Esta conta já está vinculada a outro tarólogo.');
      }
      if (atual) await store.ligarConta(ex, tarotId, slug, c.nomeDe(req), operationKey);
      else await store.inserirComConta(ex, tarotId, Number(tarotId), slug, c.nomeDe(req), operationKey);
      const base = atual || { tarot_id: tarotId, id_legado: Number(tarotId), registro_id: null, registro_revisao: null, nome: null, avatar: null, cadastro_ativo: null, perfil: {}, revisao: 0 };
      const item = montarItem({ legado, perfil: { ...base, conta_slug: slug, revisao: base.revisao + 1 }, ext: null });
      return { antes: { conta_slug: atual ? atual.conta_slug : null }, depois: { conta_slug: slug }, resposta: { readAt: new Date().toISOString(), revision: item.revision, tarologist: item } };
    },
  });
}

module.exports = { ler, gravarPerfil, vincularConta, definirFonteLegado, catalogo, AppError };
