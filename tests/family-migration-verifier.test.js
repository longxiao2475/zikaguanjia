const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyFamilyMigration } = require('../scripts/verify-family-migration');

function createSnapshots() {
  const cards = Array.from({ length: 69 }, (_, index) => ({
    _id: `card-${index + 1}`,
    ownerOpenid: 'legacy-openid',
    childId: 'child-1',
    content: `字${index + 1}`,
    categoryIds: index % 2 ? ['category-1'] : [],
    customWords: index % 3 ? [] : [`字${index + 1}词`],
    proficiency: ['unfamiliar', 'normal', 'proficient'][index % 3],
    reviewCount: index,
    lastReviewAt: index ? `2026-07-${String((index % 28) + 1).padStart(2, '0')}T04:00:00.000Z` : null,
    status: 'active',
  }));
  const before = {
    users: [{ _id: 'user-1', openid: 'legacy-openid', defaultChildId: 'child-1', status: 'active' }],
    children: [{ _id: 'child-1', ownerOpenid: 'legacy-openid', name: '果果', status: 'active' }],
    cards,
  };
  const after = {
    users: [{ ...before.users[0], activeFamilyId: 'family-1', familyMigrationVersion: 1 }],
    children: [{ ...before.children[0], familyId: 'family-1' }],
    cards: cards.map((card) => ({ ...card, familyId: 'family-1' })),
    families: [{
      _id: 'family-1', createdByOpenid: 'legacy-openid', legacyOwnerOpenid: 'legacy-openid', status: 'active',
    }],
    family_members: [{
      _id: 'member-1', familyId: 'family-1', openid: 'legacy-openid', role: 'owner', status: 'active',
    }],
  };
  return { before, after };
}

test('迁移核验确认一个孩子和 69 张字卡原地保留且原微信成为 owner', () => {
  const { before, after } = createSnapshots();

  const result = verifyFamilyMigration(before, after);

  assert.deepEqual(result, {
    ok: true,
    legacyOwnerOpenid: 'legacy-openid',
    familyId: 'family-1',
    activeChildCount: 1,
    activeCardCount: 69,
  });
});

test('迁移核验会拒绝字卡缺失、id 替换或复习进度变化', () => {
  const missing = createSnapshots();
  missing.after.cards.pop();
  assert.throws(
    () => verifyFamilyMigration(missing.before, missing.after),
    /活动字卡数量.*69.*68/,
  );

  const replaced = createSnapshots();
  replaced.after.cards[0]._id = 'replacement-id';
  assert.throws(
    () => verifyFamilyMigration(replaced.before, replaced.after),
    /缺少原字卡 card-1/,
  );

  const changed = createSnapshots();
  changed.after.cards[10].reviewCount = 999;
  assert.throws(
    () => verifyFamilyMigration(changed.before, changed.after),
    /card-11.*reviewCount/,
  );
});

test('迁移核验会拒绝跨家庭归属或原微信未成为创建人', () => {
  const crossFamily = createSnapshots();
  crossFamily.after.cards[0].familyId = 'family-2';
  assert.throws(
    () => verifyFamilyMigration(crossFamily.before, crossFamily.after),
    /card-1.*familyId/,
  );

  const wrongOwner = createSnapshots();
  wrongOwner.after.families[0].createdByOpenid = 'other-openid';
  assert.throws(
    () => verifyFamilyMigration(wrongOwner.before, wrongOwner.after),
    /家庭创建人不是原微信/,
  );
});
