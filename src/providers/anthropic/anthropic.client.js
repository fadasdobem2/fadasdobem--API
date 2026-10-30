const Anthropic = require('@anthropic-ai/sdk');

let singleton;

/**
 * Cliente singleton da Anthropic (Messages API / Tool Use).
 */
function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY ausente no ambiente.');
  }
  if (!singleton) {
    singleton = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return singleton;
}

module.exports = {
  getAnthropicClient,
};
