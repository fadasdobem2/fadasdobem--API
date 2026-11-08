'use strict';

/**
 * FILHO de scripts/verificar-gf-mapeamento-umbler.js: Postgres DESCARTÁVEL (fdb_mup_*) já migrado. O `--aplicar` com o serviço REAL do perfil
 * (`PUT /catalog/tarologists/:tarotId/profile`, aqui chamado direto) grava `directory.umblerContact`; o legado de tarólogos é uma lista fixa (MySQL nem
 * configurado). Confere o que ficou no banco, a auditoria, a revisão, a idempotência e que a Lilly lê o vínculo no catálogo.
 */

const path = require('path');
const assert = require('assert');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true' });
delete process.env.GF_LEGADO_ESCRITA_ENABLED;
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const tarologos = require(r('src/gestao-fadas/features/cadastros/tarologos.service'));
  const { aplicar } = require(r('scripts/apoio-mapear-tarologas-umbler/aplicar'));
  const LEGADO = [{ idTarologo: 10, nmuTarologo: 'Selene', ativo: 1, status: 1, meus_horarios: '' }, { idTarologo: 11, nmuTarologo: 'Aurora', ativo: 1, status: 1, meus_horarios: '' }];
  tarologos.definirFonteLegado({ listar: async () => LEGADO.map((l) => ({ ...l, oraculos: [] })), obter: async (id) => LEGADO.find((l) => l.idTarologo === Number(id)) || null });
  const ator = await criarUsuario('Administradora Umbler');
  const catalogo = () => tarologos.catalogo();

  await passo('o serviço real grava directory.umblerContact; a revisão sobe; o vínculo aparece no catálogo (o que a Lilly lê) e a auditoria registra', async () => {
    const antes = (await catalogo()).find((i) => i.id === '10');
    const res = await aplicar({ itens: [{ aprovar: true, tarotId: '10', revisao: antes.revision, proposta: { contactId: 'ct-selene', conversationId: 'chat-selene' } }], ator, catalogo, gravarPerfil: tarologos.gravarPerfil });
    assert.deepEqual(res, { gravados: ['10'], jaIguais: [], ignorados: [], simulados: [] }, JSON.stringify(res));
    const depois = (await catalogo()).find((i) => i.id === '10');
    assert.deepEqual(depois.directory.umblerContact, { contactId: 'ct-selene', conversationId: 'chat-selene', phone: '' }); // phone vazio é o formato da validação do campo
    assert.equal(depois.revision, antes.revision + 1);
    const [aud] = (await sequelize.query("SELECT acao, entidade, entidade_id FROM gf_auditoria WHERE entidade = 'tarologo-perfil' AND entidade_id = '10'"))[0];
    assert.equal(aud.acao, 'cadastros.tarologo.perfil');
    assert.equal((await catalogo()).find((i) => i.id === '11').directory.umblerContact, undefined, 'só a aprovada mudou');
  });
  await passo('repetir o mesmo arquivo não regrava (já igual); o relatório antigo (revisão velha) é recusado; vínculo diferente exige sobrescrever', async () => {
    const atual = (await catalogo()).find((i) => i.id === '10');
    const igual = await aplicar({ itens: [{ aprovar: true, tarotId: '10', revisao: atual.revision, proposta: { contactId: 'ct-selene', conversationId: 'chat-selene' } }], ator, catalogo, gravarPerfil: tarologos.gravarPerfil });
    assert.deepEqual(igual.jaIguais, ['10']);
    const velho = await aplicar({ itens: [{ aprovar: true, tarotId: '10', revisao: atual.revision - 1, proposta: { contactId: 'ct-outro' } }], ator, catalogo, gravarPerfil: tarologos.gravarPerfil });
    assert.match(velho.ignorados[0].motivo, /mudou depois do relatório/);
    const troca = await aplicar({ itens: [{ aprovar: true, tarotId: '10', revisao: atual.revision, proposta: { contactId: 'ct-outro' } }], ator, catalogo, gravarPerfil: tarologos.gravarPerfil });
    assert.match(troca.ignorados[0].motivo, /sobrescrever/);
    const forca = await aplicar({ itens: [{ aprovar: true, sobrescrever: true, tarotId: '10', revisao: atual.revision, proposta: { contactId: 'ct-outro' } }], ator, catalogo, gravarPerfil: tarologos.gravarPerfil });
    assert.deepEqual(forca.gravados, ['10']);
    assert.equal((await catalogo()).find((i) => i.id === '10').directory.umblerContact.contactId, 'ct-outro');
  });
  await passo('com a escrita desligada o serviço recusa e o item fica ignorado (nada gravado)', async () => {
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
    const atual = (await catalogo()).find((i) => i.id === '11');
    const res = await aplicar({ itens: [{ aprovar: true, tarotId: '11', revisao: atual.revision, proposta: { contactId: 'ct-aurora' } }], ator, catalogo, gravarPerfil: tarologos.gravarPerfil });
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true';
    assert.equal(res.gravados.length, 0); assert.equal(res.ignorados.length, 1);
    assert.equal((await catalogo()).find((i) => i.id === '11').directory.umblerContact, undefined);
  });

  const { ok, falhas } = resumo();
  console.log(`\nPostgres (--aplicar real): ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close().catch(() => {});
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
