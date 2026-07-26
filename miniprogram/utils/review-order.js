function getOrderPreviewIndex(y, rowPitch, itemCount) {
  if (!Number.isFinite(rowPitch)
    || rowPitch <= 0
    || !Number.isInteger(itemCount)
    || itemCount <= 0) {
    return 0;
  }
  const rawIndex = Math.round((Number(y) || 0) / rowPitch);
  return Math.max(0, Math.min(itemCount - 1, rawIndex));
}

function getPreviewY(index, fromIndex, previewIndex, rowPitch) {
  if (index === fromIndex) return fromIndex * rowPitch;
  if (fromIndex < previewIndex && index > fromIndex && index <= previewIndex) {
    return (index - 1) * rowPitch;
  }
  if (fromIndex > previewIndex && index >= previewIndex && index < fromIndex) {
    return (index + 1) * rowPitch;
  }
  return index * rowPitch;
}

function buildOrderPreviewItems(items, fromIndex, previewIndex, rowPitch) {
  return (items || []).map((item, index) => ({
    ...item,
    y: getPreviewY(index, fromIndex, previewIndex, rowPitch),
    dragging: index === fromIndex,
    animate: index !== fromIndex,
  }));
}

function reorderPendingCards(state, fromIndex, toIndex) {
  if (!state || state.readyToSubmit) throw new Error('REVIEW_ALREADY_COMPLETE');
  const completedCount = Array.isArray(state.results) ? state.results.length : 0;
  const pendingCards = Array.isArray(state.cards) ? state.cards.slice(completedCount) : [];
  const indexesAreValid = Number.isInteger(fromIndex)
    && Number.isInteger(toIndex)
    && fromIndex >= 0
    && toIndex >= 0
    && fromIndex < pendingCards.length
    && toIndex < pendingCards.length;
  if (!indexesAreValid) throw new Error('REVIEW_REORDER_INDEX_INVALID');
  if (fromIndex === toIndex) return state;

  const reorderedPendingCards = [...pendingCards];
  const [movedCard] = reorderedPendingCards.splice(fromIndex, 1);
  reorderedPendingCards.splice(toIndex, 0, movedCard);
  const cards = [
    ...state.cards.slice(0, completedCount),
    ...reorderedPendingCards,
  ];
  return {
    ...state,
    cards,
    currentIndex: completedCount,
    currentCard: reorderedPendingCards[0] || null,
  };
}

module.exports = {
  buildOrderPreviewItems,
  getOrderPreviewIndex,
  reorderPendingCards,
};
