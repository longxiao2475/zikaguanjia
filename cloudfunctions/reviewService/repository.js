function businessError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function createSummary(items) {
  return {
    plannedCount: items.length,
    reviewedCount: items.length,
    unfamiliarCount: items.filter((item) => item.proficiency === 'unfamiliar').length,
    normalCount: items.filter((item) => item.proficiency === 'normal').length,
    proficientCount: items.filter((item) => item.proficiency === 'proficient').length,
  };
}

function createReviewRepository(db) {
  const command = db.command;

  async function readDocument(collectionName, id) {
    const result = await db.collection(collectionName).doc(id).get();
    return result.data || null;
  }

  return {
    async completeReview({ openid, childId, items, bizDate }) {
      const transactionResult = await db.runTransaction(async (transaction) => {
        const childResult = await transaction.collection('children').doc(childId).get();
        const child = childResult.data || null;
        if (!child || child.ownerOpenid !== openid || child.status !== 'active') {
          throw businessError('CHILD_FORBIDDEN', '无权访问该孩子');
        }

        const reviewedAt = db.serverDate();
        const snapshots = [];
        for (const item of items) {
          const cardResult = await transaction.collection('cards').doc(item.cardId).get();
          const card = cardResult.data || null;
          if (
            !card
            || card.ownerOpenid !== openid
            || card.childId !== childId
            || card.status !== 'active'
          ) {
            throw businessError('CARD_FORBIDDEN', '字卡不存在或无权操作');
          }
          snapshots.push({ card, proficiency: item.proficiency });
        }

        const sessionItems = snapshots.map(({ card, proficiency }) => ({
          cardId: card._id,
          contentSnapshot: card.content,
          beforeProficiency: card.proficiency,
          afterProficiency: proficiency,
          reviewedAt,
        }));
        const sessionResult = await transaction.collection('review_sessions').add({
          data: {
            ownerOpenid: openid,
            childId,
            bizDate,
            status: 'completed',
            startedAt: reviewedAt,
            completedAt: reviewedAt,
            summary: createSummary(items),
            items: sessionItems,
          },
        });

        for (const { card, proficiency } of snapshots) {
          await transaction.collection('cards').doc(card._id).update({
            data: {
              proficiency,
              lastReviewAt: reviewedAt,
              reviewCount: command.inc(1),
              updatedAt: reviewedAt,
            },
          });
        }

        return {
          sessionId: sessionResult._id,
          cardIds: snapshots.map(({ card }) => card._id),
        };
      });

      const [session, cards] = await Promise.all([
        readDocument('review_sessions', transactionResult.sessionId),
        Promise.all(transactionResult.cardIds.map((id) => readDocument('cards', id))),
      ]);
      return { session, cards };
    },
  };
}

module.exports = {
  createReviewRepository,
  createSummary,
};

