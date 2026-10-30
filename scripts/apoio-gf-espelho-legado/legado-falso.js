'use strict';

/**
 * Legado FALSO em memória (`usuarios` e `tbl_tarologos`) para o filho do espelho das entidades: interpreta o SQL EXATO da allowlist
 * (`legado-escrita/sql.entidades.js`), então `clientes.js` e `tarologos.js` de verdade rodam sobre ele. `emTransacao` confirma ao terminar e
 * desfaz (snapshot) se o trabalho lançar. Conta cada UPDATE. Nada aqui abre conexão com banco algum.
 */

const se = require('../../src/gestao-fadas/legado-escrita/sql.entidades');

const reverso = (mapa) => new Map([...mapa].map(([k, v]) => [v, k.split(',')]));
const UPD_CLIENTE = reverso(se.UPDATES_CLIENTE);
const UPD_TAROLOGO = reverso(se.UPDATES_TAROLOGO);

function criar() {
  const estado = {
    usuarios: new Map([
      [900013, { id: 900013, nivel: 0, nome_id: 'Cliente Ficção 0013', nome2: '', whats: null, datanascimento: '1972-01-13 00:00:00', horanascimento: '1972-01-13 12:24:00', cpf: '000', saldo: '0.00' }],
      [900014, { id: 900014, nivel: 0, nome_id: 'Cliente Ficção 0014', nome2: 'Dona', whats: '+55 00 91111-0000', datanascimento: '1973-02-14 00:00:00', horanascimento: '1973-02-14 13:31:00', cpf: '111', saldo: '14.81' }],
      [990002, { id: 990002, nivel: 2, nome_id: 'Equipe Ficção Atendente', nome2: '', whats: '+55 00 98888-0122', datanascimento: '0000-00-00 00:00:00', horanascimento: '0000-00-00 00:00:00', cpf: '', saldo: '0.00' }],
    ]),
    tarologos: new Map([
      [9001, { idTarologo: 9001, ativo: 1, nmuTarologo: 'Tarólogo Fictício A', nmcTarologo: 'osiris', vlCartao: '0.60', status: 1 }],
      [9002, { idTarologo: 9002, ativo: 1, nmuTarologo: 'Tarólogo Fictício B', nmcTarologo: 'nyx', vlCartao: '0.60', status: 1 }],
    ]),
    falhar: null, updates: 0, escritasPorTexto: [],
  };
  const ex = {
    execute: async (q, v) => {
      if (q === se.SELECT_CLIENTE) { const l = estado.usuarios.get(v[0]); return [l && l.nivel === 0 ? [{ id: l.id, nome_id: l.nome_id, nome2: l.nome2, whats: l.whats, datanascimento: l.datanascimento }] : []]; }
      if (q === se.SELECT_TAROLOGO_ID) { const l = estado.tarologos.get(v[0]); return [l ? [{ idTarologo: l.idTarologo, nmuTarologo: l.nmuTarologo, ativo: l.ativo }] : []]; }
      if (UPD_CLIENTE.has(q) || UPD_TAROLOGO.has(q)) {
        if (estado.falhar) { const e = new Error('conexão caiu'); e.codigo = 'ECONN'; throw e; }
        const cliente = UPD_CLIENTE.has(q); const colunas = cliente ? UPD_CLIENTE.get(q) : UPD_TAROLOGO.get(q);
        const linha = (cliente ? estado.usuarios : estado.tarologos).get(v[colunas.length]);
        if (!linha || (cliente && linha.nivel !== 0)) return [{ affectedRows: 0 }];
        colunas.forEach((c, i) => { linha[c] = v[i]; });
        estado.updates += 1; estado.escritasPorTexto.push(q);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`o legado falso não conhece: ${q.slice(0, 70)}`);
    },
  };
  const copiar = () => ({ u: [...estado.usuarios].map(([k, v]) => [k, { ...v }]), t: [...estado.tarologos].map(([k, v]) => [k, { ...v }]) });
  const emTransacao = async (trabalho) => {
    const foto = copiar();
    try { return await trabalho(ex); } catch (e) {
      // Desfaz NO LUGAR (quem guardou a referência dos mapas continua enxergando o legado).
      estado.usuarios.clear(); foto.u.forEach(([k, v]) => estado.usuarios.set(k, v)); estado.tarologos.clear(); foto.t.forEach(([k, v]) => estado.tarologos.set(k, v));
      throw e;
    }
  };
  return { estado, emTransacao };
}

module.exports = { criar };
