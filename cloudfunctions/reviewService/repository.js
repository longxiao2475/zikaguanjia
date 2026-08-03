function businessError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}
const { assertTransactionFamilyAccess } = require('./family');

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
  const reviewAssignments = db.collection('review_assignments');
  let assignmentCollectionInitialization = null;

  function isMissingCollectionError(error) {
    const code = error && (error.errCode || error.errno || error.code);
    const message = String((error && (error.errMsg || error.message)) || '');
    return Number(code) === -502005
      || code === 'DATABASE_COLLECTION_NOT_EXIST'
      || /collection not exists|table not exist|DATABASE_COLLECTION_NOT_EXIST/i.test(message);
  }

  async function ensureAssignmentCollection() {
    try {
      await reviewAssignments.limit(1).get();
      return;
    } catch (error) {
      if (!isMissingCollectionError(error) || typeof db.createCollection !== 'function') throw error;
      if (!assignmentCollectionInitialization) {
        assignmentCollectionInitialization = db.createCollection('review_assignments');
      }
      try {
        await assignmentCollectionInitialization;
      } catch (creationError) {
        try {
          await reviewAssignments.limit(1).get();
        } catch (readError) {
          assignmentCollectionInitialization = null;
          throw creationError;
        }
      }
    }
  }

  async function readDocument(collectionName, id) {
    const result = await db.collection(collectionName).doc(id).get();
    return result.data || null;
  }

  return {
    async completeReview({ openid, childId, items, bizDate }) {
      await ensureAssignmentCollection();
      const transactionResult = await db.runTransaction(async (transaction) => {
        const access = await assertTransactionFamilyAccess(transaction, openid, childId);

        const reviewedAt = db.serverDate();
        const snapshots = [];
        for (const item of items) {
          const cardResult = await transaction.collection('cards').doc(item.cardId).get();
          const card = cardResult.data || null;
          if (
            !card
            || card.familyId !== access.familyId
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
            familyId: access.familyId,
            reviewedByOpenid: openid,
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

          const assignmentResult = await transaction.collection('review_assignments').where({
            familyId: access.familyId,
            childId,
            cardId: card._id,
            status: 'pending',
          }).get();
          for (const assignment of assignmentResult.data.filter((item) => (
            item.scheduledDate <= bizDate
          ))) {
            await transaction.collection('review_assignments').doc(assignment._id).update({
              data: {
                status: 'completed',
                completedAt: reviewedAt,
                completedByOpenid: openid,
                completedSessionId: sessionResult._id,
                updatedAt: reviewedAt,
              },
            });
          }
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
