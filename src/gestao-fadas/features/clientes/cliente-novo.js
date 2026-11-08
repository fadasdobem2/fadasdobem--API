'use strict';

/**
 * Cliente criada pela Lilly NO BANCO NOVO (`gf_clientes_novos`, Postgres). O legado (`usuarios`) é SOMENTE LEITURA e o auto incremento dele
 * não é nosso: o ID da cliente nova nasce da sequência `gf_clientes_novos_id_seq`, numa faixa que o legado não alcança (>= 1.000.000.000), então
 * um ID desta faixa só pode existir aqui e um ID abaixo dela só pode existir no legado. Isso evita colisão sem ler nem escrever no MySQL.
 * Funções de leitura (sem escrita): existência e linhas "no formato de `usuarios`" para o snapshot e a ficha.
 */

const { lendoNovo } = require('../../novo/leitura');

const FAIXA_INICIO = 1000000000;
const FAIXA_FIM = 2147483647;

const ehIdDaFaixaNova = (id) => typeof id === 'string' && /^[1-9]\d{9}$/.test(id) && Number(id) >= FAIXA_INICIO && Number(id) <= FAIXA_FIM;

/** `AAAA-MM-DD` de uma coluna DATE (texto ou Date). */
const dataCivil = (v) => (v === null || v === undefined ? null : (v instanceof Date ? v.toISOString() : `${v}`).slice(0, 10));

/** Linha de `gf_clientes_novos` no formato que o snapshot lê de `usuarios`, mais os campos que só esta tabela tem (`_`). */
function comoLinhaDeUsuario(l) {
  return {
    id: Number(l.id_cliente), nome: l.nome || '', nome_id: l.nome_id || '', nome2: l.nome2 || '', ddi: '', ddd: '', ddd_real: '',
    telresidencial: '', telcomercial: '', cel: '', cel2: '', whats: l.telefone || '',
    _novo: true, _nascimento: dataCivil(l.data_nascimento), _email: l.email || '',
  };
}

async function clienteNovoExiste(id) {
  if (!ehIdDaFaixaNova(`${id}`)) return false;
  return (await lendoNovo((m) => m.GfClientesNovos.count({ where: { id_cliente: `${id}` } }))) > 0;
}

/** Linhas (formato `usuarios`) dos IDs da faixa nova que existem. IDs fora da faixa são ignorados. */
async function clientesNovosPorIds(ids) {
  const alvo = [...new Set((ids || []).map(String).filter(ehIdDaFaixaNova))];
  if (!alvo.length) return [];
  return (await lendoNovo((m) => m.GfClientesNovos.findAll({ where: { id_cliente: alvo }, order: [['id_cliente', 'ASC']], raw: true }))).map(comoLinhaDeUsuario);
}

/** Nome de identificação e "tratar por" da cliente nova, ou `null` se ela não existe. */
async function lerCadastroNovo(id) {
  const [l] = await clientesNovosPorIds([id]);
  return l ? { name: l.nome_id, treatAs: l.nome2 } : null;
}

module.exports = { lerCadastroNovo, FAIXA_INICIO, FAIXA_FIM, ehIdDaFaixaNova, clienteNovoExiste, clientesNovosPorIds, comoLinhaDeUsuario, dataCivil };
