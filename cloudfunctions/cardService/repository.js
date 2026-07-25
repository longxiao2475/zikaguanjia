const BATCH_SIZE = 100;

function createCardRepository(db) {
  const cards = db.collection('cards');
  const children = db.collection('children');

  async function readCard(id) {
    if (!id) return null;
    const result = await cards.doc(id).get();
    return result.data || null;
  }

  return {
    async findChildById(id) {
      if (!id) return null;
      const result = await children.doc(id).get();
      return result.data || null;
    },

    async findActiveByNormalized(childId, normalizedContent, excludeId) {
      const result = await cards.where({
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

    async listActiveCards(childId) {
      const all = [];
      let offset = 0;
      while (true) {
        const result = await cards
          .where({ childId, status: 'active' })
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
