'use strict';

/**
 * Legado FALSO em memória para o filho do espelho: interpreta o SQL EXATO da allowlist (`legado-escrita/sql.js`), então o
 * `consultas.js` de verdade (inserir, atualizar, buscarCandidatas, resolverTarologo) roda sobre ele. `emTransacao` confirma ao
 * terminar e desfaz (snapshot) se o trabalho lançar, como o MySQL InnoDB. Nada aqui abre conexão com banco algum.
 */

const sql = require('../../src/gestao-fadas/legado-escrita/sql');

function criar() {
  const estado = { linhas: [], proximo: 100, tarologos: { osiris: 11, nyx: 12 }, falharInsert: null, inserts: 0 };
  const ex = {
    execute: async (q, v) => {
      if (q === sql.SELECT_TAROLOGO) { const id = estado.tarologos[v[0]]; return [id ? [{ idTarologo: id }] : []]; }
      if (q === sql.INSERT_CONSULTA) {
        if (estado.falharInsert) { const e = new Error('conexão caiu antes do INSERT'); e.codigo = 'ECONN'; throw e; }
        const linha = { idConsulta: (estado.proximo += 1) }; sql.COLUNAS_INSERT.forEach((c, i) => { linha[c] = v[i]; });
        estado.linhas.push(linha); estado.inserts += 1; return [{ insertId: linha.idConsulta, affectedRows: 1 }];
      }
      if (q === sql.SELECT_CANDIDATAS) return [estado.linhas.filter((l) => l.idUsuario === v[0] && l.idTarologo === v[1] && l.dtConsulta === v[2] && l.iniConsulta === v[3]).slice(0, 5).map((l) => ({ idConsulta: l.idConsulta }))];
      if (q === sql.UPDATE_CONSULTA) {
        const n = sql.COLUNAS_UPDATE.length; const linha = estado.linhas.find((l) => l.idConsulta === v[n + 1] && l.idUsuario === v[n + 2]);
        if (!linha) return [{ affectedRows: 0 }];
        sql.COLUNAS_UPDATE.forEach((c, i) => { linha[c] = v[i]; }); if (v[n] !== null) linha.valor_consulta = v[n];
        return [{ affectedRows: 1 }];
      }
      throw new Error(`o legado falso não conhece: ${q.slice(0, 60)}`);
    },
  };
  const emTransacao = async (trabalho) => {
    const copia = JSON.parse(JSON.stringify(estado.linhas));
    try { return await trabalho(ex); } catch (e) { estado.linhas = copia; throw e; }
  };
  return { estado, emTransacao };
}

module.exports = { criar };
