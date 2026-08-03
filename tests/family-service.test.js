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
    mergeResults: new Map(),
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
    async mergeFamilies({
      requestId,
      requestedByOpenid,
      sourceFamilyId,
      targetFamilyId,
      sourceChildId,
      targetChildId,
      inviteId,
    }) {
      const key = `${requestedByOpenid}:${requestId}`;
      if (state.mergeResults.has(key)) return state.mergeResults.get(key);
      const targetCategories = state.categories.filter((item) => (
        item.familyId === targetFamilyId && item.status === 'active'
      ));
      const categoryMap = new Map();
      state.categories.filter((item) => (
        item.familyId === sourceFamilyId && item.status === 'active'
      )).forEach((category) => {
        const duplicate = targetCategories.find((item) => (
          item.normalizedName === category.normalizedName
        ));
        if (duplicate) {
          category.status = 'merged';
          category.mergedIntoCategoryId = duplicate._id;
          categoryMap.set(category._id, duplicate._id);
        } else {
          category.familyId = targetFamilyId;
          category.childId = targetChildId;
          categoryMap.set(category._id, category._id);
          targetCategories.push(category);
        }
      });
      const targetCards = state.cards.filter((item) => (
        item.familyId === targetFamilyId && item.status === 'active'
      ));
      const cardMap = new Map();
      state.cards.filter((item) => (
        item.familyId === sourceFamilyId && item.status === 'active'
      )).forEach((card) => {
        const duplicate = targetCards.find((item) => (
          item.normalizedContent === card.normalizedContent
        ));
        if (duplicate) {
          card.status = 'merged';
          card.mergedIntoCardId = duplicate._id;
          cardMap.set(card._id, duplicate._id);
        } else {
          card.familyId = targetFamilyId;
          card.childId = targetChildId;
          card.categoryIds = (card.categoryIds || []).map((id) => categoryMap.get(id) || id);
          cardMap.set(card._id, card._id);
          targetCards.push(card);
        }
      });
      const sourceMember = state.members.find((item) => (
        item.familyId === sourceFamilyId
        && item.openid === requestedByOpenid
        && item.status === 'active'
      ));
      sourceMember.status = 'inactive';
      if (!state.members.some((item) => (
        item.familyId === targetFamilyId
        && item.openid === requestedByOpenid
        && item.status === 'active'
      ))) {
        state.members.push({
          familyId: targetFamilyId,
          openid: requestedByOpenid,
          role: 'member',
          status: 'active',
        });
      }
      state.users.find((item) => item.openid === requestedByOpenid).activeFamilyId = targetFamilyId;
      state.families.find((item) => item._id === sourceFamilyId).status = 'merged';
      const invite = state.invites.find((item) => item._id === inviteId);
      invite.status = 'used';
      invite.usedCount = 1;
      const result = {
        requestId,
        familyId: targetFamilyId,
        childId: targetChildId,
        movedCardCount: [...cardMap.entries()].filter(([from, to]) => from === to).length,
        mergedCardCount: [...cardMap.entries()].filter(([from, to]) => from !== to).length,
      };
      state.mergeResults.set(key, result);
      return result;
    },
    async findMergeResult(openid, requestId) {
      return state.mergeResults.get(`${openid}:${requestId}`) || null;
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

test('确认加入保留目标重复字卡进度并原地迁移来源独有字卡', async () => {
  const seed = createSeed();
  seed.cards[0].proficiency = 'proficient';
  seed.cards[0].reviewCount = 9;
  seed.cards[1].proficiency = 'unfamiliar';
  seed.cards[1].reviewCount = 1;
  const repository = createFamilyRepository(seed);
  const service = createSyncSettingsService(repository, {
    now: () => new Date('2026-08-03T00:00:00.000Z'),
    random: () => 0.25,
    inviteSecret: 'test-family-secret',
  });
  const invite = await service.createFamilyInvite('owner-openid');

  const result = await service.confirmFamilyJoin('joiner-openid', {
    code: invite.code,
    requestId: 'join-request-1',
  });

  const targetApple = repository.state.cards.find((card) => card._id === 'target-apple');
  const sourceApple = repository.state.cards.find((card) => card._id === 'source-apple');
  const sourceBanana = repository.state.cards.find((card) => card._id === 'source-banana');
  assert.equal(targetApple.proficiency, 'proficient');
  assert.equal(targetApple.reviewCount, 9);
  assert.equal(sourceApple.status, 'merged');
  assert.equal(sourceApple.mergedIntoCardId, 'target-apple');
  assert.equal(sourceBanana.familyId, 'target-family');
  assert.equal(sourceBanana._id, 'source-banana');
  assert.equal(result.familyId, 'target-family');
});

test('相同 requestId 重试不会重复创建成员或迁移字卡', async () => {
  const repository = createFamilyRepository(createSeed());
  const service = createSyncSettingsService(repository, {
    now: () => new Date('2026-08-03T00:00:00.000Z'),
    random: () => 0.25,
    inviteSecret: 'test-family-secret',
  });
  const invite = await service.createFamilyInvite('owner-openid');
  const payload = { code: invite.code, requestId: 'join-request-retry' };

  const first = await service.confirmFamilyJoin('joiner-openid', payload);
  const second = await service.confirmFamilyJoin('joiner-openid', payload);

  assert.deepEqual(second, first);
  assert.equal(repository.state.members.filter((item) => (
    item.familyId === 'target-family'
    && item.openid === 'joiner-openid'
    && item.status === 'active'
  )).length, 1);
  assert.equal(repository.state.cards.filter((item) => item.status === 'active').length, 2);
});
