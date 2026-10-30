'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `usuarios` (engine InnoDB).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 * Colunas deliberadamente fora do model (credenciais): login, senha, troca_senha, data_troca_senha.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoUsuario extends Model {}

module.exports = (sequelize) => {
  LegadoUsuario.init(
    {
      id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(11) NOT NULL AUTO_INCREMENT" },
      data_cadastro: { type: DataTypes.STRING(26), allowNull: false, comment: "TIMESTAMP lido como texto (há valores zerados no legado) | timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP" },
      nome2: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      apelido: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      nome: { type: DataTypes.STRING(255), allowNull: false, comment: "varchar(255) COLLATE utf8_unicode_ci NOT NULL" },
      tempo: { type: DataTypes.INTEGER, allowNull: true, comment: "int(11) DEFAULT '0'" },
      nomedesolteiro: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      cidadedenascimento: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      complemento: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      endereco: { type: DataTypes.STRING(250), allowNull: false, comment: "varchar(250) COLLATE utf8_unicode_ci NOT NULL" },
      numero: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      bairro: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      cidade: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      estado: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      pais: { type: DataTypes.INTEGER, allowNull: true, comment: "int(11) DEFAULT '1'" },
      ddd: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      ddd_real: { type: DataTypes.INTEGER, allowNull: false, comment: "int(2) NOT NULL" },
      telresidencial: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      telcomercial: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      cel: { type: DataTypes.STRING(50), allowNull: true, comment: "varchar(50) CHARACTER SET utf8 DEFAULT NULL" },
      rg: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      cpf: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      datanascimento: { type: DataTypes.STRING(26), allowNull: false, comment: "DATETIME lido como texto (há valores zerados no legado) | datetime NOT NULL" },
      horanascimento: { type: DataTypes.STRING(26), allowNull: false, comment: "DATETIME lido como texto (há valores zerados no legado) | datetime NOT NULL" },
      email: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      mensagem: { type: DataTypes.TEXT, allowNull: false, comment: "text COLLATE utf8_unicode_ci NOT NULL" },
      credito: { type: DataTypes.TINYINT, allowNull: true, comment: "tinyint(4) DEFAULT '0'" },
      sexo: { type: DataTypes.TINYINT, allowNull: false, comment: "tinyint(4) NOT NULL" },
      nivel: { type: DataTypes.INTEGER, allowNull: true, comment: "int(11) DEFAULT '0'" },
      chat: { type: DataTypes.TINYINT, allowNull: false, comment: "tinyint(4) NOT NULL" },
      tel: { type: DataTypes.TINYINT, allowNull: false, comment: "tinyint(4) NOT NULL" },
      skype: { type: DataTypes.TINYINT, allowNull: false, comment: "tinyint(4) NOT NULL" },
      manha: { type: DataTypes.TINYINT, allowNull: false, comment: "tinyint(4) NOT NULL" },
      tarde: { type: DataTypes.TINYINT, allowNull: false, comment: "tinyint(4) NOT NULL" },
      noite: { type: DataTypes.TINYINT, allowNull: false, comment: "tinyint(4) NOT NULL" },
      manhaobs: { type: DataTypes.TEXT, allowNull: false, comment: "text COLLATE utf8_unicode_ci NOT NULL" },
      tardeobs: { type: DataTypes.TEXT, allowNull: false, comment: "text COLLATE utf8_unicode_ci NOT NULL" },
      noiteobs: { type: DataTypes.TEXT, allowNull: false, comment: "text COLLATE utf8_unicode_ci NOT NULL" },
      cep: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      observacoes: { type: DataTypes.TEXT, allowNull: false, comment: "text COLLATE utf8_unicode_ci NOT NULL" },
      ddi: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      categoria: { type: DataTypes.INTEGER, allowNull: true, comment: "int(11) DEFAULT '0'" },
      nome_id: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      status_cpf_id: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      fone_observacoes: { type: DataTypes.TEXT, allowNull: false, comment: "text COLLATE utf8_unicode_ci NOT NULL" },
      email_correto: { type: DataTypes.TINYINT, allowNull: true, comment: "tinyint(4) DEFAULT '1'" },
      email2: { type: DataTypes.STRING(100), allowNull: false, comment: "varchar(100) COLLATE utf8_unicode_ci NOT NULL" },
      msn_user: { type: DataTypes.STRING(100), allowNull: false, comment: "varchar(100) COLLATE utf8_unicode_ci NOT NULL" },
      Twitter_user: { type: DataTypes.STRING(100), allowNull: false, comment: "varchar(100) COLLATE utf8_unicode_ci NOT NULL" },
      Skype_user: { type: DataTypes.STRING(100), allowNull: false, comment: "varchar(100) COLLATE utf8_unicode_ci NOT NULL" },
      ligouParaMarcar: { type: DataTypes.TINYINT, allowNull: true, comment: "tinyint(4) DEFAULT '0'" },
      resultadoLigouMarcar: { type: DataTypes.STRING(255), allowNull: false, comment: "varchar(255) COLLATE utf8_unicode_ci NOT NULL" },
      ligouParaCompletar: { type: DataTypes.TINYINT, allowNull: true, comment: "tinyint(4) DEFAULT '0'" },
      resultadoLigouCompletar: { type: DataTypes.STRING(255), allowNull: false, comment: "varchar(255) COLLATE utf8_unicode_ci NOT NULL" },
      ufNascimento: { type: DataTypes.STRING(2), allowNull: false, comment: "varchar(2) COLLATE utf8_unicode_ci NOT NULL" },
      IDpaisNascimento: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      buscaNaReceita: { type: DataTypes.TEXT, allowNull: false, comment: "text COLLATE utf8_unicode_ci NOT NULL" },
      idPais: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      cidadeNascimento: { type: DataTypes.STRING(100), allowNull: false, comment: "varchar(100) COLLATE utf8_unicode_ci NOT NULL" },
      obs_liberacao: { type: DataTypes.TEXT, allowNull: false, comment: "text COLLATE utf8_unicode_ci NOT NULL" },
      saldo: { type: DataTypes.DECIMAL(20,2), allowNull: true, comment: "DECIMAL volta como string (dinheiro nunca em float) | decimal(20,2) DEFAULT '0.00'" },
      valorAPagar: { type: DataTypes.DECIMAL(20,2), allowNull: true, comment: "DECIMAL volta como string (dinheiro nunca em float) | decimal(20,2) DEFAULT '0.00'" },
      vlMinuto: { type: DataTypes.DECIMAL(20,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | decimal(20,2) NOT NULL DEFAULT '1.97'" },
      vlBonus: { type: DataTypes.DECIMAL(20,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | decimal(20,2) NOT NULL DEFAULT '0.00'" },
      vlPrepago: { type: DataTypes.DECIMAL(20,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | decimal(20,2) NOT NULL DEFAULT '0.00'" },
      vlDesconto: { type: DataTypes.INTEGER, allowNull: false, comment: "int(5) NOT NULL DEFAULT '0'" },
      email_liberacao: { type: DataTypes.TINYINT, allowNull: false, comment: "tinyint(1) NOT NULL DEFAULT '0'" },
      email_completar: { type: DataTypes.TINYINT, allowNull: false, comment: "tinyint(1) NOT NULL DEFAULT '0'" },
      nao_exportado: { type: DataTypes.INTEGER, allowNull: true, comment: "int(1) DEFAULT '0'" },
      obs_perfil: { type: DataTypes.STRING(100), allowNull: false, comment: "varchar(100) COLLATE utf8_unicode_ci NOT NULL" },
      cpf_vinculado: { type: DataTypes.STRING(100), allowNull: false, comment: "varchar(100) COLLATE utf8_unicode_ci NOT NULL" },
      id_cliente_valido: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL DEFAULT '0'" },
      email_enviado: { type: DataTypes.INTEGER, allowNull: true, comment: "int(11) DEFAULT '0'" },
      id_perfil_cliente: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, comment: "int(10) unsigned NOT NULL DEFAULT '1'" },
      avatar: { type: DataTypes.STRING(255), allowNull: true, comment: "varchar(255) COLLATE utf8_unicode_ci DEFAULT NULL" },
      whats: { type: DataTypes.STRING(45), allowNull: true, comment: "varchar(45) COLLATE utf8_unicode_ci DEFAULT NULL" },
      cel2: { type: DataTypes.STRING(45), allowNull: true, comment: "varchar(45) COLLATE utf8_unicode_ci DEFAULT NULL" },
    },
    {
      sequelize,
      modelName: "LegadoUsuario",
      tableName: "usuarios",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoUsuario;
};

module.exports.NOME = "LegadoUsuario";
module.exports.TABELA = "usuarios";
