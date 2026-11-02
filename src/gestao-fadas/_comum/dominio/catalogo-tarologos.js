'use strict';

/**
 * Domínio puro do catálogo de tarólogos (Maturacao/29 seção 9): junta o cadastro do legado (`tbl_tarologos`, só leitura),
 * a extensão antiga (`gf_tarologos_ext`) e o perfil editável do banco novo (`gf_tarologos_perfil`) em dois formatos que o
 * front já conhece: `TarotProfile` (perfil operacional) e `TarologistDirectoryProfile` (diretório). Sem banco e sem HTTP.
 *
 * O `id` do catálogo é o `idTarologo` do legado em texto; quem nasce de um cadastro aprovado (sem legado) leva o id do front
 * (`tarot-...`). A conta da taróloga se liga ao tarólogo por `conta_slug`; a sessão devolve esse id.
 */

const { CadastroInvalidoError, texto: textoDoCadastro, lista: listaDoCadastro, objeto: objetoDoCadastro, GRUPOS_SEM, GRUPOS_COMPETENCIA } = require('./cadastro-tarologo');
const { campoDoPerfilVale } = require('../../legado-escrita/fusao');

/** Campos do `TarologistDirectoryProfile` que a edição pode gravar (nome, id e situação do cadastro vão em colunas próprias). */
const LISTAS = ['oracles', 'techniques', 'spreads', 'definitions', 'channels', 'themes', 'informedItems'];
const TEXTOS = { birthDate: 40, realFirstName: 120, personalWhatsapp: 45, avatarWhatsapp: 45, biography: 10000, profileCommandId: 100, registrationId: 100 };
const GRUPOS = ['definitions', 'tarot', 'cartomancy', 'astrology', 'numerology', 'oracles', 'spreads', 'practices'];
/** Campos que só a ficha pública do diretório não mostra (privados): saem para quem não é da gestão do cadastro. */
const PRIVADOS = ['birthDate', 'realFirstName', 'personalWhatsapp', 'avatarWhatsapp'];

const invalido = (m) => new CadastroInvalidoError(m);
/** As listas e textos do diretório seguem `validateRegistrationData` do front (registration-model.ts): mesmas frases, vazios saem, repetidos somem. */
const lista = listaDoCadastro;

/** Valida a parte `directory` de uma edição e devolve só os campos reconhecidos (campo ausente continua ausente). */
function validarDiretorio(entrada) {
  if (entrada === undefined) return {};
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) throw invalido('Perfil: conteúdo inválido.');
  const saida = {};
  for (const k of LISTAS) if (entrada[k] !== undefined) saida[k] = lista(entrada[k], k);
  for (const [k, max] of Object.entries(TEXTOS)) {
    if (entrada[k] === undefined) continue;
    if (typeof entrada[k] !== 'string') throw invalido(`${k === 'biography' ? 'Apresentação' : k}: informe um texto.`);
    saida[k] = k === 'biography' ? textoDoCadastro(entrada[k], 'Apresentação', max) : entrada[k];
    if (k !== 'biography' && entrada[k].length > max) throw invalido(`${k}: informe um texto de até ${max} caracteres.`);
  }
  if (entrada.registrationRevision !== undefined) {
    if (!Number.isSafeInteger(entrada.registrationRevision) || entrada.registrationRevision < 0) throw invalido('registrationRevision inválido.');
    saida.registrationRevision = entrada.registrationRevision;
  }
  if (entrada.capabilityGroups !== undefined) {
    const g = objetoDoCadastro(entrada.capabilityGroups, 'Grupos de competências');
    if (Object.keys(g).some((k) => !GRUPOS_COMPETENCIA.includes(k))) throw invalido('Grupo de competências inválido.');
    saida.capabilityGroups = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, lista(v, 'Competências')]));
  }
  if (entrada.capabilityNone !== undefined) {
    saida.capabilityNone = lista(entrada.capabilityNone, 'Competências não atendidas');
    if (saida.capabilityNone.some((k) => !GRUPOS_SEM.includes(k))) throw invalido('Grupo de competências inválido.');
    if (saida.capabilityNone.some((k) => saida.capabilityGroups && saida.capabilityGroups[k] && saida.capabilityGroups[k].length)) throw invalido('Confira as competências: uma categoria não pode estar vazia e selecionada ao mesmo tempo.');
  }
  if (saida.channels && saida.channels.some((c) => c !== 'Chat' && c !== 'Voz')) throw invalido('Os canais disponíveis são Chat e Voz.');
  return saida;
}

const ativoDoLegado = (v) => (String(v) === '1' ? true : String(v) === '0' ? false : null);
/** `tbl_tarologos.status`: 2 = em consulta, 1 (ou ausente) = disponível. É só a situação cadastral: NUNCA vira online/presença. */
const statusDoLegado = (v) => (String(v) === '2' ? 'Em consulta' : 'Disponível');
const oraculosDoLegado = (l) => (l && Array.isArray(l.oraculos) ? l.oraculos.filter((o) => typeof o === 'string' && o.trim()) : []);
const nomeLegado = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Sem os campos privados do diretório (para quem não gere o cadastro). */
function semPrivados(diretorio) {
  const d = { ...diretorio };
  for (const k of PRIVADOS) delete d[k];
  return d;
}

/**
 * Uma linha do catálogo. `legado`: `{ idTarologo, nmuTarologo, ativo, status?, oraculos? }` ou null; `perfil`: linha de `gf_tarologos_perfil` ou null;
 * `ext`: linha de `gf_tarologos_ext` ou null (só preenche o que o perfil não tem).
 */
function montarItem({ legado, perfil, ext }) {
  const id = perfil ? perfil.tarot_id : String(legado.idTarologo);
  const ativoLegado = legado ? ativoDoLegado(legado.ativo) : null;
  // Fusão (Maturacao/45, legado-escrita/fusao.js): nome e situação já espelhados vêm do legado; o perfil só vale sobre ele enquanto o campo está pendente.
  const nome = (perfil && perfil.nome && campoDoPerfilVale(perfil, 'nome', legado) && perfil.nome) || (legado && nomeLegado(legado.nmuTarologo)) || (perfil && perfil.nome) || (ext && ext.primeiro_nome_civil) || `Tarólogo ${id}`;
  const cadastroAtivo = perfil && perfil.cadastro_ativo !== null && perfil.cadastro_ativo !== undefined && (campoDoPerfilVale(perfil, 'cadastro_ativo', legado) || ativoLegado === null) ? perfil.cadastro_ativo : ativoLegado !== false;
  const avatar = (perfil && perfil.avatar) || (ext && ext.foto_atual_ref) || undefined;
  const dados = (perfil && perfil.perfil) || {};
  const diretorio = {
    tarotId: id, name: nome, registrationActive: cadastroAtivo,
    oracles: [], techniques: [], spreads: [], ...dados,
    ...(ext && ext.primeiro_nome_civil && dados.realFirstName === undefined ? { realFirstName: ext.primeiro_nome_civil } : {}),
    ...(ext && ext.personal_whatsapp && dados.personalWhatsapp === undefined ? { personalWhatsapp: ext.personal_whatsapp } : {}),
    ...(ext && ext.avatar_whatsapp && dados.avatarWhatsapp === undefined ? { avatarWhatsapp: ext.avatar_whatsapp } : {}),
  };
  // Oráculos do legado só entram enquanto o perfil novo não tem os seus (lista vazia = ainda não editado).
  if (!Array.isArray(dados.oracles) || !dados.oracles.length) diretorio.oracles = oraculosDoLegado(legado);
  const operacional = {
    id, name: nome, registrationActive: cadastroAtivo, official: Array.isArray(dados.official) ? dados.official : [], today: '', note: '',
    status: statusDoLegado(legado && legado.status), online: false,
    ...(avatar ? { avatar } : {}),
    ...(perfil && perfil.registro_id ? { registrationId: perfil.registro_id, registrationRevision: perfil.registro_revisao || 0 } : {}),
  };
  delete diretorio.official;
  return {
    id, legacyId: legado ? String(legado.idTarologo) : null, name: nome, active: ativoLegado, registrationActive: cadastroAtivo,
    accountLinked: Boolean(perfil && perfil.conta_slug), revision: perfil ? perfil.revisao : 0, profile: operacional, directory: diretorio,
  };
}

/** Aplica uma edição validada ao perfil guardado: devolve os campos novos (colunas e `perfil` jsonb). */
function aplicarEdicao(perfilAtual, { nome, avatar, registrationActive, directory }) {
  const perfil = { ...((perfilAtual && perfilAtual.perfil) || {}), ...(directory || {}) };
  return {
    nome: nome !== undefined ? nome : (perfilAtual ? perfilAtual.nome : null) ?? null,
    avatar: avatar !== undefined ? avatar : (perfilAtual ? perfilAtual.avatar : null) ?? null,
    cadastro_ativo: registrationActive !== undefined ? registrationActive : (perfilAtual ? perfilAtual.cadastro_ativo : null) ?? null,
    perfil,
  };
}

/** `prepareRegistrationChange` (admin/professional-settings-model.ts): inativar o cadastro com consulta em curso é recusado, com a frase do front. */
const MSG_INATIVAR_COM_CONSULTA = 'Há uma consulta em curso ou aguardando início. Encerre ou encaminhe esse atendimento antes de inativar.';
function conferirInativacao(ativoNovo, consultasDoTarologo) {
  return !ativoNovo && consultasDoTarologo.some((c) => c.status === 'Em curso') ? MSG_INATIVAR_COM_CONSULTA : null;
}

module.exports = { statusDoLegado, conferirInativacao, MSG_INATIVAR_COM_CONSULTA, validarDiretorio, montarItem, aplicarEdicao, semPrivados, ativoDoLegado, nomeLegado, PRIVADOS, LISTAS };
