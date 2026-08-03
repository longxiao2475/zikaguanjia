const DEFAULT_STUDY_DAYS = Object.freeze([2, 4, 6]);
const crypto = require('crypto');
const { generateInviteCode, normalizeInviteCode } = require('./family');
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

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

function createSyncSettingsService(repository, options = {}) {
  if (!repository) throw new Error('REPOSITORY_REQUIRED');
  const now = options.now || (() => new Date());
  const random = options.random || Math.random;
  const inviteSecret = options.inviteSecret || process.env.FAMILY_INVITE_SECRET || '';

  function digestInviteCode(code) {
    if (!inviteSecret) {
      throw businessError('FAMILY_INVITE_SECRET_MISSING', '家庭邀请服务尚未配置');
    }
    return crypto.createHmac('sha256', inviteSecret).update(code).digest('hex');
  }

  async function getFamilyContext(openid) {
    const user = await repository.findUserByOpenid(openid);
    const family = user && await repository.findFamilyById(user.activeFamilyId);
    const member = user && await repository.findActiveMember(user.activeFamilyId, openid);
    if (!user || !family || family.status !== 'active' || !member) {
      throw businessError('FAMILY_FORBIDDEN', '无权访问该家庭');
    }
    return { user, family, member };
  }

  async function getValidInvite(rawCode) {
    const code = normalizeInviteCode(rawCode);
    if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(code)) {
      throw businessError('FAMILY_INVITE_INVALID', '家庭码无效或已过期');
    }
    const invite = await repository.findInviteByDigest(digestInviteCode(code));
    const expiresAt = invite && new Date(invite.expiresAt).getTime();
    if (
      !invite
      || invite.status !== 'active'
      || Number(invite.usedCount || 0) >= Number(invite.maxUses || 1)
      || !Number.isFinite(expiresAt)
      || expiresAt <= now().getTime()
    ) {
      throw businessError('FAMILY_INVITE_INVALID', '家庭码无效或已过期');
    }
    return { code, invite };
  }

  async function createFamilyInvite(openid) {
    const { family, member } = await getFamilyContext(openid);
    if (member.role !== 'owner') {
      throw businessError('FAMILY_OWNER_REQUIRED', '只有家庭创建人可以生成家庭码');
    }
    const code = generateInviteCode(random);
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + INVITE_TTL_MS);
    await repository.expireActiveInvites(family._id);
    await repository.createInvite({
      familyId: family._id,
      codeDigest: digestInviteCode(code),
      status: 'active',
      maxUses: 1,
      usedCount: 0,
      createdByOpenid: openid,
      createdAt,
      expiresAt,
      usedAt: null,
      usedByOpenid: null,
    });
    return { code, expiresAt };
  }

  async function previewFamilyJoin(openid, payload = {}) {
    const source = await getFamilyContext(openid);
    const { invite } = await getValidInvite(payload.code);
    if (invite.familyId === source.family._id) {
      throw businessError('ALREADY_IN_FAMILY', '当前账号已经在这个家庭中');
    }
    const sourceMemberCount = await repository.countActiveMembers(source.family._id);
    if (sourceMemberCount !== 1) {
      throw businessError('SOURCE_FAMILY_HAS_MEMBERS', '当前家庭已有其他成员，不能直接合并');
    }
    const [targetFamily, targetMemberCount, sourceChildren, targetChildren] = await Promise.all([
      repository.findFamilyById(invite.familyId),
      repository.countActiveMembers(invite.familyId),
      repository.listActiveChildrenByFamily(source.family._id),
      repository.listActiveChildrenByFamily(invite.familyId),
    ]);
    if (!targetFamily || targetFamily.status !== 'active' || !sourceChildren.length || !targetChildren.length) {
      throw businessError('FAMILY_INVITE_INVALID', '家庭码无效或已过期');
    }
    const [sourceCards, targetCards, sourceCategories, targetCategories] = await Promise.all([
      repository.listActiveCardsByFamily(source.family._id),
      repository.listActiveCardsByFamily(invite.familyId),
      repository.listActiveCategoriesByFamily(source.family._id),
      repository.listActiveCategoriesByFamily(invite.familyId),
    ]);
    const targetContents = new Set(targetCards.map((card) => card.normalizedContent));
    const targetCategoryNames = new Set(targetCategories.map((category) => category.normalizedName));
    const duplicateCardCount = sourceCards.filter((card) => (
      targetContents.has(card.normalizedContent)
    )).length;
    return {
      familyName: targetFamily.name || '家庭',
      memberCount: targetMemberCount,
      sourceCardCount: sourceCards.length,
      targetCardCount: targetCards.length,
      duplicateCardCount,
      uniqueCardCount: sourceCards.length - duplicateCardCount,
      categoryConflictCount: sourceCategories.filter((category) => (
        targetCategoryNames.has(category.normalizedName)
      )).length,
    };
  }

  async function getFamilySummary(openid) {
    const { family, member } = await getFamilyContext(openid);
    return {
      family: { _id: family._id, name: family.name || '我的家庭' },
      member: { role: member.role },
      memberCount: await repository.countActiveMembers(family._id),
    };
  }

  async function confirmFamilyJoin(openid, payload = {}) {
    const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(requestId)) {
      throw businessError('JOIN_REQUEST_ID_INVALID', '加入请求无效，请重试');
    }
    const existingResult = await repository.findMergeResult(openid, requestId);
    if (existingResult) return existingResult;

    const source = await getFamilyContext(openid);
    const { invite } = await getValidInvite(payload.code);
    if (invite.familyId === source.family._id) {
      throw businessError('ALREADY_IN_FAMILY', '当前账号已经在这个家庭中');
    }
    if (await repository.countActiveMembers(source.family._id) !== 1) {
      throw businessError('SOURCE_FAMILY_HAS_MEMBERS', '当前家庭已有其他成员，不能直接合并');
    }
    const [sourceChildren, targetChildren, targetFamily] = await Promise.all([
      repository.listActiveChildrenByFamily(source.family._id),
      repository.listActiveChildrenByFamily(invite.familyId),
      repository.findFamilyById(invite.familyId),
    ]);
    if (
      !targetFamily
      || targetFamily.status !== 'active'
      || sourceChildren.length !== 1
      || targetChildren.length !== 1
    ) {
      throw businessError('FAMILY_MERGE_CHILDREN_UNSUPPORTED', '当前家庭数据暂不支持直接合并');
    }
    return repository.mergeFamilies({
      requestId,
      requestedByOpenid: openid,
      sourceFamilyId: source.family._id,
      targetFamilyId: invite.familyId,
      sourceChildId: sourceChildren[0]._id,
      targetChildId: targetChildren[0]._id,
      inviteId: invite._id,
    });
  }

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

  return {
    bootstrap,
    confirmFamilyJoin,
    createFamilyInvite,
    getFamilySummary,
    previewFamilyJoin,
    saveSettings,
  };
}

module.exports = {
  DEFAULT_STUDY_DAYS,
  INVITE_TTL_MS,
  businessError,
  createSyncSettingsService,
  normalizeName,
  normalizeStudyDays,
};
