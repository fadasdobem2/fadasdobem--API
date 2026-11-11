'use strict';

/** Cadastro manual pela sessão da equipe. ID, cadastro, complemento, nota e auditoria só no PostgreSQL novo. */
const { createHash, randomUUID } = require('crypto');
const c = require('./cadastros.comum');
const { validarMudancas, traduzirErroDeTexto, aplicar, paraDto } = require('./clientes.validacao');
const { colunasDaFicha, camposDaFicha, fichaParaPerfil, SELECT_FICHA } = require('./clientes.ficha');
const { suggestedRegistrationNames } = require('../../_comum/dominio/cliente-cadastro-nomes');
const { situacaoDaNova } = require('../clientes/cliente-novo.situacao');
const { ativa } = require('../clientes/cliente-novo.leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const nota = require('../../_comum/dominio/nota-cliente');
const { conferirDuplicidade } = require('./clientes.duplicidade');

function validarCriacao(changes) {
  if (!c.ehObjeto(changes)) throw c.invalido('changes');
  const permitidos = ['name', 'fullName', 'treatAs', 'whatsapp', 'birthDate', 'paymentProfile', 'cpf', 'email', 'email2', 'noEmail', 'workPhone', 'phones', 'consultationPhoneIndex', 'whatsappPhoneIndex', 'address'];
  if (Object.keys(changes).some((k) => !permitidos.includes(k))) throw c.regra('Este campo ainda não pode ser salvo no cadastro.');
  if (typeof changes.fullName !== 'string' || !changes.fullName.trim()) throw c.regra('Informe o nome completo da cliente.');
  if (!Array.isArray(changes.phones) || !changes.phones.length) throw c.regra('Informe um número de telefone da cliente.');
  if (changes.paymentProfile !== undefined && changes.paymentProfile !== 'Pré-pago') throw c.regra('O cadastro novo é Pré-pago.');
  let m;
  try {
    m = validarMudancas({ ...changes, name: changes.name || suggestedRegistrationNames(changes.fullName).name, paymentProfile: 'Pré-pago' });
  } catch (e) { throw traduzirErroDeTexto(e); }
  const whatsapp = m.phones[m.whatsappPhoneIndex];
  if (m.whatsapp !== undefined && m.whatsapp.replace(/\D/g, '') !== whatsapp.replace(/\D/g, '')) throw c.regra('Confira o número escolhido para WhatsApp.');
  return { ...m, whatsapp };
}

function validarNota(raw, quem) {
  if (raw === undefined) return undefined;
  if (!c.ehObjeto(raw) || Object.keys(raw).some((k) => !['text', 'formatting'].includes(k))) throw c.regra('Confira a observação inicial.');
  if (`${process.env.GF_FATIA_FICHA || ''}`.trim().toLowerCase() !== 'true') throw c.regra('As observações ainda não estão disponíveis neste ambiente.');
  try {
    // IDs definitivos são atribuídos somente na transação; a regra valida texto e formatação já neste ponto.
    const n = nota.criar(nota.forma({ ...raw, id: 'validacao', clientId: '1000000000' }), quem, new Date().toISOString());
    return { text: n.text, ...(n.formatting ? { formatting: n.formatting } : {}) };
  } catch (e) { if (e instanceof nota.NotaInvalidaError) throw c.regra(e.message); throw e; }
}

async function criar(req) {
  const q = c.quem(req);
  if (!q.p.canCreateClients || q.perfil === 'tarologa') throw c.negado(true);
  if (!novosDadosNoPostgres() || !ativa()) throw c.indisponivel();
  const b = req.body;
  if (!c.ehObjeto(b)) throw c.invalido('corpo');
  if (Object.keys(b).some((k) => !['operationKey', 'changes', 'initialNote', 'duplicateReviewToken'].includes(k))) throw c.invalido('corpo');
  const operationKey = c.chaveOperacao(b.operationKey);
  const m = validarCriacao(b.changes);
  const quem = { nome: q.nome, papel: q.perfil };
  const initialNote = validarNota(b.initialNote, quem);
  if (b.duplicateReviewToken !== undefined && (typeof b.duplicateReviewToken !== 'string' || !/^[a-f0-9]{64}$/.test(b.duplicateReviewToken))) throw c.invalido('duplicateReviewToken');
  return c.gravar(req, {
    escopo: 'cadastros.cliente.criar', operationKey, travarOperacao: true,
    // Confirmação de revisão não altera o efeito nem invalida a repetição após um timeout.
    corpo: { mudancas: m, initialNote }, entidade: 'cliente', acao: 'cadastros.cliente.criar',
    producao: async (ex) => {
      // Mesma trava da criação Lilly: duas origens não emitem IDs concorrentes sem conferir os novos dados.
      await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', ['gf_clientes_novos:criar']);
      await conferirDuplicidade(ex, m, req, b.duplicateReviewToken);
      const agora = new Date().toISOString();
      const [seq] = await ex.execute("SELECT nextval('gf_clientes_novos_id_seq') AS id");
      const id = String(seq[0].id);
      const nascimento = m.birthDate ? m.birthDate.split('/').reverse().join('-') : null;
      const chave = `manual:${createHash('sha256').update(operationKey).digest('hex')}`;
      const base = { nome: m.fullName, nome_id: m.name, telefone: m.whatsapp, data_nascimento: nascimento, email: m.email || null };
      await ex.execute(`INSERT INTO gf_clientes_novos (id_cliente, nome, nome_id, nome2, data_nascimento, telefone, email, origem, criado_por, operation_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`, [id, m.fullName, m.name, m.treatAs || '', nascimento, m.whatsapp, m.email || null, q.nome, chave]);
      const ext = aplicar(null, m, agora);
      const ficha = colunasDaFicha(m);
      const colunas = Object.fromEntries(ficha.map(([k, v]) => [k, k === 'telefones' ? JSON.parse(v) : v]));
      const situacao = situacaoDaNova(base, ext.dados, colunas);
      await ex.execute(`INSERT INTO gf_clientes_ext (id_cliente, perfil_pagamento, perfil_pagamento_em, dados, revisao, atualizado_por, operation_key, legado_estado, situacao_cadastral${ficha.map(([k]) => `, ${k}`).join('')})
        VALUES (?, ?, ?, ?, 1, ?, ?, 'sem_registro', ?${ficha.map(() => ', ?').join('')})`,
      [id, ext.perfil_pagamento, ext.perfil_pagamento_em, JSON.stringify(ext.dados), q.nome, chave, situacao, ...ficha.map(([, v]) => v)]);
      let notaCriada;
      if (initialNote) {
        notaCriada = nota.criar({ ...initialNote, id: randomUUID(), clientId: id }, quem, agora);
        await ex.execute('INSERT INTO gf_clientes_notas (id, id_cliente, item, version, criado_por, operation_key) VALUES (?, ?, ?, 1, ?, ?)',
          [notaCriada.id, id, JSON.stringify(notaCriada), q.nome, chave]);
      }
      const [gravada] = await ex.execute(`SELECT ${SELECT_FICHA} FROM gf_clientes_ext WHERE id_cliente = ?`, [id]);
      const extension = paraDto({ ...gravada[0], ...ext, revisao: 1 }, fichaParaPerfil(gravada[0], q.perfil));
      return {
        entidadeId: id, antes: null,
        depois: { origem: 'manual', revision: 1, situacao_cadastral: situacao, ficha: camposDaFicha(m), ...(notaCriada ? { noteId: notaCriada.id } : {}) },
        resposta: { readAt: agora, clientId: id, extension, ...(notaCriada ? { initialNote: notaCriada } : {}) },
      };
    },
  });
}

module.exports = { criar, validarCriacao };
