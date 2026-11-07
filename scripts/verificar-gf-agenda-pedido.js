'use strict';

/**
 * Verificação do pedido de agendamento, da identidade (cliente OU contato), do aviso manual, do retorno combinado e do "Pode agora" (v706 da Nice).
 *   1) OURO (sempre, sem banco): cada função do domínio da API contra o que o CÓDIGO REAL do front respondeu
 *      (scripts/gerar-ouro-gf-agenda-pedido.js -> scripts/apoio-gf-agenda/ouro-agenda-pedido.json), igual byte a byte (chaves ordenadas, sem undefined).
 *   2) MUTANTES: cada um troca UMA regra do domínio e o ouro tem de pegá-lo.
 *   3) POSTGRES DESCARTÁVEL (sem `--offline`): `fdb_agp_<aleatório>`, scripts/apoio-gf-agenda/filho-pedidos.js (HTTP do gate: pedido, contatos, agendamento de contato,
 *      vínculo/desfazer atômico, aviso manual). Apaga o banco no fim.
 *   node scripts/verificar-gf-agenda-pedido.js [--offline]
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Module = require('module');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const DOM = 'src/gestao-fadas/_comum/dominio';
const carregar = (nome) => require(path.join(raiz, DOM, nome));
let ok = 0;
const falhas = [];
const passo = (nome, fn) => { try { fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 400)}`); } };

const canon = (v) => JSON.stringify(v === undefined ? null : ordenar(v));
function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, ordenar(x)]));
  return v;
}
const roda = (fn) => { try { const v = fn(); return { v: v === undefined ? null : v }; } catch (e) { return { e: e.message }; } };
const ouro = require('./apoio-gf-agenda/ouro-agenda-pedido.json');

/** Cada grupo: nome, função que monta a resposta da API para um caso (no mesmo formato do ouro). */
function grupos(M) {
  const { id, pi, reg, fila, pc, av, rt, pp, bl } = M;
  return {
    identidade: (c) => ({ chave: id.chaveDeIdentidade(c.a), mesma: id.mesmaIdentidade(c.a, c.b), erro: id.erroDeIdentidade(c.a, c.contatos || undefined), doPedido: id.identidadeDoPedido(c.p), combina: id.pedidoCombinaComIdentidade(c.p, c.it) }),
    aplicarContato: (c) => roda(() => { const novo = id.aplicarContatoNaAgenda(c.agenda, c.c, c.ator, c.em, c.hoje); return { igual: novo === c.agenda, agenda: novo }; }),
    fone: (c) => pi.normalizarWhatsapp(c.f) ?? null,
    valida: (c) => { const r = pi.validarIdentidadeDoPedido(c.identidade, c.candidatos); return { error: r.error ?? null, client: r.client ? r.client.id : null, idx: r.client ? c.candidatos.indexOf(r.client) : -1 }; },
    contatos: (c) => ({ codigo: pi.proximoCodigoDeContato(c.contatos), formatados: c.contatos.map((x) => pi.codigoDeContatoFormatado(x.displayCode)), ativos: c.contatos.map((x) => pi.contatoAtivo(x)), vazio: pi.codigoDeContatoFormatado(undefined) }),
    resolver: (c) => { const r = pi.resolverContato(c.identidade, c.contatos, c.perfis, c.diretorio); return { clientId: r.clientId ?? null, contact: r.contact ? r.contact.id : null, ambiguous: r.ambiguous, error: r.error ?? null }; },
    duplicado: (c) => { const r = pi.pedidoDuplicado(c.pedidos, c.candidato, c.contatos); return r ? r.id : null; },
    registro: (c) => reg.normalizarRegistro(JSON.parse(JSON.stringify(c.registro))),
    procedencia: (c) => reg.procedenciaDaMudanca(c.item, c.acao, c.observadoEm),
    pedidoAgenda: (c) => { const a = reg.agendamentoDoPedido(c.pedido, c.agenda); const e = reg.agendamentoElegivel(c.pedido, c.agenda, c.consultas); const l = reg.agendamentoLigado(c.pedido, c.agenda); return { direto: a ? a.id : null, elegivel: e ? e.id : null, ligado: l ? l.id : null, etapa: reg.etapaDoPedido(c.pedido), pendente: reg.pedidoPendente(c.pedido) }; },
    fila: (c) => ({ ordem: fila.organizarFilaDePedidos(c.blocos).map((b) => b.key), mover: fila.moverBloco(c.chaves, c.origem, c.destino), lugares: fila.lugaresDosPedidos(c.chaves), revisao: fila.revisaoDosPedidos(c.pedidos) }),
    contatoPedido: (c) => { const proj = pc.itemDeContatoDoPedido(c.pedido, c.agenda); const ad = pc.adotarContatoDoPedido(c.alvo, c.pedido);
      return { projecao: proj, etapa: pc.etapaDeContato(c.pedido, proj), adotado: ad, mesmo: ad === c.alvo, naoAchada: pc.semIdentidadeLocalizada(c.pedido), erroPergunta: ['ask_reader', 'asked_reader', 'not_located', undefined].map((s) => pc.erroDeConsultaAoTarologo(c.pedido, s) ?? null), confirma: pc.pedidoPodeConfirmar(c.pedido), campos: pc.camposDeContato(proj) }; },
    desfazer: (c) => pc.erroAoDesfazerVinculo(c.contato, c.agenda, c.consultas, c.pagamentos, c.esperado0),
    horario: (c) => ({ t: undefined, esperado: pc.normalizarHorarioDoPedido(c.t), mascara: pc.mascararHorarioDoPedido(c.t) }),
    avisoManual: (c) => roda(() => { const novo = av.registrarAvisoManual(c.itens, c.agendaId, c.aviso); return { igual: novo === c.itens, itens: novo }; }),
    retorno: (c) => ({ prazo: roda(() => rt.prazoDoRetorno(c.escolha, c.agora)), vigente: (rt.retornoVigente(c.item) || {}).id ?? null }),
    pronta: (c) => pp.erroDePodeAgora(c.tag, c.item, c.perfis, c.consultas, c.date, c.agora) ?? null,
    bloqueio: (c) => bl.bloqueioDeLancamento(c.item, c.hoje, c.agora) ?? null,
  };
}
const modulos = () => ({
  id: carregar('agenda-identidade'), pi: carregar('agenda-pedido-identidade'), reg: carregar('agenda-pedido-registro'), fila: carregar('agenda-pedido-fila'),
  pc: carregar('agenda-pedido-contato'), av: carregar('agenda-aviso-manual'), rt: carregar('agenda-retorno-combinado'), pp: carregar('agenda-pronta-presenca'), bl: carregar('painel-bloqueio'),
});
const esperadoDe = (nome, c) => (c.esperado !== undefined && nome !== 'horario' ? c.esperado : nome === 'horario' ? { t: undefined, esperado: c.esperado, mascara: c.mascara } : c.esperado);

function primeiraDivergencia(M) {
  const g = grupos(M);
  for (const nome of Object.keys(g)) {
    const casos = ouro[nome];
    for (let i = 0; i < casos.length; i += 1) {
      const c = casos[i];
      const esperado = esperadoDe(nome, c);
      const obtido = g[nome](c);
      if (canon(obtido) !== canon(esperado)) return { nome, i, esperado, obtido };
    }
  }
  return null;
}

/** Carrega os módulos com UMA troca de texto (mutante); a troca tem de existir. */
function mutante(arquivo, de, para) {
  const f = path.join(raiz, DOM, `${arquivo}.js`);
  const fonte = fs.readFileSync(f, 'utf8');
  assert.ok(fonte.includes(de), `o texto do mutante não existe em ${arquivo}: ${de}`);
  const m = new Module(f, module);
  m.filename = f; m.paths = Module._nodeModulePaths(path.dirname(f));
  const original = Module._cache[f];
  delete Module._cache[f];
  m._compile(fonte.replace(de, para), f);
  Module._cache[f] = m;
  const modulosMut = modulos();
  // devolve o cache ao original
  if (original) Module._cache[f] = original; else delete Module._cache[f];
  return modulosMut;
}

console.log('Ouro do front: cada função do domínio contra o código real (v706)');
for (const nome of Object.keys(ouro).filter((k) => Array.isArray(ouro[k]))) {
  passo(`${nome}: ${ouro[nome].length} casos iguais ao front`, () => {
    const g = grupos(modulos())[nome];
    ouro[nome].forEach((c, i) => assert.strictEqual(canon(g(c)), canon(esperadoDe(nome, c)), `caso ${i}: ${canon(c).slice(0, 300)}\n   esperado ${canon(esperadoDe(nome, c)).slice(0, 300)}\n   saiu     ${canon(g(c)).slice(0, 300)}`));
  });
}

console.log('Mutantes: o ouro tem de pegar cada troca de regra');
const MUT = [
  ['agenda-identidade', "if (Boolean(clientId) === Boolean(leadId)) return undefined;", "if (!clientId && !leadId) return undefined;", 'cliente e contato juntos têm identidade'],
  ['agenda-identidade', "lead.archived || lead.clientId ||", "lead.archived ||", 'contato já vinculado a cliente serve'],
  ['agenda-identidade', "if (collision)", "if (false)", ''],
  ['agenda-identidade', "if (colisao) throw new Error(CONFLITO);", "if (false) throw new Error(CONFLITO);", 'vincular contato ignora outro agendamento ativo'],
  ['agenda-pedido-identidade', "if (explicito && !digitos.startsWith('55'))", "if (explicito && digitos.startsWith('55') === false && false)", 'DDI estrangeiro sem regra'],
  ['agenda-pedido-identidade', "/^[1-9]\\d[2-9]\\d{7,8}$/", "/^[1-9]\\d\\d{7,8}$/", 'telefone local aceita número iniciado em 0 ou 1'],
  ['agenda-pedido-identidade', "if (iguais.length > 1) return", "if (iguais.length > 5) return", 'telefone repetido identifica a cliente'],
  ['agenda-pedido-identidade', "String(maior + 1).padStart(4, '0')", "String(maior + 1).padStart(3, '0')", 'código do contato com 3 dígitos'],
  ['agenda-pedido-identidade', "if (porFone.length > 1) return", "if (porFone.length > 9) return", 'dois contatos com o mesmo telefone'],
  ['agenda-pedido-registro', "return iguais.length === 1 ? iguais[0] : undefined;", "return iguais[0];", 'pedido pega o primeiro agendamento do dia'],
  ['agenda-pedido-registro', "if (iguais.length !== 1) return undefined;", "if (iguais.length < 1) return undefined;", 'conciliar escolhe entre vários'],
  ['agenda-pedido-registro', "etapaDoPedido(pedido) === 'descheduled') return undefined;", "false) return undefined;", 'pedido desagendado ainda concilia'],
  ['agenda-pedido-registro', "pedido.note === NOTA_DE_EXEMPLO ? { note: '' }", "pedido.note === NOTA_DE_EXEMPLO ? { note: pedido.note }", 'nota de exemplo mantida'],
  ['agenda-pedido-fila', "if (p.beforeAgendaId && indice.has(`agenda:${p.beforeAgendaId}`)) return indice.get(`agenda:${p.beforeAgendaId}`);", "if (p.afterAgendaId && indice.has(`agenda:${p.afterAgendaId}`)) return indice.get(`agenda:${p.afterAgendaId}`) + 1;", 'âncora de trás vence a da frente'],
  ['agenda-pedido-fila', "(de < para ? 1 : 0)", "0", 'mover para baixo sem o ajuste'],
  ['agenda-pedido-contato', "['asked', 'confirmed'].includes(etapaDoPedido(pedido));", "['ask', 'asked', 'confirmed'].includes(etapaDoPedido(pedido));", 'confirmar sem perguntar'],
  ['agenda-pedido-contato', "if (situacao && situacao !== 'not_located' && !semIdentidadeLocalizada(pedido))", "if (false)", 'perguntar ao tarólogo sem Não encontrada'],
  ['agenda-pedido-contato', "if (consultas.some((r) => r.agendaItemId && ids.has(r.agendaItemId)))", "if (false)", 'desfazer vínculo com consulta existente'],
  ['agenda-pedido-contato', "Number(t) <= 23) return `${t.padStart(2, '0')}:00`", "Number(t) <= 24) return `${t.padStart(2, '0')}:00`", 'hora 24'],
  ['agenda-aviso-manual', "['Umbler', 'WhatsApp', 'Telefone']", "['Umbler', 'WhatsApp', 'Telefone', 'Email']", 'canal de aviso extra'],
  ['agenda-aviso-manual', "if ((item.manualNotices || []).some((r) => r.id === aviso.id)) return itens;", "", 'aviso repetido duplica'],
  ['agenda-aviso-manual', "aviso.recipientKind !== (item.clientId ? 'client' : 'lead')", "false", 'destinatária de outro tipo'],
  ['agenda-retorno-combinado', "![10, 20, 30].includes(escolha.minutes)", "![10, 20, 30, 15].includes(escolha.minutes)", '15 minutos'],
  ['agenda-retorno-combinado', "minutos(hora) < minutos(inicioDoDia)", "minutos(hora) <= minutos(inicioDoDia)", 'virada do dia no limite'],
  ['agenda-retorno-combinado', "Date.parse(prazo) <= agora", "Date.parse(prazo) < agora", 'retorno no mesmo instante'],
  ['agenda-pronta-presenca', "contato.date === data && contato.tags.includes(etiqueta)", "false", 'Pode agora repetido exige turno de novo'],
  ['agenda-pronta-presenca', "item.tarotId === FILA_GERAL", "false", 'Fila Geral exige turno'],
  ['agenda-pronta-presenca', "!perfil.presenceConfirmedAt && !perfil.shiftAvailableSince", "true", 'perfil antigo online conta como iniciado sem data'],
  ['painel-bloqueio', "if (!ehDeCliente(item)) return", "if (false) return", 'contato pode receber consulta'],
];
for (const [arq, de, para, nome] of MUT) {
  if (!nome) continue;
  passo(`mutante refutado: ${nome}`, () => {
    const d = primeiraDivergencia(mutante(arq, de, para));
    assert.ok(d, 'o ouro não pegou o mutante');
  });
}
function comBanco() {
  const banco = pg.nomeBanco('agp');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-agenda', 'filho-pedidos.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) { console.error(e.message || e); codigo = 2; } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_agp_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_agp_* restante).');
  }
  return codigo;
}

const total = ok + falhas.length;
console.log(`\nOffline: ${ok}/${total} verificações ok`);
if (falhas.length) { console.log(`FALHARAM: ${falhas.join(' | ')}`); process.exit(1); }
if (process.argv.includes('--offline')) process.exit(0);
process.exit(comBanco());
