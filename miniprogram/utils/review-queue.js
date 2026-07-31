function normalizeIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : [])
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim()))];
}

function toggleSelectedId(ids, targetId) {
  const selected = normalizeIds(ids);
  const id = typeof targetId === 'string' ? targetId.trim() : '';
  if (!id) return selected;
  return selected.includes(id)
    ? selected.filter((item) => item !== id)
    : [...selected, id];
}

function uniqueCards(cards) {
  const unique = [];
  const seen = new Set();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || !card._id || seen.has(card._id)) continue;
    seen.add(card._id);
    unique.push(card);
  }
  return unique;
}

function mergeReviewCards(autoCards, manualCards) {
  return uniqueCards([...(autoCards || []), ...(manualCards || [])]);
}

function resolveReviewCards(autoCards, manualCards, mode = 'append') {
  return mode === 'replace'
    ? uniqueCards(manualCards)
    : mergeReviewCards(autoCards, manualCards);
}

function buildReviewSelectionState(cards, selectedIds, expanded = false) {
  const safeCards = uniqueCards(cards);
  const selectedSet = new Set(normalizeIds(selectedIds));
  const orderedSelectedIds = safeCards
    .map((card) => card._id)
    .filter((id) => selectedSet.has(id));
  const validSelectedSet = new Set(orderedSelectedIds);
  const visibleCards = (expanded ? safeCards : safeCards.slice(0, 6))
    .map((card) => ({ ...card, selected: validSelectedSet.has(card._id) }));
  return {
    cards: visibleCards,
    selectedIds: orderedSelectedIds,
    selectedCount: orderedSelectedIds.length,
    allSelected: safeCards.length > 0 && orderedSelectedIds.length === safeCards.length,
  };
}

module.exports = {
  buildReviewSelectionState,
  mergeReviewCards,
  normalizeIds,
  resolveReviewCards,
  toggleSelectedId,
};
