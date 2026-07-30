const cardApi = require('../../utils/card');
const categoryApi = require('../../utils/category');
const cache = require('../../utils/cache');
const session = require('../../utils/session');
const { getCategorySelectionLabel, normalizeSelectionIds } = require('../../utils/category-view');

Page({
  data: {
    content: '',
    source: 'new',
    saving: false,
    errorMessage: '',
    savedCard: null,
    categories: [],
    selectedCategoryIds: [],
    pendingCategoryIds: [],
    categorySummary: '未分类',
    showCategoryPicker: false,
    categoriesLoading: false,
    categorySaving: false,
    categoryError: '',
  },

  onLoad() {
    const categories = cache.getCategories();
    if (categories.length) this.setData({ categories });
    this.loadCategories();
  },

  onInput(event) {
    this.setData({
      content: event.detail.value,
      errorMessage: '',
      savedCard: null,
    });
  },

  onSelectSource(event) {
    this.setData({ source: event.currentTarget.dataset.value });
  },

  onVoicePending() {
    wx.showToast({ title: '语音录入将在下一阶段接入', icon: 'none' });
  },

  async loadCategories() {
    if (this.data.categoriesLoading) return;
    this.setData({ categoriesLoading: true, categoryError: '' });
    try {
      const child = await this.ensureChild();
      const categories = await categoryApi.listCategories(child._id);
      this.setData({
        categories,
        categorySummary: getCategorySelectionLabel(categories, this.data.selectedCategoryIds),
      });
    } catch (error) {
      this.setData({ categoryError: error.message || '分类加载失败' });
    } finally {
      this.setData({ categoriesLoading: false });
    }
  },

  onOpenCategoryPicker() {
    this.setData({
      pendingCategoryIds: [...this.data.selectedCategoryIds],
      showCategoryPicker: true,
    });
  },

  onPendingCategoryChange(event) {
    this.setData({ pendingCategoryIds: normalizeSelectionIds(event.detail.selectedIds, 10) });
  },

  onCloseCategoryPicker() {
    if (this.data.categorySaving) return;
    this.setData({ showCategoryPicker: false });
  },

  onConfirmCategoryPicker(event) {
    const selectedCategoryIds = normalizeSelectionIds(event.detail.selectedIds, 10);
    this.setData({
      selectedCategoryIds,
      pendingCategoryIds: selectedCategoryIds,
      categorySummary: getCategorySelectionLabel(this.data.categories, selectedCategoryIds),
      showCategoryPicker: false,
    });
  },

  async onCreateCategory(event) {
    if (this.data.categorySaving) return;
    this.setData({ categorySaving: true });
    try {
      const child = await this.ensureChild();
      await categoryApi.createCategory({ childId: child._id, name: event.detail.name });
      const categories = cache.getCategories();
      this.setData({ categories });
      wx.showToast({ title: '分类已添加', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '分类添加失败', icon: 'none' });
    } finally {
      this.setData({ categorySaving: false });
    }
  },

  async onRenameCategory(event) {
    if (this.data.categorySaving) return;
    this.setData({ categorySaving: true });
    try {
      const child = await this.ensureChild();
      await categoryApi.updateCategory({
        childId: child._id,
        categoryId: event.detail.categoryId,
        name: event.detail.name,
      });
      const categories = cache.getCategories();
      this.setData({
        categories,
        categorySummary: getCategorySelectionLabel(categories, this.data.selectedCategoryIds),
      });
      wx.showToast({ title: '分类已修改', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '分类修改失败', icon: 'none' });
    } finally {
      this.setData({ categorySaving: false });
    }
  },

  async ensureChild() {
    const cached = session.getCachedSession();
    if (cached.child) return cached.child;
    const result = await session.bootstrap();
    return result.child;
  },

  async onSave() {
    if (this.data.saving) return;
    const content = this.data.content.trim();
    if (!content) {
      this.setData({ errorMessage: '请输入一个字或词' });
      return;
    }

    this.setData({ saving: true, errorMessage: '', savedCard: null });
    try {
      const child = await this.ensureChild();
      const card = await cardApi.createCard({
        childId: child._id,
        content,
        source: this.data.source,
        categoryIds: this.data.selectedCategoryIds,
      });
      this.setData({ content: '', savedCard: card });
      wx.showToast({ title: '字卡已保存', icon: 'success' });
    } catch (error) {
      if (error.code === 'CARD_DUPLICATE') {
        wx.showModal({
          title: '这个字卡已经存在',
          content: '无需重复录入，可以去字卡库查看。',
          confirmText: '去字卡库',
          cancelText: '继续录入',
          success: (result) => {
            if (result.confirm) wx.switchTab({ url: '/pages/library/index' });
          },
        });
      } else {
        this.setData({ errorMessage: error.message || '保存失败，请重试' });
      }
    } finally {
      this.setData({ saving: false });
    }
  },

  onOpenLibrary() {
    wx.switchTab({ url: '/pages/library/index' });
  },
});
