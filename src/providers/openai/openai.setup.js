const { APIError } = require('openai');
const prompts = require('./openai.prompts');
const { assistantToolDefinitions } = require('./openai.tools');
const { getOpenAiClient } = require('./openai.client');

const MODEL_FALLBACK = 'gpt-4o-mini';

let cachedAssistantId;
/** Fila síncrona simples garante apenas um discover/create paralelo mesmo em burst de webhooks */
let provisioningChain = Promise.resolve();

function registryMatcher(assistant, slugExact, expectedName) {
  const slug = assistant?.metadata?.fadbem_slug;
  if (slug && slugExact && slug === slugExact) return true;
  const nameHit = assistant?.name && expectedName && assistant.name === expectedName;
  return Boolean(nameHit);
}

async function findAssistantViaRegistry(client, slugExact, expectedName) {
  let page = await client.beta.assistants.list({ limit: 50 });
  for (;;) {
    const hit = page.data.find((a) => registryMatcher(a, slugExact, expectedName));
    if (hit) return hit;
    if (!page.hasNextPage?.()) break;
    page = await page.getNextPage();
  }
  return null;
}

async function createConfiguredAssistant(client) {
  const model = process.env.OPENAI_ASSISTANT_MODEL || MODEL_FALLBACK;
  const assistant = await client.beta.assistants.create({
    name: prompts.ASSISTANT_DISPLAY_NAME,
    instructions: prompts.ASSISTANT_SYSTEM_INSTRUCTIONS,
    model,
    tools: assistantToolDefinitions(),
    metadata: {
      app: 'fadasdobem',
      managed_by_code: 'true',
      fadbem_slug: prompts.ASSISTANT_REGISTRY_SLUG,
    },
  });
  console.warn(
    '[openai.setup] Assistant criado/atualizado via API — copie OPENAI_ASSISTANT_ID:',
    assistant.id
  );
  return assistant.id;
}

async function discoverOrCreateAssistant() {
  const client = getOpenAiClient();
  const envId = (process.env.OPENAI_ASSISTANT_ID || '').trim();

  if (envId) {
    try {
      const existing = await client.beta.assistants.retrieve(envId);
      const matchesRegistry = registryMatcher(
        existing,
        prompts.ASSISTANT_REGISTRY_SLUG,
        prompts.ASSISTANT_DISPLAY_NAME
      );
      if (!matchesRegistry) {
        console.warn(
          '[openai.setup] OPENAI_ASSISTANT_ID fixo diverge slug/nome canônicos — usando ID explícito informado mesmo assim:',
          `${envId.slice(0, 8)}…`
        );
      }
      return existing.id;
    } catch (err) {
      const notFound =
        err instanceof APIError &&
        typeof err.status === 'number' &&
        (err.status === 404 || err.status === 410);
      if (!notFound) throw err;
      console.warn(
        '[openai.setup] Assistente inexistente no OpenAI para OPENAI_ASSISTANT_ID:',
        `${envId.slice(0, 8)}… — recriamos via código.`
      );
    }
  }

  const reused = await findAssistantViaRegistry(
    client,
    prompts.ASSISTANT_REGISTRY_SLUG,
    prompts.ASSISTANT_DISPLAY_NAME
  );
  if (reused) return reused.id;

  return createConfiguredAssistant(client);
}

/**
 * Resolve `assistant_id` único garantindo serialização mesmo com concorrência.
 */
function getAssistantId() {
  provisioningChain = provisioningChain.then(async () => {
    if (cachedAssistantId) return cachedAssistantId;
    const id = await discoverOrCreateAssistant();
    cachedAssistantId = id;
    return id;
  });
  return provisioningChain;
}

async function warmupAssistantsSilent() {
  if (!process.env.OPENAI_API_KEY) return null;
  const id = await getAssistantId();
  console.info('[openai.setup] Assistants=v2 aquecido:', `${id.slice(0, 10)}…`);
  return id;
}

module.exports = {
  getAssistantId,
  warmupAssistantsSilent,
};
