const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateInviteCode,
  normalizeInviteCode,
  resolveFamilyAccess,
} = require('../cloudfunctions/syncSettings/family');

function createRepository() {
  return {
    async findUserByOpenid(openid) {
      if (openid !== 'openid-1') return null;
      return { _id: 'user-1', openid, activeFamilyId: 'family-1', status: 'active' };
    },
    async findFamilyById(familyId) {
      if (familyId !== 'family-1') return null;
      return { _id: familyId, status: 'active' };
    },
    async findActiveMember(familyId, openid) {
      if (familyId !== 'family-1' || openid !== 'openid-1') return null;
      return { _id: 'member-1', familyId, openid, role: 'owner', status: 'active' };
    },
    async findChildById(childId) {
      const children = {
        'child-1': { _id: 'child-1', familyId: 'family-1', status: 'active' },
        'child-2': { _id: 'child-2', familyId: 'family-2', status: 'active' },
      };
      return children[childId] || null;
    },
  };
}

test('有效家庭成员只能访问同一家庭的孩子', async () => {
  const repository = createRepository();

  const access = await resolveFamilyAccess(repository, 'openid-1', 'child-1');

  assert.equal(access.family._id, 'family-1');
  assert.equal(access.member.role, 'owner');
  await assert.rejects(
    () => resolveFamilyAccess(repository, 'openid-1', 'child-2'),
    (error) => error.code === 'CHILD_FORBIDDEN' && error.message === '无权访问该孩子',
  );
});

test('家庭码排除易混字符并统一标准化输入', () => {
  const code = generateInviteCode(() => 0.25);

  assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
  assert.equal(code.length, 8);
  assert.equal(normalizeInviteCode(' ab-cd 2345 '), 'ABCD2345');
});
