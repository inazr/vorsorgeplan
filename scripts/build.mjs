// Baut dist/index.html: eine einzige Datei ohne externe Anfragen.
// ECharts und Schriftarten werden eingebettet. Aufruf: node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => readFileSync(join(root, p), 'utf8');
const pkg = JSON.parse(rd('package.json'));
const version = process.env.VERSION || pkg.version;

const ENGINE = ['law', 'depot', 'insurance', 'loans', 'sim', 'defaults', 'analysis'];
const engine = ENGINE.map(f => rd(`src/${f}.js`)).join('\n');

const fonts = [
  ['Public Sans', 400, 'public-sans-latin-400-normal'], ['Public Sans', 500, 'public-sans-latin-500-normal'],
  ['Public Sans', 600, 'public-sans-latin-600-normal'], ['Public Sans', 700, 'public-sans-latin-700-normal'],
  ['JetBrains Mono', 400, 'jetbrains-mono-latin-400-normal'], ['JetBrains Mono', 500, 'jetbrains-mono-latin-500-normal'],
  ['JetBrains Mono', 600, 'jetbrains-mono-latin-600-normal'],
].map(([fam, w, file]) => {
  const b64 = readFileSync(join(root, 'fonts', file + '.woff2')).toString('base64');
  return `@font-face{font-family:"${fam}";font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
}).join('\n');

// </script> im eingebetteten Code darf das Script-Tag nicht schließen
const safe = js => js.replace(/<\/script/gi, '<\\/script');
const head = `<style>\n${fonts}\n</style>\n<script>\n${safe(rd('vendor/echarts.min.js'))}\n</script>`;

let page = rd('src/page.html')
  .replace('{{HEAD}}', () => head)
  .replaceAll('{{TITLE}}', 'Vorsorgeplan')
  .replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')
  .replace('/*ENGINE*/', () => safe(engine))
  .replace('/*UI*/', () => safe(rd('src/ui.js')))
  .replace('keine Steuer- oder Anlageberatung</div>', () => `keine Steuer- oder Anlageberatung · Version ${version}</div>`);

const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${page.replace('<header class="top">', '</head>\n<body>\n<header class="top">')}
</body>
</html>
`;
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), html);
console.log(`dist/index.html gebaut (Version ${version}, ${(html.length / 1024).toFixed(0)} KB)`);
