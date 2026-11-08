'use strict';

/**
 * Leitura combinada da ficha (legado SOMENTE LEITURA + complemento do banco novo). Regra da Nice (08/11): o complemento vence quando
 * preenchido; vazio nunca apaga o que o legado tem. Ordem: coluna da ficha em `gf_clientes_ext` > `dados` (e-mail e nome completo que a
 * Lilly v708 já grava) > legado. O endereço é uma unidade: com qualquer parte preenchida no complemento, vale o complemento inteiro.
 * Funções puras, sem banco.
 */

const COLUNAS = ['nome_completo', 'cpf', 'email', 'telefones', 'telefone_consulta_idx', 'telefone_whatsapp_idx',
  'end_rua', 'end_numero', 'end_complemento', 'end_bairro', 'end_cep', 'end_cidade', 'end_uf', 'end_pais'];
const ENDERECO = [['street', 'end_rua'], ['number', 'end_numero'], ['complement', 'end_complemento'], ['district', 'end_bairro'], ['zip', 'end_cep'], ['city', 'end_cidade'], ['state', 'end_uf'], ['country', 'end_pais']];
/** Coluna de `usuarios` de cada parte do endereço (o país fica de fora: o legado guarda o código do catálogo, a ficha o texto). */
const COLUNA_LEGADO = { street: 'endereco', number: 'numero', complement: 'complemento', district: 'bairro', zip: 'cep', city: 'cidade', state: 'estado' };

const cheio = (v) => typeof v === 'string' && v.trim() !== '';
const json = (v) => { if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) { return null; } } return v ?? null; };

/** Os campos da ficha que a linha de `gf_clientes_ext` (e seus `dados`) tem preenchidos. */
function fichaDeLinha(linha) {
  const dados = json(linha && linha.dados) || {};
  const saida = {};
  const nome = cheio(linha && linha.nome_completo) ? linha.nome_completo : cheio(dados.fullName) ? dados.fullName : null;
  const mail = cheio(linha && linha.email) ? linha.email : cheio(dados.email) ? dados.email : null;
  if (nome) saida.fullName = nome;
  if (cheio(linha && linha.cpf)) saida.cpf = linha.cpf;
  if (mail) saida.email = mail;
  const fones = json(linha && linha.telefones);
  if (Array.isArray(fones) && fones.length) {
    saida.phones = fones;
    saida.consultationPhoneIndex = Number(linha.telefone_consulta_idx ?? 0);
    saida.whatsappPhoneIndex = Number(linha.telefone_whatsapp_idx ?? 0);
  }
  const endereco = Object.fromEntries(ENDERECO.map(([chave, coluna]) => [chave, linha && cheio(linha[coluna]) ? linha[coluna] : '']));
  if (Object.values(endereco).some(Boolean)) saida.address = endereco;
  return saida;
}

/** O que cada perfil lê (igual à ficha do legado): nome completo e CPF só com identidade civil, telefones e endereço só com cadastro completo. */
function recortarPorPerfil(ficha, { civil, completo }) {
  const saida = { ...ficha };
  if (!civil) { delete saida.fullName; delete saida.cpf; }
  if (!completo) { delete saida.phones; delete saida.consultationPhoneIndex; delete saida.whatsappPhoneIndex; delete saida.address; }
  return saida;
}

/** A linha de `usuarios` com a ficha por cima (cópia; só o que está preenchido). */
function sobreporFicha(linha, ficha) {
  const novo = { ...linha };
  if (cheio(ficha.fullName)) novo.nome = ficha.fullName;
  if (cheio(ficha.cpf)) novo.cpf = ficha.cpf;
  if (cheio(ficha.email)) novo.email = ficha.email;
  if (ficha.address) for (const [chave, coluna] of Object.entries(COLUNA_LEGADO)) novo[coluna] = cheio(ficha.address[chave]) ? ficha.address[chave] : null;
  return novo;
}

module.exports = { COLUNAS, ENDERECO, fichaDeLinha, recortarPorPerfil, sobreporFicha };
