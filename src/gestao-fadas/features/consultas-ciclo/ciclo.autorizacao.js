'use strict';

/**
 * Autorização da supervisora no lançamento (Maturacao/38): `POST /consultations` recusa o lançamento de cliente cuja orientação financeira
 * (`gf_clientes_orientacoes`, Maturacao/36) exige aprovação e que não tem a autorização disponível, com a frase do front. A autorização vale para
 * UMA consulta (o próprio lançamento a consome): a leitura é feita sob a mesma trava da orientação, para dois lançamentos simultâneos não
 * usarem a mesma autorização. Só vale para o lançamento ao vivo (o histórico `Concluída` não passa por aqui, como no front).
 */

const dom = require('../../_comum/dominio/consulta-autorizacao');
const { RegraConsultaError } = require('../../_comum/dominio/consulta-comum');

const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

async function conferir(ex, clientId) {
  await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_clientes_orientacoes:${clientId}`]);
  const [orientacoes] = await ex.execute('SELECT item FROM gf_clientes_orientacoes WHERE id_cliente = ?', [clientId]);
  if (!orientacoes[0]) return;
  const orientacao = json(orientacoes[0].item);
  if (!orientacao || !orientacao.requiresApproval) return;
  const [linhas] = await ex.execute('SELECT id, item FROM gf_consultas_ext WHERE id_cliente = ?', [clientId]);
  const consultas = linhas.map((l) => ({ ...json(l.item), id: l.id }));
  const erro = dom.erroDeLancamento(clientId, orientacao, consultas);
  if (erro) throw new RegraConsultaError(erro);
}

module.exports = { conferir };
