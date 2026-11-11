'use strict';

/**
 * Leitura COMBINADA das clientes criadas pela Lilly no banco novo (`gf_clientes_novos`, IDs >= 1.000.000.000) para Clientes (lista, busca, ficha, histórico).
 * O legado (`usuarios`) segue SOMENTE LEITURA e nem é tocado aqui. Cada cliente nova vira uma linha "no formato de `usuarios`" (a mesma que a regra da v608
 * lê), com o complemento `gf_clientes_ext` por cima (nome de identificação, tratar por, WhatsApp, nascimento, nome completo, CPF, e-mail, endereço): a regra de
 * recorte por perfil, busca e projeção é a MESMA do legado (clientes.model.js). Sem texto novo: o estado `dados_pendentes` e a origem saem como chaves
 * (`situacao_cadastral`, `origin`) que o front v711 já entende ("AGUARDANDO DADOS PARA CADASTRO", "Nome de identificação pendente").
 * Ativa só com os dados novos no Postgres (`GF_NOVOS_DADOS`) e sem `GF_CLIENTES_NOVOS_LEITURA=false`.
 */

const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { ehIdDaFaixaNova } = require('../../_comum/dominio/cliente-faixa-nova');
const { COLUNAS: COLUNAS_FICHA, fichaDeLinha } = require('../../_comum/dominio/cliente-ficha-efetivo');
const { dadosEfetivosDoCliente } = require('../../legado-escrita/fusao');
const { saoPauloTimestamp, localOperationalDateKey } = require('./helpers/valores');
const extensao = require('./helpers/extensao');
const model = require('./clientes.model');

const ativa = () => `${process.env.GF_CLIENTES_NOVOS_LEITURA || ''}`.trim().toLowerCase() !== 'false' && novosDadosNoPostgres();

const dataCivil = (v) => (v === null || v === undefined ? null : (v instanceof Date ? v.toISOString() : `${v}`).slice(0, 10));
/** `criado_em` (instante) como o legado guarda `data_cadastro`: texto UTC `AAAA-MM-DD HH:MM:SS`. */
const textoUtc = (v) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString()).slice(0, 19).replace('T', ' ');

/** Linha de `gf_clientes_novos` no formato de `usuarios` que Clientes lê (R18). Telefone vai no WhatsApp; o resto que só o legado tem fica vazio. */
function linhaDeCadastro(l) {
  const nasc = dataCivil(l.data_nascimento);
  return {
    id: Number(l.id_cliente), nivel: 0, nome_id: l.nome_id || '', nome2: l.nome2 || '', nome: l.nome || '', ddd: '', telresidencial: '', telcomercial: '', cel: '',
    whats: l.telefone || '', email: l.email || '', email2: '', cpf: '', status_cpf_id: null, buscaNaReceita: '',
    datanascimento: nasc ? `${nasc} 00:00:00` : null, horanascimento: null, cidadeNascimento: null, ufNascimento: null, IDpaisNascimento: null,
    endereco: null, numero: null, complemento: null, bairro: null, cep: null, cidade: null, estado: null, idPais: null,
    data_cadastro: textoUtc(l.criado_em), saldo: null, valorAPagar: null, id_cliente_valido: 0,
    _novo: true, _origem: l.origem === 'manual' ? 'manual' : 'lilly',
  };
}

/** O que a edição da ficha guardou da cliente nova: tudo o que está em `dados` (não há legado a espelhar) e a ficha por cima. */
const dadosEditados = (ext) => ({ ...dadosEfetivosDoCliente(ext), ...fichaDeLinha(ext) });

async function lerExtensoes(ids) {
  if (!ids.length) return new Map();
  const linhas = await lendoNovo((m) => m.GfClientesExt.findAll({ attributes: ['id_cliente', 'dados', 'situacao_cadastral', 'sem_email', ...COLUNAS_FICHA], where: { id_cliente: ids }, raw: true }));
  return new Map(linhas.map((l) => [String(l.id_cliente), l]));
}

/** As clientes novas (todas, ou as dos `ids`) já com a edição da ficha por cima e o estado cadastral em `_situacao` / `_semEmail`. */
async function lerNovas(ids) {
  const alvo = ids ? [...new Set(ids.map(String).filter(ehIdDaFaixaNova))] : null;
  if (alvo && !alvo.length) return [];
  const novas = await lendoNovo((m) => m.GfClientesNovos.findAll({ ...(alvo ? { where: { id_cliente: alvo } } : {}), order: [['id_cliente', 'ASC']], raw: true }));
  const exts = await lerExtensoes(novas.map((l) => String(l.id_cliente)));
  return novas.map((l) => {
    const ext = exts.get(String(l.id_cliente));
    const dados = ext ? dadosEditados(ext) : {};
    const linha = extensao.sobrepor(linhaDeCadastro(l), dados);
    if (dados.phones?.length) {
      linha._telefones = dados.phones;
      const consulta = dados.phones[dados.consultationPhoneIndex];
      const whatsapp = dados.phones[dados.whatsappPhoneIndex];
      if (consulta) linha.telresidencial = consulta;
      if (whatsapp) linha.whats = whatsapp;
    }
    return { ...linha, _situacao: ext && ext.situacao_cadastral ? ext.situacao_cadastral : null, _semEmail: ext ? ext.sem_email : null };
  });
}

/** Dia operacional e instante local (São Paulo) do cadastro, que faz a cliente nova entrar na lista do período em que nasceu. */
const criadaEm = (linha) => saoPauloTimestamp(new Date(`${linha.data_cadastro}Z`));
const diaDaCriacao = (linha) => localOperationalDateKey(criadaEm(linha));
const noPeriodo = (linha, de, ate) => { const d = diaDaCriacao(linha); return d >= de && d <= ate; };

/**
 * Soma as clientes novas às linhas já lidas do legado. Busca: só as que a regra da v608 acha (a mesma `realClientMatches`, no cadastro com a edição
 * por cima). Recorte: as criadas no período (o "movimento" da cliente nova é o cadastro; ela entra em `rangeAt`). Nunca repete um ID.
 * Devolve `{ linhas, criadoAt }`; `criadoAt` (id -> instante local do cadastro) serve de última movimentação da cliente nova.
 */
async function somarNovas(linhas, plano, rangeAt) {
  const jaTem = new Set(linhas.map((l) => String(l.id)));
  const novas = (await lerNovas()).filter((l) => !jaTem.has(String(l.id)));
  const criadoAt = new Map(novas.map((l) => [String(l.id), criadaEm(l)]));
  const entram = plano.searching ? novas.filter((l) => model.realClientMatches(l, plano.search, plano.role))
    : novas.filter((l) => noPeriodo(l, plano.range.start, plano.range.end));
  if (!plano.searching) for (const l of entram) if (!rangeAt.has(String(l.id))) rangeAt.set(String(l.id), criadoAt.get(String(l.id)));
  return { linhas: [...linhas, ...entram], criadoAt, novas };
}

/** Acrescenta aos números dos controles de data (Hoje, Ontem, 7 dias) as clientes novas criadas nesses recortes. */
function somarContagens(contagens, novas, hoje, deslocar) {
  const conta = (de, ate) => novas.filter((l) => noPeriodo(l, de, ate)).length;
  const ontem = deslocar(hoje, -1);
  return { hoje: contagens.hoje + conta(hoje, hoje), ontem: contagens.ontem + conta(ontem, ontem), '7dias': contagens['7dias'] + conta(deslocar(hoje, -6), hoje) };
}

/** Marca (cópia) a ficha ou o item da lista de uma cliente nova: estado cadastral e origem, como o front já lê (e o cadastro como última movimentação). Cliente do legado passa intacta. */
function marcar(item, linha, criadoAt) {
  if (!linha || !linha._novo) return item;
  // Sem consulta nem pagamento no legado, a última movimentação da cliente nova é o próprio cadastro.
  const movimento = item.latestActivityLocal === null && criadoAt && criadoAt.get(String(linha.id)) ? { latestActivityLocal: criadoAt.get(String(linha.id)) } : {};
  return { ...item, ...movimento, origin: linha._origem === 'manual' ? 'manual' : 'lilly', ...(linha._situacao ? { situacao_cadastral: linha._situacao } : {}), ...(linha._semEmail === true || linha._semEmail === false ? { noEmail: linha._semEmail } : {}) };
}

module.exports = { ativa, linhaDeCadastro, lerNovas, somarNovas, somarContagens, marcar, diaDaCriacao };
