function getHomeBanners({ studyDay, due, quota } = {}) {
  const quotaNumber = Number(quota);
  const hasQuota = quota !== undefined && quota !== null && quota !== '' && Number.isFinite(quotaNumber);
  return {
    showStudyBanner: Boolean(studyDay) && Number(due || 0) > 0,
    showQuotaBanner: hasQuota && quotaNumber <= 2,
  };
}

module.exports = {
  getHomeBanners,
};

