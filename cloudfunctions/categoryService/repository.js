const BATCH_SIZE = 100;

function isMissingCollectionError(error) {
  const code = error && (error.errCode || error.errno || error.code);
  const message = String((error && (error.errMsg || error.message)) || '');
  return Number(code) === -502005
    || code === 'DATABASE_COLLECTION_NOT_EXIST'
    || /collection not exists|table not exist|DATABASE_COLLECTION_NOT_EXIST/i.test(message);
}

function createCategoryRepository(db) {
  const categories = db.collection('categories');
  const children = db.collection('children');
  const cards = db.collection('cards');
  const users = db.collection('users');
  const familyMembers = db.collection('family_members');
  let collectionInitialization = null;

  async function initializeCategoriesCollection(originalError) {
    if (!isMissingCollectionError(originalError) || typeof db.createCollection !== 'function') {
      throw originalError;
    }
    if (!collectionInitialization) {
      collectionInitialization = (async () => {
        try {
          await db.createCollection('categories');
        } catch (creationError) {
          try {
            await categories.limit(1).get();
          } catch (readError) {
            throw creationError;
          }
        }
      })();
    }
    try {
      await collectionInitialization;
    } catch (error) {
      collectionInitialization = null;
      throw error;
    }
  }

  async function runCategoryOperation(operation) {
    try {
      return await operation();
    } catch (error) {
      await initializeCategoriesCollection(error);
      return operation();
    }
  }

  async function readCategory(id) {
    if (!id) return null;
    const result = await runCategoryOperation(() => categories.doc(id).get());
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

    async listCategories(familyId, childId, includeInactive = false) {
      const all = [];
      let offset = 0;
      while (true) {
        const result = await runCategoryOperation(() => categories
          .where({ familyId, childId })
          .skip(offset)
          .limit(BATCH_SIZE)
          .get());
        all.push(...result.data);
        if (result.data.length < BATCH_SIZE) break;
        offset += BATCH_SIZE;
      }
      return all
        .filter((item) => includeInactive || item.status === 'active')
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
          || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
    },

    async findByNormalized(familyId, childId, normalizedName, excludeId) {
      const result = await runCategoryOperation(
        () => categories.where({ familyId, childId, normalizedName }).limit(2).get(),
      );
      return result.data.find((item) => item._id !== excludeId) || null;
    },

    async findById(id) {
      return readCategory(id);
    },

    async createCategory(data) {
      const serverDate = db.serverDate();
      const result = await runCategoryOperation(() => categories.add({
        data: { ...data, createdAt: serverDate, updatedAt: serverDate },
      }));
      return readCategory(result._id);
    },

    async updateCategory(id, updates) {
      await runCategoryOperation(() => categories.doc(id).update({
        data: { ...updates, updatedAt: db.serverDate() },
      }));
      return readCategory(id);
    },

    async countActiveCardReferences(familyId, childId, categoryId) {
      let count = 0;
      let offset = 0;
      while (true) {
        const result = await cards
          .where({ familyId, childId, status: 'active' })
          .skip(offset)
          .limit(BATCH_SIZE)
          .get();
        count += result.data.filter((card) => (
          Array.isArray(card.categoryIds) && card.categoryIds.includes(categoryId)
        )).length;
        if (result.data.length < BATCH_SIZE) break;
        offset += BATCH_SIZE;
      }
      return count;
    },

    async updateCategoryStatus(id, status) {
      await runCategoryOperation(() => categories.doc(id).update({
        data: { status, updatedAt: db.serverDate() },
      }));
      return readCategory(id);
    },
  };
}

module.exports = {
  BATCH_SIZE,
  createCategoryRepository,
  isMissingCollectionError,
};
