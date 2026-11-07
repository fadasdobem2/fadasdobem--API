'use strict';

/**
 * LEGADO MySQL SIMULADO do verificador do snapshot: listas fixas em memória no lugar de `usuarios`, `tbl_pagtoinformado` e
 * `tbl_pagtoconfirmado` (o MySQL nem é configurado). As linhas trazem de propósito colunas SENSÍVEIS (senha, cpf, e-mail, nascimento) que a
 * leitura real nunca seleciona: se o montador as deixasse passar, a verificação de privacidade pegaria.
 * `usuariosPorTelefone` imita o pré-filtro do SQL: os 8 últimos dígitos de `ddd+telresidencial`, `ddd+telcomercial`, `ddd+cel`, `ddd+cel2` ou `whats`.
 */

const SENSIVEL = { senha: 'SENHA-NAO-PODE-SAIR', cpf: '00000000191', email: 'nao.pode.sair@teste.local', datanascimento: '1990-01-01 00:00:00', endereco: 'Rua Secreta 1' };
const digitos = (v) => `${v ?? ''}`.replace(/\D/g, '');

const usuario = (id, extra) => ({ id, nome_id: `Cliente ${id}`, nome2: '', nome: `Nome Completo ${id}`, ddi: 0, ddd: '11', ddd_real: 11, telresidencial: '', telcomercial: '', cel: '', cel2: '', whats: '', ...SENSIVEL, ...extra });

function criarLegado() {
  const usuarios = [
    usuario(900101, { nome_id: 'Ana', nome2: 'Aninha', cel: '99888-7777' }), // 9 dígitos
    usuario(900102, { nome_id: 'Bia', telresidencial: '3333-4444' }),
    usuario(900103, { nome_id: 'Cris', ddd: '21', ddd_real: 21, cel: '98888-1111' }),
    usuario(900104, { nome_id: 'Duda', cel: '98776666' }), // cadastro SEM o nono dígito (8 dígitos)
    usuario(900105, { nome_id: 'Eva', ddd: '31', ddd_real: 31, cel: '97777-1234' }), // telefone compartilhado
    usuario(900106, { nome_id: 'Flavia', ddd: '31', ddd_real: 31, cel: '97777-1234' }),
    usuario(900107, { nome_id: 'Gabi', cel: '96666-0000' }), // WhatsApp novo só na extensão
    usuario(900108, { nome_id: 'Hana', ddd: '11', ddd_real: 12, cel: '94444-5555' }), // ddd x ddd_real divergentes
    usuario(900109, { nome_id: 'Ivy', whats: '+55 11 93333-2222' }),
  ];
  for (let i = 0; i < 55; i += 1) usuarios.push(usuario(910000 + i, { nome_id: `Massa ${i}`, ddd: '51', ddd_real: 51, cel: '912345678' })); // 55 candidatas ao mesmo telefone
  const pagamentos = { informed: [], confirmed: [] };
  const estado = { falhas: new Set(), chamadas: { porTelefone: 0 } };

  const falhar = (nome) => { if (estado.falhas.has(nome)) throw Object.assign(new Error('legado fora do ar'), { name: 'SequelizeConnectionError', dados: { codigo: 'LEGADO_INDISPONIVEL' } }); };
  const expressoes = (u) => [`${u.ddd}${u.telresidencial}`, `${u.ddd}${u.telcomercial}`, `${u.ddd}${u.cel}`, `${u.ddd}${u.cel2}`, `${u.whats}`].map(digitos);

  const fontes = {
    async usuariosPorTelefone(d8, limite) {
      estado.chamadas.porTelefone += 1; falhar('usuarios');
      return usuarios.filter((u) => expressoes(u).some((e) => e.endsWith(d8))).slice(0, limite + 1);
    },
    async usuariosPorIds(ids) { falhar('usuarios'); const alvo = new Set(ids.map(String)); return usuarios.filter((u) => alvo.has(`${u.id}`)); },
    async pagamentosLegado(ids) {
      falhar('pagamentos');
      const alvo = new Set(ids.map(String));
      return { informed: pagamentos.informed.filter((p) => alvo.has(`${p.idUsuario}`)), confirmed: pagamentos.confirmed.filter((p) => alvo.has(`${p.idUsuario}`)) };
    },
  };
  return { fontes, usuarios, pagamentos, estado };
}

module.exports = { criarLegado, SENSIVEL };
