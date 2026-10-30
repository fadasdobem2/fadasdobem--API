'use strict';

/**
 * ALLOWLIST do adaptador de escrita de DADOS no legado (`tbl_consultas`). Só existem estas instruções, todas com `?` para os valores
 * (nada é concatenado), e o executor recusa QUALQUER outro texto: DELETE, DDL, outra tabela, várias instruções, comentários.
 * Colunas fixas: o que não está aqui o espelho nunca escreve (`dtManutencao` é do próprio MySQL; `abatimento`, `vlPre`, `saldo`,
 * `emailCobranca` e `enviado` ficam com o DEFAULT do banco). Não se acrescenta coluna nem estrutura no legado.
 */

const COLUNAS_INSERT = Object.freeze(['idUsuario', 'idTarologo', 'dtConsulta', 'iniConsulta', 'fimConsulta', 'tmpConsulta', 'idFormaConsulta', 'idFormaPagto',
  'obsConsulta', 'dtVencto', 'vlDesconto', 'vlBonus', 'nmuAtendente', 'atendenteFinalizou', 'IDProdutoConsulta', 'valor_consulta']);
/** Só o que muda ao iniciar, encerrar ou corrigir. A cliente (`idUsuario`) é conferida no WHERE e nunca muda. */
const COLUNAS_UPDATE = Object.freeze(['iniConsulta', 'fimConsulta', 'tmpConsulta', 'idTarologo', 'idFormaConsulta', 'obsConsulta', 'vlBonus', 'atendenteFinalizou']);

const INSERT_CONSULTA = `INSERT INTO tbl_consultas (${COLUNAS_INSERT.join(', ')}) VALUES (${COLUNAS_INSERT.map(() => '?').join(', ')})`;
// `valor_consulta` é o total e não se recalcula: só entra quando o servidor tem o total (senão NULL mantém o que o legado tem).
const UPDATE_CONSULTA = `UPDATE tbl_consultas SET ${COLUNAS_UPDATE.map((c) => `${c} = ?`).join(', ')}, valor_consulta = COALESCE(?, valor_consulta) WHERE idConsulta = ? AND idUsuario = ?`;
const SELECT_CONSULTA = `SELECT idConsulta, ${['idUsuario', ...COLUNAS_INSERT.slice(1)].join(', ')}, dtManutencao FROM tbl_consultas WHERE idConsulta = ?`;
const SELECT_TAROLOGO = 'SELECT idTarologo FROM tbl_tarologos WHERE nmcTarologo = ? OR idTarologo = ? LIMIT 3';
// Reconciliação: procura (leitura) a linha que já corresponde à intenção de espelho (chave natural), antes de reinserir.
const SELECT_CANDIDATAS = 'SELECT idConsulta FROM tbl_consultas WHERE idUsuario = ? AND idTarologo = ? AND dtConsulta = ? AND iniConsulta = ? ORDER BY idConsulta LIMIT 5';
const SELECT_CONTAGEM = 'SELECT COUNT(*) AS n FROM tbl_consultas';
const SELECT_ULTIMO_ID = 'SELECT LAST_INSERT_ID() AS id';

const PERMITIDAS = new Set([INSERT_CONSULTA, UPDATE_CONSULTA, SELECT_CONSULTA, SELECT_TAROLOGO, SELECT_CANDIDATAS, SELECT_CONTAGEM, SELECT_ULTIMO_ID]);
const entidades = require('./sql.entidades');
const CONTROLE = /^(start\s+transaction|commit|rollback)$/i;

/** Devolve `null` se a instrução é permitida, ou o motivo da recusa. */
function motivoDeRecusa(sql) {
  const texto = String(sql).trim();
  if (CONTROLE.test(texto)) return null;
  if (PERMITIDAS.has(texto) || entidades.PERMITIDAS.has(texto)) return null;
  const palavra = (texto.split(/\s+/)[0] || '').toUpperCase();
  return `instrução fora da allowlist (${palavra || 'vazia'})`;
}

module.exports = { COLUNAS_INSERT, COLUNAS_UPDATE, INSERT_CONSULTA, UPDATE_CONSULTA, SELECT_CONSULTA, SELECT_TAROLOGO, SELECT_CANDIDATAS, SELECT_CONTAGEM, SELECT_ULTIMO_ID, motivoDeRecusa };
