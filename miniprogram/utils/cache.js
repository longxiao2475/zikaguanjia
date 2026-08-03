const { normalizeIds } = require('./review-queue');

const MANUAL_REVIEW_QUEUE_TTL_MS = 30 * 60 * 1000;
const LIBRARY_FILTERS = new Set(['all', 'due', 'mastered']);
const REVIEW_QUEUE_MODES = new Set(['append', 'replace']);

const KEYS = Object.freeze({
  user: 'zkg:user',
  family: 'zkg:family',
  member: 'zkg:member',
  child: 'zkg:child',
  cards: 'zkg:cards',
  categories: 'zkg:categories',
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

const FAMILY_BUSINESS_KEYS = Object.freeze([
  KEYS.child,
  KEYS.cards,
  KEYS.categories,
  KEYS.todayPlan,
  KEYS.lastSyncAt,
  KEYS.libraryFilterIntent,
  KEYS.manualReviewQueue,
]);

function getActiveFamilyId() {
  const family = read(KEYS.family, null);
  return family && family._id ? family._id : '';
}

function readFamilyValue(key, fallback) {
  const stored = read(key, fallback);
  if (!stored || typeof stored !== 'object' || stored.__familyScoped !== true) return stored;
  return stored.familyId && stored.familyId === getActiveFamilyId()
    ? stored.value
    : fallback;
}

function writeFamilyValue(key, value) {
  const familyId = getActiveFamilyId();
  return familyId
    ? write(key, { __familyScoped: true, familyId, value }) && value
    : write(key, value);
}

function clearFamilyBusinessData() {
  FAMILY_BUSINESS_KEYS.forEach((key) => wx.removeStorageSync(key));
}

function normalizeReviewQueueMode(mode) {
  return REVIEW_QUEUE_MODES.has(mode) ? mode : 'append';
}

module.exports = {
  KEYS,
  getUser: () => read(KEYS.user, null),
  setUser: (value) => write(KEYS.user, value),
  getFamily: () => read(KEYS.family, null),
  setFamily: (value) => write(KEYS.family, value),
  getMember: () => read(KEYS.member, null),
  setMember: (value) => write(KEYS.member, value),
  getChild: () => readFamilyValue(KEYS.child, null),
  setChild: (value) => writeFamilyValue(KEYS.child, value),
  getCards: () => readFamilyValue(KEYS.cards, []),
  setCards: (value) => writeFamilyValue(KEYS.cards, Array.isArray(value) ? value : []),
  getCategories: () => readFamilyValue(KEYS.categories, []),
  setCategories: (value) => writeFamilyValue(KEYS.categories, Array.isArray(value) ? value : []),
  getTodayPlan: () => readFamilyValue(KEYS.todayPlan, null),
  setTodayPlan: (value) => writeFamilyValue(KEYS.todayPlan, value),
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
  setManualReviewQueue(cardIds, createdAt = Date.now(), mode = 'append') {
    const ids = normalizeIds(cardIds).slice(0, 50);
    if (!ids.length) {
      wx.removeStorageSync(KEYS.manualReviewQueue);
      return null;
    }
    return write(KEYS.manualReviewQueue, {
      cardIds: ids,
      mode: normalizeReviewQueueMode(mode),
      createdAt,
    });
  },
  getManualReviewQueue(now = Date.now()) {
    const queue = read(KEYS.manualReviewQueue, null);
    const ids = normalizeIds(queue && queue.cardIds).slice(0, 50);
    if (!queue || !ids.length || typeof queue.createdAt !== 'number'
      || now - queue.createdAt > MANUAL_REVIEW_QUEUE_TTL_MS) {
      wx.removeStorageSync(KEYS.manualReviewQueue);
      return null;
    }
    return {
      cardIds: ids,
      mode: normalizeReviewQueueMode(queue.mode),
      createdAt: queue.createdAt,
    };
  },
  clearManualReviewQueue() {
    wx.removeStorageSync(KEYS.manualReviewQueue);
  },
  clearFamilyBusinessData,
  clearBusinessCache,
};
