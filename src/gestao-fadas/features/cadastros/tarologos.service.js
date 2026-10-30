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

/** `PUT /catalog/tarologists/:tarotId/profile`. */
async function gravarPerfil(req) {
  const tarotId = idCatalogo(req.params.tarotId);
  const q = c.quem(req);
  const propriaTarologa = q.perfil === 'tarologa' && q.proprio && q.proprio === tarotId;
  if (!propriaTarologa && !(q.perfil !== 'tarologa' && q.p.canEditProfessionalProfile)) throw c.negado(true);
  const corpo = corpoPerfil(req.body, q.perfil === 'tarologa');
  return c.gravar(req, {
    escopo: 'cadastros.tarologo.perfil', operationKey: corpo.operationKey, corpo: { ...corpo, tarotId }, entidade: 'tarologo-perfil', entidadeId: tarotId, acao: 'cadastros.tarologo.perfil',
    producao: async (ex) => {
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
      if (atual) await store.atualizar(ex, tarotId, campos, c.nomeDe(req), corpo.operationKey); else await store.inserir(ex, tarotId, idLegado, campos, c.nomeDe(req), corpo.operationKey);
      const depois = { ...(atual || { tarot_id: tarotId, id_legado: idLegado, conta_slug: null, registro_id: null, registro_revisao: null }), ...campos, revisao: (atual ? atual.revisao : 0) + 1 };
      const item = montarItem({ legado, perfil: depois, ext: null });
      const antes = atual ? { nome: atual.nome, cadastro_ativo: atual.cadastro_ativo, perfil: atual.perfil } : null;
      return { antes, depois: { nome: campos.nome, cadastro_ativo: campos.cadastro_ativo, perfil: campos.perfil }, resposta: { readAt: new Date().toISOString(), revision: item.revision, tarologist: item } };
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
