const BATCH_SIZE = 100;

function createCategoryRepository(db) {
  const categories = db.collection('categories');
  const children = db.collection('children');

  async function readCategory(id) {
    if (!id) return null;
    const result = await categories.doc(id).get();
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
        const result = await categories
          .where({ childId })
          .skip(offset)
          .limit(BATCH_SIZE)
          .get();
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
      const result = await categories.where({ childId, normalizedName }).limit(2).get();
      return result.data.find((item) => item._id !== excludeId) || null;
    },

    async findById(id) {
      return readCategory(id);
    },

    async createCategory(data) {
      const serverDate = db.serverDate();
      const result = await categories.add({
        data: { ...data, createdAt: serverDate, updatedAt: serverDate },
      });
      return readCategory(result._id);
    },

    async updateCategory(id, updates) {
      await categories.doc(id).update({
        data: { ...updates, updatedAt: db.serverDate() },
      });
      return readCategory(id);
    },
  };
}

module.exports = {
  BATCH_SIZE,
  createCategoryRepository,
};
