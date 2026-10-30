/**
 * @param {*} res Express response
 * @param {*} dados payload JSON em `dados`
 * @param {string} mensagem mensagem UX curta sempre em PT-BR
 * @param {number} httpStatus código HTTP efetivo
 */
function responderSucesso(res, dados = null, mensagem = 'Operação concluída com sucesso.', httpStatus = 200) {
  return res.status(httpStatus).json({
    sucesso: true,
    mensagem,
    dados,
  });
}

/**
 * @param {*} dados detalhes técnicos (null em produções simples ou erros sanitizados).
 */
function responderErro(res, httpStatus = 500, mensagem = 'Não foi possível concluir a operação.', dados = null) {
  return res.status(httpStatus).json({
    sucesso: false,
    mensagem,
    dados,
  });
}

module.exports = {
  responderSucesso,
  responderErro,
};
