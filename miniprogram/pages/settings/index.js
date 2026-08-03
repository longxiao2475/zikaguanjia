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
    familyName: '我的家庭',
    familyMemberCount: 1,
    memberRole: 'member',
    familyInviteCode: '',
    familyCodeInput: '',
    familyGenerating: false,
    familyPreviewing: false,
    familyJoining: false,
    showJoinPreview: false,
    joinPreview: null,
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
      memberRole: member.role || 'member',
    });
  },

  applyFamilySummary(summary = {}) {
    const family = summary.family || {};
    const member = summary.member || {};
    this.setData({
      familyName: family.name || '我的家庭',
      familyMemberCount: Number(summary.memberCount || 1),
      memberRole: member.role || this.data.memberRole || 'member',
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
      if (typeof session.getFamilySummary === 'function') {
        this.applyFamilySummary(await session.getFamilySummary());
      }
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

  swallow() {},

  async onGenerateFamilyCode() {
    if (this.data.familyGenerating || this.data.memberRole !== 'owner') return;
    this.setData({ familyGenerating: true });
    try {
      const result = await session.createFamilyInvite();
      this.setData({ familyInviteCode: result.code || '' });
    } catch (error) {
      wx.showToast({ title: error.message || '家庭码生成失败', icon: 'none' });
    } finally {
      this.setData({ familyGenerating: false });
    }
  },

  onCopyFamilyCode() {
    if (!this.data.familyInviteCode) return;
    wx.setClipboardData({
      data: this.data.familyInviteCode,
      success: () => wx.showToast({ title: '家庭码已复制', icon: 'success' }),
    });
  },

  onFamilyCodeInput(event) {
    this.setData({ familyCodeInput: event.detail.value, showJoinPreview: false });
  },

  async onPreviewFamilyJoin() {
    if (this.data.familyPreviewing || this.data.familyJoining) return;
    const code = String(this.data.familyCodeInput || '').trim();
    if (!code) {
      wx.showToast({ title: '请输入家庭码', icon: 'none' });
      return;
    }
    this.setData({ familyPreviewing: true });
    try {
      const joinPreview = await session.previewFamilyJoin(code);
      this._joinRequestId = '';
      this.setData({ joinPreview, showJoinPreview: true });
    } catch (error) {
      wx.showToast({ title: error.message || '家庭码无效或已过期', icon: 'none' });
    } finally {
      this.setData({ familyPreviewing: false });
    }
  },

  onCloseJoinPreview() {
    if (this.data.familyJoining) return;
    this.setData({ showJoinPreview: false });
  },

  async onConfirmFamilyJoin() {
    if (this.data.familyJoining || !this.data.showJoinPreview) return;
    const code = String(this.data.familyCodeInput || '').trim();
    this._joinRequestId = this._joinRequestId
      || `join_${Date.now()}_${Math.floor(Math.random() * 1000000).toString(36)}`;
    this.setData({ familyJoining: true });
    try {
      await session.confirmFamilyJoin(code, this._joinRequestId);
      this.applyFamilySummary(await session.getFamilySummary());
      this._joinRequestId = '';
      this.setData({
        familyCodeInput: '',
        familyInviteCode: '',
        joinPreview: null,
        showJoinPreview: false,
      });
      wx.showToast({ title: '已加入家庭', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '加入家庭失败，请重试', icon: 'none' });
    } finally {
      this.setData({ familyJoining: false });
    }
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
