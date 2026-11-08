'use strict';

/** Entradas do ouro da v711 (formas de atendimento, regime Pré/Pós, cadastro profissional). Tudo fictício; relógio fixo. */

const AGORA = Date.parse('2026-11-10T15:00:00.000Z'); // dia operacional 2026-11-10
const HOJE = '2026-11-10';
const ANTES_DAS_6 = Date.parse('2026-11-10T08:00:00.000Z'); // 05:00 em São Paulo: ainda é 2026-11-09

const MODOS = [[], ['pabx'], ['audio'], ['texto'], ['pabx', 'audio', 'texto'], ['texto', 'pabx'], ['audio', 'audio'], ['video'], ['pabx', 'video'], 'pabx', null, undefined, [1], ['PABX']];
const CANAIS = [undefined, 'pabx', 'PABX', 'Áudio', 'audio', 'WhatsApp Texto', 'whatsapp áudio', 'digitado', 'chat', 'Chat', 'Voz', 'Vídeo', '', null, 'ligação PABX'];
const PERFIS = [
  {}, { serviceModes: ['audio'] }, { channels: ['Chat'] }, { channels: ['Voz'] }, { channels: ['Chat', 'Voz', 'PABX'] }, { channels: [] }, { channels: ['Texto', 'Áudio'] },
  { serviceModes: ['pabx'], serviceModesToday: { date: HOJE, modes: ['texto'] } }, { serviceModes: ['pabx'], serviceModesToday: { date: '2026-11-09', modes: ['texto'] } },
  { serviceModesToday: { date: HOJE, modes: [] } }, { serviceModesToday: { date: HOJE, modes: ['xx'] } }, null,
];
const REGIMES = ['', 'Pré-pago', 'Pós-pago'];
const ANTERIORES = ['', 'Pré-pago', 'Pós-pago', undefined, null];
const PROXIMOS = ['', 'Pré-pago', 'Pós-pago', 'Misto', undefined, null];
const CONTATOS = [undefined, null, {}, { contactId: '' }, { contactId: 'abc.1-x' }, { contactId: 'a b' }, { contactId: 'x', phone: '+55 11 91234-5678' }, { contactId: 'x', phone: 'abc' }, { contactId: 'x', phone: '12' }, { contactId: 'x', conversationId: 'c1' },
  { contactId: 'x', conversationId: 'c 1' }, { phone: '+5511912345678' }, { conversationId: 'c' }, { contactId: 'x'.repeat(161) }, { contactId: 'x\n' }, [], 'x', { contactId: 7 }, { contactId: ' abc ' }];
const INSTANTES = [AGORA, ANTES_DAS_6, Date.parse('2026-11-10T09:00:00.000Z'), Date.parse('2026-11-10T08:59:59.999Z'), Date.parse('2026-11-11T08:59:59.999Z')];

/** Variações do cadastro profissional (sobre o cadastro vazio com nome). */
const CADASTROS = [
  ['padrão', {}], ['canais antigos', { channels: ['Chat', 'Voz'] }], ['canais novos', { channels: ['PABX', 'Áudio', 'Texto'] }], ['canal fora', { channels: ['Vídeo'] }], ['canal fora 2', { channels: ['Chat', 'Zap'] }],
  ['modos', { serviceModes: ['texto', 'pabx'] }], ['modo fora', { serviceModes: ['video'] }], ['modos não lista', { serviceModes: 'pabx' }], ['modos vazio', { serviceModes: [] }],
  ['modos e canais', { channels: ['Voz'], serviceModes: ['audio'] }], ['só Voz', { channels: ['Voz'] }], ['só Chat', { channels: ['Chat'] }],
  ...CONTATOS.map((c, i) => [`umbler ${i}`, { umblerContact: c }]),
];

/** Pedidos de `/professional-services`: (método, consulta, corpo, identidade, instante). */
const ID = (role, tarotId) => ({ accountId: `acc-${role}`, role, ...(tarotId ? { tarotId } : {}) });
const PEDIDOS_FORMAS = [
  ['GET', '', undefined, null], ['GET', '', undefined, ID('administradora')], ['GET', '', undefined, ID('atendente')], ['GET', '?tarotId=t1', undefined, ID('assistente')], ['GET', '', undefined, ID('tarologa', 't1')],
  ['GET', '?tarotId=t2', undefined, ID('tarologa', 't1')], ['GET', '', undefined, ID('tarologa')], ['GET', '', undefined, ID('visitante')],
  ['PUT', '?tarotId=t1', { date: HOJE, modes: ['pabx', 'texto'], revision: 0 }, ID('tarologa', 't1')], ['GET', '?tarotId=t1', undefined, ID('atendente')], ['GET', '', undefined, ID('supervisora')],
  ['PUT', '?tarotId=t1', { date: HOJE, modes: ['audio'], revision: 0 }, ID('tarologa', 't1')], ['PUT', '?tarotId=t1', { date: HOJE, modes: ['audio'], revision: 1 }, ID('tarologa', 't1')],
  ['PUT', '?tarotId=t1', { date: HOJE, modes: [], revision: 2 }, ID('administradora')], ['PUT', '?tarotId=t1', { date: HOJE, modes: ['audio'], revision: 3 }, ID('atendente')],
  ['PUT', '?tarotId=t1', { date: HOJE, modes: ['audio'], revision: 3 }, ID('supervisora')], ['PUT', '?tarotId=t1', { date: HOJE, modes: ['audio'], revision: 3 }, ID('assistente')],
  ['PUT', '?tarotId=t2', { date: HOJE, modes: ['audio'], revision: 0 }, ID('tarologa', 't1')], ['PUT', '', { date: HOJE, modes: ['audio'], revision: 0 }, ID('administradora')], ['PUT', '?tarotId=a%20b', { date: HOJE, modes: ['audio'], revision: 0 }, ID('administradora')],
  ['PUT', '?tarotId=t3', { date: '2026-11-09', modes: ['audio'], revision: 0 }, ID('administradora')], ['PUT', '?tarotId=t3', { date: '2026-11-11', modes: ['audio'], revision: 0 }, ID('administradora')],
  ['PUT', '?tarotId=t3', { date: HOJE, modes: ['audio'], revision: -1 }, ID('administradora')], ['PUT', '?tarotId=t3', { date: HOJE, modes: ['audio'], revision: 1.5 }, ID('administradora')], ['PUT', '?tarotId=t3', { date: HOJE, modes: ['audio'] }, ID('administradora')],
  ['PUT', '?tarotId=t3', { date: HOJE, modes: ['video'], revision: 0 }, ID('administradora')], ['PUT', '?tarotId=t3', { date: HOJE, modes: 'audio', revision: 0 }, ID('administradora')], ['PUT', '?tarotId=t3', { date: HOJE, modes: ['audio'], revision: 0, extra: 1 }, ID('administradora')],
  ['PUT', '?tarotId=t3', [], ID('administradora')], ['PUT', '?tarotId=t3', null, ID('administradora')], ['PUT', '?tarotId=t3', { date: HOJE, modes: ['texto', 'pabx', 'audio'], revision: 0 }, ID('administradora')], ['GET', '', undefined, ID('administradora')],
  ['DELETE', '', undefined, ID('administradora')], ['POST', '', {}, ID('administradora')],
  ['PUT', '?tarotId=t4', { date: HOJE, modes: ['audio'], revision: 0 }, ID('administradora'), ANTES_DAS_6], ['PUT', '?tarotId=t4', { date: '2026-11-09', modes: ['audio'], revision: 0 }, ID('administradora'), ANTES_DAS_6],
];

module.exports = { AGORA, HOJE, ANTES_DAS_6, MODOS, CANAIS, PERFIS, REGIMES, ANTERIORES, PROXIMOS, CONTATOS, INSTANTES, CADASTROS, PEDIDOS_FORMAS };
