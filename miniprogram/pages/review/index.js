const cache = require('../../utils/cache');
const cardApi = require('../../utils/card');
const session = require('../../utils/session');
const { decorateCard } = require('../../utils/view');

Page({
  data: {
    loading: true,
    errorMessage: '',
    cards: [],
    total: 0,
  },

  onLoad() {
    const cached = cache.getTodayPlan();
    if (cached) this.applyPlan(cached);
    this.loadPlan();
  },

  applyPlan(plan) {
    const cards = (plan.cards || []).map((card) => decorateCard(card));
    this.setData({ cards, total: cards.length });
  },

  async loadPlan() {
    this.setData({ loading: !this.data.cards.length, errorMessage: '' });
    try {
      let { child } = session.getCachedSession();
      if (!child) ({ child } = await session.bootstrap());
      const plan = await cardApi.getTodayPlan(child._id);
      this.applyPlan(plan);
    } catch (error) {
      this.setData({ errorMessage: error.message || '复习计划加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onAddCard() {
    wx.navigateTo({ url: '/pages/add/index' });
  },
});
