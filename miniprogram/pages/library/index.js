const cache = require('../../utils/cache');
const cardApi = require('../../utils/card');
const session = require('../../utils/session');
const { toggleSelectedId } = require('../../utils/review-queue');
const { isDue } = require('../../utils/review');
const { decorateCard } = require('../../utils/view');

const TAB_DEFINITIONS = [
  { value: 'all', label: '全部' },
  { value: 'due', label: '待复习' },
  { value: 'mastered', label: '已掌握' },
];

function normalizeEditableContent(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, '');
}

function cardMatchesView(card, filter, keyword) {
  if (!card || card.status === 'deleted') return false;
  const normalizedKeyword = normalizeEditableContent(keyword);
  const matchesKeyword = !normalizedKeyword
    || normalizeEditableContent(card.normalizedContent || card.content).includes(normalizedKeyword);
  if (!matchesKeyword) return false;
  if (filter === 'due') return isDue(card);
  if (filter === 'mastered') return card.proficiency === 'proficient';
  return true;
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
    showWordSheet: false,
    wordSheetCard: null,
    showEditSheet: false,
    editingCard: null,
    editContent: '',
    editProficiency: 'unfamiliar',
    editSaving: false,
  },

  onShow() {
    const intendedFilter = cache.consumeLibraryFilterIntent();
    if (intendedFilter && intendedFilter !== this.data.selectedFilter) {
      this.setData({
        selectedFilter: intendedFilter,
        keyword: '',
        items: [],
        page: 1,
        hasMore: false,
      });
    }
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
      const result = await cardApi.listCards({
        childId: child._id,
        filter: this.data.selectedFilter,
        keyword: this.data.keyword,
        page: nextPage,
        pageSize: 20,
      });
      const incoming = (result.items || []).map((card) => ({
        ...decorateCard(card),
        selected: this.data.selectedIds.includes(card._id),
      }));
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
    this.setData({ selectedFilter: filter, items: [], page: 1, hasMore: false });
    this.loadCards(true);
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
    this.setData({ keyword });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.loadCards(true), 300);
  },

  onClearKeyword() {
    clearTimeout(this._searchTimer);
    this.setData({ keyword: '' });
    this.loadCards(true);
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
      })),
    });
  },

  onToggleCardSelection(event) {
    const targetId = event.currentTarget.dataset.id;
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

  onStartSelectedReview() {
    if (!this.data.selectedIds.length) return;
    cache.setManualReviewQueue(this.data.selectedIds);
    this.setData({ selectionMode: false, selectedIds: [], selectedCount: 0 });
    wx.navigateTo({ url: '/pages/review/index?source=manual' });
  },

  onAddCard() {
    wx.navigateTo({ url: '/pages/add/index' });
  },

  onOpenWordSheet(event) {
    const cardId = event.currentTarget.dataset.id;
    const card = this.data.items.find((item) => item._id === cardId);
    if (card) this.setData({ showWordSheet: true, wordSheetCard: card });
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
    });
  },

  onCloseEdit() {
    if (this.data.editSaving) return;
    this.setData({ showEditSheet: false, editingCard: null });
  },

  onEditContentInput(event) {
    if (this.data.editSaving) return;
    this.setData({ editContent: event.detail.value });
  },

  onSelectEditProficiency(event) {
    if (this.data.editSaving) return;
    this.setData({ editProficiency: event.currentTarget.dataset.value });
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
      };
      if (normalizeEditableContent(content) !== normalizeEditableContent(editingCard.content)) {
        updatePayload.customWords = [];
      }
      const updated = decorateCard(await cardApi.updateCard(updatePayload));
      const remainsVisible = cardMatchesView(updated, this.data.selectedFilter, this.data.keyword);
      this.setData({
        items: remainsVisible
          ? this.data.items.map((item) => (item._id === updated._id ? updated : item))
          : this.data.items.filter((item) => item._id !== updated._id),
        totalResults: remainsVisible ? this.data.totalResults : Math.max(0, this.data.totalResults - 1),
        tabs: updateTabCounts(this.data.tabs, editingCard, updated),
        wordSheetCard: this.data.wordSheetCard && this.data.wordSheetCard._id === updated._id
          ? updated
          : this.data.wordSheetCard,
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

  onDeleteCard() {
    if (this.data.editSaving || !this.data.editingCard) return;
    const card = this.data.editingCard;
    wx.showModal({
      title: `删除“${card.content}”？`,
      content: '删除后不再出现在字卡库和复习计划中，历史复习记录会保留。',
      confirmText: '删除',
      confirmColor: '#C7443E',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ editSaving: true });
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
            editingCard: null,
          });
          wx.showToast({ title: '字卡已删除', icon: 'success' });
          const refreshed = await this.loadCards(true);
          if (refreshed === false) wx.showToast({ title: '已删除，请重试刷新列表', icon: 'none' });
        } catch (error) {
          wx.showToast({ title: error.message || '删除失败，请重试', icon: 'none' });
        } finally {
          this.setData({ editSaving: false });
        }
      },
    });
  },

  onCloseWordSheet() {
    this.setData({ showWordSheet: false });
  },

  swallow() {},

  async onSaveCustomWord(event) {
    const detail = event.detail || {};
    try {
      const child = await this.ensureChild();
      const updated = decorateCard(await cardApi.updateCard({
        childId: child._id,
        cardId: detail.cardId,
        customWords: detail.customWords,
      }));
      this.setData({
        items: this.data.items.map((item) => (item._id === updated._id ? updated : item)),
        wordSheetCard: updated,
      });
      wx.showToast({ title: '已添加组词', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '组词保存失败', icon: 'none' });
    }
  },
});
