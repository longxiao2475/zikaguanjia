const cache = require('../../utils/cache');
const cardApi = require('../../utils/card');
const session = require('../../utils/session');
const subscribe = require('../../utils/subscribe');
const { getHomeBanners } = require('../../utils/home');
const { isStudyDay } = require('../../utils/review');
const {
  buildReviewSelectionState,
  toggleSelectedId,
} = require('../../utils/review-queue');
const {
  decorateCard,
  formatDisplayDate,
  getGreeting,
} = require('../../utils/view');

const MAX_REVIEW_BATCH_SIZE = 50;

const EMPTY_PLAN = Object.freeze({
  cards: [],
  stats: { total: 0, unfamiliar: 0, normal: 0, proficient: 0 },
  overview: { total: 0, mastered: 0, due: 0 },
});

Page({
  data: {
    greeting: '',
    dateLabel: '',
    childName: '小朋友',
    isStudyDay: false,
    loading: true,
    showSkeleton: true,
    errorMessage: '',
    plan: EMPTY_PLAN,
    previewCards: [],
    showStudyBanner: false,
    showQuotaBanner: false,
    subscriptionQuota: 0,
    subscribing: false,
    reviewSelectionMode: false,
    selectedReviewIds: [],
    selectedReviewCount: 0,
    allReviewCardsSelected: false,
  },

  onLoad() {
    this.hydrateFromCache();
  },

  onShow() {
    this.refresh();
  },

  hydrateFromCache() {
    const now = new Date();
    const { user, child } = session.getCachedSession();
    const cachedPlan = cache.getTodayPlan() || EMPTY_PLAN;
    this.applyState(user, child, cachedPlan, now);
  },

  applyState(user, child, plan, now = new Date()) {
    const safePlan = {
      cards: Array.isArray(plan && plan.cards) ? plan.cards : [],
      stats: (plan && plan.stats) || EMPTY_PLAN.stats,
      overview: (plan && plan.overview) || EMPTY_PLAN.overview,
    };
    const studyDay = isStudyDay(child || {}, now);
    const quota = user && user.subscriptionQuota;
    const banners = getHomeBanners({ studyDay, due: safePlan.overview.due, quota });
    const reviewSelection = buildReviewSelectionState(
      safePlan.cards,
      this.data.selectedReviewIds,
      this.data.reviewSelectionMode,
    );
    const selectableReviewCount = Math.min(safePlan.cards.length, MAX_REVIEW_BATCH_SIZE);
    this.setData({
      greeting: getGreeting(now),
      dateLabel: formatDisplayDate(now),
      childName: (child && child.name) || '小朋友',
      isStudyDay: studyDay,
      plan: safePlan,
      previewCards: reviewSelection.cards.map((card) => decorateCard(card, now)),
      selectedReviewIds: reviewSelection.selectedIds,
      selectedReviewCount: reviewSelection.selectedCount,
      allReviewCardsSelected: selectableReviewCount > 0
        && reviewSelection.selectedCount === selectableReviewCount,
      showStudyBanner: banners.showStudyBanner,
      showQuotaBanner: banners.showQuotaBanner,
      subscriptionQuota: Number(quota || 0),
    });
  },

  async refresh() {
    if (this._refreshing) return;
    this._refreshing = true;
    const hasCachedPlan = Boolean(cache.getTodayPlan());
    this.setData({
      loading: !hasCachedPlan,
      showSkeleton: !hasCachedPlan,
      errorMessage: '',
    });
    try {
      const { user, child } = await session.bootstrap();
      const plan = await cardApi.getTodayPlan(child._id);
      this.applyState(user, child, plan);
      getApp().globalData.sessionReady = true;
    } catch (error) {
      this.setData({ errorMessage: error.message || '加载失败，请稍后重试' });
    } finally {
      this._refreshing = false;
      this.setData({ loading: false, showSkeleton: false });
      wx.stopPullDownRefresh();
    }
  },

  onPullDownRefresh() {
    this.refresh();
  },

  onRetry() {
    this.refresh();
  },

  onAddCard() {
    wx.navigateTo({ url: '/pages/add/index' });
  },

  onReview() {
    wx.navigateTo({ url: '/pages/review/index' });
  },

  updateReviewSelection(selectedIds, reviewSelectionMode = this.data.reviewSelectionMode) {
    const limitedIds = (Array.isArray(selectedIds) ? selectedIds : [])
      .slice(0, MAX_REVIEW_BATCH_SIZE);
    const selection = buildReviewSelectionState(
      this.data.plan.cards,
      limitedIds,
      reviewSelectionMode,
    );
    const selectableCount = Math.min(this.data.plan.cards.length, MAX_REVIEW_BATCH_SIZE);
    this.setData({
      reviewSelectionMode,
      previewCards: selection.cards.map((card) => decorateCard(card)),
      selectedReviewIds: selection.selectedIds,
      selectedReviewCount: selection.selectedCount,
      allReviewCardsSelected: selectableCount > 0
        && selection.selectedCount === selectableCount,
    });
  },

  onToggleReviewSelectionMode() {
    this.updateReviewSelection([], !this.data.reviewSelectionMode);
  },

  onToggleReviewCard(event) {
    const cardId = event.currentTarget.dataset.id;
    if (!this.data.reviewSelectionMode) {
      this.onReview();
      return;
    }
    const selectingNewCard = !this.data.selectedReviewIds.includes(cardId);
    if (selectingNewCard && this.data.selectedReviewCount >= MAX_REVIEW_BATCH_SIZE) {
      wx.showToast({ title: '每批最多选择50张', icon: 'none' });
      return;
    }
    this.updateReviewSelection(
      toggleSelectedId(this.data.selectedReviewIds, cardId),
      true,
    );
  },

  onToggleAllReviewCards() {
    const nextIds = this.data.allReviewCardsSelected
      ? []
      : this.data.plan.cards.slice(0, MAX_REVIEW_BATCH_SIZE).map((card) => card._id);
    this.updateReviewSelection(nextIds, true);
  },

  onStartSelectedReview() {
    if (!this.data.selectedReviewIds.length) return;
    try {
      const queue = cache.setManualReviewQueue(
        this.data.selectedReviewIds,
        Date.now(),
        'replace',
      );
      if (!queue) throw new Error('本批字卡保存失败');
      wx.navigateTo({
        url: '/pages/review/index?source=batch',
        success: () => this.updateReviewSelection([], false),
        fail: () => {
          cache.clearManualReviewQueue();
          wx.showToast({ title: '进入复习失败，请重试', icon: 'none' });
        },
      });
    } catch (error) {
      cache.clearManualReviewQueue();
      wx.showToast({ title: error.message || '本批字卡保存失败', icon: 'none' });
    }
  },

  onOpenLibrary(event = {}) {
    const filter = event.currentTarget && event.currentTarget.dataset
      ? event.currentTarget.dataset.filter
      : 'all';
    cache.setLibraryFilterIntent(filter || 'all');
    wx.switchTab({ url: '/pages/library/index' });
  },

  async onRequestReminderQuota() {
    if (this.data.subscribing) return;
    this.setData({ subscribing: true });
    try {
      const result = await subscribe.requestGrant('home_quota_banner');
      if (result.accepted) {
        const { user, child } = session.getCachedSession();
        this.applyState(user, child, this.data.plan);
        wx.showToast({ title: '已增加 1 次提醒', icon: 'success' });
      }
    } catch (error) {
      wx.showToast({ title: error.message || '订阅失败，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ subscribing: false });
    }
  },
});
