function createSyncSettingsRepository(db) {
  const users = db.collection('users');
  const children = db.collection('children');
  const families = db.collection('families');
  const familyMembers = db.collection('family_members');
  const familyInvites = db.collection('family_invites');
  const familyMergeJobs = db.collection('family_merge_jobs');
  const cards = db.collection('cards');
  const categories = db.collection('categories');
  const reviewSessions = db.collection('review_sessions');
  const reminderLogs = db.collection('reminder_logs');
  const reviewAssignments = db.collection('review_assignments');
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

    async countActiveMembers(familyId) {
      return (await listAll(familyMembers, { familyId, status: 'active' })).length;
    },

    async expireActiveInvites(familyId) {
      let invites;
      try {
        invites = await listAll(familyInvites, { familyId, status: 'active' });
      } catch (error) {
        if (!isMissingCollectionError(error)) throw error;
        return 0;
      }
      for (const invite of invites) {
        await familyInvites.doc(invite._id).update({
          data: { status: 'expired', updatedAt: db.serverDate() },
        });
      }
      return invites.length;
    },

    async createInvite(data) {
      const serverDate = db.serverDate();
      const result = await runCollectionOperation(
        'family_invites',
        familyInvites,
        () => familyInvites.add({
          data: {
            ...data,
            createdAt: data.createdAt || serverDate,
            updatedAt: serverDate,
          },
        }),
      );
      return readById(familyInvites, result._id);
    },

    async findInviteByDigest(codeDigest) {
      const result = await runCollectionOperation(
        'family_invites',
        familyInvites,
        () => familyInvites.where({ codeDigest }).limit(1).get(),
      );
      return result.data[0] || null;
    },

    async findMergeResult(openid, requestId) {
      let result;
      try {
        result = await familyMergeJobs.where({
          requestedByOpenid: openid,
          requestId,
          status: 'completed',
        }).limit(1).get();
      } catch (error) {
        if (isMissingCollectionError(error)) return null;
        throw error;
      }
      const job = result.data[0] || null;
      return job && job.result ? job.result : null;
    },

    async mergeFamilies(payload) {
      const existingResult = await this.findMergeResult(
        payload.requestedByOpenid,
        payload.requestId,
      );
      if (existingResult) return existingResult;

      let jobResult = await runCollectionOperation(
        'family_merge_jobs',
        familyMergeJobs,
        () => familyMergeJobs.where({
          requestedByOpenid: payload.requestedByOpenid,
          requestId: payload.requestId,
        }).limit(1).get(),
      );
      let job = jobResult.data[0] || null;
      if (!job) {
        const createdAt = db.serverDate();
        const created = await runCollectionOperation(
          'family_merge_jobs',
          familyMergeJobs,
          () => familyMergeJobs.add({
            data: {
              ...payload,
              status: 'running',
              categoryMap: {},
              cardMap: {},
              createdAt,
              updatedAt: createdAt,
            },
          }),
        );
        job = await readById(familyMergeJobs, created._id);
      } else {
        await familyMergeJobs.doc(job._id).update({
          data: { status: 'running', updatedAt: db.serverDate(), errorCode: null },
        });
      }

      const updateJob = async (updates) => {
        await familyMergeJobs.doc(job._id).update({
          data: { ...updates, updatedAt: db.serverDate() },
        });
        job = await readById(familyMergeJobs, job._id);
      };

      try {
        await families.doc(payload.sourceFamilyId).update({
          data: {
            mergeLocked: true,
            mergeRequestId: payload.requestId,
            updatedAt: db.serverDate(),
          },
        });

        const categoryMap = { ...(job.categoryMap || {}) };
        const [sourceCategories, targetCategories] = await Promise.all([
          listAll(categories, { familyId: payload.sourceFamilyId, status: 'active' }),
          listAll(categories, { familyId: payload.targetFamilyId, status: 'active' }),
        ]);
        const targetCategoryByName = new Map(targetCategories.map((item) => [
          item.normalizedName,
          item,
        ]));
        for (const category of sourceCategories) {
          const duplicate = targetCategoryByName.get(category.normalizedName);
          if (duplicate) {
            categoryMap[category._id] = duplicate._id;
            await categories.doc(category._id).update({
              data: {
                status: 'merged',
                mergedIntoCategoryId: duplicate._id,
                updatedAt: db.serverDate(),
              },
            });
          } else {
            categoryMap[category._id] = category._id;
            await categories.doc(category._id).update({
              data: {
                familyId: payload.targetFamilyId,
                childId: payload.targetChildId,
                updatedAt: db.serverDate(),
              },
            });
            targetCategoryByName.set(category.normalizedName, category);
          }
        }
        await updateJob({ categoryMap });

        const cardMap = { ...(job.cardMap || {}) };
        const [sourceCards, targetCards] = await Promise.all([
          listAll(cards, { familyId: payload.sourceFamilyId, status: 'active' }),
          listAll(cards, { familyId: payload.targetFamilyId, status: 'active' }),
        ]);
        const targetCardByContent = new Map(targetCards.map((item) => [
          item.normalizedContent,
          item,
        ]));
        for (const card of sourceCards) {
          const mappedCategoryIds = [...new Set((card.categoryIds || []).map((id) => (
            categoryMap[id] || id
          )))];
          const duplicate = targetCardByContent.get(card.normalizedContent);
          if (duplicate) {
            cardMap[card._id] = duplicate._id;
            await cards.doc(duplicate._id).update({
              data: {
                customWords: [...new Set([
                  ...(duplicate.customWords || []),
                  ...(card.customWords || []),
                ])].slice(0, 20),
                categoryIds: [...new Set([
                  ...(duplicate.categoryIds || []),
                  ...mappedCategoryIds,
                ])].slice(0, 10),
                updatedAt: db.serverDate(),
              },
            });
            await cards.doc(card._id).update({
              data: {
                status: 'merged',
                mergedIntoCardId: duplicate._id,
                updatedAt: db.serverDate(),
              },
            });
          } else {
            cardMap[card._id] = card._id;
            await cards.doc(card._id).update({
              data: {
                familyId: payload.targetFamilyId,
                childId: payload.targetChildId,
                categoryIds: mappedCategoryIds,
                updatedAt: db.serverDate(),
              },
            });
            targetCardByContent.set(card.normalizedContent, card);
          }
        }
        await updateJob({ cardMap });

        let sourceSessions = [];
        try {
          sourceSessions = await listAll(reviewSessions, { familyId: payload.sourceFamilyId });
        } catch (error) {
          if (!isMissingCollectionError(error)) throw error;
        }
        for (const session of sourceSessions) {
          const items = (session.items || []).map((item) => ({
            ...item,
            cardId: cardMap[item.cardId] || item.cardId,
          }));
          await reviewSessions.doc(session._id).update({
            data: {
              familyId: payload.targetFamilyId,
              childId: payload.targetChildId,
              items,
              updatedAt: db.serverDate(),
            },
          });
        }

        let sourceAssignments = [];
        try {
          sourceAssignments = await listAll(reviewAssignments, { familyId: payload.sourceFamilyId });
        } catch (error) {
          if (!isMissingCollectionError(error)) throw error;
        }
        for (const assignment of sourceAssignments) {
          const mappedCardId = cardMap[assignment.cardId] || assignment.cardId;
          let duplicate = null;
          if (assignment.status === 'pending') {
            const duplicateResult = await reviewAssignments.where({
              familyId: payload.targetFamilyId,
              childId: payload.targetChildId,
              cardId: mappedCardId,
              scheduledDate: assignment.scheduledDate,
              status: 'pending',
            }).limit(1).get();
            duplicate = duplicateResult.data[0] || null;
          }
          await reviewAssignments.doc(assignment._id).update({
            data: duplicate
              ? {
                status: 'merged',
                mergedIntoAssignmentId: duplicate._id,
                updatedAt: db.serverDate(),
              }
              : {
                familyId: payload.targetFamilyId,
                childId: payload.targetChildId,
                cardId: mappedCardId,
                updatedAt: db.serverDate(),
              },
          });
        }

        const sourceMemberResult = await familyMembers.where({
          familyId: payload.sourceFamilyId,
          openid: payload.requestedByOpenid,
          status: 'active',
        }).limit(1).get();
        const sourceMember = sourceMemberResult.data[0] || null;
        const targetMemberResult = await familyMembers.where({
          familyId: payload.targetFamilyId,
          openid: payload.requestedByOpenid,
          status: 'active',
        }).limit(1).get();
        if (!targetMemberResult.data[0]) {
          const serverDate = db.serverDate();
          await familyMembers.add({
            data: {
              familyId: payload.targetFamilyId,
              openid: payload.requestedByOpenid,
              role: 'member',
              status: 'active',
              reminderTime: (sourceMember && sourceMember.reminderTime) || '20:00',
              reminderEnabled: !sourceMember || sourceMember.reminderEnabled !== false,
              joinedAt: serverDate,
              createdAt: serverDate,
              updatedAt: serverDate,
            },
          });
        }
        if (sourceMember) {
          await familyMembers.doc(sourceMember._id).update({
            data: { status: 'inactive', leftAt: db.serverDate(), updatedAt: db.serverDate() },
          });
        }
        const joiningUserResult = await users.where({
          openid: payload.requestedByOpenid,
          status: 'active',
        }).limit(1).get();
        const joiningUser = joiningUserResult.data[0] || null;
        if (!joiningUser) throw new Error('JOINING_USER_NOT_FOUND');
        await users.doc(joiningUser._id).update({
          data: { activeFamilyId: payload.targetFamilyId, updatedAt: db.serverDate() },
        });
        await families.doc(payload.sourceFamilyId).update({
          data: {
            status: 'merged',
            mergedIntoFamilyId: payload.targetFamilyId,
            mergeLocked: false,
            updatedAt: db.serverDate(),
          },
        });
        await familyInvites.doc(payload.inviteId).update({
          data: {
            status: 'used',
            usedCount: 1,
            usedAt: db.serverDate(),
            usedByOpenid: payload.requestedByOpenid,
            updatedAt: db.serverDate(),
          },
        });
        const result = {
          requestId: payload.requestId,
          familyId: payload.targetFamilyId,
          childId: payload.targetChildId,
          movedCardCount: Object.entries(cardMap).filter(([from, to]) => from === to).length,
          mergedCardCount: Object.entries(cardMap).filter(([from, to]) => from !== to).length,
        };
        await updateJob({ status: 'completed', result, completedAt: db.serverDate() });
        return result;
      } catch (error) {
        await updateJob({
          status: 'failed',
          errorCode: error.code || error.message || 'FAMILY_MERGE_FAILED',
        });
        throw error;
      }
    },

    async listActiveChildrenByFamily(familyId) {
      return listAll(children, { familyId, status: 'active' });
    },

    async listActiveCardsByFamily(familyId) {
      return listAll(cards, { familyId, status: 'active' });
    },

    async listActiveCategoriesByFamily(familyId) {
      return listAll(categories, { familyId, status: 'active' });
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

    async backfillReviewAssignmentsFamily(childIds, familyId) {
      return backfillByChildIds(reviewAssignments, childIds, familyId);
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
