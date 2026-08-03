function businessError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

async function assertTransactionFamilyAccess(transaction, openid, childId) {
  const userResult = await transaction.collection('users')
    .where({ openid, status: 'active' })
    .limit(1)
    .get();
  const user = userResult.data[0] || null;
  const childResult = await transaction.collection('children').doc(childId).get();
  const child = childResult.data || null;
  if (!user || !child || !user.activeFamilyId || child.familyId !== user.activeFamilyId) {
    throw businessError('CHILD_FORBIDDEN', '无权访问该孩子');
  }
  const memberResult = await transaction.collection('family_members')
    .where({ familyId: user.activeFamilyId, openid, status: 'active' })
    .limit(1)
    .get();
  const member = memberResult.data[0] || null;
  if (!member || child.status !== 'active') {
    throw businessError('CHILD_FORBIDDEN', '无权访问该孩子');
  }
  return { user, member, child, familyId: user.activeFamilyId };
}

module.exports = { assertTransactionFamilyAccess };
