'use strict';

/**
 * CHECK de `gf_formas_atendimento_dia` (migração 20261215000000, v711): as formas de atendimento que a profissional informa PARA O DIA
 * (PABX, Áudio, Texto; a lista pode ficar vazia = "sem meio disponível"). Mesma regra de features/domain/professional-service-modes.mjs
 * (`validateServiceModes`): só os três valores, sem repetir, na ordem canônica pabx, audio, texto.
 */

const CHECKS_FORMAS = {
  gf_formas_atendimento_dia: [
    ['chk_formas_dia_tarologo', "tarologo_id ~ '^[A-Za-z0-9_.-]{1,160}$'"],
    ['chk_formas_dia_revisao', 'revisao >= 1'],
    ['chk_formas_dia_formas', "jsonb_typeof(formas) = 'array' AND formas <@ '[\"pabx\", \"audio\", \"texto\"]'::jsonb AND jsonb_array_length(formas) <= 3 AND (formas = '[]'::jsonb OR formas::text IN ('[\"pabx\"]', '[\"audio\"]', '[\"texto\"]', '[\"pabx\", \"audio\"]', '[\"pabx\", \"texto\"]', '[\"audio\", \"texto\"]', '[\"pabx\", \"audio\", \"texto\"]'))"],
  ],
};

module.exports = { CHECKS_FORMAS };
