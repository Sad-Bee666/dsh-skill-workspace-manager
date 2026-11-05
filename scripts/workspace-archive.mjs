#!/usr/bin/env node
// 按「一个会话 = 一个归档目录」把工作区产物分类复制到 <out>/<NN>_<date>_<topic>/<分类>/
// 用法: node workspace-archive.mjs --workspace <ws> --plan <plan.json> [--out <dir>] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CATS = {
  A: '01_最终交付', B: '02_过程版本', C: '03_策划文档', D: '04_调研资料',
  E: '05_源码与工作区', F: '06_预览与校验', G: '07_脚本', H: '08_其他',
};
const CAT_DOC = [
  ['01', '最终交付', '可直接交付/使用的成品'],
  ['02', '过程版本', '成品的中间修订版本'],
  ['03', '策划文档', '方案、设计说明、需求/大纲'],
  ['04', '调研资料', '原始素材、参考资料、检索缓存'],
  ['05', '源码与工作区', '工程源码、项目工作目录'],
  ['06', '预览与校验', '预览图、校验/审查输出'],
  ['07', '脚本', '一次性脚本与工具'],
  ['08', '其他', '不属于以上的杂项'],
];
const USAGE = [
  'workspace-archive — 按 plan.json 把工作区产物分类复制成「一个会话一个归档目录」',
  '',
  '用法: node workspace-archive.mjs --workspace <ws> --plan <plan.json> [选项]',
  '',
  '  --workspace <dir>  工作区根目录，默认当前目录',
  '  --plan <file>      归档计划 JSON（见 templates/plan.example.json）',
  '  --out <dir>        归档输出目录，默认 <workspace>/会话产出归档',
  '  --dry-run          只打印计划，不复制',
  '  -h, --help         显示帮助',
].join(String.fromCharCode(10));

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const flag = k => argv.includes('--' + k);

const WS = path.resolve(arg('workspace', process.cwd()));
const planPath = arg('plan');
if (!planPath) { console.error('缺少 --plan <plan.json>'); process.exit(2); }
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const OUT = path.resolve(arg('out', path.join(WS, '会话产出归档')));
const CATS = { ...DEFAULT_CATS, ...(plan.categories || {}) };
const dry = flag('dry-run');

function countFiles(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return 1;
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(p, e.name)) : 1;
  return n;
}
const BT = String.fromCharCode(96);
const q = s => BT + s + BT;

function readme(s, dirName, rows) {
  const L = ['# ' + dirName + ' · 会话产出归档', ''];
  L.push('- **会话主题**：' + s.topic);
  L.push('- **会话 ID**：' + (s.ids && s.ids.length ? s.ids.map(q).join('、') : '（无对应会话记录）'));
  if (s.goal) L.push('- **目标 / 背景**：' + s.goal);
  L.push('- **归档日期**：' + s.date, '', '## 分类说明', '', '| 编号 | 分类 | 收纳内容 |', '| --- | --- | --- |');
  for (const [no, name, desc] of CAT_DOC) L.push('| ' + no + ' | ' + name + ' | ' + desc + ' |');
  L.push('', '## 文件清单', '');
  if (!rows.length) L.push('（本会话产物已不在当前工作区，或已全部整理进其它交付包。）');
  else {
    L.push('| 原位置（工作区） | 归档位置 | 规模 | 状态 |', '| --- | --- | --- | --- |');
    for (const r of rows) L.push('| ' + q(r[0]) + ' | ' + q(r[1]) + ' | ' + r[2] + ' | ' + r[3] + ' |');
  }
  if (s.inplace && s.inplace.length) {
    L.push('', '## 保留原位（未复制）', '', '| 路径 | 原因 |', '| --- | --- |');
    for (const it of s.inplace) L.push('| ' + q(it[0]) + ' | ' + it[1] + ' |');
  }
  L.push('', '> 归档为唯一副本（若后续执行清理）：原件删除前须先通过 workspace-purge 的哈希校验。');
  return L.join('\n') + '\n';
}

function overview(groups) {
  const L = ['# 会话产出归档 · 总览', ''];
  L.push('工作区 ' + q(WS) + ' 按「一个会话 = 一个归档目录」整理。');
  L.push('分类沿用 8 段式编号：01 最终交付 / 02 过程版本 / 03 策划文档 / 04 调研资料 / 05 源码与工作区 / 06 预览与校验 / 07 脚本 / 08 其他。', '');
  L.push('| 归档目录 | 会话日期 | 主题 | 会话 ID |', '| --- | --- | --- | --- |');
  for (const s of groups) L.push('| ' + q(s.no + '_' + s.date + '_' + s.topic) + ' | ' + s.date + ' | ' + s.topic + ' | ' + (s.ids && s.ids.length ? q(s.ids[0].slice(0, 20) + '…') : '—') + ' |');
  L.push('', '## 说明', '');
  L.push('1. 归档由 workspace-archive.mjs 生成，文件为复制。');
  L.push('2. 超大环境目录（venv、插件源码、探包工作区）不复制，见各会话 README 的「保留原位」表。');
  L.push('3. 子代理会话产物归入其父会话目录。');
  return L.join('\n') + '\n';
}

const log = [];
if (!dry) fs.mkdirSync(OUT, { recursive: true });
const groups = plan.sessions;
for (const s of groups) {
  const dirName = s.no + '_' + s.date + '_' + s.topic;
  const sdir = path.join(OUT, dirName);
  const rows = [];
  if (!dry) fs.mkdirSync(sdir, { recursive: true });
  for (const it of s.items || []) {
    const src = path.join(WS, it.src);
    const cat = CATS[it.cat] || it.cat;
    if (!fs.existsSync(src)) { rows.push([it.src, '(缺失)', '—', '源文件已不存在']); log.push('MISS ' + it.src); continue; }
    const dst = path.join(sdir, cat, path.basename(it.src));
    if (dry) { rows.push([it.src, cat + '\\' + path.basename(it.src), '—', 'dry-run']); continue; }
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.cpSync(src, dst, { recursive: true, force: true, filter: p => !p.split(/[\\/]/).includes('.git') });
      rows.push([it.src, cat + '\\' + path.basename(it.src), countFiles(dst) + ' 文件', '已复制']);
      log.push('OK ' + it.src);
    } catch (e) { rows.push([it.src, cat + '\\' + path.basename(it.src), '—', '复制失败: ' + e.message]); log.push('FAIL ' + it.src + ' ' + e.message); }
  }
  if (!dry) fs.writeFileSync(path.join(sdir, 'README_文件说明.md'), readme(s, dirName, rows), 'utf8');
  console.log((dry ? 'PLAN ' : 'DONE ') + dirName + '  items=' + (s.items || []).length);
}
if (!dry) fs.writeFileSync(path.join(OUT, 'README_总览.md'), overview(groups), 'utf8');
const bad = log.filter(l => !l.startsWith('OK'));
console.log((dry ? '[dry-run] ' : '') + 'groups=' + groups.length + (bad.length ? '\n' + bad.join('\n') : '') + '\nlog -> ' + path.join(OUT, '..', 'archive-build.log'));
if (!dry) fs.writeFileSync(path.join(WS, 'archive-build.log'), log.join('\n'), 'utf8');
