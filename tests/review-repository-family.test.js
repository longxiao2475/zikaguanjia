const test = require('node:test');
const assert = require('node:assert/strict');

const { createReviewRepository } = require('../cloudfunctions/reviewService/repository');

function createDatabase() {
  const tables = {
    users: [{
      _id: 'user-member', openid: 'member-openid', activeFamilyId: 'family-1', status: 'active',
    }],
    family_members: [{
      _id: 'member-1', familyId: 'family-1', openid: 'member-openid', status: 'active',
    }],
    children: [{
      _id: 'child-1', ownerOpenid: 'owner-openid', familyId: 'family-1', status: 'active',
    }],
    cards: [{
      _id: 'card-1', ownerOpenid: 'owner-openid', familyId: 'family-1', childId: 'child-1',
      content: '大', proficiency: 'unfamiliar', reviewCount: 0, status: 'active',
    }],
    review_sessions: [],
  };

  function collection(name) {
    const state = { query: {} };
    const api = {
      where(query) {
        state.query = query;
        return api;
      },
      limit() {
        return api;
      },
      async get() {
        return {
          data: tables[name].filter((item) => (
            Object.entries(state.query).every(([key, value]) => item[key] === value)
          )),
        };
      },
      async add({ data }) {
        const document = { _id: `${name}-${tables[name].length + 1}`, ...data };
        tables[name].push(document);
        return { _id: document._id };
      },
      doc(id) {
        return {
          async get() {
            return { data: tables[name].find((item) => item._id === id) || null };
          },
          async update({ data }) {
            const document = tables[name].find((item) => item._id === id);
            for (const [key, value] of Object.entries(data)) {
              document[key] = value && value.__increment
                ? Number(document[key] || 0) + value.__increment
                : value;
            }
          },
        };
      },
    };
    return api;
  }

  return {
    tables,
    command: { inc: (value) => ({ __increment: value }) },
    collection,
    serverDate: () => 'SERVER_DATE',
    runTransaction: async (handler) => handler({ collection }),
  };
}

test('review 仓储允许家庭成员复习共享字卡并记录实际操作人', async () => {
  const db = createDatabase();
  const repository = createReviewRepository(db);

  const result = await repository.completeReview({
    openid: 'member-openid',
    childId: 'child-1',
    bizDate: '2026-08-03',
    items: [{ cardId: 'card-1', proficiency: 'normal' }],
  });

  assert.equal(result.session.familyId, 'family-1');
  assert.equal(result.session.reviewedByOpenid, 'member-openid');
  assert.equal(result.cards[0].proficiency, 'normal');
});
