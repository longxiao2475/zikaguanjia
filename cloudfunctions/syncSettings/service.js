const DEFAULT_STUDY_DAYS = Object.freeze([2, 4, 6]);

function createSyncSettingsService(repository) {
  if (!repository) throw new Error('REPOSITORY_REQUIRED');

  async function bootstrap(openid) {
    if (!openid || typeof openid !== 'string') throw new Error('OPENID_REQUIRED');

    let user = await repository.findUserByOpenid(openid);
    if (!user) {
      user = await repository.createUser({
        openid,
        defaultChildId: null,
        subscriptionQuota: 0,
        status: 'active',
      });
    }

    let child = null;
    if (user.defaultChildId) {
      child = await repository.findChildById(user.defaultChildId);
      if (child && (child.ownerOpenid !== openid || child.status !== 'active')) {
        child = null;
      }
    }

    if (!child) {
      child = await repository.findActiveChildByOwner(openid);
    }

    if (!child) {
      child = await repository.createChild({
        ownerOpenid: openid,
        name: '',
        studyDays: [...DEFAULT_STUDY_DAYS],
        reminderTime: '20:00',
        reminderEnabled: true,
        timezone: 'Asia/Shanghai',
        status: 'active',
      });
    }

    if (user.defaultChildId !== child._id) {
      user = await repository.updateUser(user._id, { defaultChildId: child._id });
    }

    return { user, child };
  }

  return { bootstrap };
}

module.exports = {
  DEFAULT_STUDY_DAYS,
  createSyncSettingsService,
};
