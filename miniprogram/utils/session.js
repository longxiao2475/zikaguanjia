const cache = require('./cache');
const { callFunction } = require('./cloud');

async function bootstrap() {
  const data = await callFunction('syncSettings', { action: 'bootstrap' });
  cache.setUser(data.user);
  cache.setChild(data.child);
  cache.setLastSyncAt(Date.now());
  return data;
}

function getCachedSession() {
  return {
    user: cache.getUser(),
    child: cache.getChild(),
  };
}

async function saveSettings(payload) {
  const child = await callFunction('syncSettings', { action: 'saveSettings', ...payload });
  cache.setChild(child);
  cache.setLastSyncAt(Date.now());
  return child;
}

module.exports = {
  bootstrap,
  getCachedSession,
  saveSettings,
};
