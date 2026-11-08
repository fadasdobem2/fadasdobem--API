'use strict';

/** Esquema do banco NOVO (migração 20261211000000): situação cadastral, nascimento/nomes na cliente nova, unicidade global, mais tempo sem efeito. */

module.exports = async ({ consulta, sequelize, conferir, passo }) => {
  const falha = async (sql, valores) => { try { await sequelize.query(sql, { replacements: valores, logging: false }); return null; } catch (e) { return e.original ? e.original.code : e.name; } };
  console.log('esquema (Postgres novo)');

  await passo('gf_clientes_ext.situacao_cadastral VARCHAR(20) NULL sem default e sem_email BOOLEAN NULL; perfil_pagamento segue separado', async () => {
    const cols = await consulta("SELECT column_name, data_type, character_maximum_length, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'gf_clientes_ext' AND column_name IN ('situacao_cadastral', 'sem_email', 'perfil_pagamento')");
    const c = Object.fromEntries(cols.map((l) => [l.column_name, l]));
    conferir('situacao_cadastral varchar(20) nullable, default NULL', c.situacao_cadastral && c.situacao_cadastral.data_type === 'character varying' && Number(c.situacao_cadastral.character_maximum_length) === 20 && c.situacao_cadastral.is_nullable === 'YES' && c.situacao_cadastral.column_default === null);
    conferir('sem_email boolean nullable', c.sem_email && c.sem_email.data_type === 'boolean' && c.sem_email.is_nullable === 'YES');
    conferir('perfil_pagamento continua uma coluna à parte (Pré/Pós)', Boolean(c.perfil_pagamento));
  });
  await passo('NUNCA backfill: linha de extensão sem situação nasce NULL; domínio barrado pelo CHECK (NULL, dados_pendentes, completo)', async () => {
    await sequelize.query("INSERT INTO gf_clientes_ext (id_cliente, perfil_pagamento, dados, atualizado_por, operation_key) VALUES ('777001', 'Pré-pago', '{}'::jsonb, 'teste', 'op-esq-1')", { logging: false });
    conferir('NULL por padrão', (await consulta("SELECT situacao_cadastral, sem_email FROM gf_clientes_ext WHERE id_cliente = '777001'"))[0].situacao_cadastral === null);
    for (const v of ['dados_pendentes', 'completo']) conferir(`aceita ${v}`, (await falha('UPDATE gf_clientes_ext SET situacao_cadastral = :v WHERE id_cliente = \'777001\'', { v })) === null);
    for (const v of ['pronto', 'Completo', 'Pré-pago', '']) conferir(`recusa "${v}" (23514)`, (await falha('UPDATE gf_clientes_ext SET situacao_cadastral = :v WHERE id_cliente = \'777001\'', { v })) === '23514');
    conferir('migração não preencheu nenhuma linha antiga', (await consulta("SELECT count(*)::int AS n FROM gf_clientes_ext WHERE situacao_cadastral IS NOT NULL AND id_cliente <> '777001'"))[0].n === 0);
  });
  await passo('gf_clientes_novos: nomes vazios e nascimento NULL são aceitos; ID só na faixa nova; texto sem espaço nas pontas', async () => {
    const ins = (id, nome = '', nasc = null, op = `op-${id}`) => falha("INSERT INTO gf_clientes_novos (id_cliente, nome, nome_id, nome2, data_nascimento, criado_por, operation_key) VALUES (:id, :nome, '', '', :nasc, 't', :op)", { id, nome, nasc, op });
    conferir('nomes vazios + nascimento NULL: aceito', (await ins('1999999991')) === null);
    conferir('ID do legado (900101) recusado (23514)', (await ins('900101')) === '23514');
    conferir('ID acima do INT (2147483648) recusado', (await ins('2147483648')) === '23514');
    conferir('nome com espaço nas pontas recusado', (await ins('1999999992', ' Ana ')) === '23514');
    conferir('nascimento antes de 1900 recusado', (await ins('1999999993', '', '1850-01-01')) === '23514');
    await sequelize.query("DELETE FROM gf_clientes_novos WHERE id_cliente = '1999999991'", { logging: false }).catch(() => {});
  });
  await passo('sequência de IDs começa na faixa nova (>= 1.000.000.000) e não passa do INT', async () => {
    const [l] = await consulta("SELECT min_value::text AS min, max_value::text AS max FROM pg_sequences WHERE sequencename = 'gf_clientes_novos_id_seq'");
    conferir('faixa', l && l.min === '1000000000' && l.max === '2147483647');
  });
  await passo('gf_lilly_mais_tempo: o CHECK impede alterar duração ou encerrar; um ciclo por consulta e um registro por evento', async () => {
    const base = (id, ciclo, ev, alt = false, enc = false) => falha("INSERT INTO gf_lilly_mais_tempo (id, consulta_id, ciclo, id_cliente, id_tarologo, solicitado_em, source_event_id, rotulo, altera_duracao, encerra_consulta) VALUES (:id, 'C-ESQ', :ciclo, '900101', 'osiris', now(), :ev, 'Pediu mais tempo', :alt, :enc)", { id, ciclo, ev, alt, enc });
    conferir('altera_duracao=true recusado (23514)', (await base('MT-e1', 1, 'ev-e1', true)) === '23514');
    conferir('encerra_consulta=true recusado (23514)', (await base('MT-e2', 1, 'ev-e2', false, true)) === '23514');
    conferir('ciclo 1 aceito', (await base('MT-e3', 1, 'ev-e3')) === null);
    conferir('mesmo ciclo da mesma consulta recusado (23505)', (await base('MT-e4', 1, 'ev-e4')) === '23505');
    conferir('mesmo evento recusado (23505)', (await base('MT-e5', 2, 'ev-e3')) === '23505');
  });
  await passo('unicidade GLOBAL da referência do provedor no banco: reference, mp_payment_id e end_to_end_id, sem caixa, em qualquer cadastro', async () => {
    const ref = (p, col, v) => falha(`INSERT INTO gf_lilly_pagamento_refs (payment_id, ${col}) VALUES (:p, :v)`, { p, v });
    conferir('primeira referência aceita', (await ref('PG-u1', 'mp_payment_id', 'MPX-1')) === null);
    conferir('mesmo mp_payment_id, outro pagamento: 23505', (await ref('PG-u2', 'mp_payment_id', 'MPX-1')) === '23505');
    conferir('mesmo mp_payment_id com outra caixa: 23505', (await ref('PG-u3', 'mp_payment_id', 'mpx-1')) === '23505');
    conferir('end_to_end_id repetido: 23505', (await ref('PG-u4', 'end_to_end_id', 'E2E-1')) === null && (await ref('PG-u5', 'end_to_end_id', 'e2e-1')) === '23505');
    conferir('reference repetida: 23505', (await ref('PG-u6', 'reference', 'REFX-1')) === null && (await ref('PG-u7', 'reference', 'refx-1')) === '23505');
  });
};
