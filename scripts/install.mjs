#!/usr/bin/env node
// 把本技能安装到 DSH 默认扫描的用户技能根：<dshHome>/skills/<name>/（无需改 profile 配置）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const USAGE = [
  'install — 把 workspace-manager 安装到 <dshHome>/skills',
  '',
  '用法: node scripts/install.mjs [选项]',
  '',
  '  --dsh-home <dir>  DSH 配置目录，默认 ~/.dsh',
  '  --target <dir>    安装根目录，默认 <dsh-home>/skills',
  '  --check           只检查目标是否已安装，不复制',
  '  -h, --help        显示帮助',
].join(String.fromCharCode(10));

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };

const root = path.resolve(import.meta.dirname, '..');
const dshHome = arg('dsh-home', path.join(os.homedir(), '.dsh'));
const targetRoot = path.resolve(arg('target', path.join(dshHome, 'skills')));
const dest = path.join(targetRoot, 'workspace-manager');
const check = argv.includes('--check');

if (check) {
  const ok = fs.existsSync(path.join(dest, 'SKILL.md'));
  console.log((ok ? 'installed: ' : 'missing: ') + dest);
  process.exit(ok ? 0 : 1);
}

const KEEP = ['SKILL.md', 'scripts', 'references', 'templates', 'README.md', 'LICENSE', 'CHANGELOG.md', 'package.json'];
fs.mkdirSync(dest, { recursive: true });
for (const name of KEEP) {
  const src = path.join(root, name);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(dest, name), { recursive: true, force: true, filter: p => !p.split(/[\\/]/).includes('.git') });
}
console.log('installed -> ' + dest);
console.log('提示：DSH 默认扫描 <dshHome>/skills，新会话的技能目录即可看到 workspace-manager。');
