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

function mergeReviewCards(autoCards, manualCards) {
  const merged = [];
  const seen = new Set();
  for (const card of [...(autoCards || []), ...(manualCards || [])]) {
    if (!card || !card._id || seen.has(card._id)) continue;
    seen.add(card._id);
    merged.push(card);
  }
  return merged;
}

module.exports = {
  mergeReviewCards,
  normalizeIds,
  toggleSelectedId,
};
