const cache = require('./cache');
const { callFunction } = require('./cloud');

async function bootstrap() {
  const data = await callFunction('syncSettings', { action: 'bootstrap' });
  const previousFamily = cache.getFamily();
  if (previousFamily && data.family && previousFamily._id !== data.family._id) {
    cache.clearFamilyBusinessData();
  }
  cache.setUser(data.user);
  cache.setFamily(data.family || null);
  cache.setMember(data.member || null);
  cache.setChild(data.child);
  cache.setLastSyncAt(Date.now());
  return data;
}

function getCachedSession() {
  return {
    user: cache.getUser(),
    family: cache.getFamily(),
    member: cache.getMember(),
    child: cache.getChild(),
  };
}

async function saveSettings(payload) {
  const data = await callFunction('syncSettings', { action: 'saveSettings', ...payload });
  cache.setChild(data.child);
  cache.setMember(data.member);
  cache.setLastSyncAt(Date.now());
  return data;
}

module.exports = {
  bootstrap,
  getCachedSession,
  saveSettings,
};
