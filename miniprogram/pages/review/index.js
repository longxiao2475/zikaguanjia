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
const {
  buildOrderPreviewItems,
  getOrderPreviewIndex,
  reorderPendingCards,
} = require('../../utils/review-order');
const { mergeReviewCards } = require('../../utils/review-queue');
const { decorateCard } = require('../../utils/view');
const {
  getWordDetail,
  mergeWordDetailInputs,
  uniqueWords,
  validateCustomWord,
} = require('../../utils/dict');

const ORDER_ROW_PITCH_RPX = 124;

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
    showWordDetail: false,
    wordDetailCard: null,
    wordDetail: getWordDetail(),
    wordDetailSaving: false,
    canReorder: false,
    showOrderSheet: false,
    pendingOrderItems: [],
    orderAreaHeight: 0,
  },

  onLoad(options = {}) {
    this._manualSource = options.source === 'manual';
    const cached = cache.getTodayPlan();
    if (cached && !this._manualSource) this.applyPlan(cached);
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
    const update = {
      cards: state.cards,
      total,
      currentCard: state.currentCard ? decorateCard(state.currentCard) : null,
      currentPosition: total ? Math.min(state.results.length + 1, total) : 0,
      completedCount: state.results.length,
      progressPercent: state.progressPercent,
      canReorder: state.cards.length - state.results.length > 1,
    };
    if (this.data.showOrderSheet) {
      Object.assign(update, this.getPendingOrderData(state));
    }
    this.setData(update);
  },

  getOrderRowPitchPx() {
    if (this._orderRowPitchPx) return this._orderRowPitchPx;
    let windowWidth = 375;
    if (typeof wx.getWindowInfo === 'function') {
      windowWidth = wx.getWindowInfo().windowWidth || windowWidth;
    } else if (typeof wx.getSystemInfoSync === 'function') {
      windowWidth = wx.getSystemInfoSync().windowWidth || windowWidth;
    }
    this._orderRowPitchPx = ORDER_ROW_PITCH_RPX * windowWidth / 750;
    return this._orderRowPitchPx;
  },

  getPendingOrderData(state = this._reviewState || createReviewState([])) {
    const completedCount = state.results.length;
    const rowPitch = this.getOrderRowPitchPx();
    const pendingOrderItems = state.cards.slice(completedCount).map((card, index) => ({
      ...decorateCard(card),
      y: index * rowPitch,
      orderNumber: completedCount + index + 1,
    }));
    return {
      pendingOrderItems,
      orderAreaHeight: pendingOrderItems.length * rowPitch,
    };
  },

  async loadPlan() {
    this.setData({ loading: !this.data.cards.length, errorMessage: '' });
    try {
      let { child } = session.getCachedSession();
      if (!child) ({ child } = await session.bootstrap());
      const plan = await cardApi.getTodayPlan(child._id);
      let cards = plan.cards || [];

      if (this._manualSource) {
        const queue = cache.getManualReviewQueue();
        if (queue && queue.cardIds.length) {
          const manualCards = await cardApi.getCardsByIds(child._id, queue.cardIds);
          cards = mergeReviewCards(cards, manualCards);
          if (manualCards.length < queue.cardIds.length) {
            wx.showToast({ title: '部分字卡已不可用', icon: 'none' });
          }
          cache.clearManualReviewQueue();
        }
        this._manualSource = false;
      }

      this.applyPlan({ ...plan, cards });
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
    this.setData({
      showWordDetail: true,
      wordDetailCard: this.data.currentCard,
      wordDetail: getWordDetail(this.data.currentCard),
    });
  },

  onCloseWords() {
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
    this.setData({ wordDetail: { ...this.data.wordDetail, characters } });
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
      let { child } = session.getCachedSession();
      if (!child) ({ child } = await session.bootstrap());
      const updated = await cardApi.updateCard({
        childId: child._id,
        cardId: this.data.wordDetailCard._id,
        customWords,
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
      this.setData({
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

  onOpenOrderSheet() {
    if (!this._reviewState || this._reviewState.cards.length - this._reviewState.results.length < 2) {
      wx.showToast({ title: '当前没有可调整的后续字卡', icon: 'none' });
      return;
    }
    this.setData({
      showOrderSheet: true,
      ...this.getPendingOrderData(this._reviewState),
    });
  },

  onCloseOrderSheet() {
    this._orderDraggingIndex = null;
    this._orderPreviewIndex = null;
    this._orderDragY = null;
    this.setData({ showOrderSheet: false });
  },

  onOrderDragStart(event) {
    const index = Number(event.currentTarget.dataset.index);
    const pendingCount = this._reviewState.cards.length - this._reviewState.results.length;
    if (!Number.isInteger(index) || index < 0 || index >= pendingCount) {
      this._orderDraggingIndex = null;
      this._orderPreviewIndex = null;
      this._orderDragY = null;
      this.setData(this.getPendingOrderData(this._reviewState));
      return;
    }
    const rowPitch = this.getOrderRowPitchPx();
    this._orderDraggingIndex = index;
    this._orderPreviewIndex = index;
    this._orderDragY = index * rowPitch;
    this.setData({
      pendingOrderItems: buildOrderPreviewItems(
        this.data.pendingOrderItems,
        index,
        index,
        rowPitch,
      ),
    });
  },

  onOrderDragChange(event) {
    if (event.detail.source !== 'touch' || !Number.isInteger(this._orderDraggingIndex)) return;
    const dragY = Number(event.detail.y) || 0;
    const rowPitch = this.getOrderRowPitchPx();
    const previewIndex = getOrderPreviewIndex(
      dragY,
      rowPitch,
      this.data.pendingOrderItems.length,
    );
    this._orderDragY = dragY;
    if (previewIndex === this._orderPreviewIndex) return;
    this._orderPreviewIndex = previewIndex;
    this.setData({
      pendingOrderItems: buildOrderPreviewItems(
        this.data.pendingOrderItems,
        this._orderDraggingIndex,
        previewIndex,
        rowPitch,
      ),
    });
  },

  onOrderDragEnd(event) {
    const eventIndex = Number(event.currentTarget.dataset.index);
    const fromIndex = Number.isInteger(this._orderDraggingIndex)
      ? this._orderDraggingIndex
      : eventIndex;
    const pendingCount = this._reviewState.cards.length - this._reviewState.results.length;
    const toIndex = Number.isInteger(this._orderPreviewIndex)
      ? this._orderPreviewIndex
      : getOrderPreviewIndex(this._orderDragY, this.getOrderRowPitchPx(), pendingCount);
    this._orderDraggingIndex = null;
    this._orderPreviewIndex = null;
    this._orderDragY = null;
    try {
      this._reviewState = reorderPendingCards(this._reviewState, fromIndex, toIndex);
      this.applyReviewState();
    } catch (error) {
      console.error('[review-order] reorder failed', {
        message: error && error.message,
        stack: error && error.stack,
        fromIndex,
        toIndex,
        pendingCount,
      });
      this.setData(this.getPendingOrderData(this._reviewState));
      wx.showToast({ title: '顺序调整失败，请重试', icon: 'none' });
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
