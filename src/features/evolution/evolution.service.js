const evolutionClient = require('../../providers/evolution/evolution.client');

async function summarizeInstancesSafe() {
  try {
    return await evolutionClient.fetchInstances();
  } catch (err) {
    console.error('[evolution.service] fetchInstances', err.response?.data || err.message);
    throw err;
  }
}

async function refreshQrArtifacts(instanceName) {
  try {
    return await evolutionClient.qrCodeReconnect(instanceName);
  } catch (err) {
    console.error('[evolution.service] reconnect', err.response?.data || err.message);
    throw err;
  }
}

module.exports = {
  summarizeInstancesSafe,
  refreshQrArtifacts,
};
