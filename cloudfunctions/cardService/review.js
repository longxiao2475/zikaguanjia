const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const ORDER = Object.freeze({ unfamiliar: 0, normal: 1, proficient: 2 });

function toTimestamp(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return new Date(value).getTime();
  if (typeof value === 'object' && typeof value._seconds === 'number') return value._seconds * 1000;
  return 0;
}

function dayNumber(value) {
  return Math.floor((toTimestamp(value) + SHANGHAI_OFFSET_MS) / DAY_MS);
}

function isDue(card, today) {
  if (!card.lastReviewAt) return true;
  const elapsedDays = dayNumber(today) - dayNumber(card.lastReviewAt);
  if (card.proficiency === 'unfamiliar') return true;
  if (card.proficiency === 'normal') return elapsedDays >= 2;
  if (card.proficiency === 'proficient') return elapsedDays >= 7;
  return false;
}

function sortCards(cards) {
  return [...cards].sort((left, right) => {
    const proficiencyDiff = (ORDER[left.proficiency] ?? 99) - (ORDER[right.proficiency] ?? 99);
    if (proficiencyDiff !== 0) return proficiencyDiff;
    return toTimestamp(left.lastReviewAt) - toTimestamp(right.lastReviewAt);
  });
}

function getTodayReviewCards(cards, today) {
  return sortCards(cards.filter((card) => isDue(card, today)));
}

function getReviewStats(cards) {
  return cards.reduce((stats, card) => {
    stats.total += 1;
    if (Object.prototype.hasOwnProperty.call(stats, card.proficiency)) stats[card.proficiency] += 1;
    return stats;
  }, { total: 0, unfamiliar: 0, normal: 0, proficient: 0 });
}

module.exports = {
  getReviewStats,
  getTodayReviewCards,
  sortCards,
};
