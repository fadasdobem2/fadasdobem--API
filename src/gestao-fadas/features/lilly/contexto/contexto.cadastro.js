'use strict';

/**
 * Cadastro da cliente no snapshot (Maturacao/59, 3.2). Junta a linha de `usuarios` (legado, leitura) com a extensão `gf_clientes_ext` (o que a
 * equipe editou na ficha) e entrega SÓ os campos que o contrato pede. Nunca sai: senha, login, CPF, e-mail, nascimento, endereço, saldo
 * cru do legado. Telefones saem como `+55 DD número`.
 */

const { sobrepor } = require('../../clientes/helpers/extensao');
const { dadosEfetivosDoCliente } = require('../../../legado-escrita/fusao');
const { telefonesDoCadastro, textoParaLilly } = require('./contexto.telefone');

const limpo = (v) => `${v ?? ''}`.trim();
const sem = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/** A linha do legado com a edição da ficha por cima (cópia; nada é escrito). */
const comExtensao = (linha, ext) => sobrepor(linha, ext ? dadosEfetivosDoCliente(ext) : null);

/** Perfil de pagamento do painel ("Pré-pago"/"Pós-pago") para o vocabulário do contrato. */
function tipoDePagamento(perfil) {
  const p = limpo(perfil).toLowerCase();
  if (p.startsWith('pós') || p.startsWith('pos')) return { paymentType: 'postpaid', postpaid: true };
  if (p.startsWith('pré') || p.startsWith('pre')) return { paymentType: 'pre', postpaid: false };
  return {};
}

/** URL da ficha: `<base>?view=clientes&client=<id>` (só HTTPS; a base já foi validada em `configuracao.js`). */
function urlDaFicha(base, id) {
  if (!base) return undefined;
  const u = new URL(base);
  u.searchParams.set('view', 'clientes');
  u.searchParams.set('client', id);
  return u.toString();
}

/**
 * @param {object} linha  usuarios (já com a extensão por cima)
 * @param {{ perfil?, saldo?, ultimaConsulta?, contactId?, profileBase?, casamento?, telefoneDoCasamento? }} extra
 */
function clienteParaLilly(linha, extra = {}) {
  const id = `${linha.id}`;
  const { telefones } = telefonesDoCadastro(linha);
  const phones = telefones.map(textoParaLilly);
  if (extra.telefoneDoCasamento) phones.push(extra.telefoneDoCasamento); // 8 x 9 dígitos: o número no formato do observado (fullPhone da Lilly não casa o nono dígito)
  const whats = limpo(linha.whats);
  return sem({
    id,
    name: limpo(linha.nome) || limpo(linha.nome_id) || id,
    identificationName: limpo(linha.nome_id) || undefined,
    treatAs: limpo(linha.nome2) || undefined,
    phone: phones[0],
    whatsapp: whats ? textoParaLilly(whats) : undefined,
    phones: phones.length ? [...new Set(phones)] : undefined,
    phoneMatch: extra.casamento || undefined,
    contactId: extra.contactId,
    ...tipoDePagamento(extra.perfil),
    balance: extra.saldo,
    lastConsultationAt: extra.ultimaConsulta,
    profileUrl: urlDaFicha(extra.profileBase, id),
  });
}

module.exports = { comExtensao, clienteParaLilly, tipoDePagamento, urlDaFicha };
