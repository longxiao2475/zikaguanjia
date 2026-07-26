const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function toTimestamp(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return new Date(value).getTime();
  if (typeof value === 'object' && typeof value._seconds === 'number') return value._seconds * 1000;
  return 0;
}

function getShanghaiContext(value = new Date()) {
  const date = new Date(toTimestamp(value) + SHANGHAI_OFFSET_MS);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = date.getUTCHours();
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const bizDate = `${year}-${month}-${day}`;
  return {
    bizDate,
    dayOfWeek: date.getUTCDay(),
    hour,
    dateTime: `${bizDate} ${String(hour).padStart(2, '0')}:${minute}`,
  };
}

function shouldRemindChild(child, context) {
  const studyDays = Array.isArray(child && child.studyDays) ? child.studyDays : [];
  const reminderHour = Number(String(child && child.reminderTime || '').slice(0, 2));
  return studyDays.includes(context.dayOfWeek) && reminderHour === context.hour;
}

function shanghaiDayNumber(value) {
  return Math.floor((toTimestamp(value) + SHANGHAI_OFFSET_MS) / DAY_MS);
}

function isDue(card, now) {
  if (!card || card.status === 'deleted') return false;
  if (!card.lastReviewAt) return card.proficiency === 'unfamiliar';
  const elapsedDays = shanghaiDayNumber(now) - shanghaiDayNumber(card.lastReviewAt);
  if (card.proficiency === 'unfamiliar') return true;
  if (card.proficiency === 'normal') return elapsedDays >= 2;
  if (card.proficiency === 'proficient') return elapsedDays >= 7;
  return false;
}

function getDueCards(cards, now = new Date()) {
  const order = { unfamiliar: 0, normal: 1, proficient: 2 };
  return (cards || []).filter((card) => isDue(card, now)).sort((left, right) => {
    const proficiencyDiff = (order[left.proficiency] ?? 99) - (order[right.proficiency] ?? 99);
    if (proficiencyDiff !== 0) return proficiencyDiff;
    return toTimestamp(left.lastReviewAt) - toTimestamp(right.lastReviewAt);
  });
}

function truncateText(value, limit) {
  return Array.from(String(value || '')).slice(0, limit).join('');
}

function buildTemplateData(cards, bizDate, reminderTime) {
  return {
    number1: { value: String(cards.length) },
    thing2: { value: truncateText(cards.map((card) => card.content).join('、'), 20) },
    time5: { value: `${bizDate} ${reminderTime}` },
  };
}

module.exports = {
  buildTemplateData,
  getDueCards,
  getShanghaiContext,
  isDue,
  shouldRemindChild,
  toTimestamp,
  truncateText,
};

