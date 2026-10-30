'use strict';

/**
 * Associações entre as tabelas LEGADAS (ASP32) e as tabelas NOVAS (`gf_*`).
 *
 * Todas são lógicas (`constraints: false`): o legado é MyISAM, sem FOREIGN KEY, e não pode ser alterado. A ligação
 * é sempre feita pelo ID legado (`usuarios.id`, `tbl_tarologos.idTarologo`, `tbl_consultas.idConsulta`).
 *
 * Atenção: as tabelas `gf_repasse_*` guardam o ID legado como TEXTO (`tarot_id`, `consulta_id`, `cliente_id`).
 * Em consultas por esses campos, passe o ID como string (`String(id)`) para o índice ser usado.
 */

module.exports = function associar(m) {
  const soft = { constraints: false };

  /* ------------------------------ Consulta ------------------------------ */
  m.LegadoConsulta.belongsTo(m.LegadoUsuario, { foreignKey: 'idUsuario', targetKey: 'id', as: 'cliente', ...soft });
  m.LegadoConsulta.belongsTo(m.LegadoTarologo, { foreignKey: 'idTarologo', targetKey: 'idTarologo', as: 'tarologo', ...soft });
  m.LegadoConsulta.belongsTo(m.LegadoFormaConsulta, { foreignKey: 'idFormaConsulta', targetKey: 'idFormaConsulta', as: 'formaConsulta', ...soft });
  m.LegadoConsulta.belongsTo(m.LegadoOpcaoPagamento, { foreignKey: 'idFormaPagto', targetKey: 'idOpcaoPagto', as: 'formaPagamento', ...soft });

  /* ------------------------------ Cliente (usuarios) ------------------------------ */
  m.LegadoUsuario.hasMany(m.LegadoConsulta, { foreignKey: 'idUsuario', sourceKey: 'id', as: 'consultas', ...soft });
  m.LegadoUsuario.hasMany(m.LegadoPagamentoInformado, { foreignKey: 'idUsuario', sourceKey: 'id', as: 'pagamentosInformados', ...soft });
  m.LegadoUsuario.hasMany(m.LegadoPagamentoConfirmado, { foreignKey: 'idUsuario', sourceKey: 'id', as: 'pagamentosConfirmados', ...soft });
  m.LegadoUsuario.hasMany(m.LegadoPagamentoNaoLocalizado, { foreignKey: 'idUsuario', sourceKey: 'id', as: 'pagamentosNaoLocalizados', ...soft });
  m.LegadoUsuario.hasMany(m.LegadoContaCorrente, { foreignKey: 'idUsuario', sourceKey: 'id', as: 'movimentos', ...soft });
  m.LegadoUsuario.hasMany(m.LegadoObsLiberacaoConsulta, { foreignKey: 'id_usuario', sourceKey: 'id', as: 'observacoesLiberacao', ...soft });
  m.LegadoUsuario.belongsTo(m.LegadoPerfilCliente, { foreignKey: 'id_perfil_cliente', targetKey: 'id', as: 'perfil', ...soft });
  m.LegadoUsuario.belongsTo(m.LegadoCpfStatus, { foreignKey: 'status_cpf_id', targetKey: 'idStatus', as: 'statusCpf', ...soft });
  m.LegadoUsuario.belongsTo(m.LegadoPais, { foreignKey: 'idPais', targetKey: 'ID', as: 'paisPorId', ...soft });

  /* ------------------------------ Tarólogo ------------------------------ */
  m.LegadoTarologo.hasMany(m.LegadoConsulta, { foreignKey: 'idTarologo', sourceKey: 'idTarologo', as: 'consultas', ...soft });
  // NOVA: extensão 1:1 por ID legado (foto, contatos, turno). O legado não ganha coluna.
  m.LegadoTarologo.hasOne(m.GfTarologosExt, { foreignKey: 'id_tarologo', sourceKey: 'idTarologo', as: 'extensao', ...soft });
  m.GfTarologosExt.belongsTo(m.LegadoTarologo, { foreignKey: 'id_tarologo', targetKey: 'idTarologo', as: 'tarologo', ...soft });

  /* ------------------------------ Pagamentos ------------------------------ */
  for (const Pagamento of [m.LegadoPagamentoInformado, m.LegadoPagamentoConfirmado, m.LegadoPagamentoNaoLocalizado]) {
    Pagamento.belongsTo(m.LegadoUsuario, { foreignKey: 'idUsuario', targetKey: 'id', as: 'cliente', ...soft });
    Pagamento.belongsTo(m.LegadoBanco, { foreignKey: 'idBanco', targetKey: 'idBanco', as: 'banco', ...soft });
    Pagamento.belongsTo(m.LegadoOpcaoPagamento, { foreignKey: 'idFormaPagto', targetKey: 'idOpcaoPagto', as: 'formaPagamento', ...soft });
  }
  m.LegadoPagamentoInformado.belongsTo(m.LegadoBandeiraCartao, { foreignKey: 'id_bandeira_cartao', targetKey: 'id', as: 'bandeira', ...soft });
  m.LegadoPagamentoInformado.belongsTo(m.LegadoStatusPagamento, { foreignKey: 'id_status_pagto', targetKey: 'id_status_pagto', as: 'situacao', ...soft });

  m.LegadoContaCorrente.belongsTo(m.LegadoUsuario, { foreignKey: 'idUsuario', targetKey: 'id', as: 'cliente', ...soft });
  m.LegadoContaCorrente.belongsTo(m.LegadoConsulta, { foreignKey: 'idConsulta', targetKey: 'idConsulta', as: 'consulta', ...soft });
  m.LegadoPagamentoAberto.belongsTo(m.LegadoUsuario, { foreignKey: 'idUsuario', targetKey: 'id', as: 'cliente', ...soft });
  m.LegadoPagamentoAberto.belongsTo(m.LegadoConsulta, { foreignKey: 'idConsulta', targetKey: 'idConsulta', as: 'consulta', ...soft });

  /* ------------------------------ Repasse (NOVAS gf_repasse_*) ------------------------------ */
  const porTarologo = [
    ['repassePercentuais', m.GfRepassePercentuais],
    ['repasseCalendarios', m.GfRepasseCalendarios],
    ['repasseAberturas', m.GfRepasseAberturas],
    ['repasseDividas', m.GfRepasseDividas],
    ['repassePagamentos', m.GfRepassePagamentos],
    ['repasseAjustes', m.GfRepasseAjustes],
    ['repasseCancelamentos', m.GfRepasseCancelamentos],
  ];
  for (const [alias, Modelo] of porTarologo) {
    m.LegadoTarologo.hasMany(Modelo, { foreignKey: 'tarot_id', sourceKey: 'idTarologo', as: alias, ...soft });
    Modelo.belongsTo(m.LegadoTarologo, { foreignKey: 'tarot_id', targetKey: 'idTarologo', as: 'tarologo', ...soft });
  }
  m.GfRepasseCancelamentos.belongsTo(m.LegadoConsulta, { foreignKey: 'consulta_id', targetKey: 'idConsulta', as: 'consulta', ...soft });
  m.GfRepasseCancelamentos.belongsTo(m.LegadoUsuario, { foreignKey: 'cliente_id', targetKey: 'id', as: 'cliente', ...soft });

  // Relações internas do repasse (a abertura reúne pendências, dívidas e ajustes; a dívida reúne parcelas).
  m.GfRepasseAberturas.hasMany(m.GfRepasseAberturaPendencias, { foreignKey: 'abertura_id', sourceKey: 'id', as: 'pendencias', ...soft });
  m.GfRepasseAberturas.hasMany(m.GfRepasseDividas, { foreignKey: 'abertura_id', sourceKey: 'id', as: 'dividas', ...soft });
  m.GfRepasseAberturas.hasMany(m.GfRepasseAjustes, { foreignKey: 'abertura_id', sourceKey: 'id', as: 'ajustes', ...soft });
  m.GfRepasseDividas.hasMany(m.GfRepasseDividaParcelas, { foreignKey: 'divida_id', sourceKey: 'id', as: 'parcelas', ...soft });
  m.GfRepassePagamentos.hasMany(m.GfRepassePagamentoDescontos, { foreignKey: 'pagamento_id', sourceKey: 'id', as: 'descontos', ...soft });
  m.GfRepasseDividas.hasMany(m.GfRepassePagamentoDescontos, { foreignKey: 'divida_id', sourceKey: 'id', as: 'descontosAplicados', ...soft });
};
