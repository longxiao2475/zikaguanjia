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

module.exports = {
  bootstrap,
  getCachedSession,
};
