'use strict';

/**
 * Harness que EXECUTA o código REAL de funções de `consultas/consultations-experience.tsx` (Maturacao/56 grupo D3) sem alterar o front:
 * lê o texto das funções locais do componente pelo compilador TypeScript do próprio front, transpila cada uma e a avalia num escopo
 * controlado (`with` + Proxy). O estado do React (useState/useMemo) entra pelo caso; os efeitos de TELA (toasts, setters, navegação) são
 * gravadores; as funções puras importadas pelo componente são as REAIS (vite ssrLoadModule). Identificador não previsto lança erro (nunca
 * silencia), para que mudança do front que passe a depender de outra coisa quebre o gerador em vez de passar em falso.
 */

const fs = require('fs');
const path = require('path');

const GLOBAIS = new Set(['Math', 'Number', 'Object', 'JSON', 'Array', 'String', 'Boolean', 'Set', 'Map', 'Error', 'Promise', 'undefined', 'Infinity', 'NaN', 'isNaN', 'parseFloat', 'parseInt', 'Symbol', 'RegExp', 'console', 'Intl', 'Date', 'crypto']);

function criar({ vite, front, locais, estado, relogio }) {
  const ts = require(path.join(front, 'node_modules', 'typescript'));
  const arquivo = path.join(front, 'features', 'consultas', 'consultations-experience.tsx');
  const fonte = fs.readFileSync(arquivo, 'utf8');
  const sf = ts.createSourceFile(arquivo, fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const importacoes = new Map();
  for (const d of sf.statements.filter(ts.isImportDeclaration)) {
    const cl = d.importClause; if (!cl || cl.isTypeOnly) continue; const mod = d.moduleSpecifier.text;
    if (cl.name) importacoes.set(cl.name.text, { mod, nome: 'default' });
    if (cl.namedBindings && ts.isNamedImports(cl.namedBindings)) for (const e of cl.namedBindings.elements) importacoes.set(e.name.text, { mod, nome: (e.propertyName || e.name).text });
  }
  const componente = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name && s.name.text === 'ConsultationsExperience');
  const funcoes = new Map(); componente.body.statements.filter(ts.isFunctionDeclaration).forEach((f) => funcoes.set(f.name.text, f));
  const caminho = (mod) => (mod.startsWith('@/') ? `/${mod.slice(2)}` : `/features/consultas/${mod.replace(/^\.\//, '')}`);
  const modulos = new Map(); const gravacoes = [];
  const gravador = (nome) => (...args) => { gravacoes.push({ nome, args }); };

  async function carregar(nomes) { for (const n of nomes) { const im = importacoes.get(n); if (im && !modulos.has(im.mod) && !['react', 'react-dom'].includes(im.mod)) modulos.set(im.mod, await vite.ssrLoadModule(caminho(im.mod))); } }
  const cache = new Map();
  const escopo = new Proxy({}, {
    has: (_t, k) => typeof k === 'string' && !GLOBAIS.has(k) && k !== 'undefined',
    get: (_t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (Object.prototype.hasOwnProperty.call(estado.valores, k)) return estado.valores[k];
      if (k === 'Date') return relogio.Date;
      if (cache.has(k)) return cache.get(k);
      let valor;
      if (locais.reais.includes(k)) valor = compilar(k);
      else if (locais.gravadores.some((g) => (g instanceof RegExp ? g.test(k) : g === k))) valor = gravador(k);
      else if (locais.fixos && k in locais.fixos) valor = locais.fixos[k];
      else if (importacoes.has(k)) { const im = importacoes.get(k); const m = modulos.get(im.mod); if (!m) throw new Error(`módulo não carregado para ${k}`); valor = m[im.nome]; }
      else throw new Error(`identificador livre não previsto no harness: ${k}`);
      cache.set(k, valor); return valor;
    },
    set: () => { throw new Error('escrita em identificador do componente fora do harness'); },
  });
  function compilar(nome) {
    const no = funcoes.get(nome); if (!no) throw new Error(`função local inexistente no componente: ${nome}`);
    const js = ts.transpileModule(no.getText(), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, alwaysStrict: false, noImplicitUseStrict: true } }).outputText;
    // eslint-disable-next-line no-new-func
    return new Function('__escopo', `with(__escopo){ return (${js.trim().replace(/;$/, '')}); }`)(escopo);
  }
  function nomesLivres() { return importacoes; }
  return { carregar, escopo, gravacoes, compilar, importacoes: nomesLivres(), limpar: () => { cache.clear(); gravacoes.length = 0; } };
}

module.exports = { criar };
