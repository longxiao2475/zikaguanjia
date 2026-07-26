const TEMPLATE_ID = '38gNuA8j_S9YEP-incMBQnGnjVE6WxP1Lm8NRRPngkM';

function businessError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function assertOpenid(openid) {
  if (!openid || typeof openid !== 'string') {
    throw businessError('OPENID_REQUIRED', '登录状态已失效');
  }
}

function createSubscriptionService(repository) {
  if (!repository) throw new Error('REPOSITORY_REQUIRED');

  async function getQuota(openid) {
    assertOpenid(openid);
    return { quota: await repository.getQuota(openid) };
  }

  async function grant(openid, payload = {}) {
    assertOpenid(openid);
    const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : '';
    if (!requestId) throw businessError('REQUEST_ID_REQUIRED', '订阅请求编号缺失');
    if (requestId.length > 100) throw businessError('REQUEST_ID_TOO_LONG', '订阅请求编号无效');
    const source = typeof payload.source === 'string' ? payload.source.trim() : '';
    if (!/^[a-z0-9_]{1,40}$/.test(source)) {
      throw businessError('SOURCE_INVALID', '订阅来源无效');
    }
    return repository.grant({ openid, requestId, source, templateId: TEMPLATE_ID });
  }

  return { getQuota, grant };
}

module.exports = {
  TEMPLATE_ID,
  businessError,
  createSubscriptionService,
};

