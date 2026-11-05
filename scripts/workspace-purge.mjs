#!/usr/bin/env node
// 校验归档覆盖率后删除工作区原件：默认 dry-run，只有加 --apply 才真正删除。
// 用法: node workspace-purge.mjs --workspace <ws> --archive <归档目录> [--keep a,b] [--apply]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const USAGE = [
  'workspace-purge — 校验归档覆盖率后删除工作区原件（默认 dry-run）',
  '',
  '用法: node workspace-purge.mjs --workspace <ws> --archive <dir> [选项]',
  '',
  '  --workspace <dir>  工作区根目录，默认当前目录',
  '  --archive <dir>    归档目录，默认 <workspace>/会话产出归档',
  '  --keep <a,b,c>     额外保留的顶层目录/文件（逗号分隔）',
  '  --apply            真正执行删除（不加则只预演）',
  '  -h, --help         显示帮助',
].join(String.fromCharCode(10));

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const apply = argv.includes('--apply');
const WS = path.resolve(arg('workspace', process.cwd()));
const ARCH = path.resolve(arg('archive', path.join(WS, '会话产出归档')));
const keepArg = arg('keep', '');
const KEEP = new Set(['会话产出归档', 'archive-build.log', 'skills', 'node_modules', ...(keepArg ? keepArg.split(',') : [])]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { try { walk(p, out); } catch {} } else if (e.isFile()) out.push(p);
  }
  return out;
}
const sha = p => { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; } };

if (!fs.existsSync(ARCH)) { console.error('归档目录不存在: ' + ARCH); process.exit(2); }
const archived = new Set();
for (const f of walk(ARCH)) { const h = sha(f); if (h) archived.add(h); }
console.log('归档已索引文件: ' + archived.size);

// 这些是"不必存在于归档"的东西：缓存、系统文件、git 元数据、本工具自身
const exempt = p => /\\__pycache__\\|\\desktop\.ini$|\\\.git\\|workspace-manager|workspace-archive\.mjs|workspace-purge\.mjs|session-inventory\.mjs/.test(p);

let removedFiles = 0, removedBytes = 0, coveredFiles = 0;
for (const n of fs.readdirSync(WS)) {
  if (KEEP.has(n) || n.startsWith('.')) continue;
  const p = path.join(WS, n);
  let st; try { st = fs.lstatSync(p); } catch { continue; }
  let files = [p];
  if (st.isDirectory()) { try { files = walk(p); } catch { continue; } }
  const missing = [];
  for (const f of files) {
    if (exempt(f)) continue;
    const h = sha(f);
    if (!h || !archived.has(h)) missing.push(f);
  }
  coveredFiles += files.length - missing.length;
  if (missing.length) {
    console.log('KEEP ' + n + '：归档中缺 ' + missing.length + ' 个文件，例如 ' + missing.slice(0, 3).map(f => f.slice(WS.length + 1)).join(' | '));
    continue;
  }
  let bytes = 0;
  for (const f of files) { try { bytes += fs.statSync(f).size; } catch {} }
  if (!apply) { console.log('WOULD-DELETE ' + n + ' (' + files.length + ' 文件 / ' + (bytes / 1048576).toFixed(2) + ' MB)'); continue; }
  try {
    fs.rmSync(p, { recursive: st.isDirectory(), force: true });
    removedFiles += files.length; removedBytes += bytes;
    console.log('DELETED ' + n + ' (' + files.length + ' 文件 / ' + (bytes / 1048576).toFixed(2) + ' MB)');
  } catch (e) { console.log('FAIL ' + n + ' -> ' + e.message); }
}
console.log('--- 已归档覆盖文件 ' + coveredFiles + '；' + (apply ? '删除 ' + removedFiles + ' 文件 / ' + (removedBytes / 1048576).toFixed(1) + ' MB' : 'dry-run（加 --apply 才删除）') + ' ---');
