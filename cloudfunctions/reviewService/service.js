const VALID_PROFICIENCIES = new Set(['unfamiliar', 'normal', 'proficient']);
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function businessError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function getBusinessDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function normalizeItems(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw businessError('REVIEW_ITEMS_REQUIRED', '请先完成本轮字卡标记');
  }
  if (value.length > 200) {
    throw businessError('REVIEW_ITEMS_TOO_MANY', '单次复习字卡不能超过 200 张');
  }

  const seen = new Set();
  return value.map((item) => {
    const cardId = typeof item.cardId === 'string' ? item.cardId.trim() : '';
    if (!cardId) throw businessError('CARD_ID_REQUIRED', '字卡信息缺失');
    if (seen.has(cardId)) throw businessError('REVIEW_ITEMS_DUPLICATE', '同一字卡不能重复提交');
    seen.add(cardId);
    if (!VALID_PROFICIENCIES.has(item.proficiency)) {
      throw businessError('PROFICIENCY_INVALID', '熟练度标记无效');
    }
    return { cardId, proficiency: item.proficiency };
  });
}

function createReviewService(repository, options = {}) {
  if (!repository) throw new Error('REPOSITORY_REQUIRED');
  const now = options.now || (() => new Date());

  async function complete(openid, payload = {}) {
    if (!openid || typeof openid !== 'string') {
      throw businessError('OPENID_REQUIRED', '登录状态已失效');
    }
    const childId = typeof payload.childId === 'string' ? payload.childId.trim() : '';
    if (!childId) throw businessError('CHILD_ID_REQUIRED', '请选择孩子');
    const items = normalizeItems(payload.items);
    return repository.completeReview({
      openid,
      childId,
      items,
      bizDate: getBusinessDate(now()),
    });
  }

  return { complete };
}

module.exports = {
  VALID_PROFICIENCIES,
  businessError,
  createReviewService,
  getBusinessDate,
  normalizeItems,
};

