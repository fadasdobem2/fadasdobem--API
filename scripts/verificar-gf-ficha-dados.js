'use strict';

/**
 * Verificação dos DADOS DA FICHA no banco novo (Nice, 08/11): nome completo, CPF, e-mail, telefones e endereço gravados em gf_clientes_ext pelo
 * mesmo caminho do editor (PATCH /catalog/clients/:id), mais a regra Pré/Pós (só Pós -> Pré, definitivo).
 *   1) OFFLINE (sempre): validação igual ao OURO do front (scripts/apoio-gf-ficha-dados/ouro.json, gerado por gerar-ouro-gf-ficha-dados.js rodando o
 *      caminho real do editor), leitura combinada (complemento vence, vazio nunca apaga, recorte por perfil), regra do regime; mutantes refutados.
 *   2) POSTGRES DESCARTÁVEL (sem `--offline`): fdb_ficha_<aleatório>, migra por run-migrations e roda scripts/apoio-gf-ficha-dados/filho.js (HTTP do gate,
 *      CHECKs, idempotência, atomicidade, perfis, auditoria sem CPF, Lilly não apaga a ficha). O legado MySQL nem é configurado. Apaga o banco no fim.
 *   npm run verificar:gf-ficha-dados            node scripts/verificar-gf-ficha-dados.js --offline
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const r = (p) => require(path.join(raiz, p));
const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-ficha-dados', 'ouro.json'), 'utf8'));
let ok = 0;
const falhas = [];
function passo(nome, fn) {
  try { fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 300)}`); }
}

const FICHA = ['fullName', 'cpf', 'email', 'email2', 'workPhone', 'phones', 'consultationPhoneIndex', 'whatsappPhoneIndex', 'address'];
const so = (obj, chaves) => Object.fromEntries(Object.entries(obj).filter(([k]) => chaves.includes(k)));
const iguais = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch (_) { return false; } };
const tenta = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e.message }; } };

/** Confere uma implementação de validarFicha contra o ouro; devolve as divergências (vazio = igual ao front). */
function paridade(validar) {
  const difs = [];
  const grupos = [['cpf', ouro.cpf, ['cpf'], (v) => ({ cpf: v })], ['email', ouro.email, ['email'], (v) => ({ email: v })],
    ['email2', ouro.email2, ['email2'], (v) => ({ email2: v })], ['comercial', ouro.comercial, ['workPhone'], (v) => ({ workPhone: v })], ['nome', ouro.nome, ['fullName'], (v) => ({ fullName: v })],
    ['fones', ouro.fones, ['phones', 'consultationPhoneIndex', 'whatsappPhoneIndex'], (v) => v], ['endereco', ouro.endereco, ['address'], (v) => ({ address: v })]];
  for (const [nome, casos, chaves, bruto] of grupos) {
    for (const c of casos) {
      if (c.front.erro) {
        // O front recusou: a API recusa o mesmo valor bruto com a MESMA mensagem (menos os índices, que o editor refaz antes de enviar).
        if (nome === 'fones' && c.v.phones.some((p) => p === '')) continue;
        const a = tenta(() => validar(bruto(c.v)));
        if (a.erro !== c.front.erro) difs.push(`${nome} ${JSON.stringify(c.v).slice(0, 40)}: front "${c.front.erro}" API ${a.erro ? `"${a.erro}"` : 'aceitou'}`);
      } else {
        // O front aceitou: a API aceita o que o editor entrega (já normalizado) e devolve o mesmo.
        const entregue = so(c.front.ok, chaves);
        if (nome === 'endereco' && Object.values(entregue.address).every((v) => !v)) continue; // vazio: recusa deliberada (ver abaixo)
        const a = tenta(() => validar(entregue));
        if (a.erro || !iguais(a.ok, entregue)) difs.push(`${nome} ${JSON.stringify(c.v).slice(0, 40)}: front aceitou ${JSON.stringify(entregue).slice(0, 80)} API ${a.erro || JSON.stringify(a.ok).slice(0, 80)}`);
      }
    }
  }
  return difs;
}

/** Conferências da API além do que o editor entrega (ele refaz os índices e apara antes de enviar): valor cru no PATCH. */
function extras(validar) {
  const difs = [];
  const fone = '+55 11 98888-7777';
  const quer = (nome, a, b) => { if (!iguais(a, b)) difs.push(`${nome}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
  quer('índice fora da lista', tenta(() => validar({ phones: [fone], consultationPhoneIndex: 5 })).erro, 'Escolha o telefone de consultas e o WhatsApp entre os números informados.');
  quer('índice negativo', tenta(() => validar({ phones: [fone], whatsappPhoneIndex: -1 })).erro, 'Escolha o telefone de consultas e o WhatsApp entre os números informados.');
  quer('índice fracionário', tenta(() => validar({ phones: [fone], whatsappPhoneIndex: 1.5 })).erro, 'Escolha o telefone de consultas e o WhatsApp entre os números informados.');
  quer('e-mail aparado', tenta(() => validar({ email: '  a@b.com ' })).ok, { email: 'a@b.com' });
  quer('e-mail 2 aparado', tenta(() => validar({ email2: '  o@b.com ' })).ok, { email2: 'o@b.com' });
  quer('telefone comercial aparado', tenta(() => validar({ workPhone: ' +55 11 3333-4444 ' })).ok, { workPhone: '+55 11 3333-4444' });
  quer('e-mail 2 e comercial juntos', tenta(() => validar({ email2: 'o@b.com', workPhone: '3333-4444' })).ok, { email2: 'o@b.com', workPhone: '3333-4444' });
  quer('nome aparado', tenta(() => validar({ fullName: '  Ana Souza ' })).ok, { fullName: 'Ana Souza' });
  quer('índices padrão 0', tenta(() => validar({ phones: [fone] })).ok, { phones: [fone], consultationPhoneIndex: 0, whatsappPhoneIndex: 0 });
  return difs;
}

function offline() {
  const val = r('src/gestao-fadas/_comum/dominio/cliente-ficha-validacao');
  const efetivo = r('src/gestao-fadas/_comum/dominio/cliente-ficha-efetivo');
  const regime = r('src/gestao-fadas/_comum/dominio/cliente-regime');
  const cli = r('src/gestao-fadas/features/cadastros/clientes.validacao');

  console.log('Validação igual ao front (ouro: caminho real do editor)');
  passo(`${ouro.cpf.length + ouro.email.length + ouro.email2.length + ouro.comercial.length + ouro.nome.length + ouro.fones.length + ouro.endereco.length} casos de CPF, e-mail, e-mail 2, telefone comercial, nome, telefones e endereço: mesma resposta e mesma mensagem do front`, () => {
    const d = paridade(val.validarFicha);
    assert.deepStrictEqual(d, [], d.join('\n'));
  });
  passo('valor cru no PATCH (o editor refaz índices e apara antes de enviar, a API confere de novo): índices fora da lista recusados, texto aparado, índices padrão 0', () => {
    const d = extras(val.validarFicha);
    assert.deepStrictEqual(d, [], d.join('\n'));
  });
  passo('o vazio nunca apaga: a API recusa limpar nome completo, CPF, e-mail e endereço (o front deixaria) e não grava nada por omissão', () => {
    for (const [campo, valor, msg] of [['cpf', '', /CPF não pode ser apagado/], ['email', '  ', /e-mail não pode ser apagado/], ['fullName', '', /Informe o nome completo/], ['email2', ' ', /outro e-mail não pode ser apagado/], ['workPhone', '', /telefone comercial não pode ser apagado/],
      ['address', { street: '', number: '', complement: '', district: '', zip: '', city: '', state: '', country: '' }, /endereço não pode ser apagado/]]) {
      assert.match(tenta(() => val.validarFicha({ [campo]: valor })).erro || '', msg, campo);
    }
    assert.deepStrictEqual(val.validarFicha({ treatAs: 'x' }), {}, 'campo ausente = nada a gravar');
  });
  passo('o formato do PATCH: nada aceito fora da lista, telefone sem lista nem índice solto, máximo de 20 telefones', () => {
    assert.match(tenta(() => val.validarFicha({ consultationPhoneIndex: 0 })).erro, /números escolhidos/);
    assert.match(tenta(() => val.validarFicha({ phones: Array(21).fill('+55 11 98888-7777') })).erro, /no máximo 20/);
    assert.match(tenta(() => val.validarFicha({ phones: 'x' })).erro, /Informe um número de telefone/);
    assert.match(tenta(() => val.validarFicha({ phones: ['+55 11 98888-7777'], consultationPhoneIndex: 1 })).erro, /entre os números informados/);
    for (const mau of [null, 7, [], {}]) for (const campo of ['cpf', 'email2', 'workPhone']) assert.ok(tenta(() => val.validarFicha({ [campo]: mau })).erro, `${campo} ${JSON.stringify(mau)}`);
  });
  passo('validarMudancas (PATCH): junta identidade e ficha com as mensagens 422 do front; só ficha também é uma alteração', () => {
    const m = cli.validarMudancas({ email: ' a@b.com ', cpf: '529.982.247-25', name: 'Ana' });
    assert.deepStrictEqual(m, { name: 'Ana', email: 'a@b.com', cpf: '529.982.247-25', noEmail: false }); // v711: informar e-mail desfaz o "não possui e-mail"
    assert.deepStrictEqual(cli.validarMudancas({ noEmail: true }), { noEmail: true });
    assert.deepStrictEqual(cli.validarMudancas({ noEmail: true, email: 'a@b.com' }), { email: 'a@b.com', noEmail: false });
    assert.throws(() => cli.validarMudancas({ noEmail: 'sim' }), (e) => e.message === 'Confira a informação de e-mail.');
    const ficha = require('../src/gestao-fadas/features/cadastros/clientes.ficha');
    assert.deepStrictEqual(ficha.colunasDaFicha({ noEmail: true }), [['sem_email', true], ['email', null]]);
    assert.deepStrictEqual(ficha.colunasDaFicha({ noEmail: false }), [['sem_email', false]]);
    assert.throws(() => cli.validarMudancas({ email: 'x' }), (e) => e.message === 'Confira o e-mail: nome@dominio.com.');
    assert.throws(() => cli.validarMudancas({}), (e) => /Nenhuma alteração/.test(e.message));
  });

  console.log('Mutantes da validação refutados');
  const real = val.validarFicha;
  const digitos11 = (v) => typeof v === 'string' && /^\d{11}$/.test(v.replace(/\D/g, ''));
  const mutantes = {
    'CPF aceita qualquer 11 dígitos': (m) => (m.cpf !== undefined && digitos11(m.cpf) ? { cpf: m.cpf.trim() } : real(m)),
    'e-mail aceita "a@b"': (m) => (m.email === 'a@b' ? { email: 'a@b' } : real(m)),
    'e-mail sem limite de 50': (m) => (typeof m.email === 'string' && m.email.length > 50 && /^x+@b\.com$/.test(m.email) ? { email: m.email } : real(m)),
    'telefone sem DDD aceito': (m) => (m.phones && m.phones.length === 1 && /^98888-7777$|^\+55 98888-7777$/.test(m.phones[0]) ? { phones: m.phones, consultationPhoneIndex: 0, whatsappPhoneIndex: 0 } : real(m)),
    'índice de telefone fora da lista aceito': (m) => (m.phones && m.consultationPhoneIndex === 5 ? { phones: m.phones, consultationPhoneIndex: 5, whatsappPhoneIndex: 0 } : real(m)),
    'CEP não conferido': (m) => (m.address && m.address.zip === '5000-000' ? { address: { ...m.address } } : real(m)),
    'UF não vira maiúscula': (m) => { const v = real(m); return v.address && v.address.state ? { ...v, address: { ...v.address, state: v.address.state.toLowerCase() } } : v; },
    'nome com mais de 255 aceito': (m) => (typeof m.fullName === 'string' && m.fullName.length === 256 ? { fullName: m.fullName } : real(m)),
    'texto não aparado': (m) => (typeof m.email === 'string' && m.email.startsWith(' ') ? { email: m.email } : real(m)),
    'e-mail 2 com limite de 50': (m) => { if (typeof m.email2 === 'string' && m.email2.trim().length > 50) throw new Error('E-mail: use no máximo 50 caracteres. O texto não foi cortado.'); return real(m); },
    'e-mail 2 aceita "a@b"': (m) => (m.email2 === 'a@b' ? { email2: 'a@b' } : real(m)),
    'telefone comercial passa de 50': (m) => (typeof m.workPhone === 'string' && m.workPhone.length === 51 ? { workPhone: m.workPhone } : real(m)),
    'telefone comercial vira só dígitos': (m) => { const v = real(m); return v.workPhone ? { ...v, workPhone: v.workPhone.replace(/\D/g, '') } : v; },
    'vazio apaga o e-mail 2': (m) => (typeof m.email2 === 'string' && !m.email2.trim() ? { email2: '' } : real(m)),
    'vazio apaga o CPF': (m) => (m.cpf === '' ? { cpf: '' } : real(m)),
  };
  for (const [nome, mut] of Object.entries(mutantes)) {
    passo(`mutante refutado: ${nome}`, () => {
      const casosCrus = [{ cpf: '' }, { email: 'a@b' }, { email: 'x'.repeat(45) + '@b.com' }, { email2: '' }, { workPhone: '' }];
      const pegou = paridade(mut).length > 0 || extras(mut).length > 0 || (nome === 'vazio apaga o CPF' && !tenta(() => mut({ cpf: '' })).erro);
      assert.ok(pegou || casosCrus.some((e) => tenta(() => mut(e)).erro !== tenta(() => real(e)).erro), 'o ouro não pegou o mutante');
    });
  }

  console.log('Leitura combinada: complemento vence, vazio nunca apaga');
  const linhaExt = { nome_completo: 'Ana Gravada', cpf: '529.982.247-25', email: 'g@x.com', email2: 'g2@x.com', telefone_comercial: '+55 11 3333-4444', telefones: ['+55 11 98888-7777', '+55 21 93333-4444'], telefone_consulta_idx: 1, telefone_whatsapp_idx: 0,
    end_rua: 'Rua B', end_numero: '2', end_complemento: null, end_bairro: null, end_cep: '50000-000', end_cidade: 'Olinda', end_uf: 'PE', end_pais: null, dados: { email: 'lilly@x.com', fullName: 'Nome Lilly' } };
  const legado = { id: 7, nivel: 0, nome: 'Ana Antiga', nome_id: 'Ana', nome2: 'Ani', email: 'antigo@x.com', email2: 'antigo2@x.com', cpf: '11144477735', endereco: 'Rua A', numero: '1', complemento: 'Apto', bairro: 'Centro', cep: '40000-000', cidade: 'Recife', estado: 'PE', idPais: 1, datanascimento: '1990-05-17 00:00:00' };
  passo('com a ficha preenchida: nome completo, CPF, e-mail e endereço vêm do complemento; a coluna da ficha vence os dados da Lilly', () => {
    const f = efetivo.fichaDeLinha(linhaExt);
    assert.deepStrictEqual([f.fullName, f.cpf, f.email, f.consultationPhoneIndex, f.whatsappPhoneIndex], ['Ana Gravada', '529.982.247-25', 'g@x.com', 1, 0]);
    const l = efetivo.sobreporFicha(legado, f);
    assert.deepStrictEqual([l.nome, l.cpf, l.email, l.endereco, l.numero, l.complemento, l.bairro, l.cep, l.cidade, l.estado], ['Ana Gravada', '529.982.247-25', 'g@x.com', 'Rua B', '2', null, null, '50000-000', 'Olinda', 'PE']);
    assert.strictEqual(l.idPais, 1, 'o país do catálogo do legado não é tocado');
    assert.strictEqual(legado.nome, 'Ana Antiga', 'o legado não é alterado (cópia)');
  });
  passo('e-mail 2 e telefone comercial: o complemento vence o legado (e-mail 2 sobre a linha; o comercial sai na ficha), vazio ou só espaços nunca apaga', () => {
    const f = efetivo.fichaDeLinha(linhaExt);
    assert.deepStrictEqual([f.email2, f.workPhone], ['g2@x.com', '+55 11 3333-4444']);
    assert.strictEqual(efetivo.sobreporFicha(legado, f).email2, 'g2@x.com');
    assert.strictEqual(legado.email2, 'antigo2@x.com', 'o legado não é alterado (cópia)');
    for (const vazio of [null, '', '   ']) {
      const v = efetivo.fichaDeLinha({ email2: vazio, telefone_comercial: vazio, dados: {} });
      assert.deepStrictEqual(v, {}, `vazio ${JSON.stringify(vazio)} não entra na ficha`);
      assert.strictEqual(efetivo.sobreporFicha(legado, v).email2, 'antigo2@x.com', 'o e-mail 2 do legado fica');
    }
    assert.deepStrictEqual(efetivo.fichaDeLinha({ email2: 'so@x.com', dados: {} }), { email2: 'so@x.com' });
  });
  passo('colunas gravadas pelo PATCH: email2 e telefone_comercial só quando enviados; campo ausente = coluna intocada', () => {
    const ficha = require('../src/gestao-fadas/features/cadastros/clientes.ficha');
    assert.deepStrictEqual(ficha.colunasDaFicha({ email2: 'o@b.com', workPhone: '3333-4444' }), [['email2', 'o@b.com'], ['telefone_comercial', '3333-4444']]);
    assert.deepStrictEqual(ficha.colunasDaFicha({ email: 'a@b.com' }), [['email', 'a@b.com']]);
    assert.deepStrictEqual(ficha.camposDaFicha({ email2: 'o@b.com', workPhone: 'x' }), ['email2', 'workPhone']);
    const m = cli.validarMudancas({ email2: ' o@b.com ', workPhone: ' 3333-4444 ' });
    assert.deepStrictEqual(m, { email2: 'o@b.com', workPhone: '3333-4444' });
    assert.ok(!('noEmail' in m), 'informar só o e-mail 2 não mexe em "não possui e-mail"');
  });
  passo('o nascimento já é gravado pela identidade (dados.birthDate, validação do legado-escrita do front): não ganhou coluna nova', () => {
    assert.deepStrictEqual(cli.validarMudancas({ birthDate: '17/05/1990' }), { birthDate: '17/05/1990' });
    assert.throws(() => cli.validarMudancas({ birthDate: '' }), (e) => /não pode ser apagada/.test(e.message));
    assert.deepStrictEqual(cli.aplicar(null, { birthDate: '17/05/1990' }, '2026-11-09T00:00:00Z').dados, { birthDate: '17/05/1990' });
  });
  passo('com a ficha vazia: nada do legado é apagado; só os dados da Lilly (e-mail e nome) entram, e vazio da Lilly não apaga', () => {
    const vazia = { nome_completo: null, cpf: null, email: null, email2: null, telefone_comercial: null, telefones: null, end_rua: null, dados: {} };
    assert.deepStrictEqual(efetivo.fichaDeLinha(vazia), {});
    assert.deepStrictEqual(efetivo.sobreporFicha(legado, efetivo.fichaDeLinha(vazia)), legado);
    const lilly = efetivo.sobreporFicha(legado, efetivo.fichaDeLinha({ dados: { email: 'lilly@x.com', fullName: 'Nome Lilly' } }));
    assert.deepStrictEqual([lilly.email, lilly.nome, lilly.cpf], ['lilly@x.com', 'Nome Lilly', '11144477735']);
    assert.deepStrictEqual(efetivo.sobreporFicha(legado, efetivo.fichaDeLinha({ dados: { email: '', fullName: '  ' } })), legado, 'sem e-mail declarado (vazio) não apaga o do legado');
  });
  passo('o endereço é uma unidade: com qualquer parte no complemento, vale o complemento inteiro (parte vazia fica vazia)', () => {
    const so1 = efetivo.sobreporFicha(legado, efetivo.fichaDeLinha({ end_cidade: 'Olinda', dados: {} }));
    assert.deepStrictEqual([so1.cidade, so1.endereco, so1.cep, so1.complemento], ['Olinda', null, null, null]);
  });
  passo('recorte por perfil igual ao da ficha do legado: sem identidade civil não há nome completo nem CPF; sem cadastro completo não há telefones nem endereço', () => {
    const f = efetivo.fichaDeLinha(linhaExt);
    assert.deepStrictEqual(Object.keys(efetivo.recortarPorPerfil(f, { civil: true, completo: false })).filter((k) => /email2|workPhone/.test(k)), [], 'o atendente não lê e-mail 2 nem telefone comercial');
    const adm = efetivo.recortarPorPerfil(f, { civil: true, completo: true });
    const aten = efetivo.recortarPorPerfil(f, { civil: true, completo: false });
    const nada = efetivo.recortarPorPerfil(f, { civil: false, completo: false });
    assert.deepStrictEqual(Object.keys(adm).sort(), FICHA.slice().sort());
    assert.deepStrictEqual(Object.keys(aten).sort(), ['cpf', 'email', 'fullName']);
    assert.deepStrictEqual(Object.keys(nada), ['email']);
    const perfis = r('src/gestao-fadas/features/clientes/helpers/perfis');
    assert.deepStrictEqual(['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'].map((p) => [perfis.canViewCivilIdentity(p), perfis.canViewFullRegistration(p)]),
      [[true, true], [true, true], [true, false], [true, false], [false, false]]);
  });
  passo('a ficha lida pelo model do Clientes: o perfil (administradora) mostra o complemento; o do atendente não vê endereço', () => {
    const model = r('src/gestao-fadas/features/clientes/clientes.model');
    const linha = efetivo.sobreporFicha(legado, efetivo.fichaDeLinha(linhaExt));
    const perfil = (role) => model.projectProfile(model.readRealClientRow(linha), role);
    const adm = perfil('administradora');
    assert.deepStrictEqual([adm.fullName, adm.cpf, adm.email, adm.address.street, adm.address.city], ['Ana Gravada', '529.982.247-25', 'g@x.com', 'Rua B', 'Olinda']);
    const aten = perfil('atendente');
    assert.deepStrictEqual([aten.fullName, aten.email, aten.address], ['Ana Gravada', 'g@x.com', undefined]);
  });
  const leitura = { ...mutantesLeitura(efetivo) };
  for (const [nome, impl] of Object.entries(leitura)) {
    passo(`mutante refutado: ${nome}`, () => {
      const f = impl.fichaDeLinha(linhaExt);
      const l = impl.sobreporFicha(legado, impl.fichaDeLinha({ nome_completo: null, cpf: null, email: null, dados: {} }));
      const quebrou = !(f.email === 'g@x.com' && f.fullName === 'Ana Gravada') || JSON.stringify(l) !== JSON.stringify(legado)
        || impl.sobreporFicha(legado, impl.fichaDeLinha(linhaExt)).email !== 'g@x.com' || impl.sobreporFicha(legado, impl.fichaDeLinha({ end_cidade: 'Olinda', dados: {} })).endereco !== null
        || JSON.stringify(impl.recortarPorPerfil(f, { civil: true, completo: false })) !== JSON.stringify({ fullName: 'Ana Gravada', cpf: '529.982.247-25', email: 'g@x.com' });
      assert.ok(quebrou, 'a conferência não pegou o mutante');
    });
  }

  console.log('Pré/Pós: só Pós -> Pré, definitivo');
  // v711 (assertClientPaymentTransition do front): o único destino novo é Pré; sem regime NÃO vai para Pós e Pós não volta a "não informado".
  const MATRIZ = [['', '', true], ['', 'Pré-pago', true], ['', 'Pós-pago', false], [null, 'Pós-pago', false], [null, '', true], ['Pós-pago', 'Pós-pago', true], ['Pós-pago', 'Pré-pago', true], ['Pós-pago', '', false],
    ['Pré-pago', 'Pré-pago', true], ['Pré-pago', 'Pós-pago', false], ['Pré-pago', '', false], ['Pré-pago', null, false]];
  const sobreRegime = (fn) => MATRIZ.filter(([de, para, esperado]) => fn(de, para) !== esperado);
  passo('tabela de transições: Pós -> Pré vale; Pré -> Pós e Pré -> "não informado" são recusados; sem regime aceita qualquer um; repetir é sem efeito', () => {
    assert.deepStrictEqual(sobreRegime(regime.regimePodeMudar), []);
    assert.match(regime.MENSAGEM, /não volta para Pós/);
  });
  passo('o front aceita os três valores em qualquer sentido (não impõe a regra): a regra de sentido é só da API; valor fora da lista segue "Selecione Pré ou Pós."', () => {
    const aceita = ouro.regime.filter((c) => c.front === 'aceita').map((c) => c.v);
    assert.deepStrictEqual(aceita, ['', 'Pré-pago', 'Pós-pago']);
    for (const c of ouro.regime.filter((x) => x.front !== 'aceita')) {
      assert.strictEqual(c.front, 'Selecione Pré ou Pós.');
      assert.throws(() => cli.validarMudancas({ paymentProfile: c.v }), (e) => e.message === 'Selecione Pré ou Pós.');
    }
    for (const v of aceita) assert.strictEqual(cli.validarMudancas({ paymentProfile: v }).paymentProfile, v || null);
  });
  const mutRegime = {
    'sempre permite': () => true, 'permite Pré -> Pós': (de, para) => !(de === 'Pré-pago' && para === '') ,
    'proíbe Pós -> Pré': (de, para) => regime.regimePodeMudar(de, para) && !(de === 'Pós-pago' && para === 'Pré-pago'),
    'proíbe repetir o mesmo': (de, para) => regime.regimePodeMudar(de, para) && de !== para,
    'permite apagar o Pré': (de, para) => regime.regimePodeMudar(de, para) || (de === 'Pré-pago' && para === ''),
    'proíbe cadastro sem regime': (de, para) => regime.regimePodeMudar(de, para) && !!de,
  };
  for (const [nome, mut] of Object.entries(mutRegime)) passo(`mutante refutado: regime ${nome}`, () => assert.ok(sobreRegime(mut).length > 0));
  passo('nenhum outro lugar da API grava o regime: só o PATCH da ficha e o cadastro novo da Lilly (que só põe Pré em quem não tem)', () => {
    const arquivos = execFileSync('grep', ['-rlE', 'SET perfil_pagamento|perfil_pagamento = \\?', path.join(raiz, 'src')], { encoding: 'utf8' }).trim().split('\n').map((p) => path.relative(raiz, p)).filter((p) => !/consultas-ciclo|novo\/models/.test(p)).sort();
    assert.deepStrictEqual(arquivos, ['src/gestao-fadas/features/cadastros/clientes.service.js']);
  });
}

/** Cópias da leitura combinada com um defeito cada (para provar que a conferência pega). */
function mutantesLeitura(ef) {
  const igual = { ...ef };
  return {
    'o legado vence o complemento': { ...igual, sobreporFicha: (l, f) => ({ ...f.address ? l : l, ...Object.fromEntries(Object.entries(ef.sobreporFicha({}, f)).filter(([k]) => l[k] === undefined || l[k] === null)) }) },
    'vazio apaga o legado': { ...igual, sobreporFicha: (l, f) => ({ ...ef.sobreporFicha(l, f), email: f.email ?? null }) },
    'endereço parte a parte': { ...igual, sobreporFicha: (l, f) => { const n = ef.sobreporFicha(l, f); if (f.address) { n.endereco = f.address.street ? n.endereco : l.endereco; } return n; } },
    'os dados da Lilly vencem a coluna da ficha': { ...igual, fichaDeLinha: (linha) => { const f = ef.fichaDeLinha(linha); const d = (linha.dados || {}); return d.email ? { ...f, email: d.email } : f; } },
    'sem recorte por perfil': { ...igual, recortarPorPerfil: (f) => ({ ...f }) },
    'atendente vê o endereço': { ...igual, recortarPorPerfil: (f, p) => ef.recortarPorPerfil(f, { ...p, completo: true }) },
  };
}

async function comBanco() {
  const banco = pg.nomeBanco('ficha');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-ficha-dados', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_ficha_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_ficha_* restante).');
  }
  return codigo;
}

(async () => {
  offline();
  console.log(`\nOffline: ${ok} ok, ${falhas.length} falhas`);
  if (falhas.length) process.exit(1);
  if (process.argv.includes('--offline')) process.exit(0);
  process.exit(await comBanco());
})().catch((e) => { console.error(e); process.exit(2); });
