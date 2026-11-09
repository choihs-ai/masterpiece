// Turns the single-file build into an Artifact page body (no doctype/html/head/body tags;
// the host wraps it). Also keeps a standalone copy that works as a plain offline file.
import fs from 'node:fs';

const src = fs.readFileSync('dist-single/index.html', 'utf8');
const head = (src.match(/<head>([\s\S]*?)<\/head>/i) || [, ''])[1];
const body = (src.match(/<body>([\s\S]*?)<\/body>/i) || [, ''])[1];

const keepHead = head
  .split(/\n/)
  .join('\n')
  // links that point at files that do not exist in a single-file publish
  .replace(/<link[^>]+rel="(manifest|icon|apple-touch-icon)"[^>]*>\s*/gi, '')
  // the host supplies charset + viewport
  .replace(/<meta charset="utf-8"\s*\/?>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');

const title = (keepHead.match(/<title>[\s\S]*?<\/title>/i) || ['<title>PULSAR</title>'])[0];
const rest = keepHead.replace(title, '');
const page = `${title}\n${rest.trim()}\n${body.trim()}\n`;
fs.writeFileSync('dist-single/pulsar.html', page);
console.log(`artifact page: dist-single/pulsar.html (${(page.length / 1024).toFixed(0)} KB)`);
