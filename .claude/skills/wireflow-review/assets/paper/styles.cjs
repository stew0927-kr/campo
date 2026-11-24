'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = function standalonePaperStyles() {
  const source = fs.readFileSync(path.join(__dirname, 'paper.css'), 'utf8');
  const licenses = ['inter', 'patrick-hand', 'gaegu'].map(name =>
    fs.readFileSync(path.join(__dirname, 'fonts', name + '-OFL.txt'), 'utf8'));
  return '/* Bundled fonts\n' + licenses.join('\n') + '\n*/\n' +
    source.replace(/url\("\.\/fonts\/([^"]+)\.woff2"\)/g, (_, name) => {
      const font = fs.readFileSync(path.join(__dirname, 'fonts', name + '.woff2'));
      return 'url("data:font/woff2;base64,' + font.toString('base64') + '")';
    });
};
