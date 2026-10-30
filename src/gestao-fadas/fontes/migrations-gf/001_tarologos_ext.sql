-- Gestão Fadas v276: extensão nova do perfil profissional.
-- Preparado para revisão/aplicação no banco fadasdobem; NÃO executado pelo protótipo.
-- Aplicar uma única vez. Se a tabela já existir, conferir sua estrutura antes de prosseguir.
-- Não altera tbl_tarologos, não copia fotos/contatos antigos nem cria profissionais.
-- tbl_tarologos é MyISAM: o vínculo com idTarologo é lógico, sem FOREIGN KEY.
CREATE TABLE `gf_tarologos_ext` (
  `id_tarologo` INT NOT NULL,
  `foto_atual_ref` VARCHAR(2048) NULL DEFAULT NULL,
  `primeiro_nome_civil` VARCHAR(100) NULL DEFAULT NULL,
  `personal_whatsapp` VARCHAR(45) NULL DEFAULT NULL,
  `avatar_whatsapp` VARCHAR(45) NULL DEFAULT NULL,
  `situacao_turno` VARCHAR(20) NULL DEFAULT NULL,
  `retorno_previsto_em` VARCHAR(40) NULL DEFAULT NULL,
  PRIMARY KEY (`id_tarologo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- foto_atual_ref: caminho/URL persistente da foto nova; não guardar data: ou blob:.
-- NULL na foto mantém o avatar sem foto, nunca recupera tbl_tarologos.avatar.
-- Contatos são independentes; nenhum número é deduzido do outro ou de telefone sem rótulo.
-- situacao_turno: Disponível, Em pausa, Offline; NULL = ainda não informado.
-- retorno_previsto_em: instante ISO 8601 com fuso, quando informado pela operação.
-- A API deve validar o ID existente e a autorização antes de qualquer escrita.
