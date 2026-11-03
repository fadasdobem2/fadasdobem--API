'use strict';

/**
 * Regras ÚNICAS para os dados ruins de data do legado ASP (onda 1 da auditoria, A4). Funções PURAS, sem SQL, usadas pelos leitores da ficha/lista de
 * Clientes, pelo leitor de Recebimentos (SQL e JS) e pelo histórico de "primeira consulta". NUNCA muda dinheiro: só decide se uma data vale e se uma
 * linha é "vazia".
 *
 *  - Consulta "sem data": `iniConsulta` com ano < 1900 (o ASP grava `1899-12-30` quando só guardou a hora; ou `0000-00-00`). A consulta CONTINUA na
 *    lista, nos totais e na contagem de tarólogos; só perde a data (a tela mostra "Não informado", nunca "30/12/99").
 *  - Pagamento com data inválida: ano < 2000 ou depois de amanhã (o ASP tem datas como 2027, 2042, 6026). Vai para "Sem data" e nunca
 *    para "Último pagamento", nem para a última movimentação da cliente. O valor continua somando onde já somava (a lista "Sem data" fica fora dos totais, D9).
 *  - Linha vazia do ASP: `idUsuario` 0/nulo E valor 0/nulo E data nula ou de ano <= 2000 (o ASP cria ~11 por dia com `2000-01-01`). Fica FORA das
 *    listas e contagens. NÃO descarta pagamento com valor (> 0) nem com cliente (idUsuario > 0), qualquer que seja a data.
 */

const ANO_MINIMO_PAGAMENTO = 2000;
const ANO_MINIMO_CONSULTA = 1900;
const relogioSp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
/** Agora no relógio de São Paulo, AAAA-MM-DDTHH:mm:ss. */
const agoraSaoPaulo = (em = new Date()) => relogioSp.format(em).replace(' ', 'T');
const dia = (local) => (typeof local === 'string' ? local.slice(0, 10) : '');
const ano = (local) => Number(dia(local).slice(0, 4));
const diaSeguinte = (chave) => new Date(Date.parse(`${chave}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

/** `1899-12-30`, `0000-00-00`, `0001-...`: o início que o ASP grava sem data. Texto bruto ou local; nulo não é marcador (já é "não informado"). */
function inicioSemData(bruto) {
  if (bruto === null || bruto === undefined || bruto === '') return false;
  const a = ano(String(bruto));
  return Number.isFinite(a) && a < ANO_MINIMO_CONSULTA;
}

/** A data paga só vale entre 2000 e amanhã (relógio local de São Paulo `agoraLocal`, AAAA-MM-DDTHH:mm:ss). Senão null ("Sem data"). */
function pagamentoPlausivel(local, agoraLocal) {
  if (!local) return null;
  const a = ano(local);
  if (!Number.isFinite(a) || a < ANO_MINIMO_PAGAMENTO) return null;
  if (agoraLocal && dia(local) > diaSeguinte(dia(agoraLocal))) return null;
  return local;
}

/** Linha vazia do ASP (ver o cabeçalho). `valor` em texto/número; `data` em texto bruto ou nulo. */
function linhaVazia({ idUsuario, valor, data }) {
  const semCliente = idUsuario === null || idUsuario === undefined || Number(idUsuario) === 0;
  const semValor = valor === null || valor === undefined || valor === '' || Number(valor) === 0;
  const semData = data === null || data === undefined || data === '' || !(ano(String(data)) > ANO_MINIMO_PAGAMENTO);
  return semCliente && semValor && semData;
}

/** Fragmento SQL (MySQL) de "data paga que não vale": nulo, zero-date, ano < 2000 ou depois de amanhã. `col` já vem qualificada pelo código, nunca por entrada de usuário. */
const sqlDataInvalida = (col) => `(${col} IS NULL OR YEAR(${col}) < ${ANO_MINIMO_PAGAMENTO} OR MONTH(${col}) = 0 OR DAYOFMONTH(${col}) = 0 OR ${col} >= DATE_ADD(CURDATE(), INTERVAL 2 DAY))`;

module.exports = { agoraSaoPaulo, ANO_MINIMO_CONSULTA, ANO_MINIMO_PAGAMENTO, inicioSemData, pagamentoPlausivel, linhaVazia, sqlDataInvalida, diaSeguinte };
