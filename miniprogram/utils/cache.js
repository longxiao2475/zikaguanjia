const { normalizeIds } = require('./review-queue');

const MANUAL_REVIEW_QUEUE_TTL_MS = 30 * 60 * 1000;
const LIBRARY_FILTERS = new Set(['all', 'due', 'mastered']);

const KEYS = Object.freeze({
  user: 'zkg:user',
  child: 'zkg:child',
  cards: 'zkg:cards',
  todayPlan: 'zkg:todayPlan',
  lastSyncAt: 'zkg:lastSyncAt',
  libraryFilterIntent: 'zkg:libraryFilterIntent',
  manualReviewQueue: 'zkg:manualReviewQueue',
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
  setLibraryFilterIntent(filter) {
    if (!LIBRARY_FILTERS.has(filter)) {
      wx.removeStorageSync(KEYS.libraryFilterIntent);
      return null;
    }
    return write(KEYS.libraryFilterIntent, filter);
  },
  consumeLibraryFilterIntent() {
    const filter = read(KEYS.libraryFilterIntent, null);
    wx.removeStorageSync(KEYS.libraryFilterIntent);
    return LIBRARY_FILTERS.has(filter) ? filter : null;
  },
  setManualReviewQueue(cardIds, createdAt = Date.now()) {
    const ids = normalizeIds(cardIds).slice(0, 50);
    if (!ids.length) {
      wx.removeStorageSync(KEYS.manualReviewQueue);
      return null;
    }
    return write(KEYS.manualReviewQueue, { cardIds: ids, createdAt });
  },
  getManualReviewQueue(now = Date.now()) {
    const queue = read(KEYS.manualReviewQueue, null);
    const ids = normalizeIds(queue && queue.cardIds).slice(0, 50);
    if (!queue || !ids.length || typeof queue.createdAt !== 'number'
      || now - queue.createdAt > MANUAL_REVIEW_QUEUE_TTL_MS) {
      wx.removeStorageSync(KEYS.manualReviewQueue);
      return null;
    }
    return { cardIds: ids, createdAt: queue.createdAt };
  },
  clearManualReviewQueue() {
    wx.removeStorageSync(KEYS.manualReviewQueue);
  },
  clearBusinessCache,
};
