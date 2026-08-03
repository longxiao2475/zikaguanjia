const test = require('node:test');
const assert = require('node:assert/strict');

const { createSyncSettingsService } = require('../cloudfunctions/syncSettings/service');

function createFamilyRepository(seed = {}) {
  const state = {
    users: [...(seed.users || [])],
    families: [...(seed.families || [])],
    members: [...(seed.members || [])],
    children: [...(seed.children || [])],
    cards: [...(seed.cards || [])],
    categories: [...(seed.categories || [])],
    invites: [...(seed.invites || [])],
  };
  return {
    state,
    async findUserByOpenid(openid) {
      return state.users.find((item) => item.openid === openid && item.status === 'active') || null;
    },
    async findFamilyById(id) {
      return state.families.find((item) => item._id === id) || null;
    },
    async findActiveMember(familyId, openid) {
      return state.members.find((item) => (
        item.familyId === familyId && item.openid === openid && item.status === 'active'
      )) || null;
    },
    async countActiveMembers(familyId) {
      return state.members.filter((item) => item.familyId === familyId && item.status === 'active').length;
    },
    async expireActiveInvites(familyId) {
      state.invites
        .filter((item) => item.familyId === familyId && item.status === 'active')
        .forEach((item) => { item.status = 'expired'; });
    },
    async createInvite(data) {
      const invite = { _id: `invite-${state.invites.length + 1}`, ...data };
      state.invites.push(invite);
      return invite;
    },
    async findInviteByDigest(codeDigest) {
      return state.invites.find((item) => item.codeDigest === codeDigest) || null;
    },
    async listActiveChildrenByFamily(familyId) {
      return state.children.filter((item) => item.familyId === familyId && item.status === 'active');
    },
    async listActiveCardsByFamily(familyId) {
      return state.cards.filter((item) => item.familyId === familyId && item.status === 'active');
    },
    async listActiveCategoriesByFamily(familyId) {
      return state.categories.filter((item) => item.familyId === familyId && item.status === 'active');
    },
  };
}

function createSeed() {
  return {
    users: [
      { _id: 'user-owner', openid: 'owner-openid', activeFamilyId: 'target-family', status: 'active' },
      { _id: 'user-joiner', openid: 'joiner-openid', activeFamilyId: 'source-family', status: 'active' },
    ],
    families: [
      { _id: 'target-family', name: '果果家庭', status: 'active' },
      { _id: 'source-family', name: '我的家庭', status: 'active' },
    ],
    members: [
      { familyId: 'target-family', openid: 'owner-openid', role: 'owner', status: 'active' },
      { familyId: 'source-family', openid: 'joiner-openid', role: 'owner', status: 'active' },
    ],
    children: [
      { _id: 'target-child', familyId: 'target-family', status: 'active' },
      { _id: 'source-child', familyId: 'source-family', status: 'active' },
    ],
    cards: [
      { _id: 'target-apple', familyId: 'target-family', childId: 'target-child', normalizedContent: '苹果', status: 'active' },
      { _id: 'source-apple', familyId: 'source-family', childId: 'source-child', normalizedContent: '苹果', status: 'active' },
      { _id: 'source-banana', familyId: 'source-family', childId: 'source-child', normalizedContent: '香蕉', status: 'active' },
    ],
    categories: [
      { _id: 'target-food', familyId: 'target-family', normalizedName: '食品', status: 'active' },
      { _id: 'source-food', familyId: 'source-family', normalizedName: '食品', status: 'active' },
      { _id: 'source-fruit', familyId: 'source-family', normalizedName: '水果', status: 'active' },
    ],
  };
}

test('家庭 owner 生成单次有效的 24 小时邀请码并使旧码失效', async () => {
  const repository = createFamilyRepository(createSeed());
  const now = new Date('2026-08-03T00:00:00.000Z');
  const service = createSyncSettingsService(repository, {
    now: () => now,
    random: () => 0.25,
    inviteSecret: 'test-family-secret',
  });

  const first = await service.createFamilyInvite('owner-openid');
  const second = await service.createFamilyInvite('owner-openid');

  assert.match(first.code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
  assert.equal(second.code.length, 8);
  assert.equal(repository.state.invites.length, 2);
  assert.equal(repository.state.invites[0].status, 'expired');
  assert.equal(repository.state.invites[1].maxUses, 1);
  assert.equal(repository.state.invites[1].expiresAt.toISOString(), '2026-08-04T00:00:00.000Z');
  assert.equal('code' in repository.state.invites[1], false);
});

test('加入预览返回重复和独有数量且不暴露字卡内容', async () => {
  const repository = createFamilyRepository(createSeed());
  const service = createSyncSettingsService(repository, {
    now: () => new Date('2026-08-03T00:00:00.000Z'),
    random: () => 0.25,
    inviteSecret: 'test-family-secret',
  });
  const invite = await service.createFamilyInvite('owner-openid');

  const preview = await service.previewFamilyJoin('joiner-openid', { code: invite.code });

  assert.deepEqual(preview, {
    familyName: '果果家庭',
    memberCount: 1,
    sourceCardCount: 2,
    targetCardCount: 1,
    duplicateCardCount: 1,
    uniqueCardCount: 1,
    categoryConflictCount: 1,
  });
  assert.equal(JSON.stringify(preview).includes('苹果'), false);
});

test('已有其他成员的来源家庭不能直接合并加入', async () => {
  const seed = createSeed();
  seed.members.push({
    familyId: 'source-family', openid: 'another-openid', role: 'member', status: 'active',
  });
  const repository = createFamilyRepository(seed);
  const service = createSyncSettingsService(repository, {
    now: () => new Date('2026-08-03T00:00:00.000Z'),
    random: () => 0.25,
    inviteSecret: 'test-family-secret',
  });
  const invite = await service.createFamilyInvite('owner-openid');

  await assert.rejects(
    () => service.previewFamilyJoin('joiner-openid', { code: invite.code }),
    (error) => error.code === 'SOURCE_FAMILY_HAS_MEMBERS',
  );
});
