// Copia in src/ocr il motore OCR (Tesseract) e i dati delle lingue, per l'uso offline.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), nm = p => path.join(root, 'node_modules', p), out = path.join(root, 'src/ocr');
fs.rmSync(out, {recursive: true, force: true});
for (const d of ['', 'core', 'lang']) fs.mkdirSync(path.join(out, d), {recursive: true});
fs.copyFileSync(nm('tesseract.js/dist/tesseract.min.js'), path.join(out, 'tesseract.min.js'));
fs.copyFileSync(nm('tesseract.js/dist/worker.min.js'), path.join(out, 'worker.min.js'));
for (const f of fs.readdirSync(nm('tesseract.js-core'))) if (/^tesseract-core.*\.wasm\.js$/.test(f)) fs.copyFileSync(nm('tesseract.js-core/' + f), path.join(out, 'core', f));
for (const l of ['ita', 'eng']){
  const dir = nm('@tesseract.js-data/' + l + '/4.0.0_best_int'); const f = fs.readdirSync(dir).find(x => x.endsWith('.traineddata.gz'));
  fs.copyFileSync(path.join(dir, f), path.join(out, 'lang', f));
}
console.log('OCR pronto:', fs.readdirSync(path.join(out, 'core')).length, 'core,', fs.readdirSync(path.join(out, 'lang')).join(', '));
