'use strict';

/**
 * Leitura e validação da equipe interna (JSON temporário FORA do repositório). Sem banco. Reaproveita as regras do serviço de contas
 * (`contas.validacao.corpoCriar`: nome, e-mail e papel exatamente como o POST /accounts) e a normalização de telefone da ficha.
 * Campos do JSON: nome, nomeFada, cargo, email, whatsapp.
 */

const fs = require('fs');
const crypto = require('crypto');
const dom = require('../../src/gestao-fadas/_comum/dominio/contas');
const validar = require('../../src/gestao-fadas/features/contas/contas.validacao');
const tel = require('../../src/gestao-fadas/_comum/dominio/cliente-ficha-telefone');

const CARGOS = Object.freeze({ administrador: 'administradora', administradora: 'administradora', supervisor: 'supervisora', supervisora: 'supervisora', atendente: 'atendente', assistente: 'assistente' });
const texto = (v) => (v === undefined || v === null ? '' : `${v}`);
const limpa = (v) => texto(v).trim().replace(/\s+/g, ' ');

function lerArquivo(caminho) {
  const j = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  const lista = Array.isArray(j) ? j : j && j.pessoas;
  if (!Array.isArray(lista)) throw new Error('o JSON deve ser uma lista de pessoas (ou { "pessoas": [...] })');
  return lista;
}

/** a***@gmail.com */
function mascararEmail(e) {
  const m = /^(.)[^@]*(@.*)$/.exec(texto(e).trim());
  return m ? `${m[1]}***${m[2]}` : '(e-mail ilegível)';
}
/** Só os 2 últimos dígitos. */
function mascararFone(f) {
  const d = texto(f).replace(/\D/g, '');
  return d.length >= 2 ? `(**) *****-**${d.slice(-2)}` : '(vazio)';
}

/** Telefone como a ficha: `+55 11 99999-9999`. Devolve { texto, chave, motivo }. */
function normalizarFone(bruto) {
  const v = texto(bruto).trim();
  if (!v) return { texto: '', chave: '', motivo: 'WhatsApp vazio' };
  const f = tel.formatarNumero(tel.normalizarTelefone(v));
  const t = tel.textoDoTelefone(f);
  if (!tel.clientePhoneComplete({ ddi: '+55', ddd: '', number: v })) return { texto: t, chave: '', motivo: 'WhatsApp incompleto ou em formato que a ficha não reconhece' };
  return { texto: t, chave: t.replace(/\D/g, ''), motivo: null };
}

/** Chave estável da operação (idempotência): depende só do e-mail normalizado. */
const chaveOperacao = (email) => `importar-equipe-${crypto.createHash('sha256').update(email).digest('hex').slice(0, 32)}`;

/** Valida tudo. Devolve [{ n, nome, nomeFada, papel, email, fone, problemas[] }] (um item por linha, na ordem). */
function validarPessoas(lista) {
  const itens = lista.map((o, i) => {
    const p = { n: i + 1, nome: limpa(o && o.nome), nomeFada: limpa(o && o.nomeFada), cargoOriginal: limpa(o && o.cargo), papel: null, email: texto(o && o.email).trim(), emailBruto: texto(o && o.email), fone: normalizarFone(o && o.whatsapp), problemas: [] };
    p.papel = CARGOS[p.cargoOriginal.toLowerCase()] || null;
    if (!p.papel) p.problemas.push(`cargo "${p.cargoOriginal}" não mapeia para um papel do sistema`);
    if (/\s/.test(p.email)) p.problemas.push('e-mail com espaço no meio (não corrigido automaticamente; confirmar com a pessoa)');
    else {
      try { validar.corpoCriar({ operationKey: 'validacao-local-00', name: p.nome, email: p.email, role: p.papel || 'atendente' }); p.email = p.email.toLocaleLowerCase('pt-BR'); }
      catch (e) { p.problemas.push(`${/nome/i.test(`${e.message}`) ? 'nome' : 'e-mail'} recusado pelo serviço de contas: ${String(e.message).slice(0, 120)}`); }
    }
    if (!p.nomeFada) p.problemas.push('nome de fada vazio');
    if (p.fone.motivo) p.problemas.push(p.fone.motivo);
    return p;
  });
  for (const campo of ['email', 'fone']) {
    const grupos = new Map();
    for (const p of itens) { const k = campo === 'email' ? (/\s/.test(p.email) ? '' : p.email) : p.fone.chave; if (k) grupos.set(k, [...(grupos.get(k) || []), p]); }
    for (const g of grupos.values()) if (g.length > 1) for (const p of g) p.problemas.push(`${campo === 'email' ? 'e-mail' : 'WhatsApp'} repetido na planilha (linhas ${g.map((x) => x.n).join(', ')})`);
  }
  return itens;
}

const nomeDaConta = (p, usar) => (usar === 'fada' ? p.nomeFada : p.nome);
module.exports = { lerArquivo, validarPessoas, mascararEmail, mascararFone, normalizarFone, chaveOperacao, nomeDaConta, CARGOS, PERFIS: dom.PERFIS_EQUIPE };
