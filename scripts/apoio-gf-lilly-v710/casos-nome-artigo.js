'use strict';

/** nameArticle (docs/banco/22 §2): coluna e CHECK no banco NOVO, catálogo (perfil e extensão), validação do cadastro e `tarologists[].nameArticle` do contexto. NUNCA deduzido do nome. */

module.exports = async (c) => {
  const { r, sequelize, conferir, passo, contexto, tarologos, consulta, igual } = c;
  console.log('nameArticle (banco novo, catálogo, cadastro e contexto)');

  await passo('coluna gf_tarologos_ext.name_article existe (nullable) e a migração v710 roda de novo sem erro (idempotente)', async () => {
    const col = await consulta("SELECT is_nullable, character_maximum_length FROM information_schema.columns WHERE table_name = 'gf_tarologos_ext' AND column_name = 'name_article'");
    conferir('coluna presente, nullable, 1 caractere', col.length === 1 && col[0].is_nullable === 'YES' && Number(col[0].character_maximum_length) === 1);
    await require(r('migrations/20261212000000-gestao-fadas-lilly-v710')).up({ sequelize });
    conferir('de novo sem erro', true);
  });
  await passo('CHECK: só "o", "a" ou NULL no banco (inserções inválidas diretas são barradas)', async () => {
    for (const [id, v] of [[9001, 'a'], [9002, null]]) await sequelize.query('INSERT INTO gf_tarologos_ext (id_tarologo, name_article) VALUES (:id, :v)', { replacements: { id, v }, logging: false });
    let barrou = 0;
    for (const ruim of ['x', 'A', 'os', '']) {
      try { await sequelize.query('INSERT INTO gf_tarologos_ext (id_tarologo, name_article) VALUES (:id, :v)', { replacements: { id: 9100 + barrou, v: ruim }, logging: false }); } catch (e) { barrou += 1; }
    }
    conferir('"x", "A", "os" e vazio recusados', barrou === 4);
  });
  await passo('o modelo do banco novo conhece a coluna (e o do legado MySQL NÃO foi tocado)', async () => {
    conferir('modelo novo tem name_article', Boolean(require(r('src/gestao-fadas/novo/models/gf_tarologos_ext.model'))(sequelize).rawAttributes.name_article));
    const legado = require('fs').readFileSync(r('src/models/legado/novas/gf_tarologos_ext.model.js'), 'utf8');
    conferir('modelo legado sem name_article', !legado.includes('name_article'));
  });
  await passo('catálogo: extensão "a" aparece; extensão NULL e tarólogo sem linha NÃO ganham artigo (nada é deduzido do nome, nem de "Osíris")', async () => {
    const itens = await tarologos.catalogo();
    const mara = itens.find((i) => i.id === '9001'); const osiris = itens.find((i) => i.id === '9002');
    conferir('9001 (extensão "a")', mara.directory.nameArticle === 'a');
    conferir('9002 (extensão sem tratamento) sem nameArticle', !Object.prototype.hasOwnProperty.call(osiris.directory, 'nameArticle'));
  });
  await passo('perfil editado vence a extensão; null declarado fica neutro; validação aceita o/a/null/vazio e recusa o resto', async () => {
    const { montarItem, validarDiretorio } = require(r('src/gestao-fadas/_comum/dominio/catalogo-tarologos'));
    const perfil = (dados) => ({ tarot_id: 'p1', id_legado: null, nome: 'Pat', avatar: null, cadastro_ativo: true, perfil: dados, registro_id: null, registro_revisao: 0, revisao: 1, conta_slug: null });
    conferir('perfil "o" vence a extensão "a"', montarItem({ legado: null, perfil: perfil({ nameArticle: 'o' }), ext: { name_article: 'a' } }).directory.nameArticle === 'o');
    conferir('perfil null declarado vence a extensão "a"', montarItem({ legado: null, perfil: perfil({ nameArticle: null }), ext: { name_article: 'a' } }).directory.nameArticle === null);
    conferir('validar: o, a, null e "" (=null)', ['o', 'a'].every((v) => validarDiretorio({ nameArticle: v }).nameArticle === v) && validarDiretorio({ nameArticle: null }).nameArticle === null && validarDiretorio({ nameArticle: '' }).nameArticle === null);
    let recusou = 0; for (const ruim of ['x', 'O', 'ele', 1, true]) { try { validarDiretorio({ nameArticle: ruim }); } catch (e) { recusou += 1; } }
    conferir('valores fora de o/a/null recusados', recusou === 5);
  });
  await passo('contexto: tarologists[].nameArticle copia SOMENTE o cadastro explícito (o, a, null declarado); sem cadastro o campo é ausente', async () => {
    await sequelize.query("INSERT INTO gf_tarologos_perfil (tarot_id, id_legado, nome, cadastro_ativo, perfil, revisao, atualizado_por) VALUES ('neutra', NULL, 'Neutra', true, :p, 1, 'teste'), ('osiris', NULL, 'Osíris', true, '{}', 1, 'teste')", { replacements: { p: JSON.stringify({ nameArticle: null }) }, logging: false });
    const snap = await contexto({ conversationId: 'chat-na', tarologistId: 'osiris' });
    const por = Object.fromEntries(snap.tarologists.map((t) => [t.id, t]));
    conferir('Mara (extensão "a") => "a"', por['9001'] && por['9001'].nameArticle === 'a');
    conferir('Osíris sem tratamento cadastrado => AUSENTE (não "o")', por.osiris && !Object.prototype.hasOwnProperty.call(por.osiris, 'nameArticle'));
    conferir('neutra declarada => null explícito', por.neutra && Object.prototype.hasOwnProperty.call(por.neutra, 'nameArticle') && por.neutra.nameArticle === null);
    await sequelize.query("UPDATE gf_tarologos_perfil SET perfil = :p WHERE tarot_id = 'osiris'", { replacements: { p: JSON.stringify({ nameArticle: 'o' }) }, logging: false });
    const depois = await contexto({ conversationId: 'chat-na', tarologistId: 'osiris' });
    conferir('depois de cadastrado "o" => "o"', depois.tarologists.find((t) => t.id === 'osiris').nameArticle === 'o');
    conferir('sem inferência por nome: nenhum outro tarólogo ganhou artigo', depois.tarologists.filter((t) => t.nameArticle !== undefined).map((t) => t.id).sort().join() === '9001,neutra,osiris');
  });
  await passo('cadastro de tarólogo: o formulário aceita nameArticle e o projeta no diretório público; valor inválido é recusado', async () => {
    const dom = require(r('src/gestao-fadas/_comum/dominio/cadastro-tarologo'));
    const base = (extra) => ({ professionalName: 'Nova', ...extra });
    const publico = dom.validarCadastro(base({ nameArticle: 'a' }), { publica: false });
    conferir('guarda "a"', publico.nameArticle === 'a' && dom.perfilPublico(publico, 'nova').nameArticle === 'a' && dom.projecaoDoLink(publico).nameArticle === 'a');
    const sem = dom.validarCadastro(base({}), { publica: false });
    conferir('sem o campo, nada é inventado', !Object.prototype.hasOwnProperty.call(sem, 'nameArticle') && !Object.prototype.hasOwnProperty.call(dom.perfilPublico(sem, 'nova'), 'nameArticle'));
    let recusou = false; try { dom.validarCadastro(base({ nameArticle: 'x' }), { publica: false }); } catch (e) { recusou = true; }
    conferir('"x" recusado', recusou);
  });
  void igual;
};
