const AppError = require('../utils/AppError');

module.exports = function notFoundHandler(req, res, next) {
  next(new AppError(`Endpoint ${req.method} ${req.originalUrl} não encontrado.`, 404));
}

