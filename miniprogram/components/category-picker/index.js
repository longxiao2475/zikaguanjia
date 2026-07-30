const { UNCATEGORIZED_ID, normalizeSelectionIds } = require('../../utils/category-view');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '选择分类' },
    categories: { type: Array, value: [] },
    selectedIds: { type: Array, value: [] },
    multiple: { type: Boolean, value: true },
    showUncategorized: { type: Boolean, value: true },
    filterMode: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
  },

  data: {
    managing: false,
    uncategorizedId: UNCATEGORIZED_ID,
    uncategorizedSelected: true,
    displayCategories: [],
  },

  observers: {
    'categories, selectedIds, filterMode': function syncSelection(categories, selectedIds, filterMode) {
      const normalizedIds = normalizeSelectionIds(selectedIds);
      const selectedIdSet = new Set(normalizedIds);
      this.setData({
        uncategorizedSelected: selectedIdSet.has(UNCATEGORIZED_ID)
          || (!filterMode && normalizedIds.length === 0),
        displayCategories: (categories || []).map((item) => ({
          ...item,
          selected: selectedIdSet.has(item._id),
        })),
      });
    },
  },

  methods: {
    swallow() {},

    onClose() {
      if (this.data.disabled) return;
      this.setData({ managing: false });
      this.triggerEvent('close');
    },

    onConfirm() {
      if (this.data.disabled) return;
      this.setData({ managing: false });
      this.triggerEvent('confirm', { selectedIds: normalizeSelectionIds(this.data.selectedIds) });
    },

    onClear() {
      if (this.data.disabled) return;
      this.triggerEvent('change', { selectedIds: [] });
    },

    onToggleCategory(event) {
      if (this.data.disabled) return;
      const categoryId = event.currentTarget.dataset.id;
      let selectedIds = normalizeSelectionIds(this.data.selectedIds);
      if (categoryId === UNCATEGORIZED_ID && !this.data.filterMode) {
        selectedIds = [];
      } else if (selectedIds.includes(categoryId)) {
        selectedIds = selectedIds.filter((id) => id !== categoryId);
      } else if (this.data.multiple) {
        selectedIds = [...selectedIds, categoryId];
      } else {
        selectedIds = [categoryId];
      }
      this.triggerEvent('change', { selectedIds });
    },

    onToggleManage() {
      if (this.data.disabled) return;
      this.setData({ managing: !this.data.managing });
    },

    onCreateCategory() {
      if (this.data.disabled) return;
      wx.showModal({
        title: '新增分类',
        editable: true,
        placeholderText: '最多 12 个字符',
        confirmText: '添加',
        success: (result) => {
          if (result.confirm && String(result.content || '').trim()) {
            this.triggerEvent('create', { name: result.content });
          }
        },
      });
    },

    onRenameCategory(event) {
      if (this.data.disabled) return;
      const categoryId = event.currentTarget.dataset.id;
      const category = (this.data.categories || []).find((item) => item._id === categoryId);
      if (!category) return;
      wx.showModal({
        title: '修改分类名称',
        editable: true,
        content: category.name,
        placeholderText: '最多 12 个字符',
        confirmText: '保存',
        success: (result) => {
          if (result.confirm && String(result.content || '').trim()) {
            this.triggerEvent('rename', { categoryId, name: result.content });
          }
        },
      });
    },
  },
});
