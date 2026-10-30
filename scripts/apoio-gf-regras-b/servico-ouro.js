'use strict';

/**
 * Ouro do SERVIÇO do cadastro de tarólogo (Maturacao/44): roda o `handleProfessionalRegistration` REAL do front (registration-service.ts) contra um D1
 * simulado em memória (node:sqlite, o mesmo SQL) sobre uma sequência de passos (formulário público, ficha da gestão, aprovação, link de 7 dias,
 * envio pelo link, idempotência, 409/410) e grava, por passo, o status e o corpo NORMALIZADO (ids, instantes e tokens viram símbolos).
 * O Postgres (`apoio-gf-cadastros/filho.js`) repete os MESMOS passos pelo gate e compara.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const ORIGEM = 'https://app.test';
const DONO = 'dona@fadas.test';
const RELOGIO0 = Date.parse('2026-10-30T15:00:00.000Z');

const ficha = (extra = {}, publico = false) => {
  const f = {
    professionalName: 'Cadastro Novo', fullName: 'Luna Souza', birthDate: '1990-05-10', cpf: '529.982.247-25', phone: '(11) 91234-5678', email: 'luna@exemplo.com', biography: 'Apresentação',
    weeklySchedule: { segunda: '9h às 12h' }, channels: ['Chat'], bank: { pix: 'luna@exemplo.com' }, paymentMethods: ['pix'], preferredPaymentMethod: 'pix', ...extra,
  };
  if (!publico) f.commissionRate = f.commissionRate ?? 30;
  return f;
};

/** Passos abstratos: `@id:NOME` e `@token:NOME` viram o valor real; `guardar` registra o id (ou token) devolvido. */
const PASSOS = [
  { n: 'publico: envio novo', quem: 'publico', m: 'POST', corpo: { data: ficha({}, true), idempotencyKey: 'chave-publica-0001' }, guardar: { id: 'A' } },
  { n: 'publico: mesma chave e mesmos dados repete o recibo', quem: 'publico', m: 'POST', corpo: { data: ficha({}, true), idempotencyKey: 'chave-publica-0001' } },
  { n: 'publico: mesma chave com outros dados e 409', quem: 'publico', m: 'POST', corpo: { data: ficha({ professionalName: 'Outro' }, true), idempotencyKey: 'chave-publica-0001' } },
  { n: 'publico: com campo de aprovacao e 400', quem: 'publico', m: 'POST', corpo: { data: ficha({}, true), idempotencyKey: 'chave-publica-0002', status: 'approved' } },
  { n: 'publico: chave curta e 400', quem: 'publico', m: 'POST', corpo: { data: ficha({}, true), idempotencyKey: 'curta' } },
  { n: 'publico: sem CPF e 400', quem: 'publico', m: 'POST', corpo: { data: ficha({ cpf: '' }, true), idempotencyKey: 'chave-publica-0003' } },
  { n: 'publico: com repasse no data e 400', quem: 'publico', m: 'POST', corpo: { data: ficha({ commissionRate: 40 }, true), idempotencyKey: 'chave-publica-0004' } },
  { n: 'gestao: lista', quem: 'adm', m: 'GET', query: '' },
  { n: 'gestao: ficha por id', quem: 'adm', m: 'GET', query: '?id=@id:A' },
  { n: 'gestao: ficha inexistente e 404', quem: 'adm', m: 'GET', query: '?id=nao-existe' },
  { n: 'gestao: ficha por tarotId sem dono e record null', quem: 'adm', m: 'GET', query: '?tarotId=tarot-1' },
  { n: 'gestao: id invalido e 400', quem: 'adm', m: 'GET', query: '?id=a%20b' },
  { n: 'outra pessoa: lista e 403', quem: 'outro', m: 'GET', query: '' },
  { n: 'aprovar sem tarotId e 400', quem: 'adm', m: 'PUT', corpo: { id: '@id:A', revision: 1, status: 'approved', data: ficha(), tarotId: '' } },
  { n: 'aprovar com situacao invalida e 400', quem: 'adm', m: 'PUT', corpo: { id: '@id:A', revision: 1, status: 'x', data: ficha() } },
  { n: 'aprovar com revisao negativa e 400', quem: 'adm', m: 'PUT', corpo: { id: '@id:A', revision: -1, status: 'pending', data: ficha() } },
  { n: 'aprovar com dado invalido e 400', quem: 'adm', m: 'PUT', corpo: { id: '@id:A', revision: 1, status: 'pending', data: ficha({ cpf: '111.111.111-11' }) } },
  { n: 'aprovar', quem: 'adm', m: 'PUT', corpo: { id: '@id:A', revision: 1, status: 'approved', tarotId: 'tarot-cadastro-1', data: ficha({ commissionRate: 35, biography: 'Apresentação aprovada' }) } },
  { n: 'aprovados', quem: 'adm', m: 'GET', query: '?approved=1' },
  { n: 'ficha aprovada por tarotId', quem: 'adm', m: 'GET', query: '?tarotId=tarot-cadastro-1' },
  { n: 'revisao velha e 409', quem: 'adm', m: 'PUT', corpo: { id: '@id:A', revision: 1, status: 'pending', tarotId: 'tarot-cadastro-1', data: ficha() } },
  { n: 'trocar o vinculo e 409', quem: 'adm', m: 'PUT', corpo: { id: '@id:A', revision: 2, status: 'approved', tarotId: 'tarot-outro', data: ficha() } },
  { n: 'mesmo tarotId em outra ficha e 409', quem: 'adm', m: 'PUT', corpo: { id: 'outra-ficha', revision: 0, status: 'approved', tarotId: 'tarot-cadastro-1', data: ficha() } },
  { n: 'criar com revisao diferente de zero e 409', quem: 'adm', m: 'PUT', corpo: { id: 'nova-ficha', revision: 3, status: 'pending', data: ficha() } },
  { n: 'criar pela gestao', quem: 'adm', m: 'PUT', corpo: { id: 'nova-ficha', revision: 0, status: 'pending', data: ficha({ professionalName: 'Criada pela gestão' }) } },
  { n: 'PUT por outra pessoa e 403', quem: 'outro', m: 'PUT', corpo: { id: 'x1', revision: 0, status: 'pending', data: ficha() } },
  { n: 'link: outra pessoa e 403', quem: 'outro', m: 'POST', corpo: { action: 'create-update-link', id: '@id:A', revision: 2 } },
  { n: 'link: revisao errada e 409', quem: 'adm', m: 'POST', corpo: { action: 'create-update-link', id: '@id:A', revision: 1 } },
  { n: 'link: revisao negativa e 400', quem: 'adm', m: 'POST', corpo: { action: 'create-update-link', id: '@id:A', revision: -1 } },
  { n: 'link: acao desconhecida e 400', quem: 'adm', m: 'POST', corpo: { action: 'x', id: '@id:A', revision: 2 } },
  { n: 'link: cria', quem: 'adm', m: 'POST', corpo: { action: 'create-update-link', id: '@id:A', revision: 2 }, guardar: { token: 'A' } },
  { n: 'token: mostra a ficha sem repasse', quem: 'publico', m: 'GET', query: '?token=@token:A' },
  { n: 'token: formato invalido e 410', quem: 'publico', m: 'GET', query: '?token=abc' },
  { n: 'envio pelo link', quem: 'publico', m: 'POST', corpo: { data: ficha({ biography: 'Bio pelo link' }, true), token: '@token:A', idempotencyKey: 'chave-link-000001' } },
  { n: 'ficha depois do link: revisao 3, repasse preservado', quem: 'adm', m: 'GET', query: '?id=@id:A' },
  { n: 'token consumido e 410', quem: 'publico', m: 'GET', query: '?token=@token:A' },
  { n: 'envio com token consumido e 410', quem: 'publico', m: 'POST', corpo: { data: ficha({}, true), token: '@token:A', idempotencyKey: 'chave-link-000002' } },
  { n: 'mesmo envio repete o recibo', quem: 'publico', m: 'POST', corpo: { data: ficha({ biography: 'Bio pelo link' }, true), token: '@token:A', idempotencyKey: 'chave-link-000001' } },
  { n: 'novo link', quem: 'adm', m: 'POST', corpo: { action: 'create-update-link', id: '@id:A', revision: 3 }, guardar: { token: 'B' } },
  { n: 'avanca 8 dias', op: 'avancar', dias: 8 },
  { n: 'token expirado e 410', quem: 'publico', m: 'GET', query: '?token=@token:B' },
  { n: 'envio com token expirado e 410', quem: 'publico', m: 'POST', corpo: { data: ficha({}, true), token: '@token:B', idempotencyKey: 'chave-link-000003' } },
  { n: 'token com 64 hex que nunca existiu e 410', quem: 'publico', m: 'GET', query: `?token=${'a'.repeat(64)}` },
  { n: 'GET com metodo nao permitido', quem: 'adm', m: 'DELETE' },
];

const SQL_ESQUEMA = `
CREATE TABLE professional_registration_requests (key_hash text PRIMARY KEY NOT NULL, fingerprint text NOT NULL, registration_id text NOT NULL, received_at text NOT NULL);
CREATE TABLE professional_registrations (id text PRIMARY KEY NOT NULL, data text NOT NULL, status text NOT NULL, revision integer NOT NULL, tarot_id text, approved_data text, approved_public text, approved_revision integer, created_at text NOT NULL, updated_at text NOT NULL, updated_by text NOT NULL, approved_at text, approved_by text);
CREATE TABLE professional_registration_tokens (registration_id text PRIMARY KEY NOT NULL, token_hash text NOT NULL, issued_revision integer NOT NULL, expires_at text NOT NULL, consumed_at text, created_at text NOT NULL, created_by text NOT NULL);
CREATE UNIQUE INDEX professional_registration_token_hash ON professional_registration_tokens (token_hash);
CREATE UNIQUE INDEX professional_registration_tarot_id ON professional_registrations (tarot_id);
`;

/** D1 de mentira sobre node:sqlite com a interface que o serviço usa (`prepare/bind/first/all/run/batch`). */
function d1() {
  const bd = new DatabaseSync(':memory:'); bd.exec(SQL_ESQUEMA);
  const stmt = (sql, valores = []) => ({
    bind: (...v) => stmt(sql, v),
    first: async () => bd.prepare(sql).get(...valores) ?? null,
    all: async () => ({ results: bd.prepare(sql).all(...valores) }),
    run: async () => { const r = bd.prepare(sql).run(...valores); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql), batch: async (lista) => { const out = []; bd.exec('BEGIN'); try { for (const s of lista) out.push(await s.run()); bd.exec('COMMIT'); } catch (e) { bd.exec('ROLLBACK'); throw e; } return out; } };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const INSTANTE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
/** Troca os valores voláteis por símbolos estáveis. */
function normalizar(valor, simbolos) {
  let t = JSON.stringify(valor);
  for (const [simb, real] of simbolos) t = t.split(real).join(simb);
  t = t.replace(/https?:\/\/[^/"]+\/form-tarologo/g, '<origem>/form-tarologo').replace(/[a-f0-9]{64}/g, '<token>').replace(UUID, '<uuid>').replace(INSTANTE, '<instante>');
  const o = JSON.parse(t);
  // Quem gravou (e-mail no front, nome da sessão no servidor) não é o contrato: vira símbolo.
  const limpar = (v) => { if (Array.isArray(v)) return v.map(limpar); if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ['updatedBy', 'approvedBy'].includes(k) && x !== 'public-form' && x !== 'form-token' ? '<ator>' : limpar(x)])); return v; };
  return limpar(o);
}

async function gerar(ctx) {
  const mod = await ctx.carregar('/features/professionals/registration-service.ts');
  const RealDate = Date; let agora = RELOGIO0;
  class DataFalsa extends RealDate { constructor(...a) { if (a.length) super(...a); else super(agora); } static now() { return agora; } }
  globalThis.Date = DataFalsa;
  const db = d1(); const ids = {}; const tokens = {};
  const resultados = [];
  try {
    const subst = (v) => JSON.parse(JSON.stringify(v ?? null).replace(/@id:([A-Z])/g, (_, k) => ids[k]).replace(/@token:([A-Z])/g, (_, k) => tokens[k]));
    for (const p of PASSOS) {
      if (p.op === 'avancar') { agora += p.dias * 86400000; resultados.push({ n: p.n, op: 'avancar', dias: p.dias }); continue; }
      const corpo = p.corpo ? subst(p.corpo) : undefined;
      const query = (p.query || '').replace(/@id:([A-Z])/g, (_, k) => ids[k]).replace(/@token:([A-Z])/g, (_, k) => tokens[k]);
      const headers = { origin: ORIGEM, 'content-type': 'application/json', ...(p.quem === 'adm' ? { 'oai-authenticated-user-email': DONO } : p.quem === 'outro' ? { 'oai-authenticated-user-email': 'outra@fadas.test' } : {}) };
      const req = new Request(`${ORIGEM}/api/tarologos-cadastro${query}`, { method: p.m, headers: p.m === 'GET' ? { 'oai-authenticated-user-email': headers['oai-authenticated-user-email'] ?? '' } : headers, body: p.m === 'GET' || p.m === 'DELETE' ? undefined : JSON.stringify(corpo) });
      if (p.m === 'GET' && !headers['oai-authenticated-user-email']) req.headers.delete('oai-authenticated-user-email');
      const resp = await mod.handleProfessionalRegistration(req, db, DONO);
      const status = resp.status; const j = await resp.json().catch(() => null);
      if (p.guardar && p.guardar.id && j) ids[p.guardar.id] = j.id;
      if (p.guardar && p.guardar.token && j && j.url) tokens[p.guardar.token] = j.url.split('token=')[1];
      const simbolos = [...Object.entries(ids).map(([k, v]) => [`<id:${k}>`, v]), ...Object.entries(tokens).map(([k, v]) => [`<token:${k}>`, v])];
      resultados.push({ ...p, corpo: p.corpo, status, esperado: normalizar(j, simbolos) });
    }
  } finally { globalThis.Date = RealDate; }
  fs.writeFileSync(path.join(__dirname, 'servico-passos.json'), JSON.stringify(PASSOS));
  return { passos: resultados };
}

module.exports = { gerar, PASSOS, normalizar };
