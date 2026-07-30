const cache = require('./cache');
const { callFunction } = require('./cloud');

async function createCard(payload) {
  const card = await callFunction('cardService', { action: 'create', ...payload });
  const cards = cache.getCards().filter((item) => item._id !== card._id);
  cache.setCards([...cards, card]);
  cache.setTodayPlan(null);
  cache.setLastSyncAt(Date.now());
  return card;
}

async function listCards(payload) {
  const result = await callFunction('cardService', { action: 'list', ...payload });
  if ((payload.filter || 'all') === 'all'
    && !String(payload.keyword || '').trim()
    && !(Array.isArray(payload.categoryIds) && payload.categoryIds.length)
    && payload.includeUncategorized !== true
    && Number(payload.page || 1) === 1) {
    cache.setCards(result.items || []);
    cache.setLastSyncAt(Date.now());
  }
  return result;
}

async function getCardsByIds(childId, cardIds) {
  return callFunction('cardService', {
    action: 'getByIds',
    childId,
    cardIds,
  });
}

async function getTodayPlan(childId) {
  const result = await callFunction('cardService', { action: 'getTodayPlan', childId });
  cache.setTodayPlan(result);
  cache.setLastSyncAt(Date.now());
  return result;
}

async function updateCard(payload) {
  const card = await callFunction('cardService', { action: 'update', ...payload });
  cache.setCards(cache.getCards().map((item) => (item._id === card._id ? card : item)));
  cache.setTodayPlan(null);
  cache.setLastSyncAt(Date.now());
  return card;
}

async function deleteCard(payload) {
  const card = await callFunction('cardService', { action: 'delete', ...payload });
  cache.setCards(cache.getCards().filter((item) => item._id !== card._id));
  cache.setTodayPlan(null);
  cache.setLastSyncAt(Date.now());
  return card;
}

module.exports = {
  createCard,
  deleteCard,
  getCardsByIds,
  getTodayPlan,
  listCards,
  updateCard,
};
