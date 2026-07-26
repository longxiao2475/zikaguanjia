const cloud = require('wx-server-sdk');
const { createSyncSettingsRepository } = require('./repository');
const { createSyncSettingsService } = require('./service');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const repository = createSyncSettingsRepository(cloud.database());
const service = createSyncSettingsService(repository);

function errorResult(error) {
  return {
    ok: false,
    error: {
      code: error.code || error.message || 'SYNC_SETTINGS_FAILED',
      message: error.code ? error.message : '初始化失败，请稍后重试',
    },
  };
}

exports.main = async (event = {}) => {
  try {
    const action = service[event.action];
    if (!['bootstrap', 'saveSettings'].includes(event.action) || typeof action !== 'function') {
      const error = new Error('不支持的操作');
      error.code = 'ACTION_NOT_SUPPORTED';
      throw error;
    }
    const openid = cloud.getWXContext().OPENID;
    return { ok: true, data: await action(openid, event) };
  } catch (error) {
    console.error('syncSettings failed', error);
    return errorResult(error);
  }
};
