const { daysSince } = require('./review');

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const META = Object.freeze({
  unfamiliar: { label: '不熟', className: 'unfamiliar' },
  normal: { label: '一般', className: 'normal' },
  proficient: { label: '熟练', className: 'proficient' },
});
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function shanghaiDate(value = new Date()) {
  return new Date(new Date(value).getTime() + SHANGHAI_OFFSET_MS);
}

function formatDisplayDate(value = new Date()) {
  const date = shanghaiDate(value);
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${WEEKDAYS[date.getUTCDay()]}`;
}

function getGreeting(value = new Date()) {
  const hour = shanghaiDate(value).getUTCHours();
  if (hour < 11) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function getProficiencyMeta(proficiency) {
  return META[proficiency] || META.unfamiliar;
}

function formatLastReview(lastReviewAt, today = new Date()) {
  if (!lastReviewAt) return '还没复习过';
  const elapsed = Math.max(0, daysSince(lastReviewAt, today));
  if (elapsed === 0) return '今天复习过';
  if (elapsed === 1) return '昨天复习';
  return `${elapsed} 天前复习`;
}

function decorateCard(card, today = new Date()) {
  const meta = getProficiencyMeta(card.proficiency);
  return {
    ...card,
    proficiencyLabel: meta.label,
    proficiencyClass: meta.className,
    typeLabel: card.type === 'word' ? '词语' : '单字',
    lastReviewLabel: formatLastReview(card.lastReviewAt, today),
  };
}

module.exports = {
  decorateCard,
  formatDisplayDate,
  formatLastReview,
  getGreeting,
  getProficiencyMeta,
};
