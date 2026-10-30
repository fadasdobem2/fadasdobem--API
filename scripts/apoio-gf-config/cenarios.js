'use strict';

/** Cenários de `validateWelcome` (Boas-vindas). Entram no ouro do front e no teste do domínio do servidor. */

const { padrao } = require('../../src/gestao-fadas/_comum/dominio/welcome');

const base = () => padrao();
const mut = (fn) => { const c = base(); fn(c); return c; };
const semAudience = (c) => ({ greetings: c.greetings.filter((g) => g.audience === 'atendimento').map(({ audience, ...r }) => r), messages: c.messages.filter((m) => m.audience === 'atendimento').map(({ audience, ...r }) => r) });

const CENARIOS = [
  { nome: 'padrão completo é aceito e volta igual', conteudo: base() },
  { nome: 'conteúdo antigo sem público recebe o público e os textos do tarólogo', conteudo: semAudience(base()) },
  { nome: 'texto com espaços nas pontas é aparado', conteudo: mut((c) => { c.greetings[0].title = '  Olá  '; c.messages[0].text = ' Uma mensagem '; }) },
  { nome: 'mensagem sem título ganha o título padrão', conteudo: mut((c) => { delete c.messages[0].title; }) },
  { nome: 'saudação sem complemento é aceita (complemento opcional)', conteudo: mut((c) => { c.greetings[0].text = ''; }) },
  { nome: 'nulo', conteudo: null },
  { nome: 'saudações ausentes', conteudo: { messages: [] } },
  { nome: 'frase grande vazia', conteudo: mut((c) => { c.greetings[0].title = '   '; }) },
  { nome: 'frase grande com 91 caracteres', conteudo: mut((c) => { c.greetings[0].title = 'a'.repeat(91); }) },
  { nome: 'saudação abaixo com 221 caracteres', conteudo: mut((c) => { c.greetings[0].text = 'a'.repeat(221); }) },
  { nome: 'mensagem com 281 caracteres', conteudo: mut((c) => { c.messages[0].text = 'a'.repeat(281); }) },
  { nome: 'mensagem vazia', conteudo: mut((c) => { c.messages[0].text = ''; }) },
  { nome: 'título da mensagem com 91 caracteres', conteudo: mut((c) => { c.messages[0].title = 'a'.repeat(91); }) },
  { nome: 'id repetido', conteudo: mut((c) => { c.messages[1].id = c.messages[0].id; }) },
  { nome: 'id com caractere inválido', conteudo: mut((c) => { c.messages[0].id = 'a b'; }) },
  { nome: 'active que não é booleano', conteudo: mut((c) => { c.messages[0].active = 'sim'; }) },
  { nome: 'público desconhecido', conteudo: mut((c) => { c.messages[0].audience = 'cliente'; }) },
  { nome: 'período desconhecido', conteudo: mut((c) => { c.greetings[0].period = 'meio-dia'; }) },
  { nome: 'sem saudação ativa na manhã do atendimento', conteudo: mut((c) => { c.greetings[0].active = false; }) },
  { nome: 'sem saudação ativa na madrugada do tarólogo', conteudo: mut((c) => { c.greetings.find((g) => g.id === 'tarologo-dawn-1').active = false; }) },
  { nome: 'nenhuma mensagem ativa para o atendimento', conteudo: mut((c) => { c.messages.filter((m) => m.audience === 'atendimento').forEach((m) => { m.active = false; }); }) },
  { nome: 'nenhuma mensagem ativa para o tarólogo', conteudo: mut((c) => { c.messages.filter((m) => m.audience === 'tarologo').forEach((m) => { m.active = false; }); }) },
  { nome: 'saudação inativa com a outra do mesmo período ativa é aceita', conteudo: mut((c) => { c.greetings.push({ id: 'morning-2', audience: 'atendimento', period: 'morning', title: 'Outra', text: '', active: false }); }) },
  { nome: 'mais de 300 saudações para o atendimento', conteudo: mut((c) => { for (let i = 0; i < 300; i += 1) c.greetings.push({ id: `extra-${i}`, audience: 'atendimento', period: 'morning', title: 'x', text: '', active: true }); }) },
  { nome: 'mais de 600 saudações no total', conteudo: mut((c) => { for (let i = 0; i < 601; i += 1) c.greetings.push({ id: `extra-${i}`, audience: i % 2 ? 'atendimento' : 'tarologo', period: 'morning', title: 'x', text: '', active: true }); }) },
];

module.exports = { CENARIOS };
