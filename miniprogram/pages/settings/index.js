const session = require('../../utils/session');
const subscribe = require('../../utils/subscribe');

const DAY_OPTIONS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' },
];

Page({
  data: {
    childId: '',
    childName: '',
    studyDays: [2, 4, 6],
    dayOptions: [],
    reminderTime: '20:00',
    reminderEnabled: true,
    subscriptionQuota: 0,
    loading: true,
    saving: false,
    subscribing: false,
    errorMessage: '',
  },

  onShow() {
    this.loadSettings();
  },

  applySession(user, child) {
    const studyDays = Array.isArray(child.studyDays) && child.studyDays.length
      ? child.studyDays
      : [2, 4, 6];
    this.setData({
      childId: child._id,
      childName: child.name || '',
      studyDays,
      dayOptions: DAY_OPTIONS.map((day) => ({
        ...day,
        selected: studyDays.includes(day.value),
      })),
      reminderTime: child.reminderTime || '20:00',
      reminderEnabled: child.reminderEnabled !== false,
      subscriptionQuota: Number(user.subscriptionQuota || 0),
    });
  },

  async loadSettings() {
    this.setData({ errorMessage: '' });
    try {
      let { user, child } = session.getCachedSession();
      if (!user || !child) ({ user, child } = await session.bootstrap());
      this.applySession(user, child);
    } catch (error) {
      this.setData({ errorMessage: error.message || '设置加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onNameInput(event) {
    this.setData({ childName: event.detail.value });
  },

  onToggleDay(event) {
    const day = Number(event.currentTarget.dataset.day);
    const selected = this.data.studyDays.includes(day);
    if (selected && this.data.studyDays.length === 1) {
      wx.showToast({ title: '请至少保留一个认字日', icon: 'none' });
      return;
    }
    const studyDays = selected
      ? this.data.studyDays.filter((item) => item !== day)
      : [...this.data.studyDays, day].sort((left, right) => left - right);
    this.setData({
      studyDays,
      dayOptions: DAY_OPTIONS.map((item) => ({
        ...item,
        selected: studyDays.includes(item.value),
      })),
    });
  },

  onTimeChange(event) {
    this.setData({ reminderTime: event.detail.value });
  },

  onReminderToggle(event) {
    this.setData({ reminderEnabled: event.detail.value });
  },

  async onSave() {
    if (this.data.saving) return;
    this.setData({ saving: true, errorMessage: '' });
    try {
      await session.saveSettings({
        childId: this.data.childId,
        name: this.data.childName,
        studyDays: this.data.studyDays,
        reminderTime: this.data.reminderTime,
        reminderEnabled: this.data.reminderEnabled,
      });
      wx.showToast({ title: '设置已保存', icon: 'success' });
    } catch (error) {
      this.setData({ errorMessage: error.message || '保存失败，请重试' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async onRequestGrant() {
    if (this.data.subscribing) return;
    this.setData({ subscribing: true });
    try {
      const result = await subscribe.requestGrant('settings');
      if (result.accepted) {
        this.setData({ subscriptionQuota: result.quota });
        wx.showToast({ title: '已增加 1 次提醒', icon: 'success' });
      }
    } catch (error) {
      wx.showToast({ title: error.message || '订阅失败，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ subscribing: false });
    }
  },
});
