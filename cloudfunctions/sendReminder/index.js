const cloud = require('wx-server-sdk');
const { createReminderRepository } = require('./repository');
const { TEMPLATE_ID, createReminderService } = require('./service');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const repository = createReminderRepository(cloud.database());
const sender = {
  send(message) {
    return cloud.openapi.subscribeMessage.send(message);
  },
};
const service = createReminderService({ repository, sender, templateId: TEMPLATE_ID });

exports.main = async (event = {}) => {
  try {
    if (event.action === 'status') {
      const openid = cloud.getWXContext().OPENID;
      return { ok: true, data: await service.getStatus(openid, new Date()) };
    }
    return { ok: true, data: await service.run(new Date()) };
  } catch (error) {
    console.error('sendReminder failed', error);
    return {
      ok: false,
      error: {
        code: error.code || 'SEND_REMINDER_FAILED',
        message: '提醒任务执行失败',
      },
    };
  }
};
