'use strict';

/**
 * Banco falso em memória das gf_repasse_* e gf_auditoria, usado dos DOIS lados do teste diferencial: a loja da B
 * (TypeScript, gerador do ouro) e a da A (verificador). Entende o SQL das duas depois de `normalizar`, que reescreve só
 * o que a B escreve de outro jeito sem mudar o sentido (`(? IS NULL OR tarot_id = ?)` vira `tarot_id = ?`). SQL que não
 * bate, letra por letra, com uma constante de escrita/sql.js da A é erro: a divergência aparece como "SQL não simulado".
 * Grava o TRAÇO: cada instrução (nome, parâmetros) e cada begin/commit/rollback, na ordem em que chegam.
 */

const path = require('node:path');

const raizA = path.join(__dirname, '..', '..', 'src', 'gestao-fadas');
const sqlA = require(path.join(raizA, 'features', 'repasse', 'escrita', 'sql'));
const { AUDIT_INSERT } = require(path.join(raizA, '_comum', 'auditoria'));

const colapsar = (s) => s.replace(/\s+/g, ' ').trim();
const NOMES = new Map(Object.entries({ ...sqlA, AUDIT_INSERT }).map(([nome, texto]) => [colapsar(texto), nome]));
const TABELAS = ['gf_repasse_percentuais', 'gf_repasse_calendarios', 'gf_repasse_aberturas', 'gf_repasse_abertura_pendencias', 'gf_repasse_dividas',
  'gf_repasse_divida_parcelas', 'gf_repasse_ajustes', 'gf_auditoria', 'gf_auth_accounts'];

/** O SQL da B no formato da A: filtro opcional por tarólogo vira filtro simples (os dois parâmetros são o mesmo valor). */
function normalizar(instrucao, params) {
  let texto = colapsar(instrucao);
  let valores = [...params];
  const FILTRO = /\(\? IS NULL OR ([\w.]+) = \?\)/g;
  if (FILTRO.test(texto)) {
    if (valores.length !== 2 || valores[0] !== valores[1]) throw new Error('filtro opcional da B com parâmetros diferentes');
    texto = texto.replace(FILTRO, '$1 = ?');
    valores = valores.slice(0, 1);
  }
  texto = texto.replace('ORDER BY tarot_id, ', 'ORDER BY ');
  return { texto, valores };
}

const centavos = (t) => BigInt(t.replace('.', ''));
const porTexto = (campo) => (a, b) => (a[campo] < b[campo] ? -1 : a[campo] > b[campo] ? 1 : 0);

function criarBanco({ tarologos = ['7'], contas = ['conta-1'] } = {}) {
  const n = { t: {}, eventos: [], tarologos: new Set(tarologos), falharNaAuditoria: false, esconderReplayUmaVez: false };
  for (const nome of TABELAS) n.t[nome] = [];
  for (const id of contas) n.t.gf_auth_accounts.push({ id });

  function inserir(nome, instrucao, p) {
    const m = /INSERT INTO (\w+) \(([^)]*)\)\s+VALUES \((.*)\)$/s.exec(instrucao);
    const colunas = m[2].split(',').map((c) => c.trim());
    const fichas = m[3].split(',').map((c) => c.trim());
    let i = 0;
    const linha = {};
    colunas.forEach((c, k) => {
      const f = fichas[k];
      linha[c] = f === '?' ? p[i++] : f === 'NULL' ? null : f.replace(/^'|'$/g, '');
    });
    if (i !== p.length) throw new Error(`parâmetros a mais em ${m[1]}`);
    if (p.includes(undefined)) throw new Error(`parâmetro undefined em ${nome}: o mysql2 recusaria`);
    if (m[1] === 'gf_auditoria') {
      if (n.falharNaAuditoria) throw Object.assign(new Error('falha'), { code: 'ER_FAKE' });
      if (n.t.gf_auditoria.some((l) => l.operation_key === linha.operation_key)) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    }
    n.t[m[1]].push(linha);
    return [{ affectedRows: 1 }];
  }

  function ler(nome, p) {
    const T = n.t;
    const [a] = p;
    switch (nome) {
      case 'REPLAY': {
        if (n.esconderReplayUmaVez) { n.esconderReplayUmaVez = false; return []; }
        return T.gf_auditoria.filter((l) => l.operation_key === a);
      }
      case 'ACCOUNT_EXISTS': return T.gf_auth_accounts.filter((l) => l.id === a);
      case 'COMMISSION_RATES': return T.gf_repasse_percentuais.filter((l) => l.tarot_id === a).sort((x, y) => porTexto('vigente_desde')(x, y) || porTexto('id')(x, y));
      case 'PAYMENT_SCHEDULES': return T.gf_repasse_calendarios.filter((l) => l.tarot_id === a).sort((x, y) => porTexto('vigente_desde')(x, y) || porTexto('id')(x, y));
      case 'DEBTS': return T.gf_repasse_dividas.filter((l) => l.tarot_id === a).sort((x, y) => x.registrado_em - y.registrado_em || porTexto('id')(x, y));
      case 'INSTALLMENTS': {
        const ids = new Set(T.gf_repasse_dividas.filter((l) => l.tarot_id === a).map((l) => l.id));
        return T.gf_repasse_divida_parcelas.filter((l) => ids.has(l.divida_id)).sort((x, y) => porTexto('divida_id')(x, y) || x.sequencia - y.sequencia);
      }
      case 'ADJUSTMENTS': return T.gf_repasse_ajustes.filter((l) => l.tarot_id === a).sort((x, y) => x.registrado_em - y.registrado_em || porTexto('id')(x, y));
      case 'OPENINGS': return T.gf_repasse_aberturas.filter((l) => l.tarot_id === a).sort((x, y) => x.revisao - y.revisao).map((l) => ({
        ...l, corrige_id: (T.gf_repasse_aberturas.find((o) => o.tarot_id === l.tarot_id && o.revisao === l.corrige_revisao) || {}).id ?? null }));
      case 'DIFFERENCES': {
        const ids = new Set(T.gf_repasse_aberturas.filter((l) => l.tarot_id === a).map((l) => l.id));
        return T.gf_repasse_abertura_pendencias.filter((l) => ids.has(l.abertura_id)).sort((x, y) => porTexto('abertura_id')(x, y) || porTexto('id')(x, y));
      }
      case 'TAROT_OPENINGS': return T.gf_repasse_aberturas.filter((l) => l.tarot_id === a).map(({ revisao, situacao }) => ({ revisao, situacao }));
      case 'OPENING_STATE': return T.gf_repasse_aberturas.filter((l) => l.id === a);
      case 'DEBT_STATE': return T.gf_repasse_dividas.filter((l) => l.id === a).map(({ tarot_id, situacao }) => ({ tarot_id, situacao }));
      case 'INSTALLMENT_TOTAL': {
        const d = T.gf_repasse_dividas.find((l) => l.id === a);
        const soma = T.gf_repasse_divida_parcelas.filter((l) => l.divida_id === a).reduce((s, l) => s + centavos(l.valor), 0n);
        return [{ valor: d.valor, soma: `${soma / 100n}.${String(soma % 100n).padStart(2, '0')}` }];
      }
      default: return null;
    }
  }

  function gravar(nome, p) {
    const T = n.t;
    const [a] = p;
    switch (nome) {
      case 'CONFIRM_OPENING': Object.assign(T.gf_repasse_aberturas.find((l) => l.id === p[2]), { situacao: 'confirmada', confirmado_por: p[0], confirmado_em: p[1] }); break;
      case 'DISCARD_OPENING': T.gf_repasse_aberturas.find((l) => l.id === a).situacao = 'descartada'; break;
      case 'REPLACE_DEBT': T.gf_repasse_dividas.find((l) => l.id === a).situacao = 'substituido'; break;
      case 'REPLACE_OLDER_MIGRATED_DEBTS':
        for (const l of T.gf_repasse_dividas) if (l.tarot_id === a && l.origem === 'migracao' && l.situacao === 'valido' && l.abertura_id !== p[1]) l.situacao = 'substituido';
        break;
      default: throw new Error(`SQL não simulado: ${nome}`);
    }
    return [{ affectedRows: 1 }];
  }

  /** Executa uma instrução (da A ou da B) e registra no traço. Devolve `[linhas]` ou `[cabeçalho]`. */
  n.executar = (instrucao, params = []) => {
    const { texto, valores } = normalizar(instrucao, params);
    const nome = NOMES.get(texto);
    if (!nome) throw new Error(`SQL não simulado: ${texto.slice(0, 90)}`);
    n.eventos.push({ tipo: 'sql', nome, params: structuredClone(valores) });
    if (/^INSERT/i.test(texto)) return inserir(nome, texto, valores);
    const linhas = ler(nome, valores);
    return [linhas === null ? gravar(nome, valores)[0] : structuredClone(linhas)];
  };
  let foto = null;
  n.iniciar = () => { n.eventos.push({ tipo: 'tx', nome: 'begin' }); foto = JSON.stringify(n.t); };
  n.confirmar = () => { n.eventos.push({ tipo: 'tx', nome: 'commit' }); foto = null; };
  n.desfazer = () => { n.eventos.push({ tipo: 'tx', nome: 'rollback' }); if (foto) n.t = JSON.parse(foto); foto = null; };

  /** Dependências no formato da fábrica da A (`criarRepasseEscrita`). */
  n.paraA = () => ({
    avulso: async (i, p) => n.executar(i, p),
    emTransacao: async (trabalho) => {
      n.iniciar();
      try {
        const r = await trabalho({ execute: async (i, p) => n.executar(i, p) });
        n.confirmar();
        return r;
      } catch (e) {
        n.desfazer();
        throw e;
      }
    },
  });

  /** Pool e conexão no formato do mysql2, para o `createFinanceStore` da B. */
  n.paraB = () => {
    const consulta = async (i, p) => n.executar(i, p);
    const conexao = { query: consulta, beginTransaction: async () => n.iniciar(), commit: async () => n.confirmar(), rollback: async () => n.desfazer(), release() {}, destroy() {} };
    return { query: consulta, getConnection: async () => conexao };
  };
  return n;
}

module.exports = { criarBanco, normalizar, colapsar, TABELAS };
