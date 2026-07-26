function createSyncSettingsRepository(db) {
  const users = db.collection('users');
  const children = db.collection('children');

  async function readById(collection, id) {
    if (!id) return null;
    const result = await collection.doc(id).get();
    return result.data || null;
  }

  return {
    async findUserByOpenid(openid) {
      const result = await users.where({ openid }).limit(1).get();
      return result.data[0] || null;
    },

    async createUser(data) {
      const serverDate = db.serverDate();
      const result = await users.add({
        data: { ...data, createdAt: serverDate, updatedAt: serverDate },
      });
      return readById(users, result._id);
    },

    async findChildById(id) {
      return readById(children, id);
    },

    async findActiveChildByOwner(ownerOpenid) {
      const result = await children.where({ ownerOpenid, status: 'active' }).limit(1).get();
      return result.data[0] || null;
    },

    async createChild(data) {
      const serverDate = db.serverDate();
      const result = await children.add({
        data: { ...data, createdAt: serverDate, updatedAt: serverDate },
      });
      return readById(children, result._id);
    },

    async updateUser(id, updates) {
      await users.doc(id).update({
        data: { ...updates, updatedAt: db.serverDate() },
      });
      return readById(users, id);
    },

    async updateChild(id, updates) {
      await children.doc(id).update({
        data: { ...updates, updatedAt: db.serverDate() },
      });
      return readById(children, id);
    },
  };
}

module.exports = {
  createSyncSettingsRepository,
};
