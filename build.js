/* Inline engine + app + css into a single deployable HTML file. */
var fs = require('fs');
var path = require('path');

var html = fs.readFileSync(path.join(__dirname, 'src/index.html'), 'utf8');
var css = fs.readFileSync(path.join(__dirname, 'src/app.css'), 'utf8');
var engine = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
var app = fs.readFileSync(path.join(__dirname, 'src/app.js'), 'utf8');

function inject(src, token, code) {
  var i = src.indexOf(token);
  if (i === -1) throw new Error('token not found: ' + token);
  return src.slice(0, i) + code + src.slice(i + token.length);
}

html = inject(html, '/*__CSS__*/', '\n' + css + '\n');
html = inject(html, '/*__ENGINE__*/', '\n' + engine + '\n');
html = inject(html, '/*__APP__*/', '\n' + app + '\n');

/* Usage: node build.js [outputDir | outputFile.html] [...more targets] */
var targets = process.argv.slice(2);
if (!targets.length) targets = ['dist'];

targets.forEach(function (target) {
  var out = /\.html?$/i.test(target) ? target : path.join(target, 'carnatic-swara-player.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, 'utf8');
  console.log('built ' + out + '  (' + Math.round(html.length / 1024) + ' KB)');
});
