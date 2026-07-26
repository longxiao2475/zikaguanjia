const cache = require('../../utils/cache');
const cardApi = require('../../utils/card');
const session = require('../../utils/session');
const { toggleSelectedId } = require('../../utils/review-queue');
const { decorateCard } = require('../../utils/view');

const TAB_DEFINITIONS = [
  { value: 'all', label: '全部' },
  { value: 'due', label: '待复习' },
  { value: 'mastered', label: '已掌握' },
];

Page({
  data: {
    skeletons: [1, 2, 3],
    selectedFilter: 'all',
    tabs: TAB_DEFINITIONS.map((item) => ({ ...item, count: 0 })),
    items: [],
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
      return;
    }
    this._loading = true;
    const nextPage = reset ? 1 : this.data.page + 1;
    this.setData({
      loading: reset,
      loadingMore: !reset,
      errorMessage: '',
    });

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
        page: result.page || nextPage,
        hasMore: Boolean(result.hasMore),
        tabs: TAB_DEFINITIONS.map((item) => ({ ...item, count: counts[item.value] || 0 })),
      });
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

  onCloseWordSheet() {
    this.setData({ showWordSheet: false });
  },

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
