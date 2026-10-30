'use strict';

/**
 * Nota nova da ficha em `obs_liberacao_consulta` (Maturacao/47 Q6): `id_usuario` = cliente, `desc` varchar(500), `id_atendente` = `usuarios.id` do AUTOR
 * (nivel 2 ou 99), vindo de `gf_contas_ext.legacy_id`. Só INSERT de nota NOVA (nunca edição nem DELETE). Autor sem linha de equipe em `usuarios`: RECUSADO
 * com erro claro, nunca se inventa id. Texto acima de 500 ou com emoji: recusado, nunca cortado.
 */

const sql = require('./sql.financeiro');
const { MapeamentoError } = require('./mapeamento');

function linhaDaNota(texto, clientId, idAtendente) {
  const id = Number(clientId);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw new MapeamentoError('Cliente fora do intervalo do legado.');
  if (!/^[1-9]\d{0,9}$/.test(`${idAtendente || ''}`) || Number(idAtendente) > 2147483647) throw new MapeamentoError('A conta de quem escreveu não tem linha de equipe em usuarios (gf_contas_ext.legacy_id vazio): a nota não foi espelhada.');
  const t = String(texto ?? '').trim();
  if (!t) throw new MapeamentoError('Nota vazia.');
  if (Array.from(t).length > 500) throw new MapeamentoError('A nota passa de 500 caracteres (limite de obs_liberacao_consulta): não foi espelhada nem cortada.');
  // eslint-disable-next-line no-control-regex
  if (/[\u{10000}-\u{10FFFF}]/u.test(t) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(t)) throw new MapeamentoError('A nota tem caractere que a coluna do sistema antigo não aceita (emoji ou controle).');
  return { id_usuario: id, desc: t, id_atendente: Number(idAtendente) };
}

async function inserir(ex, c) {
  const [e] = await ex.execute(sql.SELECT_EQUIPE, [c.id_atendente]);
  if (!e.length) throw new MapeamentoError(`usuarios ${c.id_atendente} não existe como equipe (nível 2 ou 99): a nota não foi espelhada.`);
  const [r] = await ex.execute(sql.INSERT_OBS, [c.id_usuario, c.desc, c.id_atendente]);
  if (r && r.insertId) return String(r.insertId);
  throw new Error('o legado não devolveu o id da nota');
}
async function ler(ex, id) { const [l] = await ex.execute(sql.SELECT_OBS, [Number(id)]); return l[0] || null; }

module.exports = { linhaDaNota, inserir, ler };
