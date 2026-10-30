'use strict';

/**
 * Verificação OFFLINE: o nome de quem registrou (gf_auth_accounts) é preenchido no DTO do repasse como na B,
 * e o model da conta NÃO tem nenhuma coluna de credencial.
 */
const assert = require('assert');
process.env.LEGADO_DB_HOST = process.env.LEGADO_DB_HOST || '127.0.0.1';
process.env.LEGADO_DB_NAME = process.env.LEGADO_DB_NAME || 'verificacao_offline';
process.env.LEGADO_DB_USER = process.env.LEGADO_DB_USER || 'verificacao';
const { iniciarLegado, encerrarLegado } = require('../src/models/legado');
const { contasCitadas, preencherNomes } = require('../src/gestao-fadas/features/repasse/repasse.service');

const { models } = iniciarLegado();
const cols = Object.keys(models.GfAuthAccounts.rawAttributes);
for (const proibida of ['password_hash', 'credential_version', 'bootstrap_key']) assert.ok(!cols.includes(proibida), `${proibida} não pode estar no model`);
assert.ok(cols.includes('id') && cols.includes('display_name'));
assert.strictEqual(models.GfAuthAccounts.options.somenteLeitura, true);

const dto = { commission: { history: [{ by: { accountId: 'a1', displayName: null } }], current: null }, draft: { enteredBy: { accountId: 'a2', displayName: null }, confirmedBy: null, resolved: [{ resolvedBy: { accountId: 'a1', displayName: null } }, { resolvedBy: null }] } };
assert.deepStrictEqual([...contasCitadas(dto, new Set())].sort(), ['a1', 'a2']);
preencherNomes(dto, new Map([['a1', 'Ana'], ['a2', 'Bia']]));
assert.strictEqual(dto.commission.history[0].by.displayName, 'Ana');
assert.strictEqual(dto.draft.enteredBy.displayName, 'Bia');
assert.strictEqual(dto.draft.resolved[0].resolvedBy.displayName, 'Ana');
assert.strictEqual(dto.draft.confirmedBy, null);
const semConta = { by: { accountId: 'x9', displayName: 'velho' } };
preencherNomes(semConta, new Map());
assert.strictEqual(semConta.by.displayName, null, 'conta inexistente fica com displayName null');
console.log('  ok  gf_auth_accounts sem credenciais; nomes preenchidos como na B; conta ausente vira null');
encerrarLegado().then(() => { console.log('\nVERIFICAÇÃO OK (nomes de contas).'); process.exit(0); });
