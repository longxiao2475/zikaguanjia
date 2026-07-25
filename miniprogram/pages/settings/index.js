const session = require('../../utils/session');

Page({
  data: {
    childName: '小朋友',
    studyDaysText: '周二、周四、周六',
    reminderTime: '20:00',
  },

  onShow() {
    const { child } = session.getCachedSession();
    if (!child) return;
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    this.setData({
      childName: child.name || '小朋友',
      studyDaysText: (child.studyDays || [2, 4, 6]).map((day) => dayNames[day]).join('、'),
      reminderTime: child.reminderTime || '20:00',
    });
  },
});
