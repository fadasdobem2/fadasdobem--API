'use strict';

/**
 * Departamentos dos Recados (v706 da Nice). Porte de `features/painel/note-departments.ts`: a visibilidade por departamento segue a hierarquia
 * operacional, independente dos filtros da caixa. `conta` = `{ id, papel, active?, departments?, department? }` (o servidor só conhece contas ativas;
 * `active === false` nega). Recado antigo sem destino vale como Atendimento; seleção declarada vazia não dá acesso. Ouro: scripts/gerar-ouro-gf-area5-v706.js. Puro.
 */

const DEPARTAMENTOS = [
  { id: 'atendimento', label: 'Atendimento' }, { id: 'financeiro', label: 'Financeiro' }, { id: 'administrativo', label: 'Administrativo' },
  { id: 'supervisao', label: 'Supervisão' }, { id: 'tarologos', label: 'Tarólogos' },
];
const ehDepartamento = (valor) => DEPARTAMENTOS.some((x) => x.id === valor);

function departamentosDaConta(conta) {
  if (!conta) return ['atendimento'];
  const declarados = [...new Set([...(conta.departments || []), ...(conta.department ? [conta.department] : [])])].filter(ehDepartamento);
  if (declarados.length) return declarados;
  return conta.papel === 'tarologa' ? ['tarologos'] : conta.papel === 'administradora' ? ['administrativo'] : conta.papel === 'supervisora' ? ['supervisao'] : ['atendimento'];
}
const rotuloDosDepartamentos = (ids) => DEPARTAMENTOS.filter((x) => ids.includes(x.id)).map((x) => x.label).join(', ');

/** Departamentos que a conta pode enxergar/escolher, pela hierarquia. */
function departamentosPermitidos(conta, papel = conta && conta.papel) {
  if (!papel || (conta && (conta.active === false || conta.papel !== papel))) return [];
  if (papel === 'administradora') return DEPARTAMENTOS.map((x) => x.id);
  if (papel === 'atendente') return ['atendimento'];
  if (papel === 'supervisora') return ['atendimento', 'supervisao'];
  if (papel === 'assistente') return [...new Set(['atendimento', 'supervisao', ...departamentosDaConta(conta)])];
  return ['tarologos'];
}

/** Destino ausente (recado antigo) significa Atendimento. */
function notaEmDepartamentosPermitidos(nota, conta, papel = conta && conta.papel) {
  if (nota.delivery && nota.delivery.kind === 'message') return true;
  const alvos = (nota.delivery && nota.delivery.departments) || ['atendimento'];
  return departamentosPermitidos(conta, papel).some((id) => alvos.includes(id));
}

const podeVerOutrosDepartamentos = (conta, papel = conta && conta.papel) => Boolean(papel && papel !== 'atendente' && papel !== 'tarologa' && departamentosPermitidos(conta, papel).length > 1);

/** A caixa normal seleciona os departamentos da própria conta dentro do que ela pode ver. */
function notaNosDepartamentosDaConta(nota, conta, papel = conta && conta.papel) {
  if (nota.delivery && nota.delivery.kind === 'message') return true;
  const alvos = (nota.delivery && nota.delivery.departments) || ['atendimento'];
  const permitidos = departamentosPermitidos(conta, papel);
  const proprios = departamentosDaConta(conta).filter((id) => permitidos.includes(id));
  return (proprios.length ? proprios : permitidos.slice(0, 1)).some((id) => alvos.includes(id));
}

/** Só depois da autorização da conversa; destinatários privados são conferidos pelo modelo do recado. */
function notaCombinaComAVisao(nota, conta, papel, mostrarOutros, incluirEnviadasPorMim = false) {
  if ((nota.delivery && nota.delivery.kind === 'message') || papel === 'tarologa') return true;
  if (incluirEnviadasPorMim && conta && nota.delivery && nota.delivery.senderId === conta.id) return true;
  if (!notaEmDepartamentosPermitidos(nota, conta, papel)) return false;
  return (mostrarOutros && podeVerOutrosDepartamentos(conta, papel)) || notaNosDepartamentosDaConta(nota, conta, papel);
}

module.exports = { DEPARTAMENTOS, ehDepartamento, departamentosDaConta, rotuloDosDepartamentos, departamentosPermitidos, notaEmDepartamentosPermitidos, podeVerOutrosDepartamentos, notaNosDepartamentosDaConta, notaCombinaComAVisao };
