// Assembla src/index.html: un unico file con librerie, worker e app incorporati.
const fs = require('fs'), path = require('path'), esbuild = require('esbuild');
const root = path.join(__dirname, '..'), nm = p => path.join(root, 'node_modules', p), rd = p => fs.readFileSync(p, 'utf8');
const sig = esbuild.buildSync({
  entryPoints: [path.join(root, 'app/sig_entry.js')], bundle: true, minify: true, platform: 'browser', format: 'iife', write: false,
  alias: {'pdf-lib': path.join(root, 'app/shim/pdflib.js')}, define: {global: 'window', 'process.env.NODE_ENV': '"production"'},
  absWorkingDir: root, logLevel: 'error'
}).outputFiles[0].text;
const files = ['a_core', 'b_ann', 'c_forms_sign', 'd_save_pages', 'e_view', 'f_tools', 'g_more', 'h_menu', 'i_word', 'j_merge'].map(f => rd(path.join(root, 'app', f + '.js'))).join('\n');
const parts = {
  '/*CSS*/': rd(path.join(root, 'app/app.css')),
  '/*WORKER*/': rd(nm('pdfjs-dist/build/pdf.worker.min.js')),
  '/*PDFJS*/': rd(nm('pdfjs-dist/build/pdf.min.js')),
  '/*PDFLIB*/': rd(nm('pdf-lib/dist/pdf-lib.min.js')),
  '/*JSZIP*/': rd(nm('jszip/dist/jszip.min.js')),
  '/*SIGLIB*/': sig,
  '/*APP*/': files
};
let t = rd(path.join(root, 'app/template.html'));
const version = require(path.join(root, 'package.json')).version;
for (const [k, v] of Object.entries(parts)){
  if (k !== '/*CSS*/' && /<\/script/i.test(v)) throw new Error('</script dentro ' + k);
  const i = t.indexOf(k); if (i < 0) throw new Error('segnaposto mancante ' + k);
  t = t.slice(0, i) + v + t.slice(i + k.length);
}
t = t.split('\ufffd').join('\\uFFFD');
t = t.replace(/APP_VERSION = '[^']*'/, `APP_VERSION = '${version}'`);
fs.mkdirSync(path.join(root, 'src'), {recursive: true});
fs.writeFileSync(path.join(root, 'src/index.html'), t);
console.log('src/index.html', Math.round(t.length / 1024), 'KB');
