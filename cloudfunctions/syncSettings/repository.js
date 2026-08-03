function createSyncSettingsRepository(db) {
  const users = db.collection('users');
  const children = db.collection('children');
  const families = db.collection('families');
  const familyMembers = db.collection('family_members');
  const cards = db.collection('cards');
  const categories = db.collection('categories');
  const reviewSessions = db.collection('review_sessions');
  const reminderLogs = db.collection('reminder_logs');
  const collectionInitializations = new Map();

  function isMissingCollectionError(error) {
    const code = error && (error.errCode || error.errno || error.code);
    const message = String((error && (error.errMsg || error.message)) || '');
    return Number(code) === -502005
      || code === 'DATABASE_COLLECTION_NOT_EXIST'
      || /collection not exists|table not exist|DATABASE_COLLECTION_NOT_EXIST/i.test(message);
  }

  async function initializeCollection(name, collection, originalError) {
    if (!isMissingCollectionError(originalError) || typeof db.createCollection !== 'function') {
      throw originalError;
    }
    if (!collectionInitializations.has(name)) {
      collectionInitializations.set(name, (async () => {
        try {
          await db.createCollection(name);
        } catch (creationError) {
          try {
            await collection.limit(1).get();
          } catch (readError) {
            throw creationError;
          }
        }
      })());
    }
    try {
      await collectionInitializations.get(name);
    } catch (error) {
      collectionInitializations.delete(name);
      throw error;
    }
  }

  async function runCollectionOperation(name, collection, operation) {
    try {
      return await operation();
    } catch (error) {
      await initializeCollection(name, collection, error);
      return operation();
    }
  }

  async function listAll(collection, query) {
    const all = [];
    let offset = 0;
    while (true) {
      const result = await collection.where(query).skip(offset).limit(100).get();
      all.push(...result.data);
      if (result.data.length < 100) break;
      offset += 100;
    }
    return all;
  }

  async function backfillByChildIds(collection, childIds, familyId) {
    let updated = 0;
    for (const childId of childIds) {
      let items;
      try {
        items = await listAll(collection, { childId });
      } catch (error) {
        if (isMissingCollectionError(error)) continue;
        throw error;
      }
      for (const item of items) {
        if (item.familyId === familyId) continue;
        await collection.doc(item._id).update({
          data: { familyId, updatedAt: db.serverDate() },
        });
        updated += 1;
      }
    }
    return updated;
  }

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

    async findFamilyById(id) {
      return readById(families, id);
    },

    async findLegacyFamilyByCreator(openid) {
      const result = await runCollectionOperation(
        'families',
        families,
        () => families.where({ createdByOpenid: openid, status: 'active' }).limit(1).get(),
      );
      return result.data[0] || null;
    },

    async createFamily(data) {
      const serverDate = db.serverDate();
      const result = await runCollectionOperation(
        'families',
        families,
        () => families.add({ data: { ...data, createdAt: serverDate, updatedAt: serverDate } }),
      );
      return readById(families, result._id);
    },

    async findActiveMember(familyId, openid) {
      if (!familyId || !openid) return null;
      const result = await runCollectionOperation(
        'family_members',
        familyMembers,
        () => familyMembers.where({ familyId, openid, status: 'active' }).limit(1).get(),
      );
      return result.data[0] || null;
    },

    async createMember(data) {
      const serverDate = db.serverDate();
      const result = await runCollectionOperation(
        'family_members',
        familyMembers,
        () => familyMembers.add({
          data: {
            ...data,
            joinedAt: data.joinedAt || serverDate,
            createdAt: serverDate,
            updatedAt: serverDate,
          },
        }),
      );
      return readById(familyMembers, result._id);
    },

    async updateMember(id, updates) {
      await familyMembers.doc(id).update({
        data: { ...updates, updatedAt: db.serverDate() },
      });
      return readById(familyMembers, id);
    },

    async findChildById(id) {
      return readById(children, id);
    },

    async findActiveChildByOwner(ownerOpenid) {
      const result = await children.where({ ownerOpenid, status: 'active' }).limit(1).get();
      return result.data[0] || null;
    },

    async listActiveChildrenByOwner(ownerOpenid) {
      return listAll(children, { ownerOpenid, status: 'active' });
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

    async backfillChildrenFamily(ownerOpenid, familyId) {
      const items = await listAll(children, { ownerOpenid, status: 'active' });
      let updated = 0;
      for (const item of items) {
        if (item.familyId === familyId) continue;
        await children.doc(item._id).update({
          data: { familyId, updatedAt: db.serverDate() },
        });
        updated += 1;
      }
      return updated;
    },

    async backfillCardsFamily(childIds, familyId) {
      return backfillByChildIds(cards, childIds, familyId);
    },

    async backfillCategoriesFamily(childIds, familyId) {
      return backfillByChildIds(categories, childIds, familyId);
    },

    async backfillReviewSessionsFamily(childIds, familyId) {
      return backfillByChildIds(reviewSessions, childIds, familyId);
    },

    async backfillReminderLogsFamily(childIds, familyId) {
      return backfillByChildIds(reminderLogs, childIds, familyId);
    },

    async countActiveCards(childIds, familyId) {
      let count = 0;
      for (const childId of childIds) {
        const items = await listAll(cards, { childId, status: 'active' });
        count += items.filter((item) => item.familyId === familyId).length;
      }
      return count;
    },
  };
}

module.exports = {
  createSyncSettingsRepository,
};
