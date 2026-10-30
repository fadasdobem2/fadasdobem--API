'use strict';

/**
 * REGRA DE LEITURA COMBINADA (legado + extensão `gf_*`), depois que o legado passa a receber a escrita (Maturacao/45 seção 4):
 *   1. o LEGADO é a fonte de todo campo espelhado (cliente: nome, tratar por, WhatsApp, nascimento; tarólogo: nome e cadastro ativo);
 *   2. a extensão só vale para o campo que o legado ainda NÃO recebeu: o que está em `legado_pendentes` (edição feita e ainda não escrita,
 *      ou feita com o espelho desligado, ou recusada/erro). Campo que consta como espelhado é ignorado na extensão: se a Nice mudar no
 *      ASP depois, a leitura mostra o que o legado tem, sem a cópia velha do Postgres por cima;
 *   3. o que não tem casa no legado (Pré/Pós, avatar, perfil, conta...) vem sempre da extensão;
 *   4. linha sem a coluna `legado_pendentes` (objeto montado em memória, ex. resposta de uma gravação) ou `nao_espelhada` com a lista vazia (nunca
 *      passou pelo espelho) vale por inteiro: é o que acabou de ser gravado.
 * Com o espelho desligado (hoje) as edições entram em `legado_pendentes` e a leitura é IDÊNTICA à de antes (tudo sobreposto): nada muda no front.
 * Funções puras, sem banco.
 */

const CAMPOS_CLIENTE = Object.freeze(['name', 'treatAs', 'whatsapp', 'birthDate']);
const CAMPOS_TAROLOGO = Object.freeze(['nome', 'cadastro_ativo']);

const json = (v, vazio) => { if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) { return vazio; } } return v === undefined || v === null ? vazio : v; };

/**
 * Campos pendentes da linha. `null` = tudo vale (a linha não traz a coluna, OU nunca passou pelo espelho: `nao_espelhada` com a lista vazia,
 * como uma linha gravada por um processo anterior à migração durante a troca de versão; o código novo nunca deixa uma edição assim).
 */
function pendentesDe(linha) {
  if (!linha || linha.legado_pendentes === undefined) return null;
  const p = json(linha.legado_pendentes, []);
  const lista = Array.isArray(p) ? p : [];
  return !lista.length && linha.legado_estado === 'nao_espelhada' ? null : lista;
}

/** `dados` do cliente só com o que a extensão ainda tem direito de sobrepor ao legado. */
function dadosEfetivosDoCliente(linha) {
  const dados = json(linha && linha.dados, {}) || {};
  const pend = pendentesDe(linha);
  if (pend === null) return dados;
  return Object.fromEntries(Object.entries(dados).filter(([k]) => !CAMPOS_CLIENTE.includes(k) || pend.includes(k)));
}

/** `perfil.nome` / `perfil.cadastro_ativo` só valem sobre o legado enquanto pendentes; sem tarólogo no legado (`legado` nulo) valem sempre. */
function campoDoPerfilVale(perfil, campo, legado) {
  if (!perfil || !legado) return true;
  const pend = pendentesDe(perfil);
  return pend === null || pend.includes(campo);
}

module.exports = { CAMPOS_CLIENTE, CAMPOS_TAROLOGO, pendentesDe, dadosEfetivosDoCliente, campoDoPerfilVale };
