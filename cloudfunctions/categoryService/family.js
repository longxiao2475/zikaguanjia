function businessError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

async function assertChildAccess(repository, openid, childId) {
  if (!childId) throw businessError('CHILD_ID_REQUIRED', '请选择孩子');
  const access = await repository.findFamilyAccess(openid, childId);
  if (
    !access
    || !access.child
    || access.child.status !== 'active'
    || !access.member
    || access.member.status !== 'active'
    || access.child.familyId !== access.member.familyId
  ) {
    throw businessError('CHILD_FORBIDDEN', '无权访问该孩子');
  }
  return { ...access, familyId: access.child.familyId };
}

module.exports = { assertChildAccess };
