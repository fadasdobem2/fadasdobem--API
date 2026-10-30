'use strict';

/**
 * Leitura e validação da lista de contas (JSON ou CSV) e geração da senha temporária. Sem I/O de banco.
 * Campos: nome, email, papel (administradora|supervisora|atendente|assistente; `tarologa` só com tarotId), opcionais tarotId e legacyId.
 */

const fs = require('fs');
const crypto = require('crypto');
const dom = require('../../src/gestao-fadas/_comum/dominio/contas');

const PAPEIS_EQUIPE = dom.PERFIS_EQUIPE; // administradora, assistente, supervisora, atendente
const CAMPOS = { nome: 'nome', name: 'nome', email: 'email', 'e-mail': 'email', papel: 'papel', role: 'papel', tarotid: 'tarotId', legacyid: 'legacyId' };

function dividirCsv(linha, sep) {
  const saida = []; let atual = ''; let aspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const ch = linha[i];
    if (aspas) { if (ch === '"' && linha[i + 1] === '"') { atual += '"'; i += 1; } else if (ch === '"') aspas = false; else atual += ch; }
    else if (ch === '"') aspas = true;
    else if (ch === sep) { saida.push(atual); atual = ''; } else atual += ch;
  }
  saida.push(atual);
  return saida.map((c) => c.trim());
}

function lerCsv(texto) {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!linhas.length) throw new Error('o arquivo CSV está vazio');
  const sep = (linhas[0].match(/;/g) || []).length > (linhas[0].match(/,/g) || []).length ? ';' : ',';
  const cab = dividirCsv(linhas[0], sep).map((c) => CAMPOS[c.toLowerCase()] || null);
  if (!cab.includes('nome') || !cab.includes('email') || !cab.includes('papel')) throw new Error('o cabeçalho do CSV precisa ter as colunas nome, email e papel');
  return linhas.slice(1).map((l) => Object.fromEntries(dividirCsv(l, sep).map((v, i) => [cab[i], v]).filter(([k]) => k)));
}

function lerArquivo(caminho) {
  const texto = fs.readFileSync(caminho, 'utf8');
  if (/\.json$/i.test(caminho)) {
    const j = JSON.parse(texto);
    const lista = Array.isArray(j) ? j : j && j.contas;
    if (!Array.isArray(lista)) throw new Error('o JSON deve ser uma lista de contas (ou { "contas": [...] })');
    return lista.map((o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [CAMPOS[k.toLowerCase()] || k, v])));
  }
  if (/\.csv$/i.test(caminho)) return lerCsv(texto);
  throw new Error('use um arquivo .json ou .csv');
}

/** Valida tudo ANTES de qualquer gravação. Devolve { contas, erros }. */
function validar(linhas) {
  const erros = []; const contas = []; const vistos = new Set();
  linhas.forEach((l, i) => {
    const n = i + 1; const prob = (m) => erros.push(`linha ${n}: ${m}`);
    const nome = dom.normalizarNome(typeof l.nome === 'string' ? l.nome : '');
    const msgEmail = dom.validarEmail(typeof l.email === 'string' ? l.email : '');
    const email = typeof l.email === 'string' ? l.email.trim().toLocaleLowerCase('pt-BR') : '';
    const papel = typeof l.papel === 'string' ? l.papel.trim().toLowerCase() : '';
    const tarotId = l.tarotId === undefined || l.tarotId === null || `${l.tarotId}`.trim() === '' ? undefined : `${l.tarotId}`.trim();
    const legacyId = l.legacyId === undefined || l.legacyId === null || `${l.legacyId}`.trim() === '' ? undefined : `${l.legacyId}`.trim();
    if (!nome) prob('nome vazio'); else if (nome.length > 80) prob('nome com mais de 80 caracteres');
    if (msgEmail) prob(`e-mail inválido (${email || 'vazio'})`);
    else if (vistos.has(email)) prob(`e-mail repetido no arquivo (${email})`);
    else vistos.add(email);
    if (papel === 'tarologa') { if (!tarotId) prob('papel tarologa exige tarotId'); }
    else if (!PAPEIS_EQUIPE.includes(papel)) prob(`papel inválido "${l.papel}" (use ${PAPEIS_EQUIPE.join(', ')})`);
    else if (tarotId) prob('tarotId só vale para o papel tarologa');
    if (tarotId && !/^[A-Za-z0-9_-]{1,64}$/.test(tarotId)) prob('tarotId inválido');
    if (legacyId && legacyId.length > 64) prob('legacyId com mais de 64 caracteres');
    if (nome && !msgEmail && !erros.some((e) => e.startsWith(`linha ${n}:`))) contas.push({ linha: n, nome, email, papel, tarotId, legacyId });
  });
  if (!linhas.length) erros.push('nenhuma conta na lista');
  return { contas, erros };
}

const CLASSES = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%*+-=?'];
/** Senha temporária forte (16 caracteres, 2+ de cada classe), sem `;`, `,` nem aspas, que quebrariam o CSV. */
function senhaTemporaria() {
  for (;;) {
    const chars = [];
    for (const c of CLASSES) for (let i = 0; i < 2; i += 1) chars.push(c[crypto.randomInt(c.length)]);
    const todos = CLASSES.join('');
    while (chars.length < 16) chars.push(todos[crypto.randomInt(todos.length)]);
    for (let i = chars.length - 1; i > 0; i -= 1) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
    const s = chars.join('');
    if (dom.senhaForte(s)) return s;
  }
}

module.exports = { lerArquivo, validar, senhaTemporaria, PAPEIS_EQUIPE };
