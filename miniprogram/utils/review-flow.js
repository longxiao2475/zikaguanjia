const VALID_PROFICIENCIES = new Set(['unfamiliar', 'normal', 'proficient']);

function createReviewState(cards) {
  const safeCards = Array.isArray(cards) ? cards.filter((card) => card && card._id) : [];
  return {
    cards: safeCards,
    currentIndex: 0,
    currentCard: safeCards[0] || null,
    results: [],
    readyToSubmit: false,
    progressPercent: 0,
  };
}

function markCurrent(state, proficiency) {
  if (!VALID_PROFICIENCIES.has(proficiency)) throw new Error('PROFICIENCY_INVALID');
  if (!state || state.readyToSubmit) throw new Error('REVIEW_ALREADY_COMPLETE');
  const currentCard = state.currentCard;
  if (!currentCard) throw new Error('REVIEW_CARD_MISSING');

  const results = [
    ...state.results,
    { cardId: currentCard._id, proficiency },
  ];
  const readyToSubmit = results.length === state.cards.length;
  const currentIndex = readyToSubmit ? state.currentIndex : state.currentIndex + 1;
  return {
    ...state,
    currentIndex,
    currentCard: state.cards[currentIndex] || currentCard,
    results,
    readyToSubmit,
    progressPercent: Math.round((results.length / state.cards.length) * 100),
  };
}

function buildCompletePayload(childId, state) {
  if (!childId) throw new Error('CHILD_ID_REQUIRED');
  if (!state || !state.readyToSubmit || state.results.length !== state.cards.length) {
    throw new Error('REVIEW_NOT_READY');
  }
  return {
    childId,
    items: state.results.map((item) => ({ ...item })),
  };
}

module.exports = {
  VALID_PROFICIENCIES,
  buildCompletePayload,
  createReviewState,
  markCurrent,
};
