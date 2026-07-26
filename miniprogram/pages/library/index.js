const cardApi = require('../../utils/card');
const session = require('../../utils/session');
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
    showWordSheet: false,
    wordSheetCard: null,
  },

  onShow() {
    this.loadCards(true);
  },

  async ensureChild() {
    const cached = session.getCachedSession();
    if (cached.child) return cached.child;
    const result = await session.bootstrap();
    return result.child;
  },

  async loadCards(reset = false) {
    if (this._loading) return;
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
        page: nextPage,
        pageSize: 20,
      });
      const incoming = (result.items || []).map((card) => decorateCard(card));
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
