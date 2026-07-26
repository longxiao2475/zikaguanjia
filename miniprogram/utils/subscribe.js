const cache = require('./cache');
const { callFunction } = require('./cloud');

const TEMPLATE_ID = '38gNuA8j_S9YEP-incMBQnGnjVE6WxP1Lm8NRRPngkM';

function createRequestId(now = Date.now(), random = Math.random()) {
  return `sub_${now}_${Math.floor(random * 1000000).toString(36)}`;
}

function requestSubscribeMessage() {
  return new Promise((resolve, reject) => {
    const result = wx.requestSubscribeMessage({
      tmplIds: [TEMPLATE_ID],
      success: resolve,
      fail: reject,
    });
    if (result && typeof result.then === 'function') result.then(resolve, reject);
  });
}

function updateCachedQuota(quota) {
  const user = cache.getUser();
  if (user) cache.setUser({ ...user, subscriptionQuota: Number(quota || 0) });
}

async function requestGrant(source, options = {}) {
  const response = await requestSubscribeMessage();
  if (!response || response[TEMPLATE_ID] !== 'accept') {
    return { accepted: false, quota: null, idempotent: false };
  }
  const requestId = options.requestId || createRequestId();
  const result = await callFunction('subscriptionService', {
    action: 'grant',
    requestId,
    source,
  });
  updateCachedQuota(result.quota);
  return {
    accepted: true,
    quota: result.quota,
    idempotent: Boolean(result.idempotent),
  };
}

async function getQuota() {
  const result = await callFunction('subscriptionService', { action: 'getQuota' });
  updateCachedQuota(result.quota);
  return Number(result.quota || 0);
}

module.exports = {
  TEMPLATE_ID,
  createRequestId,
  getQuota,
  requestGrant,
};
