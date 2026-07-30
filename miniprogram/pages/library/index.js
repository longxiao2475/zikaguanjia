const cache = require('../../utils/cache');
const cardApi = require('../../utils/card');
const categoryApi = require('../../utils/category');
const session = require('../../utils/session');
const { toggleSelectedId } = require('../../utils/review-queue');
const { getSwipeIntent, setOpenSwipeCard } = require('../../utils/card-swipe');
const { isDue, matchesReviewAge } = require('../../utils/review');
const { decorateCard } = require('../../utils/view');
const {
  decorateCardCategories,
  getCategorySelectionLabel,
  normalizeSelectionIds,
  splitCategoryFilter,
} = require('../../utils/category-view');
const {
  getWordDetail,
  mergeWordDetailInputs,
  uniqueWords,
  validateCustomWord,
} = require('../../utils/dict');

const TAB_DEFINITIONS = [
  { value: 'all', label: '全部' },
  { value: 'due', label: '待复习' },
  { value: 'mastered', label: '已掌握' },
];
const REVIEW_AGE_OPTIONS = [
  { value: 0, label: '不限' },
  { value: 7, label: '7天未复习' },
  { value: 30, label: '30天未复习' },
];

function normalizeEditableContent(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, '');
}

function hasActiveFilters({
  selectedFilter,
  keyword,
  selectedCategoryFilterIds,
  reviewAgeDays,
} = {}) {
  return selectedFilter !== 'all'
    || Boolean(normalizeEditableContent(keyword))
    || normalizeSelectionIds(selectedCategoryFilterIds).length > 0
    || Number(reviewAgeDays) > 0;
}

function cardMatchesView(
  card,
  filter,
  keyword,
  selectedCategoryFilterIds = [],
  reviewAgeDays = 0,
) {
  if (!card || card.status === 'deleted') return false;
  const normalizedKeyword = normalizeEditableContent(keyword);
  const matchesKeyword = !normalizedKeyword
    || normalizeEditableContent(card.normalizedContent || card.content).includes(normalizedKeyword);
  if (!matchesKeyword) return false;
  const categoryFilter = splitCategoryFilter(selectedCategoryFilterIds);
  if (categoryFilter.categoryIds.length || categoryFilter.includeUncategorized) {
    const cardCategoryIds = normalizeSelectionIds(card.categoryIds, 10);
    const selectedIdSet = new Set(categoryFilter.categoryIds);
    const matchesCategory = cardCategoryIds.some((id) => selectedIdSet.has(id))
      || (categoryFilter.includeUncategorized && cardCategoryIds.length === 0);
    if (!matchesCategory) return false;
  }
  if (!matchesReviewAge(card, reviewAgeDays)) return false;
  if (filter === 'due') return isDue(card);
  if (filter === 'mastered') return card.proficiency === 'proficient';
  return true;
}

function decorateLibraryCard(card, categories, selectedIds = []) {
  return decorateCardCategories({
    ...decorateCard(card),
    selected: selectedIds.includes(card._id),
  }, categories);
}

function updateTabCounts(tabs, previousCard, nextCard) {
  return (tabs || []).map((tab) => {
    const previousIncluded = tab.value === 'all'
      ? previousCard && previousCard.status !== 'deleted'
      : tab.value === 'due'
        ? isDue(previousCard)
        : previousCard && previousCard.proficiency === 'proficient' && previousCard.status !== 'deleted';
    const nextIncluded = tab.value === 'all'
      ? nextCard && nextCard.status !== 'deleted'
      : tab.value === 'due'
        ? isDue(nextCard)
        : nextCard && nextCard.proficiency === 'proficient' && nextCard.status !== 'deleted';
    return {
      ...tab,
      count: Math.max(0, Number(tab.count || 0) + Number(Boolean(nextIncluded)) - Number(Boolean(previousIncluded))),
    };
  });
}

Page({
  data: {
    skeletons: [1, 2, 3],
    selectedFilter: 'all',
    tabs: TAB_DEFINITIONS.map((item) => ({ ...item, count: 0 })),
    reviewAgeOptions: REVIEW_AGE_OPTIONS,
    reviewAgeDays: 0,
    hasActiveFilters: false,
    items: [],
    totalResults: 0,
    page: 1,
    hasMore: false,
    loading: true,
    loadingMore: false,
    errorMessage: '',
    keyword: '',
    selectionMode: false,
    selectedIds: [],
    selectedCount: 0,
    showWordDetail: false,
    wordDetailCard: null,
    wordDetail: getWordDetail(),
    wordDetailSaving: false,
    showEditSheet: false,
    editingCard: null,
    editContent: '',
    editProficiency: 'unfamiliar',
    editCategoryIds: [],
    pendingEditCategoryIds: [],
    editCategorySummary: '未分类',
    editSaving: false,
    categories: [],
    categoriesLoading: false,
    categorySaving: false,
    categoryError: '',
    selectedCategoryFilterIds: [],
    pendingCategoryFilterIds: [],
    categoryFilterSummary: '全部分类',
    showCategoryFilterPicker: false,
    showEditCategoryPicker: false,
    deletingCardId: '',
  },

  onShow() {
    const cachedCategories = cache.getCategories();
    if (cachedCategories.length) this.setData({ categories: cachedCategories });
    const intendedFilter = cache.consumeLibraryFilterIntent();
    if (intendedFilter && intendedFilter !== this.data.selectedFilter) {
      const nextFilterState = {
        ...this.data,
        selectedFilter: intendedFilter,
        keyword: '',
      };
      this.setData({
        selectedFilter: intendedFilter,
        keyword: '',
        hasActiveFilters: hasActiveFilters(nextFilterState),
        items: [],
        page: 1,
        hasMore: false,
      });
    }
    this.loadCategories();
    this.loadCards(true);
  },

  onUnload() {
    clearTimeout(this._searchTimer);
  },

  async ensureChild() {
    const cached = session.getCachedSession();
    if (cached.child) return cached.child;
    const result = await session.bootstrap();
    return result.child;
  },

  async loadCategories() {
    if (this.data.categoriesLoading) return;
    this.setData({ categoriesLoading: true, categoryError: '' });
    try {
      const child = await this.ensureChild();
      const categories = await categoryApi.listCategories(child._id);
      this.setData({
        categories,
        items: this.data.items.map((item) => decorateLibraryCard(item, categories, this.data.selectedIds)),
        categoryFilterSummary: getCategorySelectionLabel(
          categories,
          this.data.selectedCategoryFilterIds,
          { filterMode: true },
        ),
        editCategorySummary: getCategorySelectionLabel(categories, this.data.editCategoryIds),
      });
    } catch (error) {
      this.setData({ categoryError: error.message || '分类加载失败' });
    } finally {
      this.setData({ categoriesLoading: false });
    }
  },

  async loadCards(reset = false) {
    if (this._loading) {
      if (reset) this._reloadAfterCurrent = true;
      return null;
    }
    this._loading = true;
    const nextPage = reset ? 1 : this.data.page + 1;
    this.setData({
      loading: reset,
      loadingMore: !reset,
      errorMessage: '',
    });

    let succeeded = false;
    try {
      const child = await this.ensureChild();
      const categoryFilter = splitCategoryFilter(this.data.selectedCategoryFilterIds);
      const result = await cardApi.listCards({
        childId: child._id,
        filter: this.data.selectedFilter,
        keyword: this.data.keyword,
        categoryIds: categoryFilter.categoryIds,
        includeUncategorized: categoryFilter.includeUncategorized,
        reviewAgeDays: this.data.reviewAgeDays,
        page: nextPage,
        pageSize: 20,
      });
      const incoming = (result.items || []).map((card) => decorateLibraryCard(
        card,
        this.data.categories,
        this.data.selectedIds,
      ));
      const items = reset ? incoming : [...this.data.items, ...incoming];
      const counts = result.counts || { all: 0, due: 0, mastered: 0 };
      this.setData({
        items,
        totalResults: Number(result.total) || 0,
        page: result.page || nextPage,
        hasMore: Boolean(result.hasMore),
        tabs: TAB_DEFINITIONS.map((item) => ({ ...item, count: counts[item.value] || 0 })),
      });
      succeeded = true;
    } catch (error) {
      this.setData({ errorMessage: error.message || '字卡加载失败，请重试' });
    } finally {
      this._loading = false;
      this.setData({ loading: false, loadingMore: false });
      wx.stopPullDownRefresh();
      const shouldReload = this._reloadAfterCurrent;
      this._reloadAfterCurrent = false;
      if (shouldReload) this.loadCards(true);
    }
    return succeeded;
  },

  onSelectFilter(event) {
    const filter = event.currentTarget.dataset.value;
    if (filter === this.data.selectedFilter) return;
    this.setData({
      selectedFilter: filter,
      hasActiveFilters: hasActiveFilters({ ...this.data, selectedFilter: filter }),
      items: [],
      page: 1,
      hasMore: false,
    });
    return this.loadCards(true);
  },

  onPullDownRefresh() {
    this.loadCards(true);
  },

  onReachBottom() {
    if (this.data.hasMore) this.loadCards(false);
  },

  onRetry() {
    this.loadCards(true);
  },

  onKeywordInput(event) {
    const keyword = event.detail.value;
    this.setData({
      keyword,
      hasActiveFilters: hasActiveFilters({ ...this.data, keyword }),
    });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.loadCards(true), 300);
  },

  onClearKeyword() {
    clearTimeout(this._searchTimer);
    this.setData({
      keyword: '',
      hasActiveFilters: hasActiveFilters({ ...this.data, keyword: '' }),
      items: [],
      page: 1,
      hasMore: false,
    });
    return this.loadCards(true);
  },

  onSelectReviewAge(event) {
    const reviewAgeDays = [7, 30].includes(Number(event.currentTarget.dataset.days))
      ? Number(event.currentTarget.dataset.days)
      : 0;
    if (reviewAgeDays === this.data.reviewAgeDays) return null;
    this.setData({
      reviewAgeDays,
      hasActiveFilters: hasActiveFilters({ ...this.data, reviewAgeDays }),
      items: [],
      page: 1,
      hasMore: false,
    });
    return this.loadCards(true);
  },

  onClearAllFilters() {
    clearTimeout(this._searchTimer);
    this.setData({
      selectedFilter: 'all',
      keyword: '',
      reviewAgeDays: 0,
      selectedCategoryFilterIds: [],
      pendingCategoryFilterIds: [],
      categoryFilterSummary: '全部分类',
      hasActiveFilters: false,
      items: [],
      page: 1,
      hasMore: false,
    });
    return this.loadCards(true);
  },

  onOpenCategoryFilter() {
    this.setData({
      pendingCategoryFilterIds: [...this.data.selectedCategoryFilterIds],
      showCategoryFilterPicker: true,
    });
  },

  onPendingCategoryFilterChange(event) {
    this.setData({ pendingCategoryFilterIds: normalizeSelectionIds(event.detail.selectedIds) });
  },

  onCloseCategoryFilter() {
    if (this.data.categorySaving) return;
    this.setData({ showCategoryFilterPicker: false });
  },

  onConfirmCategoryFilter(event) {
    const selectedCategoryFilterIds = normalizeSelectionIds(event.detail.selectedIds);
    this.setData({
      selectedCategoryFilterIds,
      pendingCategoryFilterIds: selectedCategoryFilterIds,
      categoryFilterSummary: getCategorySelectionLabel(
        this.data.categories,
        selectedCategoryFilterIds,
        { filterMode: true },
      ),
      showCategoryFilterPicker: false,
      hasActiveFilters: hasActiveFilters({
        ...this.data,
        selectedCategoryFilterIds,
      }),
      items: [],
      page: 1,
      hasMore: false,
    });
    return this.loadCards(true);
  },

  onToggleSelectionMode() {
    const selectionMode = !this.data.selectionMode;
    const selectedIds = selectionMode ? this.data.selectedIds : [];
    this.setData({
      selectionMode,
      selectedIds,
      selectedCount: selectedIds.length,
      items: this.data.items.map((item) => ({
        ...item,
        selected: selectedIds.includes(item._id),
        swipeOpen: false,
      })),
    });
  },

  toggleCardSelection(targetId) {
    if (!this.data.selectedIds.includes(targetId) && this.data.selectedIds.length >= 50) {
      wx.showToast({ title: '一次最多选择 50 张', icon: 'none' });
      return;
    }
    const selectedIds = toggleSelectedId(this.data.selectedIds, targetId);
    this.setData({
      selectedIds,
      selectedCount: selectedIds.length,
      items: this.data.items.map((item) => ({
        ...item,
        selected: selectedIds.includes(item._id),
      })),
    });
  },

  onToggleCardSelection(event) {
    this.toggleCardSelection(event.currentTarget.dataset.id);
  },

  onCardTap(event) {
    const cardId = event.currentTarget.dataset.id;
    if (this.data.selectionMode) {
      this.toggleCardSelection(cardId);
      return;
    }
    const card = this.data.items.find((item) => item._id === cardId);
    if (!card) return;
    if (this._suppressCardTapId === cardId) {
      this._suppressCardTapId = '';
      return;
    }
    if (card.swipeOpen) {
      this.setData({ items: setOpenSwipeCard(this.data.items, null) });
      return;
    }
    this.setData({
      showWordDetail: true,
      wordDetailCard: card,
      wordDetail: getWordDetail(card),
    });
  },

  onCardTouchStart(event) {
    if (this.data.selectionMode || this.data.deletingCardId) return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    this._cardTouchStart = {
      cardId: event.currentTarget.dataset.id,
      x: touch.clientX,
      y: touch.clientY,
    };
  },

  onCardTouchEnd(event) {
    if (this.data.selectionMode || !this._cardTouchStart) return;
    const touch = event.changedTouches && event.changedTouches[0];
    const cardId = event.currentTarget.dataset.id;
    const start = this._cardTouchStart;
    this._cardTouchStart = null;
    if (!touch || start.cardId !== cardId) return;
    const intent = getSwipeIntent(start, { x: touch.clientX, y: touch.clientY });
    if (intent === 'none') return;
    this._suppressCardTapId = cardId;
    this.setData({
      items: setOpenSwipeCard(this.data.items, intent === 'open' ? cardId : null),
    });
  },

  onStartSelectedReview() {
    if (!this.data.selectedIds.length) return;
    cache.setManualReviewQueue(this.data.selectedIds);
    this.setData({ selectionMode: false, selectedIds: [], selectedCount: 0 });
    wx.navigateTo({ url: '/pages/review/index?source=manual' });
  },

  onAddCard() {
    wx.navigateTo({ url: '/pages/add/index' });
  },

  onOpenEdit(event) {
    const cardId = event.currentTarget.dataset.id;
    const card = this.data.items.find((item) => item._id === cardId);
    if (!card) return;
    this.setData({
      showEditSheet: true,
      editingCard: card,
      editContent: card.content,
      editProficiency: card.proficiency,
      editCategoryIds: normalizeSelectionIds(card.categoryIds, 10),
      pendingEditCategoryIds: normalizeSelectionIds(card.categoryIds, 10),
      editCategorySummary: getCategorySelectionLabel(this.data.categories, card.categoryIds),
      items: setOpenSwipeCard(this.data.items, null),
    });
  },

  onCloseEdit() {
    if (this.data.editSaving) return;
    this.setData({ showEditSheet: false, showEditCategoryPicker: false, editingCard: null });
  },

  onEditContentInput(event) {
    if (this.data.editSaving) return;
    this.setData({ editContent: event.detail.value });
  },

  onSelectEditProficiency(event) {
    if (this.data.editSaving) return;
    this.setData({ editProficiency: event.currentTarget.dataset.value });
  },

  onOpenEditCategoryPicker() {
    if (this.data.editSaving) return;
    this.setData({
      pendingEditCategoryIds: [...this.data.editCategoryIds],
      showEditCategoryPicker: true,
    });
  },

  onPendingEditCategoryChange(event) {
    if (this.data.editSaving) return;
    this.setData({ pendingEditCategoryIds: normalizeSelectionIds(event.detail.selectedIds, 10) });
  },

  onCloseEditCategoryPicker() {
    if (this.data.editSaving || this.data.categorySaving) return;
    this.setData({ showEditCategoryPicker: false });
  },

  onConfirmEditCategoryPicker(event) {
    if (this.data.editSaving) return;
    const editCategoryIds = normalizeSelectionIds(event.detail.selectedIds, 10);
    this.setData({
      editCategoryIds,
      pendingEditCategoryIds: editCategoryIds,
      editCategorySummary: getCategorySelectionLabel(this.data.categories, editCategoryIds),
      showEditCategoryPicker: false,
    });
  },

  async onCreateCategory(event) {
    if (this.data.categorySaving) return;
    this.setData({ categorySaving: true });
    try {
      const child = await this.ensureChild();
      await categoryApi.createCategory({ childId: child._id, name: event.detail.name });
      const categories = cache.getCategories();
      this.setData({ categories });
      wx.showToast({ title: '分类已添加', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '分类添加失败', icon: 'none' });
    } finally {
      this.setData({ categorySaving: false });
    }
  },

  async onRenameCategory(event) {
    if (this.data.categorySaving) return;
    this.setData({ categorySaving: true });
    try {
      const child = await this.ensureChild();
      await categoryApi.updateCategory({
        childId: child._id,
        categoryId: event.detail.categoryId,
        name: event.detail.name,
      });
      const categories = cache.getCategories();
      this.setData({
        categories,
        items: this.data.items.map((item) => decorateLibraryCard(item, categories, this.data.selectedIds)),
        categoryFilterSummary: getCategorySelectionLabel(
          categories,
          this.data.selectedCategoryFilterIds,
          { filterMode: true },
        ),
        editCategorySummary: getCategorySelectionLabel(categories, this.data.editCategoryIds),
      });
      wx.showToast({ title: '分类已修改', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '分类修改失败', icon: 'none' });
    } finally {
      this.setData({ categorySaving: false });
    }
  },

  async onSaveEdit() {
    if (this.data.editSaving || !this.data.editingCard) return;
    const editingCard = this.data.editingCard;
    const content = this.data.editContent.trim();
    const proficiency = this.data.editProficiency;
    if (!content) {
      wx.showToast({ title: '请输入字或词', icon: 'none' });
      return;
    }
    this.setData({ editSaving: true });
    try {
      const child = await this.ensureChild();
      const updatePayload = {
        childId: child._id,
        cardId: editingCard._id,
        content,
        proficiency,
        categoryIds: this.data.editCategoryIds,
      };
      if (normalizeEditableContent(content) !== normalizeEditableContent(editingCard.content)) {
        updatePayload.customWords = [];
      }
      const updated = decorateLibraryCard(
        await cardApi.updateCard(updatePayload),
        this.data.categories,
        this.data.selectedIds,
      );
      const remainsVisible = cardMatchesView(
        updated,
        this.data.selectedFilter,
        this.data.keyword,
        this.data.selectedCategoryFilterIds,
        this.data.reviewAgeDays,
      );
      this.setData({
        items: remainsVisible
          ? this.data.items.map((item) => (item._id === updated._id ? updated : item))
          : this.data.items.filter((item) => item._id !== updated._id),
        totalResults: remainsVisible ? this.data.totalResults : Math.max(0, this.data.totalResults - 1),
        tabs: updateTabCounts(this.data.tabs, editingCard, updated),
        wordDetailCard: this.data.wordDetailCard && this.data.wordDetailCard._id === updated._id
          ? updated
          : this.data.wordDetailCard,
        wordDetail: this.data.wordDetailCard && this.data.wordDetailCard._id === updated._id
          ? getWordDetail(updated)
          : this.data.wordDetail,
        showEditSheet: false,
        editingCard: null,
      });
      wx.showToast({ title: '字卡已更新', icon: 'success' });
      const refreshed = await this.loadCards(true);
      if (refreshed === false) wx.showToast({ title: '已保存，请重试刷新列表', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' });
    } finally {
      this.setData({ editSaving: false });
    }
  },

  confirmDeleteCard(card) {
    if (!card || this.data.deletingCardId || this.data.editSaving) return;
    wx.showModal({
      title: `删除“${card.content}”？`,
      content: '删除后不再出现在字卡库和复习计划中，历史复习记录会保留。',
      confirmText: '删除',
      confirmColor: '#C7443E',
      success: async (result) => {
        if (!result.confirm) return;
        const deletingFromEdit = Boolean(
          this.data.editingCard && this.data.editingCard._id === card._id,
        );
        this.setData({
          deletingCardId: card._id,
          editSaving: deletingFromEdit,
          items: setOpenSwipeCard(this.data.items, null),
        });
        try {
          const child = await this.ensureChild();
          await cardApi.deleteCard({ childId: child._id, cardId: card._id });
          const selectedIds = this.data.selectedIds.filter((id) => id !== card._id);
          this.setData({
            items: this.data.items.filter((item) => item._id !== card._id),
            totalResults: Math.max(0, this.data.totalResults - 1),
            tabs: updateTabCounts(this.data.tabs, card, null),
            selectedIds,
            selectedCount: selectedIds.length,
            showEditSheet: false,
            showEditCategoryPicker: false,
            editingCard: null,
          });
          wx.showToast({ title: '字卡已删除', icon: 'success' });
          const refreshed = await this.loadCards(true);
          if (refreshed === false) wx.showToast({ title: '已删除，请重试刷新列表', icon: 'none' });
        } catch (error) {
          wx.showToast({ title: error.message || '删除失败，请重试', icon: 'none' });
        } finally {
          this.setData({ editSaving: false, deletingCardId: '' });
        }
      },
    });
  },

  onDeleteCard() {
    if (this.data.editSaving || !this.data.editingCard) return;
    this.confirmDeleteCard(this.data.editingCard);
  },

  onSwipeDelete(event) {
    if (this.data.selectionMode || this.data.deletingCardId) return;
    const cardId = event.currentTarget.dataset.id;
    const card = this.data.items.find((item) => item._id === cardId);
    this.confirmDeleteCard(card);
  },

  onCloseWordDetail() {
    if (this.data.wordDetailSaving) return;
    this.setData({ showWordDetail: false });
  },

  swallow() {},

  onDetailWordInput(event) {
    if (this.data.wordDetailSaving) return;
    const targetIndex = Number(event.currentTarget.dataset.index);
    const characters = (this.data.wordDetail.characters || []).map((item, index) => (
      index === targetIndex ? { ...item, inputValue: event.detail.value } : item
    ));
    this.setData({
      wordDetail: { ...this.data.wordDetail, characters },
    });
  },

  async onSaveDetailWord(event) {
    if (this.data.wordDetailSaving || !this.data.wordDetailCard) return;
    const targetIndex = Number(event.currentTarget.dataset.index);
    const characterDetail = (this.data.wordDetail.characters || [])[targetIndex];
    if (!characterDetail) return;
    const validation = validateCustomWord(characterDetail.character, characterDetail.inputValue);
    if (!validation.ok) {
      wx.showToast({ title: validation.message, icon: 'none' });
      return;
    }
    const customWords = uniqueWords([
      ...(this.data.wordDetailCard.customWords || []),
      validation.word,
    ]);
    this.setData({ wordDetailSaving: true });
    try {
      const child = await this.ensureChild();
      const updated = decorateCard(await cardApi.updateCard({
        childId: child._id,
        cardId: this.data.wordDetailCard._id,
        customWords,
      }));
      this.setData({
        items: this.data.items.map((item) => (item._id === updated._id ? updated : item)),
        wordDetailCard: updated,
        wordDetail: mergeWordDetailInputs(
          this.data.wordDetail,
          getWordDetail(updated),
          characterDetail.character,
        ),
      });
      wx.showToast({ title: '已添加组词', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '组词保存失败', icon: 'none' });
    } finally {
      this.setData({ wordDetailSaving: false });
    }
  },
});
