const BATCH_SIZE = 100;

function createCardRepository(db) {
  const cards = db.collection('cards');
  const categories = db.collection('categories');
  const children = db.collection('children');
  const users = db.collection('users');
  const familyMembers = db.collection('family_members');
  const reviewAssignments = db.collection('review_assignments');
  let assignmentCollectionInitialization = null;

  function isMissingCollectionError(error) {
    const code = error && (error.errCode || error.errno || error.code);
    const message = String((error && (error.errMsg || error.message)) || '');
    return Number(code) === -502005
      || code === 'DATABASE_COLLECTION_NOT_EXIST'
      || /collection not exists|table not exist|DATABASE_COLLECTION_NOT_EXIST/i.test(message);
  }

  async function initializeAssignmentCollection(originalError) {
    if (!isMissingCollectionError(originalError) || typeof db.createCollection !== 'function') {
      throw originalError;
    }
    if (!assignmentCollectionInitialization) {
      assignmentCollectionInitialization = (async () => {
        try {
          await db.createCollection('review_assignments');
        } catch (creationError) {
          try {
            await reviewAssignments.limit(1).get();
          } catch (readError) {
            throw creationError;
          }
        }
      })();
    }
    try {
      await assignmentCollectionInitialization;
    } catch (error) {
      assignmentCollectionInitialization = null;
      throw error;
    }
  }

  async function runAssignmentOperation(operation) {
    try {
      return await operation();
    } catch (error) {
      await initializeAssignmentCollection(error);
      return operation();
    }
  }

  async function readCard(id) {
    if (!id) return null;
    const result = await cards.doc(id).get();
    return result.data || null;
  }

  return {
    async findFamilyAccess(openid, childId) {
      if (!openid || !childId) return null;
      const userResult = await users.where({ openid, status: 'active' }).limit(1).get();
      const user = userResult.data[0] || null;
      const childResult = await children.doc(childId).get();
      const child = childResult.data || null;
      if (!user || !child || !user.activeFamilyId || child.familyId !== user.activeFamilyId) return null;
      const memberResult = await familyMembers.where({
        familyId: user.activeFamilyId,
        openid,
        status: 'active',
      }).limit(1).get();
      const member = memberResult.data[0] || null;
      return member ? { user, child, member, familyId: user.activeFamilyId } : null;
    },

    async findChildById(id) {
      if (!id) return null;
      const result = await children.doc(id).get();
      return result.data || null;
    },

    async findActiveByNormalized(familyId, childId, normalizedContent, excludeId) {
      const result = await cards.where({
        familyId,
        childId,
        normalizedContent,
        status: 'active',
      }).limit(2).get();
      return result.data.find((item) => item._id !== excludeId) || null;
    },

    async createCard(data) {
      const serverDate = db.serverDate();
      const result = await cards.add({
        data: { ...data, createdAt: serverDate, updatedAt: serverDate },
      });
      return readCard(result._id);
    },

    async listActiveCards(familyId, childId) {
      const all = [];
      let offset = 0;
      while (true) {
        const result = await cards
          .where({ familyId, childId, status: 'active' })
          .skip(offset)
          .limit(BATCH_SIZE)
          .get();
        all.push(...result.data);
        if (result.data.length < BATCH_SIZE) break;
        offset += BATCH_SIZE;
      }
      return all;
    },

    async findCardById(id) {
      return readCard(id);
    },

    async findCategoriesByIds(ids) {
      const results = await Promise.all((ids || []).map(async (id) => {
        if (!id) return null;
        const result = await categories.doc(id).get();
        return result.data || null;
      }));
      return results.filter(Boolean);
    },

    async addReviewAssignments({ familyId, childId, cardIds, scheduledDate, addedByOpenid }) {
      let addedCount = 0;
      let existingCount = 0;
      for (const cardId of cardIds) {
        const existingResult = await runAssignmentOperation(() => reviewAssignments.where({
          familyId,
          childId,
          cardId,
          scheduledDate,
          source: 'manual',
          status: 'pending',
        }).limit(1).get());
        if (existingResult.data[0]) {
          existingCount += 1;
          continue;
        }
        const serverDate = db.serverDate();
        await runAssignmentOperation(() => reviewAssignments.add({
          data: {
            familyId,
            childId,
            cardId,
            scheduledDate,
            source: 'manual',
            status: 'pending',
            addedByOpenid,
            createdAt: serverDate,
            updatedAt: serverDate,
          },
        }));
        addedCount += 1;
      }
      return { addedCount, existingCount };
    },

    async listPendingReviewAssignments(familyId, childId, scheduledDate) {
      const all = [];
      let offset = 0;
      while (true) {
        const result = await runAssignmentOperation(() => reviewAssignments
          .where({ familyId, childId, status: 'pending' })
          .skip(offset)
          .limit(BATCH_SIZE)
          .get());
        all.push(...result.data.filter((item) => item.scheduledDate <= scheduledDate));
        if (result.data.length < BATCH_SIZE) break;
        offset += BATCH_SIZE;
      }
      return all;
    },

    async updateCard(id, updates) {
      await cards.doc(id).update({
        data: { ...updates, updatedAt: db.serverDate() },
      });
      return readCard(id);
    },
  };
}

module.exports = {
  BATCH_SIZE,
  createCardRepository,
};
