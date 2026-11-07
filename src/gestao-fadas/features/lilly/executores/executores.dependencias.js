'use strict';

/**
 * Fontes externas dos executores, trocáveis nos testes (o legado MySQL é SOMENTE LEITURA e não está configurado no verificador).
 *  - `clienteExiste(id)`   a cliente existe no legado (nivel = 0);
 *  - `lerCadastro(id)`     nome de identificação e "tratar por" efetivos (legado + extensão), ou `null` se a cliente não existe;
 *  - `lerTarologo(id)`     `{ catalogo, item }` do catálogo de tarólogos (item `null` = não existe; `catalogo:false` = não consegui ler);
 *  - `montarContexto(acao)` snapshot que o `validate` devolve em `context`. Padrão: só o envelope (`complete:false`, a Lilly não age sobre ele);
 *                          agora vem do montador do snapshot (contexto/); `complete:false` continua valendo quando a cobertura é parcial.
 */

const padrao = {
  clienteExiste: (id) => require('../../clientes/clientes.service').clienteExiste(id),
  async lerCadastro(id) {
    const { lendo } = require('../../../_comum/legado');
    const extensao = require('../../clientes/helpers/extensao');
    const linha = await lendo(async (m) => (await m.LegadoUsuario.findAll({ attributes: ['id', 'nome_id', 'nome2'], where: { nivel: 0, id: Number(id) }, raw: true }))[0]);
    if (!linha) return null;
    const efetiva = extensao.sobrepor(linha, (await extensao.extensoesPorId([String(id)])).get(String(id)));
    return { name: `${efetiva.nome_id || ''}`.trim(), treatAs: `${efetiva.nome2 || ''}`.trim() };
  },
  lerTarologo: (id) => require('../../agenda/agenda-fila.contexto').cadastroConhecido(id),
  /** Snapshot da conversa da ação, pelo mesmo montador do `POST /lilly/context` (um evento de validação com o que a ação já traz). */
  async montarContexto(acao) {
    const a = acao && typeof acao === 'object' ? acao : {};
    const dados = a.payload && typeof a.payload === 'object' ? a.payload : {};
    const event = { type: 'action_validation', conversationId: a.conversationId, clientId: a.clientId, tarologistId: a.tarologistId, data: { ...(dados.paymentId ? { paymentId: dados.paymentId } : {}) } };
    return (await require('../contexto/contexto.servico').montarContexto({ event })).snapshot;
  },
};

let atual = { ...padrao };
const dependencias = () => atual;
const definirDependencias = (d) => { atual = { ...atual, ...d }; };
const restaurarDependencias = () => { atual = { ...padrao }; };

module.exports = { dependencias, definirDependencias, restaurarDependencias };
