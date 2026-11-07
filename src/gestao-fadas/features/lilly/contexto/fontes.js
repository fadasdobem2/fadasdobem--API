'use strict';

/**
 * Registro das fontes de dados do snapshot. O padrão lê o legado (só leitura) e o Postgres novo; `definirFontes({ nome: fn })` troca funções
 * avulsas (o verificador simula o legado e as falhas), `definirFontes()` restaura. Os montadores recebem o objeto de fontes por parâmetro.
 */

const legado = require('./fontes.legado');
const novo = require('./fontes.novo');
const lilly = require('./fontes.lilly');
const dominio = require('./fontes.dominio');

const padrao = Object.freeze({ ...legado, ...novo, ...lilly, ...dominio });
let atual = { ...padrao };

const fontes = () => atual;
const definirFontes = (trocas = {}) => { atual = { ...padrao, ...trocas }; };

module.exports = { fontes, definirFontes };
