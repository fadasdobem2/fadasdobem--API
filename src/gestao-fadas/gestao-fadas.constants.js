'use strict';

/** O módulo só é montado quando GESTAO_FADAS_ENABLED=true (o "gate" que separa o sistema B do restante da API). */
function moduloHabilitado() {
  return `${process.env.GESTAO_FADAS_ENABLED || ''}`.trim().toLowerCase() === 'true';
}

module.exports = { moduloHabilitado, PREFIXO: '/v1/gestao-fadas' };
