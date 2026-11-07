'use strict';

/**
 * Canal da consulta: vocabulário do painel -> vocabulário da Lilly. A Lilly só inicia consulta com canal em
 * {`WhatsApp`, `PABX`, `Texto/Áudio`, `WhatsApp: texto/áudio`, `WhatsApp Texto/Áudio`} (engine.mjs:788, Maturacao/59 3.5); o painel guarda
 * `WhatsApp Áudio`, `WhatsApp Ligação`, `WhatsApp Texto` (ciclo.validacao.js), que a Lilly RECUSA. Tabela (decisão desta etapa, NÃO RESPONDIDO
 * pelo painel nem pelo contrato; segue o resumo da própria Lilly: zap = WhatsApp, telefone/ligação por operadora = PABX):
 *
 *   painel (`gf_consultas_ext.canal`)  ->  Lilly (`consultations[].channel`)
 *   WhatsApp                           ->  WhatsApp
 *   WhatsApp Texto                     ->  WhatsApp: texto/áudio
 *   WhatsApp Áudio                     ->  WhatsApp: texto/áudio
 *   WhatsApp Ligação                   ->  WhatsApp
 *   PABX                               ->  PABX
 *   Telefone                           ->  PABX
 *   (outro valor, vazio)               ->  ausente (a Lilly recusa iniciar: "confira o canal"; nunca inventa)
 */

const TABELA_DE_CANAIS = Object.freeze({
  WhatsApp: 'WhatsApp',
  'WhatsApp Texto': 'WhatsApp: texto/áudio',
  'WhatsApp Áudio': 'WhatsApp: texto/áudio',
  'WhatsApp Ligação': 'WhatsApp',
  PABX: 'PABX',
  Telefone: 'PABX',
});

const CANAIS_DA_LILLY = Object.freeze(['WhatsApp', 'PABX', 'Texto/Áudio', 'WhatsApp: texto/áudio', 'WhatsApp Texto/Áudio']);

/** @returns {string|undefined} o canal no vocabulário da Lilly, ou `undefined` se não houver tradução segura. */
function traduzirCanal(canal) {
  const chave = `${canal ?? ''}`.trim();
  return Object.prototype.hasOwnProperty.call(TABELA_DE_CANAIS, chave) ? TABELA_DE_CANAIS[chave] : undefined;
}

module.exports = { TABELA_DE_CANAIS, CANAIS_DA_LILLY, traduzirCanal };
