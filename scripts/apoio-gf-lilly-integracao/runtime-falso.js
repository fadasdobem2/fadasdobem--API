'use strict';

/**
 * Peças do ciclo com o `LillyRuntime` REAL (modo production): Umbler e IA FALSAS (mesmo padrão de tests/lilly-runtime.test.mjs da Nice),
 * armazenamento em diretório temporário do sistema e relógio controlado. O `fadas` é o FadasAdapter real apontado para a nossa API.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

async function criarRuntime({ importar, fadas, intencao, telefone = '+5511998776666', contato = 'ct-D' }) {
  const { LillyRuntime } = await importar('runtime.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lilly-int-'));
  const relogio = { t: Date.now() };
  const now = () => new Date(relogio.t).toISOString();
  const enviados = [];
  const umblerFalsa = {
    readConversation: async (id) => ({ id, contact: { id: contato, tags: [], phoneNumber: telefone }, channel: { id: 'ch1' }, sector: { id: 's1' }, latestMessages: [] }),
    readContact: async (id) => ({ id, tags: [], phoneNumber: telefone }),
    execute: async (acao, validado) => { enviados.push({ kind: acao.kind, payload: acao.payload, contactId: validado && validado.contactId }); return { id: `m-${enviados.length}` }; },
  };
  const interpreter = { interpret: async (evento) => ({ data: { confidence: 0.99, ...(typeof intencao === 'function' ? intencao(evento) : intencao) }, usage: { input_tokens: 1, output_tokens: 1 } }) };
  const runtime = await LillyRuntime.open({ path: path.join(dir, 'state.json'), mode: 'production', fadas, umbler: umblerFalsa, interpreter, now });
  await runtime.control(true, 'Teste de integração');
  const fechar = async () => { await runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { runtime, relogio, now, enviados, fechar };
}

/** Coloca uma ação direto na fila de saída (como o seedAction da Lilly), já registrada no motor. */
async function semearAcao(runtime, acao, conversa = {}) {
  await runtime.store.transact((s) => {
    s.outbox.push(acao);
    s.engine.actions[acao.id] = JSON.parse(JSON.stringify(acao));
    s.engine.conversations[acao.conversationId] = { id: acao.conversationId, clientId: acao.clientId, pending: false, ...conversa };
  });
}

module.exports = { criarRuntime, semearAcao };
