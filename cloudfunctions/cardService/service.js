const {
  getReviewStats,
  getTodayReviewCards,
  matchesReviewAge,
  sortCards,
} = require('./review');
const { assertChildAccess } = require('./family');

const VALID_PROFICIENCIES = new Set(['unfamiliar', 'normal', 'proficient']);
const VALID_SOURCES = new Set(['new', 'reviewed']);
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

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

function normalizeCategoryIds(value, limit = 10) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim()))].slice(0, limit);
}

function getBusinessDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function createCardService(repository, options = {}) {
  if (!repository) throw new Error('REPOSITORY_REQUIRED');
  const now = options.now || (() => new Date());

  function validateContent(content) {
    const normalizedContent = normalizeContent(content);
    const length = Array.from(normalizedContent).length;
    if (!normalizedContent) throw businessError('CARD_CONTENT_REQUIRED', '请输入字或词');
    if (length > 20) throw businessError('CARD_CONTENT_TOO_LONG', '字卡内容不能超过 20 个字符');
    return normalizedContent;
  }

  async function validateCategoryIds(familyId, childId, value) {
    const categoryIds = normalizeCategoryIds(value);
    if (!categoryIds.length) return [];
    const categories = await repository.findCategoriesByIds(categoryIds);
    const validIds = new Set(categories
      .filter((category) => (
        category.familyId === familyId
        && category.childId === childId
        && category.status === 'active'
      ))
      .map((category) => category._id));
    if (categoryIds.some((id) => !validIds.has(id))) {
      throw businessError('CATEGORY_INVALID', '所选分类已失效，请重新选择');
    }
    return categoryIds;
  }

  async function create(openid, payload = {}) {
    const access = await assertChildAccess(repository, openid, payload.childId);
    const normalizedContent = validateContent(payload.content);
    const categoryIds = await validateCategoryIds(access.familyId, payload.childId, payload.categoryIds);
    const source = VALID_SOURCES.has(payload.source) ? payload.source : 'new';
    const duplicate = await repository.findActiveByNormalized(
      access.familyId,
      payload.childId,
      normalizedContent,
    );
    if (duplicate) throw businessError('CARD_DUPLICATE', '这个字卡已经存在');

    return repository.createCard({
      familyId: access.familyId,
      createdByOpenid: openid,
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
    const access = await assertChildAccess(repository, openid, payload.childId);
    const allCards = sortCards(await repository.listActiveCards(access.familyId, payload.childId));
    const categoryIds = normalizeCategoryIds(payload.categoryIds, 50);
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
    const keyword = normalizeContent(payload.keyword || '');
    const keywordCards = keyword
      ? categoryCards.filter((card) => normalizeContent(card.normalizedContent || card.content).includes(keyword))
      : categoryCards;
    const reviewAgeDays = [7, 30].includes(Number(payload.reviewAgeDays))
      ? Number(payload.reviewAgeDays)
      : 0;
    const currentTime = now();
    const scopedCards = keywordCards.filter((card) => (
      matchesReviewAge(card, reviewAgeDays, currentTime)
    ));
    const todayCards = getTodayReviewCards(scopedCards, currentTime);
    const masteredCards = scopedCards.filter((card) => card.proficiency === 'proficient');
    const filter = ['all', 'due', 'mastered'].includes(payload.filter) ? payload.filter : 'all';
    const filtered = filter === 'due'
      ? todayCards
      : filter === 'mastered'
        ? masteredCards
        : scopedCards;
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
        all: scopedCards.length,
        due: todayCards.length,
        mastered: masteredCards.length,
      },
    };
  }

  async function getByIds(openid, payload = {}) {
    const access = await assertChildAccess(repository, openid, payload.childId);
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
      && card.familyId === access.familyId
      && card.status === 'active'
    ));
  }

  async function addReviewAssignments(openid, payload = {}) {
    const access = await assertChildAccess(repository, openid, payload.childId);
    const rawIds = Array.isArray(payload.cardIds) ? payload.cardIds : [];
    if (!rawIds.length) throw businessError('CARD_IDS_REQUIRED', '请先选择要复习的字卡');
    if (rawIds.length > 50) throw businessError('CARD_IDS_TOO_MANY', '一次最多选择 50 张字卡');
    const cardIds = [...new Set(rawIds
      .filter((id) => typeof id === 'string' && id.trim())
      .map((id) => id.trim()))];
    if (!cardIds.length) throw businessError('CARD_IDS_REQUIRED', '请先选择要复习的字卡');

    const cards = await Promise.all(cardIds.map((id) => repository.findCardById(id)));
    const hasInvalidCard = cards.some((card) => (
      !card
      || card.familyId !== access.familyId
      || card.childId !== payload.childId
      || card.status !== 'active'
    ));
    if (hasInvalidCard) throw businessError('CARD_NOT_FOUND', '部分字卡不存在或已失效');

    const scheduledDate = getBusinessDate(now());
    const result = await repository.addReviewAssignments({
      familyId: access.familyId,
      childId: payload.childId,
      cardIds,
      scheduledDate,
      addedByOpenid: openid,
    });
    return { ...result, scheduledDate };
  }

  async function getTodayPlan(openid, payload = {}) {
    const access = await assertChildAccess(repository, openid, payload.childId);
    const allCards = sortCards(await repository.listActiveCards(access.familyId, payload.childId));
    const currentTime = now();
    const automaticCards = getTodayReviewCards(allCards, currentTime);
    const automaticIds = new Set(automaticCards.map((card) => card._id));
    const assignments = await repository.listPendingReviewAssignments(
      access.familyId,
      payload.childId,
      getBusinessDate(currentTime),
    );
    const manualIds = new Set(assignments.map((assignment) => assignment.cardId));
    const manualOnlyCards = sortCards(allCards.filter((card) => (
      manualIds.has(card._id) && !automaticIds.has(card._id)
    )));
    const cards = [
      ...automaticCards.map((card) => ({ ...card, reviewSource: 'automatic' })),
      ...manualOnlyCards.map((card) => ({ ...card, reviewSource: 'manual' })),
    ];
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
    const access = await assertChildAccess(repository, openid, payload.childId);
    const card = await repository.findCardById(payload.cardId);
    if (!card || card.familyId !== access.familyId || card.childId !== payload.childId || card.status !== 'active') {
      throw businessError('CARD_NOT_FOUND', '字卡不存在');
    }

    const updates = {};
    if (payload.content !== undefined) {
      const normalizedContent = validateContent(payload.content);
      const duplicate = await repository.findActiveByNormalized(
        access.familyId,
        payload.childId,
        normalizedContent,
        card._id,
      );
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
      updates.categoryIds = await validateCategoryIds(
        access.familyId,
        payload.childId,
        payload.categoryIds,
      );
    }
    return repository.updateCard(card._id, updates);
  }

  async function remove(openid, payload = {}) {
    const access = await assertChildAccess(repository, openid, payload.childId);
    const card = await repository.findCardById(payload.cardId);
    if (!card || card.familyId !== access.familyId || card.childId !== payload.childId || card.status !== 'active') {
      throw businessError('CARD_NOT_FOUND', '字卡不存在');
    }
    return repository.updateCard(card._id, {
      status: 'deleted',
      deletedAt: now(),
    });
  }

  return {
    addReviewAssignments,
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
  getBusinessDate,
  normalizeCategoryIds,
  normalizeContent,
};
