const {
  getWordDetail,
  uniqueWords,
  validateCustomWord,
} = require('../../utils/dict');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    card: { type: Object, value: null },
  },

  data: {
    detail: getWordDetail(),
    inputValue: '',
  },

  observers: {
    'visible, card': function syncSheet(visible, card) {
      if (!visible) return;
      this.setData({ detail: getWordDetail(card || {}), inputValue: '' });
    },
  },

  methods: {
    swallow() {},

    onClose() {
      this.triggerEvent('close');
    },

    onInput(event) {
      this.setData({ inputValue: event.detail.value });
    },

    onSaveCustomWord() {
      const card = this.properties.card || {};
      const validation = validateCustomWord(card.content, this.data.inputValue);
      if (!validation.ok) {
        wx.showToast({ title: validation.message, icon: 'none' });
        return;
      }
      const customWords = uniqueWords([...(card.customWords || []), validation.word]);
      this.triggerEvent('savecustomword', {
        cardId: card._id,
        word: validation.word,
        customWords,
      });
      this.setData({ inputValue: '' });
    },
  },
});

