'use strict';

/**
 * Quem são as tarólogas ativas e quais telefones têm (SOMENTE LEITURA): o catálogo do Gestão (legado `tbl_tarologos` lido sem escrita + perfil no banco novo)
 * e, para o telefone do cadastro (`phone`, `phone2`), a ficha em `gf_cadastros_tarologo`. Também aceita um arquivo JSON (`--tarologas`) no mesmo formato,
 * para rodar sem banco. Nada aqui grava.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..', '..');
const gf = (p) => require(path.join(raiz, 'src', 'gestao-fadas', p));
const FILA_GERAL = 'afila';

const quando = (origem, telefone) => (typeof telefone === 'string' && telefone.trim() ? [{ origem, telefone: telefone.trim() }] : []);

/** Tarólogas ativas do catálogo, com os telefones do diretório (WhatsApp pessoal e do avatar) e do cadastro. */
async function doBanco() {
  const { catalogo } = gf('features/cadastros/tarologos.service');
  const { lendoNovo } = gf('novo/leitura');
  const cadastros = gf('features/cadastros/cadastro-tarologo.store');
  const itens = (await catalogo()).filter((i) => i.id !== FILA_GERAL && i.registrationActive !== false);
  const fichas = new Map((await lendoNovo((m) => cadastros.lerRecentes(m))).filter((l) => l.tarot_id).map((l) => [`${l.tarot_id}`, cadastros.json(l.dados) || {}]));
  return itens.map((i) => {
    const d = i.directory || {};
    const ficha = fichas.get(`${i.id}`) || {};
    return {
      tarotId: i.id, nome: i.name, revisao: i.revision,
      telefones: [...quando('personalWhatsapp', d.personalWhatsapp), ...quando('avatarWhatsapp', d.avatarWhatsapp), ...quando('cadastro.phone', ficha.phone), ...quando('cadastro.phone2', ficha.phone2)],
      ...(d.umblerContact && d.umblerContact.contactId ? { umblerContact: d.umblerContact } : {}),
    };
  });
}

/** `[{ tarotId, nome, revisao, telefones: [{ origem, telefone }], umblerContact? }]` de um arquivo JSON. */
function doArquivo(arquivo) {
  const lista = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (!Array.isArray(lista)) throw new Error('O arquivo de tarólogas precisa ser uma lista.');
  return lista;
}

/** O catálogo atual (para conferir revisão e vínculo antes de gravar). */
async function catalogoAtual() {
  const { catalogo } = gf('features/cadastros/tarologos.service');
  return catalogo();
}

module.exports = { doBanco, doArquivo, catalogoAtual, gf };
