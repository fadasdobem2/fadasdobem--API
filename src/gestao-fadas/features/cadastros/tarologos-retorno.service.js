'use strict';

const { lendo } = require('../../_comum/legado');
const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const c = require('./cadastros.comum');
const { montar } = require('./tarologos-retorno.model');

// Proteção contra resposta truncada: ultrapassar o teto recusa o agregado inteiro.
// Nenhuma lista parcial se transforma em percentual. Cache curto compartilhado pela equipe.
const LIMITE = 1000000;
const VALIDADE_MS = 60000;
let cache = null;
let pendente = null;
const limparCache = () => { cache = null; pendente = null; };
const antigas = () => lendo((m) => m.LegadoConsulta.findAll({
  attributes: ['idConsulta', 'idUsuario', 'idTarologo', 'iniConsulta', 'fimConsulta', 'tmpConsulta'],
  order: [['idConsulta', 'ASC']], limit: LIMITE + 1, raw: true,
}));
const novas = () => lendoNovo((m) => m.GfConsultasExt.findAll({
  attributes: ['id', 'id_consulta_legado', 'id_cliente', 'id_tarologo', 'status', 'aguardando_inicio', 'duracao_segundos', 'iniciada_em', 'encerrada_em', 'consulta_origem_id', 'item'],
  order: [['id', 'ASC']], limit: LIMITE + 1, raw: true,
}));

async function ler(req) {
  const q = c.quem(req);
  if (q.perfil === 'tarologa' || !q.p.canViewTarologists) throw c.negado(false);
  if (!novosDadosNoPostgres()) throw c.indisponivel();
  const agora = new Date();
  if (cache && agora.getTime() >= cache.em && agora.getTime() - cache.em < VALIDADE_MS) return cache.dados;
  if (!pendente) pendente = (async () => {
    const [anteriores, atuais] = await Promise.all([antigas(), novas()]);
    if (anteriores.length > LIMITE || atuais.length > LIMITE) throw c.indisponivel();
    const dados = montar(atuais, anteriores, agora);
    cache = { em: agora.getTime(), dados };
    return dados;
  })().finally(() => { pendente = null; });
  return pendente;
}
module.exports = { ler, limparCache, LIMITE };
