const test = require('node:test');
const assert = require('node:assert/strict');

const { createReviewService } = require('../cloudfunctions/reviewService/service');

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function hasCode(code) {
  return (error) => error && error.code === code;
}

function createMemoryRepository(seed = {}) {
  const children = [...(seed.children || [
    { _id: 'child-1', ownerOpenid: 'openid-1', familyId: 'family-1', status: 'active' },
  ])];
  const members = [...(seed.members || [
    { familyId: 'family-1', openid: 'openid-1', status: 'active' },
  ])];
  const cards = (seed.cards || [
    {
      _id: 'card-1', ownerOpenid: 'openid-1', familyId: 'family-1', childId: 'child-1', content: '大',
      proficiency: 'unfamiliar', reviewCount: 0, status: 'active',
    },
    {
      _id: 'card-2', ownerOpenid: 'openid-1', familyId: 'family-1', childId: 'child-1', content: '人',
      proficiency: 'normal', reviewCount: 2, status: 'active',
    },
  ]).map((card) => ({
    familyId: (children.find((child) => child._id === card.childId) || {}).familyId,
    ...card,
  }));
  const sessions = [];

  return {
    cards,
    children,
    sessions,
    failAfterUpdates: false,

    async completeReview({ openid, childId, items, bizDate }) {
      const nextCards = cards.map((card) => ({ ...card }));
      const child = children.find((item) => item._id === childId);
      const member = child && members.find((item) => (
        item.familyId === child.familyId && item.openid === openid && item.status === 'active'
      ));
      if (!child || !member || child.status !== 'active') {
        throw codedError('CHILD_FORBIDDEN');
      }

      const sessionItems = items.map((result) => {
        const card = nextCards.find((item) => item._id === result.cardId);
        if (
          !card
          || card.familyId !== child.familyId
          || card.childId !== childId
          || card.status !== 'active'
        ) {
          throw codedError('CARD_FORBIDDEN');
        }
        const beforeProficiency = card.proficiency;
        card.proficiency = result.proficiency;
        card.reviewCount = Number(card.reviewCount || 0) + 1;
        card.lastReviewAt = 'SERVER_DATE';
        card.updatedAt = 'SERVER_DATE';
        return {
          cardId: card._id,
          contentSnapshot: card.content,
          beforeProficiency,
          afterProficiency: result.proficiency,
          reviewedAt: 'SERVER_DATE',
        };
      });

      if (this.failAfterUpdates) throw codedError('TRANSACTION_FAILED');

      const summary = {
        plannedCount: items.length,
        reviewedCount: items.length,
        unfamiliarCount: items.filter((item) => item.proficiency === 'unfamiliar').length,
        normalCount: items.filter((item) => item.proficiency === 'normal').length,
        proficientCount: items.filter((item) => item.proficiency === 'proficient').length,
      };
      const session = {
        _id: `session-${sessions.length + 1}`,
        familyId: child.familyId,
        reviewedByOpenid: openid,
        childId,
        bizDate,
        status: 'completed',
        summary,
        items: sessionItems,
      };
      cards.splice(0, cards.length, ...nextCards);
      sessions.push(session);
      return {
        session,
        cards: sessionItems.map((item) => cards.find((card) => card._id === item.cardId)),
      };
    },
  };
}

test('complete 创建一次 session 并更新全部字卡', async () => {
  const repository = createMemoryRepository();
  const service = createReviewService(repository, {
    now: () => new Date('2026-07-26T04:00:00.000Z'),
  });

  const result = await service.complete('openid-1', {
    childId: 'child-1',
    items: [
      { cardId: 'card-1', proficiency: 'normal' },
      { cardId: 'card-2', proficiency: 'proficient' },
    ],
  });

  assert.equal(repository.sessions.length, 1);
  assert.equal(result.session.bizDate, '2026-07-26');
  assert.deepEqual(result.session.summary, {
    plannedCount: 2,
    reviewedCount: 2,
    unfamiliarCount: 0,
    normalCount: 1,
    proficientCount: 1,
  });
  assert.deepEqual(result.session.items[0], {
    cardId: 'card-1',
    contentSnapshot: '大',
    beforeProficiency: 'unfamiliar',
    afterProficiency: 'normal',
    reviewedAt: 'SERVER_DATE',
  });
  assert.equal(result.cards[0].reviewCount, 1);
  assert.equal(result.cards[1].reviewCount, 3);
});

test('同一家庭成员可以提交共享字卡复习且记录实际操作人', async () => {
  const repository = createMemoryRepository({
    children: [{
      _id: 'child-1', ownerOpenid: 'owner-openid', familyId: 'family-1', status: 'active',
    }],
    members: [
      { familyId: 'family-1', openid: 'owner-openid', status: 'active' },
      { familyId: 'family-1', openid: 'member-openid', status: 'active' },
    ],
    cards: [{
      _id: 'card-1', familyId: 'family-1', childId: 'child-1', content: '大',
      proficiency: 'unfamiliar', reviewCount: 0, status: 'active',
    }],
  });
  const service = createReviewService(repository);

  const result = await service.complete('member-openid', {
    childId: 'child-1',
    items: [{ cardId: 'card-1', proficiency: 'normal' }],
  });

  assert.equal(result.session.familyId, 'family-1');
  assert.equal(result.session.reviewedByOpenid, 'member-openid');
  assert.equal(result.cards[0].proficiency, 'normal');
});

test('拒绝空结果、重复 cardId 和非法熟练度', async () => {
  const service = createReviewService(createMemoryRepository());
  const base = { childId: 'child-1' };

  await assert.rejects(() => service.complete('openid-1', { ...base, items: [] }), hasCode('REVIEW_ITEMS_REQUIRED'));
  await assert.rejects(() => service.complete('openid-1', {
    ...base,
    items: [
      { cardId: 'card-1', proficiency: 'normal' },
      { cardId: 'card-1', proficiency: 'proficient' },
    ],
  }), hasCode('REVIEW_ITEMS_DUPLICATE'));
  await assert.rejects(() => service.complete('openid-1', {
    ...base,
    items: [{ cardId: 'card-1', proficiency: 'mastered' }],
  }), hasCode('PROFICIENCY_INVALID'));
});

test('越权访问被拒绝且不创建 session', async () => {
  const repository = createMemoryRepository();
  const service = createReviewService(repository);

  await assert.rejects(() => service.complete('other-openid', {
    childId: 'child-1',
    items: [{ cardId: 'card-1', proficiency: 'normal' }],
  }), hasCode('CHILD_FORBIDDEN'));

  assert.equal(repository.sessions.length, 0);
  assert.equal(repository.cards[0].proficiency, 'unfamiliar');
});

test('事务中途失败时不留下 session 或部分字卡更新', async () => {
  const repository = createMemoryRepository();
  repository.failAfterUpdates = true;
  const service = createReviewService(repository);

  await assert.rejects(() => service.complete('openid-1', {
    childId: 'child-1',
    items: [{ cardId: 'card-1', proficiency: 'proficient' }],
  }), hasCode('TRANSACTION_FAILED'));

  assert.equal(repository.sessions.length, 0);
  assert.equal(repository.cards[0].proficiency, 'unfamiliar');
  assert.equal(repository.cards[0].reviewCount, 0);
});
