const cache = require('./cache');
const { callFunction } = require('./cloud');

async function completeReview(payload) {
  const result = await callFunction('reviewService', { action: 'complete', ...payload });
  const updates = new Map((result.cards || []).filter(Boolean).map((card) => [card._id, card]));
  cache.setCards(cache.getCards().map((card) => updates.get(card._id) || card));
  cache.setTodayPlan(null);
  cache.setLastSyncAt(Date.now());
  return result;
}

module.exports = {
  completeReview,
};

