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

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => (
  `${String(hour).padStart(2, '0')}:00`
));

function normalizeReminderTime(value) {
  const match = String(value || '').match(/^(\d{2}):\d{2}$/);
  if (!match || Number(match[1]) > 23) return '20:00';
  return `${match[1]}:00`;
}

Page({
  data: {
    childId: '',
    childName: '',
    studyDays: [2, 4, 6],
    dayOptions: [],
    hourOptions: HOUR_OPTIONS,
    reminderHourIndex: 20,
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

  applySession(user, child, member = {}) {
    const studyDays = Array.isArray(child.studyDays) && child.studyDays.length
      ? child.studyDays
      : [2, 4, 6];
    const reminderTime = normalizeReminderTime(member.reminderTime || child.reminderTime);
    this.setData({
      childId: child._id,
      childName: child.name || '',
      studyDays,
      dayOptions: DAY_OPTIONS.map((day) => ({
        ...day,
        selected: studyDays.includes(day.value),
      })),
      reminderHourIndex: HOUR_OPTIONS.indexOf(reminderTime),
      reminderTime,
      reminderEnabled: member.reminderEnabled !== undefined
        ? member.reminderEnabled !== false
        : child.reminderEnabled !== false,
      subscriptionQuota: Number(user.subscriptionQuota || 0),
    });
  },

  async loadSettings() {
    this.setData({ errorMessage: '' });
    try {
      let {
        user,
        child,
        member,
      } = session.getCachedSession();
      if (!user || !child || !member) ({ user, child, member } = await session.bootstrap());
      this.applySession(user, child, member);
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
    const requestedIndex = Number(event.detail.value);
    const reminderHourIndex = Number.isInteger(requestedIndex)
      && requestedIndex >= 0
      && requestedIndex < HOUR_OPTIONS.length
      ? requestedIndex
      : 20;
    this.setData({
      reminderHourIndex,
      reminderTime: HOUR_OPTIONS[reminderHourIndex],
    });
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
