const cache = require('../../utils/cache');
const cardApi = require('../../utils/card');
const session = require('../../utils/session');
const { isStudyDay } = require('../../utils/review');
const {
  decorateCard,
  formatDisplayDate,
  getGreeting,
} = require('../../utils/view');

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
  },

  onLoad() {
    this.hydrateFromCache();
  },

  onShow() {
    this.refresh();
  },

  hydrateFromCache() {
    const now = new Date();
    const { child } = session.getCachedSession();
    const cachedPlan = cache.getTodayPlan() || EMPTY_PLAN;
    this.applyState(child, cachedPlan, now);
  },

  applyState(child, plan, now = new Date()) {
    const safePlan = {
      cards: Array.isArray(plan && plan.cards) ? plan.cards : [],
      stats: (plan && plan.stats) || EMPTY_PLAN.stats,
      overview: (plan && plan.overview) || EMPTY_PLAN.overview,
    };
    const studyDay = isStudyDay(child || {}, now);
    this.setData({
      greeting: getGreeting(now),
      dateLabel: formatDisplayDate(now),
      childName: (child && child.name) || '小朋友',
      isStudyDay: studyDay,
      plan: safePlan,
      previewCards: safePlan.cards.slice(0, 6).map((card) => decorateCard(card, now)),
      showStudyBanner: studyDay && safePlan.overview.due > 0,
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
      const { child } = await session.bootstrap();
      const plan = await cardApi.getTodayPlan(child._id);
      this.applyState(child, plan);
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

  onOpenLibrary() {
    wx.switchTab({ url: '/pages/library/index' });
  },
});
