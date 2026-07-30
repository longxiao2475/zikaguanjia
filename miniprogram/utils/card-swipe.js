const SWIPE_THRESHOLD_PX = 36;

function getSwipeIntent(start, end) {
  if (!start || !end) return 'none';
  const deltaX = Number(end.x) - Number(start.x);
  const deltaY = Number(end.y) - Number(start.y);
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return 'none';
  if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX || Math.abs(deltaX) <= Math.abs(deltaY)) return 'none';
  return deltaX < 0 ? 'open' : 'close';
}

function setOpenSwipeCard(items, cardId) {
  return (items || []).map((item) => ({
    ...item,
    swipeOpen: Boolean(cardId && item._id === cardId),
  }));
}

module.exports = {
  SWIPE_THRESHOLD_PX,
  getSwipeIntent,
  setOpenSwipeCard,
};
