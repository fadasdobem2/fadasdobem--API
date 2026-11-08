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

const lerDados = (ext) => (ext && typeof ext.dados === 'string' ? JSON.parse(ext.dados) : (ext && ext.dados) || {});
/** `dd/mm/aaaa` (a ficha) -> `AAAA-MM-DD` (contrato); qualquer outra coisa, `undefined`. */
const nascimentoIso = (t) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(limpo(t)); return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined; };

/**
 * Situação cadastral (Lilly v708) e, SÓ para a cliente que o fluxo de cadastro da Lilly já tocou (situação não nula), os dados que ela precisa
 * reler para completar o MESMO ID sem repetir gravação: nome completo, nascimento, e-mail e "sem e-mail". Cadastro antigo (situação NULL) sai sem
 * nada disso (continua sem nascimento nem e-mail no snapshot). `situacao_cadastral` NULL é omitida: significa "ainda não avaliada".
 */
function complementoCadastral(linha, ext) {
  const situacao = ext && ext.situacao_cadastral ? ext.situacao_cadastral : undefined;
  if (!situacao) return {};
  const dados = lerDados(ext);
  const nascimento = linha._nascimento || nascimentoIso(dados.birthDate);
  const email = limpo(linha._email) || limpo(dados.email);
  return {
    situacao, nomeCompleto: limpo(linha.nome) || limpo(dados.fullName) || undefined, nascimento, email: email || undefined,
    semEmail: ext.sem_email === true ? true : ext.sem_email === false ? false : undefined,
  };
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
  // Cadastro pendente sem nome: o campo de nome fica ausente (a Lilly mostra "ID <n>" só na apresentação); nunca o ID no lugar do nome.
  const pendenteSemNome = extra.situacao === 'dados_pendentes' && !limpo(linha.nome) && !limpo(linha.nome_id);
  return sem({
    id,
    name: limpo(extra.nomeCompleto) || limpo(linha.nome) || limpo(linha.nome_id) || (pendenteSemNome ? undefined : id),
    fullName: limpo(extra.nomeCompleto) || undefined, // só para a cliente que o fluxo de cadastro da Lilly tocou (ver `complementoCadastral`)
    situacao_cadastral: extra.situacao,
    birthDate: extra.nascimento, email: extra.email, noEmail: extra.semEmail,
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

module.exports = { comExtensao, clienteParaLilly, complementoCadastral, tipoDePagamento, urlDaFicha };
