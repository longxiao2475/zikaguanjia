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
    async findChildById(id) {
      if (!id) return null;
      const result = await children.doc(id).get();
      return result.data || null;
    },

    async listCategories(childId, includeInactive = false) {
      const all = [];
      let offset = 0;
      while (true) {
        const result = await runCategoryOperation(() => categories
          .where({ childId })
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

    async findByNormalized(childId, normalizedName, excludeId) {
      const result = await runCategoryOperation(
        () => categories.where({ childId, normalizedName }).limit(2).get(),
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

    async countActiveCardReferences(childId, categoryId) {
      let count = 0;
      let offset = 0;
      while (true) {
        const result = await cards
          .where({ childId, status: 'active' })
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
