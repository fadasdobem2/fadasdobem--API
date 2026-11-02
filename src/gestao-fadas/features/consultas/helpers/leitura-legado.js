'use strict';

/**
 * Porte de `features/integration/legacy-values.ts` e da parte de consultas de `legacy-read-model.ts` (B):
 * decodificação PURA de valores do banco legado (nenhum SQL aqui). Datas/horas voltam como TEXTO; dinheiro como TEXTO.
 */

/** O problema de uma consulta cujo fim vem antes do início; a visão real procura por ele. */
const ENDED_BEFORE_START = 'Encerramento anterior ao início registrado';

function idLegadoTexto(valor) {
  const texto = typeof valor === 'number' && Number.isSafeInteger(valor) ? String(valor) : valor;
  return typeof texto === 'string' && /^\d{1,10}$/.test(texto) && Number(texto) > 0 && Number(texto) <= 2147483647 ? texto : null;
}

function exigirIdLegado(valor, origem) {
  const id = idLegadoTexto(valor);
  if (!id) throw new Error(`Identificador inválido em ${origem}; o registro não pode ser renumerado.`);
  return id;
}

/** DECIMAL(20,2) cruza a API como texto. Nulo não é zero; valores grandes nunca viram float. */
function valorLegado(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number' && (!Number.isFinite(valor) || Math.abs(valor) > Number.MAX_SAFE_INTEGER / 100)) return null;
  const m = String(valor).match(/^(-?)(\d{1,18})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const inteiro = m[2].replace(/^0+(?=\d)/, '');
  const fracao = (m[3] || '').padEnd(2, '0');
  const sinal = inteiro === '0' && fracao === '00' ? '' : m[1];
  return `${sinal}${inteiro}.${fracao}`;
}

function minutosLegado(valor) {
  if (valor === null || valor === undefined || valor === '' || !/^\d+$/.test(String(valor))) return null;
  const minutos = Number(valor);
  return Number.isSafeInteger(minutos) && minutos <= 2147483647 ? minutos : null;
}

/** DATETIME do MySQL é horário de parede. Não anexa o fuso de hoje a datas históricas. Zero-date vira null. */
function dataHoraLegado(valor) {
  if (!valor) return null;
  const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?$/);
  if (!m) return null;
  const [, ano, mes, dia, hora, minuto, segundo, fracao = ''] = m;
  const y = Number(ano);
  const mm = Number(mes);
  const d = Number(dia);
  if (y < 1000 || mm < 1 || mm > 12 || d < 1 || Number(hora) > 23 || Number(minuto) > 59 || Number(segundo) > 59) return null;
  const dias = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d > dias[mm - 1]) return null;
  return `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}${fracao}`;
}

/** Diferença em minutos (inteira) entre dois textos `YYYY-MM-DDTHH:mm:ss` de relógio de parede (lidos como UTC, sem fuso). */
function minutosEntre(inicioLocal, fimLocal) {
  return Math.floor((Date.parse(`${fimLocal}Z`) - Date.parse(`${inicioLocal}Z`)) / 60000);
}

/** Soma um dia a um texto `YYYY-MM-DDTHH:mm:ss[.fff]` de relógio de parede. */
function maisUmDia(local) {
  const t = new Date(Date.parse(`${local.slice(0, 19)}Z`) + 86400000).toISOString().slice(0, 19);
  return `${t}${local.slice(19)}`;
}

/** Tolerância (minutos) entre a duração gravada e a diferença das datas para aceitar a correção de virada de dia. */
const TOLERANCIA_VIRADA_MIN = 1;

/**
 * HEURÍSTICA DA VIRADA DE DIA (auditoria 02/11/2026). O legado grava `fimConsulta` com a DATA DO INÍCIO mesmo quando a
 * consulta cruza a meia-noite (fim < início); `tmpConsulta` fica certo. Se somar 1 dia ao fim faz a diferença bater com
 * `tmpConsulta` (±1 min), o fim é o do dia seguinte e o texto é corrigido. Fora disso (diferença não bate) nada muda e
 * a consulta continua marcada "fim antes do início". Prova em produção: 2026 tem 1.340 casos de fim < início, 1.235
 * batem exatamente; o resto não bate e fica marcado.
 */
function fimCorrigidoPorVirada(inicio, fim, minutos) {
  if (!inicio || !fim || minutos === null || fim >= inicio) return null;
  const candidato = maisUmDia(fim);
  return Math.abs(minutosEntre(inicio, candidato) - minutos) <= TOLERANCIA_VIRADA_MIN ? candidato : null;
}

/**
 * `tmpConsulta = -1` (9 consultas de set/2011) é "sem duração gravada", não aberta: com início e fim válidos e coerentes
 * (fim >= início, menos de 24 h) a duração sai das datas; senão continua sem minutagem (e, pela R4, em aberto).
 */
function minutosDasDatas(inicio, fim) {
  if (!inicio || !fim || fim < inicio) return null;
  const minutos = minutosEntre(inicio, fim);
  return minutos < 1440 ? minutos : null;
}

function textoLegado(valor) {
  return typeof valor === 'string' && valor.trim() ? valor : null;
}

/** Notas antigas podem conter HTML; as telas novas mostram texto puro, nunca marcação injetada. */
function notaLegado(valor) {
  return valor ? valor.replace(/<br\s*\/?\s*>/gi, '\n') : null;
}

function valorDeCatalogo(codigo, rotulos) {
  const id = codigo === null || codigo === undefined ? null : String(codigo);
  return { code: id, label: id === null ? null : (rotulos && rotulos[id]) ?? null };
}

/**
 * `readLegacyConsultation` (B): linha crua da lista branca (+ `nome_id` e `nmuTarologo` das junções) -> modelo de leitura.
 * `catalogos` = { channels, paymentOptions } (código -> rótulo).
 */
function lerConsultaLegado(linha, catalogos = {}) {
  const id = exigirIdLegado(linha.idConsulta, 'tbl_consultas.idConsulta');
  const startedAtLocal = dataHoraLegado(linha.iniConsulta);
  const fimGravado = dataHoraLegado(linha.fimConsulta);
  const semDuracaoGravada = Number(linha.tmpConsulta) === -1;
  const recordedMinutes = semDuracaoGravada ? minutosDasDatas(startedAtLocal, fimGravado) : minutosLegado(linha.tmpConsulta);
  const endedAtLocal = fimCorrigidoPorVirada(startedAtLocal, fimGravado, recordedMinutes) ?? fimGravado;
  const recordedAmount = valorLegado(linha.valor_consulta);
  const issues = [];
  if (!idLegadoTexto(linha.idUsuario)) issues.push('Referência da cliente ausente ou inválida');
  if (!idLegadoTexto(linha.idTarologo)) issues.push('Referência do profissional ausente ou inválida');
  if (!startedAtLocal) issues.push('Início não informado ou inválido');
  if (!endedAtLocal) issues.push('Encerramento não informado ou inválido');
  if (endedAtLocal && startedAtLocal && endedAtLocal < startedAtLocal) issues.push(ENDED_BEFORE_START);
  if (recordedMinutes === null) issues.push('Minutagem não informada ou inválida');
  if (recordedAmount === null) issues.push('Valor não informado ou inválido');
  return {
    origin: 'legacy', sourceTable: 'tbl_consultas', readOnly: true, id,
    clientId: idLegadoTexto(linha.idUsuario), tarotId: idLegadoTexto(linha.idTarologo),
    clientIdentification: textoLegado(linha.nome_id), tarotName: rotuloTarologo(idLegadoTexto(linha.idTarologo), linha.nmuTarologo),
    consultationDateLocal: dataHoraLegado(linha.dtConsulta), startedAtLocal, endedAtLocal,
    recordedMinutes, durationSeconds: recordedMinutes === null ? null : recordedMinutes * 60,
    recordedAmount, unitValue: null, commissionRate: null, commissionAmount: null,
    status: null,
    paymentProfile: linha.idFormaPagto !== null && linha.idFormaPagto !== undefined && String(linha.idFormaPagto) === '8' ? 'Pré-paga' : null,
    channel: valorDeCatalogo(linha.idFormaConsulta, catalogos.channels),
    paymentOption: valorDeCatalogo(linha.idFormaPagto, catalogos.paymentOptions),
    internalObservation: notaLegado(linha.obsConsulta), attendantLabel: textoLegado(linha.nmuAtendente),
    lastEditorLabel: textoLegado(linha.atendenteFinalizou), updatedAtLocal: dataHoraLegado(linha.dtManutencao),
    // Aplicados na cobrança antiga, não uma nova concessão de bônus nem uma segunda dedução.
    appliedBonusMinutes: minutosLegado(linha.vlBonus), discountPercent: minutosLegado(linha.vlDesconto),
    recordedAbatement: valorLegado(linha.abatimento),
    rawTiming: { start: linha.iniConsulta ?? null, end: linha.fimConsulta ?? null, minutes: linha.tmpConsulta ?? null },
    issues,
  };
}

/** Nome do tarólogo de `nmuTarologo`; vazio vira "Tarólogo NNN" (como o catálogo), nunca null quando há id. */
function rotuloTarologo(id, nome) {
  return textoLegado(nome) ?? (id ? `Tarólogo ${id}` : null);
}

/** Rótulo da cliente a partir de `usuarios.nome_id`, senão "Cliente {id}"; nunca o nome civil. */
function rotuloCliente(clientId, identification) {
  const label = identification?.trim() || null;
  return { clientLabel: label ?? (clientId ? `Cliente ${clientId}` : null), clientLabelMissing: label === null };
}

module.exports = {
  ENDED_BEFORE_START, idLegadoTexto, exigirIdLegado, valorLegado, minutosLegado, dataHoraLegado, textoLegado, notaLegado,
  valorDeCatalogo, lerConsultaLegado, rotuloCliente, rotuloTarologo, fimCorrigidoPorVirada, minutosDasDatas,
};
