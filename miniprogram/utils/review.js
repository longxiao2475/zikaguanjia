const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

const PROFICIENCY_ORDER = Object.freeze({
  unfamiliar: 0,
  normal: 1,
  proficient: 2,
});

function toTimestamp(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return new Date(value).getTime();
  if (typeof value === 'object' && typeof value._seconds === 'number') {
    return value._seconds * 1000;
  }
  return 0;
}

function shanghaiDayNumber(value) {
  return Math.floor((toTimestamp(value) + SHANGHAI_OFFSET_MS) / DAY_MS);
}

function daysSince(value, today) {
  if (!value) return Infinity;
  return shanghaiDayNumber(today) - shanghaiDayNumber(value);
}

function isDue(card, today = new Date()) {
  if (!card || card.status === 'deleted') return false;
  if (!card.lastReviewAt) return card.proficiency === 'unfamiliar';

  const elapsedDays = daysSince(card.lastReviewAt, today);
  if (card.proficiency === 'unfamiliar') return true;
  if (card.proficiency === 'normal') return elapsedDays >= 2;
  if (card.proficiency === 'proficient') return elapsedDays >= 7;
  return false;
}

function sortCards(cards) {
  return [...(cards || [])].sort((left, right) => {
    const proficiencyDiff = (PROFICIENCY_ORDER[left.proficiency] ?? 99)
      - (PROFICIENCY_ORDER[right.proficiency] ?? 99);
    if (proficiencyDiff !== 0) return proficiencyDiff;
    return toTimestamp(left.lastReviewAt) - toTimestamp(right.lastReviewAt);
  });
}

function getTodayReviewCards(cards, today = new Date()) {
  return sortCards((cards || []).filter((card) => isDue(card, today)));
}

function getReviewStats(cards) {
  return (cards || []).reduce((stats, card) => {
    stats.total += 1;
    if (Object.prototype.hasOwnProperty.call(stats, card.proficiency)) {
      stats[card.proficiency] += 1;
    }
    return stats;
  }, {
    total: 0,
    unfamiliar: 0,
    normal: 0,
    proficient: 0,
  });
}

function isStudyDay(child, today = new Date()) {
  const studyDays = Array.isArray(child && child.studyDays) ? child.studyDays : [];
  const shanghaiDate = new Date(toTimestamp(today) + SHANGHAI_OFFSET_MS);
  return studyDays.includes(shanghaiDate.getUTCDay());
}

module.exports = {
  PROFICIENCY_ORDER,
  daysSince,
  getReviewStats,
  getTodayReviewCards,
  isDue,
  isStudyDay,
  sortCards,
  toTimestamp,
};
