#!/usr/bin/env node
/*
 * Synchronise cache-busting URLs in index.html with the Service Worker shell.
 * Run before starting the server; use --check in pre-commit to reject stale
 * cache metadata instead of relying on a developer to remember it.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const indexPath = path.join(publicDir, 'index.html');
const swPath = path.join(publicDir, 'sw.js');
const checkOnly = process.argv.includes('--check');
const versionedAssetPattern = /((?:src|href)=["'])(\/(?:js\/[^"'?#]+\.js|css\/[^"'?#]+\.css|manifest\.json))(?:\?v=[^"']*)?(["'])/g;
const shellAssetPattern = /(?:src|href)=["'](\/(?:js\/[^"'?#]+\.js|css\/[^"'?#]+\.css|manifest\.json)(?:\?v=[^"']*)?)["']/g;

function hashFile(urlPath) {
  const filename = path.join(publicDir, urlPath.replace(/^\//, ''));
  const contents = fs.readFileSync(filename);
  return crypto.createHash('sha256').update(contents).digest('hex').slice(0, 12);
}

function updateIndex(source) {
  return source.replace(versionedAssetPattern, (match, prefix, urlPath, suffix) => {
    return `${prefix}${urlPath}?v=${hashFile(urlPath)}${suffix}`;
  });
}

function buildServiceWorker(source, indexHtml) {
  const versionedAssets = [...indexHtml.matchAll(shellAssetPattern)].map(match => match[1]);
  const shellAssets = [...new Set([
    '/',
    ...versionedAssets,
    '/dompurify.min.js',
    '/heic2any.min.js',
    '/icon-192.png',
    '/icon-512.png',
    '/icon.png',
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js'
  ])];
  const revision = `auto-${crypto.createHash('sha256').update(shellAssets.join('\n')).digest('hex').slice(0, 12)}`;
  const shellSource = `const APP_SHELL = [\n${shellAssets.map(url => `  ${JSON.stringify(url)}`).join(',\n')}\n];`;

  let next = source.replace(/const BUILD_REVISION = '[^']+';/, `const BUILD_REVISION = '${revision}';`);
  next = next.replace(/const APP_SHELL = \[[\s\S]*?\n\];\nconst CDN_HOSTS/, `${shellSource}\nconst CDN_HOSTS`);
  return next;
}

const originalIndex = fs.readFileSync(indexPath, 'utf8');
const originalSw = fs.readFileSync(swPath, 'utf8');
const nextIndex = updateIndex(originalIndex);
const nextSw = buildServiceWorker(originalSw, nextIndex);
const changed = nextIndex !== originalIndex || nextSw !== originalSw;

if (checkOnly) {
  if (changed) {
    console.error('PWA cache metadata is stale. Run: node scripts/prepare-pwa-cache.js');
    process.exit(1);
  }
  console.log('PWA cache metadata is current.');
  process.exit(0);
}

if (changed) {
  fs.writeFileSync(indexPath, nextIndex);
  fs.writeFileSync(swPath, nextSw);
  console.log('PWA cache metadata synchronised.');
} else {
  console.log('PWA cache metadata already current.');
}
