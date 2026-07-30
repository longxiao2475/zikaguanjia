const {
  getReviewStats,
  getTodayReviewCards,
  sortCards,
} = require('./review');

const VALID_PROFICIENCIES = new Set(['unfamiliar', 'normal', 'proficient']);
const VALID_SOURCES = new Set(['new', 'reviewed']);

function businessError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function normalizeContent(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').trim().replace(/\s+/g, '');
}

function normalizeCustomWords(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeContent).filter(Boolean))].slice(0, 20);
}

function normalizeCategoryIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim()))].slice(0, 10);
}

function createCardService(repository, options = {}) {
  if (!repository) throw new Error('REPOSITORY_REQUIRED');
  const now = options.now || (() => new Date());

  async function assertChildOwnership(openid, childId) {
    if (!childId) throw businessError('CHILD_ID_REQUIRED', '请选择孩子');
    const child = await repository.findChildById(childId);
    if (!child || child.ownerOpenid !== openid || child.status !== 'active') {
      throw businessError('CHILD_FORBIDDEN', '无权访问该孩子');
    }
    return child;
  }

  function validateContent(content) {
    const normalizedContent = normalizeContent(content);
    const length = Array.from(normalizedContent).length;
    if (!normalizedContent) throw businessError('CARD_CONTENT_REQUIRED', '请输入字或词');
    if (length > 20) throw businessError('CARD_CONTENT_TOO_LONG', '字卡内容不能超过 20 个字符');
    return normalizedContent;
  }

  async function validateCategoryIds(childId, value) {
    const categoryIds = normalizeCategoryIds(value);
    if (!categoryIds.length) return [];
    const categories = await repository.findCategoriesByIds(categoryIds);
    const validIds = new Set(categories
      .filter((category) => category.childId === childId && category.status === 'active')
      .map((category) => category._id));
    if (categoryIds.some((id) => !validIds.has(id))) {
      throw businessError('CATEGORY_INVALID', '所选分类已失效，请重新选择');
    }
    return categoryIds;
  }

  async function create(openid, payload = {}) {
    await assertChildOwnership(openid, payload.childId);
    const normalizedContent = validateContent(payload.content);
    const categoryIds = await validateCategoryIds(payload.childId, payload.categoryIds);
    const source = VALID_SOURCES.has(payload.source) ? payload.source : 'new';
    const duplicate = await repository.findActiveByNormalized(payload.childId, normalizedContent);
    if (duplicate) throw businessError('CARD_DUPLICATE', '这个字卡已经存在');

    return repository.createCard({
      ownerOpenid: openid,
      childId: payload.childId,
      content: normalizedContent,
      normalizedContent,
      type: Array.from(normalizedContent).length === 1 ? 'char' : 'word',
      language: 'zh',
      proficiency: source === 'reviewed' ? 'normal' : 'unfamiliar',
      source,
      lastReviewAt: null,
      reviewCount: 0,
      customWords: [],
      categoryIds,
      status: 'active',
      deletedAt: null,
    });
  }

  async function list(openid, payload = {}) {
    await assertChildOwnership(openid, payload.childId);
    const allCards = sortCards(await repository.listActiveCards(payload.childId));
    const categoryIds = normalizeCategoryIds(payload.categoryIds);
    const includeUncategorized = payload.includeUncategorized === true;
    const hasCategoryFilter = categoryIds.length > 0 || includeUncategorized;
    const categoryIdSet = new Set(categoryIds);
    const categoryCards = hasCategoryFilter
      ? allCards.filter((card) => {
        const cardCategoryIds = normalizeCategoryIds(card.categoryIds);
        return cardCategoryIds.some((id) => categoryIdSet.has(id))
          || (includeUncategorized && cardCategoryIds.length === 0);
      })
      : allCards;
    const todayCards = getTodayReviewCards(categoryCards, now());
    const masteredCards = categoryCards.filter((card) => card.proficiency === 'proficient');
    const filter = ['all', 'due', 'mastered'].includes(payload.filter) ? payload.filter : 'all';
    const byFilter = filter === 'due' ? todayCards : filter === 'mastered' ? masteredCards : categoryCards;
    const keyword = normalizeContent(payload.keyword || '');
    const filtered = keyword
      ? byFilter.filter((card) => normalizeContent(card.normalizedContent || card.content).includes(keyword))
      : byFilter;
    const page = Math.max(1, Number(payload.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(payload.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const items = filtered.slice(offset, offset + pageSize);

    return {
      items,
      page,
      pageSize,
      total: filtered.length,
      hasMore: offset + items.length < filtered.length,
      counts: {
        all: categoryCards.length,
        due: todayCards.length,
        mastered: masteredCards.length,
      },
    };
  }

  async function getByIds(openid, payload = {}) {
    await assertChildOwnership(openid, payload.childId);
    const rawIds = Array.isArray(payload.cardIds) ? payload.cardIds : [];
    if (rawIds.length > 50) {
      throw businessError('CARD_IDS_TOO_MANY', '一次最多选择 50 张字卡');
    }
    const cardIds = [...new Set(rawIds
      .filter((id) => typeof id === 'string' && id.trim())
      .map((id) => id.trim()))];
    const cards = await Promise.all(cardIds.map((id) => repository.findCardById(id)));
    return cards.filter((card) => (
      card
      && card.childId === payload.childId
      && card.ownerOpenid === openid
      && card.status === 'active'
    ));
  }

  async function getTodayPlan(openid, payload = {}) {
    await assertChildOwnership(openid, payload.childId);
    const allCards = sortCards(await repository.listActiveCards(payload.childId));
    const cards = getTodayReviewCards(allCards, now());
    return {
      cards,
      stats: getReviewStats(cards),
      overview: {
        total: allCards.length,
        mastered: allCards.filter((card) => card.proficiency === 'proficient').length,
        due: cards.length,
      },
      generatedAt: now().toISOString(),
    };
  }

  async function update(openid, payload = {}) {
    await assertChildOwnership(openid, payload.childId);
    const card = await repository.findCardById(payload.cardId);
    if (!card || card.childId !== payload.childId || card.status !== 'active') {
      throw businessError('CARD_NOT_FOUND', '字卡不存在');
    }

    const updates = {};
    if (payload.content !== undefined) {
      const normalizedContent = validateContent(payload.content);
      const duplicate = await repository.findActiveByNormalized(payload.childId, normalizedContent, card._id);
      if (duplicate) throw businessError('CARD_DUPLICATE', '这个字卡已经存在');
      updates.content = normalizedContent;
      updates.normalizedContent = normalizedContent;
      updates.type = Array.from(normalizedContent).length === 1 ? 'char' : 'word';
    }
    if (payload.proficiency !== undefined) {
      if (!VALID_PROFICIENCIES.has(payload.proficiency)) {
        throw businessError('PROFICIENCY_INVALID', '熟练度无效');
      }
      updates.proficiency = payload.proficiency;
    }
    if (payload.source !== undefined) {
      if (!VALID_SOURCES.has(payload.source)) throw businessError('SOURCE_INVALID', '字卡来源无效');
      updates.source = payload.source;
    }
    if (payload.customWords !== undefined) updates.customWords = normalizeCustomWords(payload.customWords);
    if (payload.categoryIds !== undefined) {
      updates.categoryIds = await validateCategoryIds(payload.childId, payload.categoryIds);
    }
    return repository.updateCard(card._id, updates);
  }

  async function remove(openid, payload = {}) {
    await assertChildOwnership(openid, payload.childId);
    const card = await repository.findCardById(payload.cardId);
    if (!card || card.childId !== payload.childId || card.status !== 'active') {
      throw businessError('CARD_NOT_FOUND', '字卡不存在');
    }
    return repository.updateCard(card._id, {
      status: 'deleted',
      deletedAt: now(),
    });
  }

  return {
    create,
    getByIds,
    getTodayPlan,
    list,
    remove,
    update,
  };
}

module.exports = {
  businessError,
  createCardService,
  normalizeCategoryIds,
  normalizeContent,
};
