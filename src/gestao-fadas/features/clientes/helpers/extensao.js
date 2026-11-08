'use strict';

/**
 * Busca e lista coerentes com a ficha editada (Maturacao/36): o nome de identificação, o "tratar por", o WhatsApp e o nascimento que a equipe
 * edita ficam em `gf_clientes_ext` (Postgres novo) e a lista da B lê só o legado. Com a flag `GF_FATIA_FICHA` ligada, a lista e a busca passam a
 * ver o cadastro como a ficha o mostra: a extensão é SOBREPOSTA às linhas lidas do legado (em memória, nada é escrito no MySQL) e a busca
 * também acha clientes cujo nome editado casa, mesmo que o nome do legado não case. Desligada, nada muda (contrato da B).
 */

const { lendoNovo } = require('../../../novo/leitura');
const { novosDadosNoPostgres } = require('../../../novo/modo');
const { dadosEfetivosDoCliente } = require('../../../legado-escrita/fusao');
const { COLUNAS: COLUNAS_FICHA, fichaDeLinha, sobreporFicha } = require('../../../_comum/dominio/cliente-ficha-efetivo');

const LIMITE_EXTENSOES = 5000;
const ativa = () => `${process.env.GF_FATIA_FICHA || ''}`.trim().toLowerCase() === 'true' && novosDadosNoPostgres();

/** `dd/mm/aaaa` (o que a ficha grava) -> `aaaa-mm-dd hh:mm:ss`, o formato da coluna do legado. */
const nascimentoDoLegado = (texto) => {
  const m = typeof texto === 'string' ? texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]} 00:00:00` : null;
};

/** Extensões (`dados`) por id de cliente: as dos ids dados, ou todas (até o limite) quando `ids` é omitido. */
async function extensoesPorId(ids) {
  if (!ativa() || (ids && ids.length === 0)) return new Map();
  const linhas = await lendoNovo((m) => m.GfClientesExt.findAll({ attributes: ['id_cliente', 'dados', 'legado_estado', 'legado_pendentes', ...COLUNAS_FICHA], ...(ids ? { where: { id_cliente: ids.map(String) } } : { limit: LIMITE_EXTENSOES }), raw: true }));
  // Fusão (Maturacao/45): só os campos que o legado ainda não recebeu sobrepõem o legado; os espelhados vêm do próprio legado.
  // A ficha (nome completo, CPF, e-mail, endereço) entra por cima: o complemento vence quando preenchido.
  return new Map(linhas.map((l) => [String(l.id_cliente), { ...dadosEfetivosDoCliente(l), ...fichaDeLinha(l) }]));
}

/** A linha de `usuarios` com os campos editados na ficha por cima (cópia; nome_id, nome2, whats, datanascimento e, preenchidos na ficha, nome, cpf, email e o endereço; nunca apaga). */
function sobrepor(linha, dados) {
  if (!dados) return linha;
  const novo = { ...linha };
  if (typeof dados.name === 'string' && dados.name) novo.nome_id = dados.name;
  if (typeof dados.treatAs === 'string') novo.nome2 = dados.treatAs;
  if (typeof dados.whatsapp === 'string') novo.whats = dados.whatsapp;
  const nasc = nascimentoDoLegado(dados.birthDate);
  if (nasc) novo.datanascimento = nasc;
  return sobreporFicha(novo, dados);
}

/** Sobrepõe a extensão a cada linha (uma leitura só pelos ids das linhas). */
async function sobreporTodas(linhas) {
  const mapa = await extensoesPorId(linhas.map((l) => String(l.id)));
  return mapa.size ? linhas.map((l) => sobrepor(l, mapa.get(String(l.id)))) : linhas;
}

module.exports = { ativa, extensoesPorId, sobrepor, sobreporTodas, nascimentoDoLegado };
