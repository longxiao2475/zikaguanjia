const cardApi = require('../../utils/card');
const session = require('../../utils/session');

Page({
  data: {
    content: '',
    source: 'new',
    saving: false,
    errorMessage: '',
    savedCard: null,
  },

  onInput(event) {
    this.setData({
      content: event.detail.value,
      errorMessage: '',
      savedCard: null,
    });
  },

  onSelectSource(event) {
    this.setData({ source: event.currentTarget.dataset.value });
  },

  onVoicePending() {
    wx.showToast({ title: '语音录入将在下一阶段接入', icon: 'none' });
  },

  async ensureChild() {
    const cached = session.getCachedSession();
    if (cached.child) return cached.child;
    const result = await session.bootstrap();
    return result.child;
  },

  async onSave() {
    if (this.data.saving) return;
    const content = this.data.content.trim();
    if (!content) {
      this.setData({ errorMessage: '请输入一个字或词' });
      return;
    }

    this.setData({ saving: true, errorMessage: '', savedCard: null });
    try {
      const child = await this.ensureChild();
      const card = await cardApi.createCard({
        childId: child._id,
        content,
        source: this.data.source,
      });
      this.setData({ content: '', savedCard: card });
      wx.showToast({ title: '字卡已保存', icon: 'success' });
    } catch (error) {
      if (error.code === 'CARD_DUPLICATE') {
        wx.showModal({
          title: '这个字卡已经存在',
          content: '无需重复录入，可以去字卡库查看。',
          confirmText: '去字卡库',
          cancelText: '继续录入',
          success: (result) => {
            if (result.confirm) wx.switchTab({ url: '/pages/library/index' });
          },
        });
      } else {
        this.setData({ errorMessage: error.message || '保存失败，请重试' });
      }
    } finally {
      this.setData({ saving: false });
    }
  },

  onOpenLibrary() {
    wx.switchTab({ url: '/pages/library/index' });
  },
});
