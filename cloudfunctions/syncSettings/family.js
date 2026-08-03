const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function businessError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function generateInviteCode(random = Math.random) {
  return Array.from({ length: 8 }, () => {
    const index = Math.floor(random() * INVITE_ALPHABET.length) % INVITE_ALPHABET.length;
    return INVITE_ALPHABET[index];
  }).join('');
}

function normalizeInviteCode(value) {
  return String(value || '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

async function resolveFamilyAccess(repository, openid, childId) {
  const user = await repository.findUserByOpenid(openid);
  const familyId = user && user.activeFamilyId;
  const [family, member, child] = await Promise.all([
    repository.findFamilyById(familyId),
    repository.findActiveMember(familyId, openid),
    repository.findChildById(childId),
  ]);
  if (
    !user
    || user.status !== 'active'
    || !family
    || family.status !== 'active'
    || !member
    || member.status !== 'active'
    || !child
    || child.status !== 'active'
    || child.familyId !== familyId
  ) {
    throw businessError('CHILD_FORBIDDEN', '无权访问该孩子');
  }
  return { user, family, member, child };
}

module.exports = {
  INVITE_ALPHABET,
  businessError,
  generateInviteCode,
  normalizeInviteCode,
  resolveFamilyAccess,
};
