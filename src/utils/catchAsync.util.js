const AppError = require('./AppError');

/**
 * Middleware Express padronizado: encaminha falhas ao `next(err)`.
 */
function catchAsyncRoute(fn) {
  return function routeHandler(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Para serviços assíncronos (fora Express): garante erro operacional onde fizer sentido.
 * Erros já em `AppError` são preservados.
 */
async function invokeServiceSafe(fn, ...args) {
  try {
    return await fn(...args);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(err.message || 'Falha inesperada no serviço.', 500, null, false);
  }
}

/** Envolve handlers de serviço assíncronos — erros são normalizados em `next` quando combinado ao controller. */
function catchAsyncService(serviceFn) {
  return (...args) => invokeServiceSafe(serviceFn, ...args);
}

module.exports = {
  catchAsyncRoute,
  invokeServiceSafe,
  catchAsyncService,
};
