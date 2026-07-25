const KEYS = Object.freeze({
  user: 'zkg:user',
  child: 'zkg:child',
  cards: 'zkg:cards',
  todayPlan: 'zkg:todayPlan',
  lastSyncAt: 'zkg:lastSyncAt',
});

function read(key, fallback) {
  const value = wx.getStorageSync(key);
  return value === undefined || value === null || value === '' ? fallback : value;
}

function write(key, value) {
  wx.setStorageSync(key, value);
  return value;
}

function clearBusinessCache() {
  Object.values(KEYS).forEach((key) => wx.removeStorageSync(key));
}

module.exports = {
  KEYS,
  getUser: () => read(KEYS.user, null),
  setUser: (value) => write(KEYS.user, value),
  getChild: () => read(KEYS.child, null),
  setChild: (value) => write(KEYS.child, value),
  getCards: () => read(KEYS.cards, []),
  setCards: (value) => write(KEYS.cards, Array.isArray(value) ? value : []),
  getTodayPlan: () => read(KEYS.todayPlan, null),
  setTodayPlan: (value) => write(KEYS.todayPlan, value),
  getLastSyncAt: () => read(KEYS.lastSyncAt, null),
  setLastSyncAt: (value) => write(KEYS.lastSyncAt, value),
  clearBusinessCache,
};
