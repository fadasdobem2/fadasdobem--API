'use strict';

/**
 * Gera os models do sistema B (Gestão Fadas) a partir das fontes versionadas em
 * `src/gestao-fadas/fontes/`:
 *
 *   - schema-catalog.json         -> src/models/legado/tabelas/*.model.js  (tabelas LEGADAS do ASP, SOMENTE LEITURA)
 *   - migrations-gf/*.sql         -> src/models/legado/novas/*.model.js    (tabelas NOVAS `gf_*`, vínculo por ID legado)
 *
 * Os arquivos gerados NÃO são editados à mão: ajuste o gerador (ou as fontes) e rode de novo.
 *
 *   node scripts/gerar-models-legado.js
 *
 * Regras (ver src/gestao-fadas/README.md):
 *   1. Nenhuma tabela legada é alterada. Os models legados são somente leitura.
 *   2. Colunas de senha/credencial NUNCA entram no model (lista SENSIVEIS).
 *   3. Datas e horas do legado são lidas como TEXTO (o `sql_mode` do servidor é vazio e há `0000-00-00`).
 *   4. Dinheiro (DECIMAL) volta como string; nunca como ponto flutuante.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const FONTES = path.join(RAIZ, 'src', 'gestao-fadas', 'fontes');
const SAIDA = path.join(RAIZ, 'src', 'models', 'legado');

/** Tabelas do catálogo que NÃO são do sistema de gestão e por isso não ganham model. */
const IGNORAR_LEGADO = {
  usuarios_backup: 'cópia de `usuarios` dentro do banco (duplica dados pessoais e credenciais)',
  wp_options: 'tabela do WordPress (pode guardar chaves de API); não é do sistema ASP',
  wp_mail_bank_logs: 'log de e-mails do WordPress; não é do sistema ASP',
  recado: 'decisão v273 (docs/banco): não ler, escrever nem importar; o módulo novo de recados é gf_recados*',
};

/** Colunas que nunca podem aparecer em um model (credenciais). */
const SENSIVEIS = {
  usuarios: ['login', 'senha', 'troca_senha', 'data_troca_senha'],
  tbl_tarologos: ['pass'],
  tbl_usuario: ['senUsuario'],
  // gf_auth_accounts: só id, nome de exibição, papel e situação; nunca o verificador de senha nem a chave de criação.
  gf_auth_accounts: ['password_hash', 'credential_version', 'bootstrap_key'],
};

/** Nomes de classe legíveis para as tabelas legadas (o resto é derivado do nome da tabela). */
const NOMES_LEGADO = {
  tbl_consultas: 'LegadoConsulta',
  tbl_tarologos: 'LegadoTarologo',
  usuarios: 'LegadoUsuario',
  tbl_pagtoinformado: 'LegadoPagamentoInformado',
  tbl_pagtoconfirmado: 'LegadoPagamentoConfirmado',
  tbl_pagtonaolocalizado: 'LegadoPagamentoNaoLocalizado',
  tbl_pagtoaberto: 'LegadoPagamentoAberto',
  tbl_bancos: 'LegadoBanco',
  tbl_formaconsulta: 'LegadoFormaConsulta',
  tbl_opcaopagto: 'LegadoOpcaoPagamento',
  bandeira_cartao: 'LegadoBandeiraCartao',
  contacorrente: 'LegadoContaCorrente',
  cpf_status: 'LegadoCpfStatus',
  obs_liberacao_consulta: 'LegadoObsLiberacaoConsulta',
  paises: 'LegadoPais',
  perfil_cliente: 'LegadoPerfilCliente',
  status_pagamento: 'LegadoStatusPagamento',
  tbl_atendente: 'LegadoAtendente',
  tbl_usuario: 'LegadoUsuarioAsp',
};

/**
 * Tabelas `gf_*` do fluxo de autenticação do suspiro: a API A tem autenticação própria, então ficam de fora, EXCETO
 * `gf_auth_accounts` (somente leitura e sem credenciais), de onde se lê o nome de quem registrou uma operação.
 */
const IGNORAR_NOVAS = /^gf_(auth_(?!accounts$)|probe_)/;

function pascal(nome) {
  return nome
    .split('_')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

/** Converte um tipo SQL (MySQL/MariaDB) no código do tipo Sequelize. Devolve { codigo, nota }. */
function tipoSequelize(tipoSql, definicao = '') {
  const t = tipoSql.trim().toLowerCase();
  const m = t.match(/^([a-z]+)\s*(?:\(([^)]*)\))?\s*(.*)$/);
  if (!m) throw new Error(`Tipo não reconhecido: ${tipoSql}`);
  const base = m[1];
  const args = m[2];
  const resto = `${m[3] || ''} ${definicao}`.toLowerCase();
  const sem = resto.includes('unsigned');

  switch (base) {
    case 'varchar':
      return { codigo: `DataTypes.STRING(${args})` };
    case 'char':
      return { codigo: `DataTypes.CHAR(${args})` };
    case 'tinytext':
    case 'text':
    case 'mediumtext':
      return { codigo: 'DataTypes.TEXT' };
    case 'longtext':
      return { codigo: "DataTypes.TEXT('long')" };
    case 'json':
      return { codigo: 'DataTypes.TEXT', nota: 'JSON lido como texto' };
    case 'tinyint':
      return { codigo: sem ? 'DataTypes.TINYINT.UNSIGNED' : 'DataTypes.TINYINT' };
    case 'smallint':
      return { codigo: sem ? 'DataTypes.SMALLINT.UNSIGNED' : 'DataTypes.SMALLINT' };
    case 'mediumint':
    case 'int':
    case 'integer':
      return { codigo: sem ? 'DataTypes.INTEGER.UNSIGNED' : 'DataTypes.INTEGER' };
    case 'bigint':
      return { codigo: sem ? 'DataTypes.BIGINT.UNSIGNED' : 'DataTypes.BIGINT', nota: 'BIGINT volta como string' };
    case 'decimal':
    case 'numeric':
      return { codigo: `DataTypes.DECIMAL(${args})`, nota: 'DECIMAL volta como string (dinheiro nunca em float)' };
    case 'double':
    case 'float':
      return { codigo: base === 'float' ? 'DataTypes.FLOAT' : 'DataTypes.DOUBLE', nota: 'ponto flutuante no legado; não usar para dinheiro' };
    case 'datetime':
    case 'timestamp':
      return { codigo: 'DataTypes.STRING(26)', nota: `${base.toUpperCase()} lido como texto (há valores zerados no legado)` };
    case 'date':
      return { codigo: 'DataTypes.STRING(10)', nota: 'DATE lido como texto (há valores zerados no legado)' };
    case 'time':
      return { codigo: 'DataTypes.STRING(16)', nota: 'TIME lido como texto' };
    case 'enum':
    case 'set':
      return { codigo: 'DataTypes.STRING(255)', nota: `${base.toUpperCase()}(${args}) lido como texto` };
    case 'blob':
    case 'longblob':
    case 'mediumblob':
    case 'tinyblob':
      return { codigo: 'DataTypes.BLOB' };
    default:
      throw new Error(`Tipo sem mapeamento: ${tipoSql}`);
  }
}

function literal(s) {
  return JSON.stringify(s);
}

function emitirModel({ classe, tabela, colunas, chaves, origem, engine, somenteLeitura, omitidas, descricao }) {
  const linhas = [];
  linhas.push("'use strict';");
  linhas.push('');
  linhas.push('/**');
  linhas.push(` * GERADO por scripts/gerar-models-legado.js a partir de ${origem}. NÃO EDITAR À MÃO.`);
  linhas.push(` * Tabela: \`${tabela}\`${engine ? ` (engine ${engine})` : ''}.`);
  if (descricao) linhas.push(` * ${descricao}`);
  linhas.push(
    somenteLeitura
      ? ' * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.'
      : ' * Tabela NOVA (gf_*): vínculo com o legado por ID, sem FOREIGN KEY para tabela MyISAM.'
  );
  if (omitidas && omitidas.length) {
    linhas.push(` * Colunas deliberadamente fora do model (credenciais): ${omitidas.join(', ')}.`);
  }
  linhas.push(' */');
  linhas.push('');
  linhas.push("const { Model, DataTypes } = require('sequelize');");
  linhas.push('');
  linhas.push(`class ${classe} extends Model {}`);
  linhas.push('');
  linhas.push('module.exports = (sequelize) => {');
  linhas.push(`  ${classe}.init(`);
  linhas.push('    {');
  for (const c of colunas) {
    const partes = [`type: ${c.tipo.codigo}`, `allowNull: ${c.nullable ? 'true' : 'false'}`];
    if (chaves.includes(c.nome)) partes.push('primaryKey: true');
    if (c.autoIncrement) partes.push('autoIncrement: true');
    const comentario = [c.tipo.nota, c.definicao].filter(Boolean).join(' | ');
    if (comentario) partes.push(`comment: ${literal(comentario)}`);
    linhas.push(`      ${/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.nome) ? c.nome : literal(c.nome)}: { ${partes.join(', ')} },`);
  }
  linhas.push('    },');
  linhas.push('    {');
  linhas.push('      sequelize,');
  linhas.push(`      modelName: ${literal(classe)},`);
  linhas.push(`      tableName: ${literal(tabela)},`);
  linhas.push('      freezeTableName: true,');
  linhas.push('      timestamps: false,');
  linhas.push('      underscored: false,');
  linhas.push(`      somenteLeitura: ${somenteLeitura ? 'true' : 'false'},`);
  linhas.push('    }');
  linhas.push('  );');
  linhas.push(`  return ${classe};`);
  linhas.push('};');
  linhas.push('');
  linhas.push(`module.exports.NOME = ${literal(classe)};`);
  linhas.push(`module.exports.TABELA = ${literal(tabela)};`);
  linhas.push('');
  return linhas.join('\n');
}

/* ------------------------------- legado ------------------------------- */

function gerarLegado() {
  const catalogo = JSON.parse(fs.readFileSync(path.join(FONTES, 'schema-catalog.json'), 'utf8'));
  const dirSaida = path.join(SAIDA, 'tabelas');
  fs.mkdirSync(dirSaida, { recursive: true });
  for (const f of fs.readdirSync(dirSaida)) if (f.endsWith('.model.js')) fs.unlinkSync(path.join(dirSaida, f));

  const gerados = [];
  const ignorados = [];
  let totalColunas = 0;
  for (const [tabela, def] of Object.entries(catalogo.tables)) {
    if (IGNORAR_LEGADO[tabela]) {
      ignorados.push({ tabela, motivo: IGNORAR_LEGADO[tabela] });
      continue;
    }
    const classe = NOMES_LEGADO[tabela];
    if (!classe) throw new Error(`Falta nome de classe para a tabela legada ${tabela}`);
    const pkLinha = def.constraints.find((c) => /^PRIMARY KEY/i.test(c));
    if (!pkLinha) throw new Error(`Tabela ${tabela} sem PRIMARY KEY no catálogo`);
    const chaves = [...pkLinha.matchAll(/`([^`]+)`/g)].map((x) => x[1]);
    const sens = SENSIVEIS[tabela] || [];
    const colunas = [];
    for (const [nome, d] of Object.entries(def.columns)) {
      if (sens.includes(nome)) continue;
      colunas.push({
        nome,
        nullable: d.nullable,
        tipo: tipoSequelize(d.type, d.definition),
        autoIncrement: /auto_increment/i.test(d.definition),
        definicao: d.definition,
      });
    }
    for (const s of sens) if (!def.columns[s]) throw new Error(`Coluna sensível ${tabela}.${s} não existe no catálogo`);
    totalColunas += colunas.length;
    const codigo = emitirModel({
      classe,
      tabela,
      colunas,
      chaves,
      origem: 'gestao-fadas/fontes/schema-catalog.json',
      engine: def.engine,
      somenteLeitura: true,
      omitidas: sens,
    });
    fs.writeFileSync(path.join(dirSaida, `${tabela}.model.js`), codigo);
    gerados.push({ tabela, classe, colunas: colunas.length, omitidas: sens.length });
  }

  const indice = [
    "'use strict';",
    '',
    '/** GERADO por scripts/gerar-models-legado.js. Tabelas LEGADAS do ASP32 (somente leitura). */',
    '',
    'module.exports = [',
    ...gerados.map((g) => `  require('./${g.tabela}.model'),`),
    '];',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dirSaida, 'index.js'), indice);
  return { gerados, ignorados, totalColunas, totalCatalogo: Object.values(catalogo.tables).reduce((a, t) => a + Object.keys(t.columns).length, 0) };
}

/* ------------------------------- novas (gf_*) ------------------------------- */

function removerComentariosSql(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => {
      const i = l.indexOf('--');
      return i >= 0 ? l.slice(0, i) : l;
    })
    .join('\n');
}

function blocoParenteses(texto, inicio) {
  let nivel = 0;
  let aspas = null;
  for (let i = inicio; i < texto.length; i += 1) {
    const ch = texto[i];
    if (aspas) {
      if (ch === aspas && texto[i - 1] !== '\\') aspas = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') aspas = ch;
    else if (ch === '(') nivel += 1;
    else if (ch === ')') {
      nivel -= 1;
      if (nivel === 0) return i;
    }
  }
  throw new Error('Parênteses não fecham');
}

function dividirNoTopo(corpo) {
  const partes = [];
  let nivel = 0;
  let aspas = null;
  let atual = '';
  for (let i = 0; i < corpo.length; i += 1) {
    const ch = corpo[i];
    if (aspas) {
      atual += ch;
      if (ch === aspas && corpo[i - 1] !== '\\') aspas = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      aspas = ch;
      atual += ch;
    } else if (ch === '(') {
      nivel += 1;
      atual += ch;
    } else if (ch === ')') {
      nivel -= 1;
      atual += ch;
    } else if (ch === ',' && nivel === 0) {
      partes.push(atual.trim());
      atual = '';
    } else atual += ch;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

function lerTabelasSql(arquivo) {
  const sql = removerComentariosSql(fs.readFileSync(arquivo, 'utf8'));
  const tabelas = [];
  const re = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?([a-z0-9_]+)`?\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const abre = m.index + m[0].length - 1;
    const fecha = blocoParenteses(sql, abre);
    const corpo = sql.slice(abre + 1, fecha);
    const depois = sql.slice(fecha + 1, sql.indexOf(';', fecha));
    const engine = (depois.match(/ENGINE=([A-Za-z]+)/i) || [])[1] || null;
    const colunas = [];
    let chaves = [];
    for (const parte of dividirNoTopo(corpo)) {
      if (/^PRIMARY KEY/i.test(parte)) {
        chaves = [...parte.matchAll(/`([^`]+)`/g)].map((x) => x[1]);
        continue;
      }
      if (/^(CONSTRAINT|UNIQUE|KEY|INDEX|CHECK|FOREIGN KEY|FULLTEXT)/i.test(parte)) continue;
      const c = parte.match(/^`([^`]+)`\s+([A-Za-z]+(?:\s*\([^)]*\))?(?:\s+UNSIGNED)?)([\s\S]*)$/i);
      if (!c) throw new Error(`Coluna não reconhecida em ${m[1]}: ${parte.slice(0, 80)}`);
      const resto = c[3] || '';
      colunas.push({
        nome: c[1],
        nullable: !/NOT NULL/i.test(resto),
        tipo: tipoSequelize(c[2].replace(/\s+/g, ' '), resto),
        autoIncrement: /AUTO_INCREMENT/i.test(resto),
        definicao: `${c[2]}${resto}`.replace(/\s+/g, ' ').trim(),
      });
    }
    if (!chaves.length) throw new Error(`Tabela ${m[1]} sem PRIMARY KEY`);
    tabelas.push({ tabela: m[1], engine, colunas, chaves });
  }
  return tabelas;
}

function gerarNovas() {
  const dirSaida = path.join(SAIDA, 'novas');
  fs.mkdirSync(dirSaida, { recursive: true });
  for (const f of fs.readdirSync(dirSaida)) if (f.endsWith('.model.js')) fs.unlinkSync(path.join(dirSaida, f));

  const gerados = [];
  const dirSql = path.join(FONTES, 'migrations-gf');
  for (const arq of fs.readdirSync(dirSql).filter((f) => f.endsWith('.sql') && !f.includes('rollback')).sort()) {
    for (const t of lerTabelasSql(path.join(dirSql, arq))) {
      if (IGNORAR_NOVAS.test(t.tabela)) continue;
      const classe = pascal(t.tabela);
      const omitir = SENSIVEIS[t.tabela] || [];
      const codigo = emitirModel({
        classe,
        tabela: t.tabela,
        colunas: t.colunas.filter((c) => !omitir.includes(c.nome)),
        chaves: t.chaves,
        origem: `gestao-fadas/fontes/migrations-gf/${arq}`,
        engine: t.engine,
        somenteLeitura: true,
        omitidas: omitir,
        descricao:
          'Criada e gravada hoje pelo app do suspiro (Lucas). Fica somente leitura aqui até a API A assumir a escrita com decisão registrada.',
      });
      fs.writeFileSync(path.join(dirSaida, `${t.tabela}.model.js`), codigo);
      gerados.push({ tabela: t.tabela, classe, colunas: t.colunas.length, arquivo: arq });
    }
  }
  const indice = [
    "'use strict';",
    '',
    '/** GERADO por scripts/gerar-models-legado.js. Tabelas NOVAS `gf_*` ligadas ao legado por ID. */',
    '',
    'module.exports = [',
    ...gerados.map((g) => `  require('./${g.tabela}.model'),`),
    '];',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dirSaida, 'index.js'), indice);
  return gerados;
}

function main() {
  const leg = gerarLegado();
  const novas = gerarNovas();
  console.log(`Legado: ${leg.gerados.length} models, ${leg.totalColunas} de ${leg.totalCatalogo} colunas (omitidas por credencial: ${leg.gerados.reduce((a, g) => a + g.omitidas, 0)}).`);
  for (const i of leg.ignorados) console.log(`  ignorada: ${i.tabela} (${i.motivo})`);
  console.log(`Novas (gf_*): ${novas.length} models.`);
  for (const g of novas) console.log(`  ${g.tabela} -> ${g.classe} (${g.colunas} colunas)`);
}

if (require.main === module) main();

module.exports = { tipoSequelize, lerTabelasSql, SENSIVEIS, IGNORAR_LEGADO };
