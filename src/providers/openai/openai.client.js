const OpenAI = require('openai');

let singleton;

/** Instância compartilhada do cliente OpenAI (lazy). */
function getOpenAiClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY não configurado');
  }
  if (!singleton) {
    singleton = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return singleton;
}

module.exports = {
  getOpenAiClient,
};
