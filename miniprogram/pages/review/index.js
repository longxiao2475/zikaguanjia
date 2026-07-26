const cache = require('../../utils/cache');
const cardApi = require('../../utils/card');
const reviewApi = require('../../utils/review-api');
const session = require('../../utils/session');
const subscribe = require('../../utils/subscribe');
const {
  buildCompletePayload,
  createReviewState,
  markCurrent,
} = require('../../utils/review-flow');
const { decorateCard } = require('../../utils/view');

Page({
  data: {
    loading: true,
    errorMessage: '',
    submissionError: '',
    cards: [],
    total: 0,
    currentCard: null,
    currentPosition: 0,
    completedCount: 0,
    progressPercent: 0,
    submitting: false,
    completed: false,
    showSubscribeCard: true,
    subscribing: false,
    showWordSheet: false,
    wordSheetCard: null,
  },

  onLoad() {
    const cached = cache.getTodayPlan();
    if (cached) this.applyPlan(cached);
    this.loadPlan();
  },

  applyPlan(plan) {
    const cards = Array.isArray(plan && plan.cards) ? plan.cards : [];
    this._reviewState = createReviewState(cards);
    this.applyReviewState();
  },

  applyReviewState() {
    const state = this._reviewState || createReviewState([]);
    const total = state.cards.length;
    this.setData({
      cards: state.cards,
      total,
      currentCard: state.currentCard ? decorateCard(state.currentCard) : null,
      currentPosition: total ? Math.min(state.results.length + 1, total) : 0,
      completedCount: state.results.length,
      progressPercent: state.progressPercent,
    });
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

  async onMark(event) {
    if (this.data.submitting || this.data.completed) return;
    try {
      this._reviewState = markCurrent(
        this._reviewState,
        event.currentTarget.dataset.proficiency,
      );
      this.applyReviewState();
      if (this._reviewState.readyToSubmit) await this.submitReview();
    } catch (error) {
      wx.showToast({ title: '请重新选择熟练度', icon: 'none' });
    }
  },

  async submitReview() {
    if (this.data.submitting || !this._reviewState || !this._reviewState.readyToSubmit) return;
    this.setData({ submitting: true, submissionError: '' });
    try {
      let { child } = session.getCachedSession();
      if (!child) ({ child } = await session.bootstrap());
      const payload = buildCompletePayload(child._id, this._reviewState);
      await reviewApi.completeReview(payload);
      this.setData({ completed: true });
    } catch (error) {
      this.setData({ submissionError: error.message || '复习结果提交失败，请重试' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onRetrySubmit() {
    this.submitReview();
  },

  onOpenWords() {
    if (!this.data.currentCard) return;
    this.setData({ showWordSheet: true, wordSheetCard: this.data.currentCard });
  },

  onCloseWords() {
    this.setData({ showWordSheet: false });
  },

  async onSaveCustomWord(event) {
    const detail = event.detail || {};
    try {
      let { child } = session.getCachedSession();
      if (!child) ({ child } = await session.bootstrap());
      const updated = await cardApi.updateCard({
        childId: child._id,
        cardId: detail.cardId,
        customWords: detail.customWords,
      });
      if (this._reviewState) {
        this._reviewState = {
          ...this._reviewState,
          cards: this._reviewState.cards.map((card) => (card._id === updated._id ? updated : card)),
          currentCard: this._reviewState.currentCard._id === updated._id
            ? updated
            : this._reviewState.currentCard,
        };
        this.applyReviewState();
      }
      this.setData({ wordSheetCard: updated });
      wx.showToast({ title: '已添加组词', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '组词保存失败', icon: 'none' });
    }
  },

  onAddCard() {
    wx.navigateTo({ url: '/pages/add/index' });
  },

  onBackHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  async onEnableReminder() {
    if (this.data.subscribing) return;
    this.setData({ subscribing: true });
    try {
      const result = await subscribe.requestGrant('review_complete');
      if (result.accepted) {
        this.setData({ showSubscribeCard: false });
        wx.showToast({ title: '已增加 1 次提醒', icon: 'success' });
      } else {
        this.setData({ showSubscribeCard: false });
      }
    } catch (error) {
      wx.showToast({ title: error.message || '订阅失败，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ subscribing: false });
    }
  },

  onDismissReminder() {
    this.setData({ showSubscribeCard: false });
  },
});
