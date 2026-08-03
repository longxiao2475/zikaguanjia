const DEFAULT_STUDY_DAYS = Object.freeze([2, 4, 6]);

function businessError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function normalizeName(value) {
  const name = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  if (Array.from(name).length > 12) {
    throw businessError('CHILD_NAME_TOO_LONG', '孩子昵称不能超过 12 个字');
  }
  return name;
}

function normalizeStudyDays(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw businessError('STUDY_DAYS_REQUIRED', '请至少选择一个认字日');
  }
  const days = [...new Set(value.map(Number))];
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw businessError('STUDY_DAYS_INVALID', '认字日设置无效');
  }
  return days.sort((left, right) => left - right);
}

function createSyncSettingsService(repository) {
  if (!repository) throw new Error('REPOSITORY_REQUIRED');

  async function ensureFamily(openid, user) {
    let family = user.activeFamilyId
      ? await repository.findFamilyById(user.activeFamilyId)
      : null;
    if (!family) family = await repository.findLegacyFamilyByCreator(openid);
    if (!family) {
      family = await repository.createFamily({
        name: '我的家庭',
        createdByOpenid: openid,
        legacyOwnerOpenid: openid,
        status: 'active',
      });
    }
    return family;
  }

  async function migrateLegacyFamily(openid, user, child) {
    const family = await ensureFamily(openid, user);
    const legacyChildren = await repository.listActiveChildrenByOwner(openid);
    const childIds = [...new Set([child, ...legacyChildren]
      .filter(Boolean)
      .map((item) => item._id))];

    await repository.backfillChildrenFamily(openid, family._id);
    await repository.backfillCardsFamily(childIds, family._id);
    await repository.backfillCategoriesFamily(childIds, family._id);
    await repository.backfillReviewSessionsFamily(childIds, family._id);
    await repository.backfillReminderLogsFamily(childIds, family._id);

    let member = await repository.findActiveMember(family._id, openid);
    if (!member) {
      member = await repository.createMember({
        familyId: family._id,
        openid,
        role: 'owner',
        status: 'active',
        reminderTime: child.reminderTime || '20:00',
        reminderEnabled: child.reminderEnabled !== false,
      });
    }

    const activeCardCount = await repository.countActiveCards(childIds, family._id);
    const updatedUser = await repository.updateUser(user._id, {
      activeFamilyId: family._id,
      familyMigrationVersion: 1,
    });
    const migratedChild = await repository.findChildById(child._id);
    return {
      user: updatedUser,
      family,
      member,
      child: migratedChild,
      migration: { activeCardCount, childCount: childIds.length },
    };
  }

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

    return migrateLegacyFamily(openid, user, child);
  }

  async function saveSettings(openid, payload = {}) {
    if (!openid || typeof openid !== 'string') throw businessError('OPENID_REQUIRED', '登录状态已失效');
    const childId = typeof payload.childId === 'string' ? payload.childId.trim() : '';
    if (!childId) throw businessError('CHILD_ID_REQUIRED', '请选择孩子');
    const user = await repository.findUserByOpenid(openid);
    const child = await repository.findChildById(childId);
    const member = user && await repository.findActiveMember(user.activeFamilyId, openid);
    if (
      !user
      || user.status !== 'active'
      || !member
      || !child
      || child.familyId !== user.activeFamilyId
      || child.status !== 'active'
    ) {
      throw businessError('CHILD_FORBIDDEN', '无权修改该孩子设置');
    }
    const reminderTime = typeof payload.reminderTime === 'string' ? payload.reminderTime.trim() : '';
    if (!/^(?:[01]\d|2[0-3]):00$/.test(reminderTime)) {
      throw businessError('REMINDER_TIME_INVALID', '提醒时间格式无效');
    }
    if (typeof payload.reminderEnabled !== 'boolean') {
      throw businessError('REMINDER_ENABLED_INVALID', '提醒开关设置无效');
    }
    const updatedChild = await repository.updateChild(childId, {
      name: normalizeName(payload.name),
      studyDays: normalizeStudyDays(payload.studyDays),
      timezone: 'Asia/Shanghai',
    });
    const updatedMember = await repository.updateMember(member._id, {
      reminderTime,
      reminderEnabled: payload.reminderEnabled,
    });
    return { child: updatedChild, member: updatedMember };
  }

  return { bootstrap, saveSettings };
}

module.exports = {
  DEFAULT_STUDY_DAYS,
  businessError,
  createSyncSettingsService,
  normalizeName,
  normalizeStudyDays,
};
