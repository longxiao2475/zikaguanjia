const BATCH_SIZE = 100;

function createCardRepository(db) {
  const cards = db.collection('cards');
  const categories = db.collection('categories');
  const children = db.collection('children');
  const users = db.collection('users');
  const familyMembers = db.collection('family_members');

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
