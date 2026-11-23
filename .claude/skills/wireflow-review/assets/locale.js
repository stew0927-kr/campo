'use strict';

const WireflowLocale = {
  resolve(model, browserLanguage = 'en') {
    if (model.review?.locale) return model.review.locale;
    const source = [model.title,model.goal,model.screens?.[0]?.title].filter(Boolean).join(' ');
    if (/[\p{Script=Hangul}]/u.test(source)) return 'ko';
    if (/[a-z]{3,}/i.test(source)) return 'en';
    return /^ko(?:-|$)/i.test(browserLanguage) ? 'ko' : 'en';
  },

  translator(language) {
    return (korean,english) => language === 'en' ? english : korean;
  },

  applyEnglish(document) {
    for (const node of document.querySelectorAll('[data-en]')) node.textContent = node.dataset.en;
    for (const attribute of ['aria-label','placeholder','title']) {
      for (const node of document.querySelectorAll('[data-en-'+attribute+']')) {
        node.setAttribute(attribute,node.getAttribute('data-en-'+attribute));
      }
    }
  },
};

if (typeof module === 'object') module.exports = WireflowLocale;
