'use strict';

/**
 * Gravações do repasse (porta de `real-payouts-http.server.ts`, POSTs): percentual, calendário, rascunho da abertura,
 * confirmar e corrigir. Ordem da B: ator (permissão já checada na rota) -> segmento e corpo (400) -> gravação (transação com
 * auditoria, idempotente por `operationKey`) -> resposta. Respostas: 201 com o acordo ou a abertura; 200 ao confirmar.
 * Banco: SÓ `gf_*` por novo/escritor.js (Postgres da A por padrão; `GF_NOVOS_DADOS=mysql` usa models/legado/escrita.js); o legado só é lido (o tarólogo existe?).
 */

const { executarAvulso, emTransacao } = require('../../../novo/escritor');
const { novosDadosNoPostgres } = require('../../../novo/modo');
const { contaExisteNaA, nomesDeContasDaA } = require('../../../novo/contas');
const AppError = require('../../../../utils/AppError');
const { lendo } = require('../../../_comum/legado');
const { erroOperacao } = require('../../../_comum/politica-acesso');
const { idTarologo, idAbertura, corpoPercentual, corpoCalendario, corpoAbertura, corpoCorrecao, corpoConfirmar } = require('../repasse.validacao');
const { openingView } = require('../repasse.dto');
const service = require('../repasse.service');
const { criarRepasseEscrita } = require('./fabrica');
const { atorDe } = require('./ator');
const { entradaDaAbertura, vigenciaAgora } = require('./entrada');
const { traduzirErroEscrita } = require('./erros');

let loja = null;

/** Tarólogo do legado existe? Um SELECT de leitura, como `legacyIdentities` da B. */
const tarologoExiste = (tarotId) => lendo(async (m) => (await m.LegadoTarologo.findOne({ attributes: ['idTarologo'], where: { idTarologo: Number(tarotId) }, raw: true })) !== null);

function lojaReal() {
  if (!loja) {
    loja = criarRepasseEscrita({
      avulso: executarAvulso, emTransacao, legado: { tarologoExiste }, ...(novosDadosNoPostgres() ? { contaExiste: contaExisteNaA } : {}),
    });
  }
  return loja;
}

/** Roda a gravação traduzindo as recusas do store e as falhas de infraestrutura. */
async function gravando(trabalho) {
  try {
    return await trabalho();
  } catch (erro) {
    throw traduzirErroEscrita(erro);
  }
}

/** Validação do corpo/segmento na mensagem de uma GRAVAÇÃO da B ("Confira os dados informados..."). */
function validando(trabalho) {
  try {
    return trabalho();
  } catch (erro) {
    if (erro instanceof AppError && erro.dados && erro.dados.codigo === 'INVALID_INPUT') throw erroOperacao('INVALID_INPUT', true);
    throw erro;
  }
}

/** A abertura gravada como a tela a mostra, com o nome de quem lançou/confirmou. */
async function aberturaComNomes(registro) {
  const dto = openingView(registro);
  const ids = [...service.contasCitadas(dto, new Set())];
  if (!ids.length) return dto;
  if (novosDadosNoPostgres()) return service.preencherNomes(dto, await nomesDeContasDaA(ids));
  return lendo(async (m) => {
    const encontradas = await m.GfAuthAccounts.findAll({ attributes: ['id', 'display_name'], where: { id: ids }, raw: true });
    return service.preencherNomes(dto, new Map(encontradas.map((l) => [l.id, l.display_name])));
  });
}

/** `store` é injetável para o teste offline; o padrão é o real. */
function criarServicoEscrita({ store = null, ator = atorDe, acordoLido = service.acordo, comNomes = aberturaComNomes, agora = () => new Date() } = {}) {
  const obter = () => store || lojaReal();

  const gravarAcordo = async (req, tarotIdTexto, validarCorpo, gravar) => {
    const a = ator(req);
    const { tarotId, corpo } = validando(() => ({ tarotId: idTarologo(tarotIdTexto, 'tarotId'), corpo: validarCorpo(req.body) }));
    return gravando(async () => {
      await gravar(obter(), { ...corpo, actor: a, tarotId, effectiveFrom: vigenciaAgora(agora()) });
      return acordoLido(tarotId);
    });
  };

  return {
    /** `POST /payouts/agreements/:tarotId/commission` -> 201 com o acordo. */
    percentual: (req) => gravarAcordo(req, req.params.tarotId, corpoPercentual, (s, e) => s.setCommissionRate(e)),
    /** `POST /payouts/agreements/:tarotId/schedule` -> 201 com o acordo. Parcelas já acordadas não são tocadas. */
    calendario: (req) => gravarAcordo(req, req.params.tarotId, corpoCalendario, (s, e) => s.setPaymentSchedule(e)),

    /** `POST /payouts/openings` -> 201 com o rascunho da revisão 1. */
    rascunho: async (req) => {
      const a = ator(req);
      const corpo = validando(() => corpoAbertura(req.body));
      return gravando(async () => comNomes(await obter().draftOpening(entradaDaAbertura(corpo, a))));
    },
    /** `POST /payouts/openings/:ref/confirm` -> 200 com a abertura vigente. */
    confirmar: async (req) => {
      const a = ator(req);
      const { openingId, corpo } = validando(() => ({ openingId: idAbertura(req.params.ref, 'ref'), corpo: corpoConfirmar(req.body) }));
      return gravando(async () => comNomes(await obter().confirmOpening({ operationKey: corpo.operationKey, actor: a, openingId })));
    },
    /** `POST /payouts/openings/:ref/correct` -> 201 com a revisão N+1 em rascunho. */
    corrigir: async (req) => {
      const a = ator(req);
      const { openingId, corpo } = validando(() => ({ openingId: idAbertura(req.params.ref, 'ref'), corpo: corpoCorrecao(req.body) }));
      return gravando(async () => comNomes(await obter().correctOpening({ ...entradaDaAbertura(corpo, a), openingId, reason: corpo.reason })));
    },
  };
}

module.exports = { criarServicoEscrita, servico: criarServicoEscrita() };
