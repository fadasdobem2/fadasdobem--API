'use strict';

/**
 * CHECKs das tabelas de e-mails (migração 20261214000000, v711): `gf_email_config` (configuração única, SEM segredo em claro) e
 * `gf_email_eventos` (recibos de teste, convite e recuperação, só acrescenta). Finalidades e estados do front (features/email/email-model.ts).
 */

const CHECKS_EMAIL = {
  gf_email_config: [
    ['chk_email_config_unica', 'id = 1'],
    ['chk_email_config_revisao', 'revisao >= 1'],
    ['chk_email_config_forma', "jsonb_typeof(conteudo) = 'object' AND jsonb_typeof(conteudo -> 'connections') = 'array' AND jsonb_array_length(conteudo -> 'connections') <= 20 AND jsonb_typeof(conteudo -> 'purposes') = 'object'"],
    ['chk_email_config_revisao_igual', "(conteudo ->> 'revision') = revisao::text"],
    ['chk_email_config_sem_segredo', "NOT (conteudo ? 'secrets') AND NOT (conteudo::text ~* '\"(secret|password|senha|token)\"')"],
    ['chk_email_config_segredos', "jsonb_typeof(segredos) = 'object'"],
  ],
  gf_email_eventos: [
    ['chk_email_eventos_id', "id ~ '^[A-Za-z0-9_-]{1,80}$'"],
    ['chk_email_eventos_finalidade', "finalidade IN ('financeiro', 'usuarios', 'marketing', 'institucional')"],
    ['chk_email_eventos_tipo', "tipo IN ('test', 'invitation')"],
    ['chk_email_eventos_resultado', "resultado IN ('accepted', 'failed')"],
    ['chk_email_eventos_erro', "(resultado = 'failed' AND codigo_erro IS NOT NULL AND char_length(codigo_erro) <= 200) OR (resultado = 'accepted' AND codigo_erro IS NULL)"],
  ],
};

module.exports = { CHECKS_EMAIL };
