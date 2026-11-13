#!/usr/bin/env node
// 自动推断归档计划：按会话选文件，按 8 段式分类，产出可交给 workspace-archive.mjs 的 plan 对象。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanStore } from './session-inventory.mjs';

const ENV_HINTS = /(^|[\\/])(venv|py-install|node_modules|\.venv)([\\/]|$)/i;

export function classify(rel) {
  const p = rel.replace(/\\/g, '/');
  const base = p.split('/').pop().toLowerCase();
  const ext = (base.match(/\.[^.]+$/) || [''])[0];
  if (/(^|[^a-z])v\d|backup|备份|旧版|copia|copy|_old|\(\d\)/.test(base)) return 'B';
  if (/final|最终|交付|成品/.test(base)) return 'A';
  if (/preview|预览|verify|校验|audit|检查/.test(base)) return 'F';
  if (/design|spec|plan|readme|方案|说明书|策划|大纲/.test(base)) return 'C';
  if (/素材|资料|research|survey|访谈|问卷/.test(base)) return 'D';
  const byExt = {
    '.docx': 'A', '.doc': 'A', '.pdf': 'A', '.pptx': 'A', '.xlsx': 'A', '.html': 'A', '.htm': 'A',
    '.png': 'F', '.jpg': 'F', '.jpeg': 'F', '.webp': 'F', '.gif': 'F', '.svg': 'F',
    '.py': 'G', '.mjs': 'G', '.js': 'G', '.cjs': 'G', '.ps1': 'G', '.sh': 'G', '.bat': 'G', '.cmd': 'G',
    '.md': 'C', '.txt': 'D', '.csv': 'D', '.zip': 'D', '.tgz': 'D', '.7z': 'D',
    '.json': 'H', '.log': 'H', '.yml': 'H', '.yaml': 'H', '.ini': 'H', '.cfg': 'H',
  };
  return byExt[ext] || 'H';
}

function walkFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, acc); else if (e.isFile()) acc.push(p);
  }
  return acc;
}

function newestMtime(p) {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return st.mtimeMs;
    let m = st.mtimeMs;
    for (const f of walkFiles(p)) { const t = fs.statSync(f).mtimeMs; if (t > m) m = t; }
    return m;
  } catch { return 0; }
}

function sanitize(s, max) {
  return String(s || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildAutoPlan(opts) {
  const WS = path.resolve(opts.workspace);
  const OUT = path.resolve(opts.outDir || path.join(WS, '会话产出归档'));
  const dshHome = opts.dshHome || path.join(os.homedir(), '.dsh');
  const storesRoot = path.join(dshHome, 'sessions');
  const cacheDir = path.join(dshHome, 'storages', 'session_projcache', 'sessions');
  const sessions = [];
  if (fs.existsSync(storesRoot)) {
    for (const s of fs.readdirSync(storesRoot)) {
      const p = path.join(storesRoot, s);
      if (fs.statSync(p).isDirectory()) sessions.push(...scanStore(p, cacheDir));
    }
  }
  const norm = p => String(p || '').replace(/\\/g, '/').toLowerCase();
  const mine = sessions.filter(s => norm(s.cwd) === norm(WS));
  let target = null;
  if (opts.sessionId) target = sessions.find(s => s.id === opts.sessionId) || null;
  else target = mine.slice().sort((a, b) => (b.last || 0) - (a.last || 0))[0] || null;

  const existing = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(n => /^\d{2}_/.test(n)) : [];
  // 同一会话重复归档时复用已有目录，避免建出 12_/13_ 这样的重复文件夹
  let reuse = null;
  if (target) {
    for (const d of existing.slice().sort().reverse()) {
      const f = path.join(OUT, d, 'README_文件说明.md');
      if (fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes(target.id)) { reuse = d; break; }
    }
  }
  const nextNo = existing.reduce((m, n) => Math.max(m, parseInt(n.slice(0, 2), 10) || 0), 0) + 1;
  const date = new Date((target && target.created) || Date.now());
  const iso = date.toISOString().slice(0, 10);
  const stripRef = s => String(s || '').replace(/^@?\s*[A-Za-z]:[\\/][^\s]*\s*/, '').replace(/^@\S*\s*/, '');
  const firstClause = s => stripRef(s).split(/[，。；;,.\n]/)[0];
  const topic = sanitize(firstClause((target && (target.title || target.firstUser)) || opts.topic) || '工作区产物', 20) || '工作区产物';

  const entries = fs.readdirSync(WS).filter(n =>
    n !== path.basename(OUT) && n !== '会话产出归档' && n !== 'skills' && n !== 'archive-build.log' && !n.startsWith('.'));
  const since = opts.since ? (Date.parse(opts.since) || 0) : (target && !opts.all ? (target.created || 0) - 120000 : 0);
  const items = [];
  const inplace = [];
  for (const name of entries) {
    const abs = path.join(WS, name);
    if (fs.existsSync(path.join(abs, 'README_总览.md'))) continue; // 已归档目录
    if (newestMtime(abs) < since) continue;
    const st = fs.statSync(abs);
    if (!st.isDirectory()) { items.push({ cat: classify(name), src: name }); continue; }
    if (ENV_HINTS.test(abs)) { inplace.push([name, '运行环境目录，不复制']); continue; }
    const files = walkFiles(abs);
    if (files.length > 800) { inplace.push([name, '超大目录（' + files.length + ' 个文件），保留原位']); continue; }
    const named = classify(name);
    if (('AB CDF'.replace(/ /g, '')).includes(named)) { items.push({ cat: named, src: name }); continue; }
    const hasPkg = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'CMakeLists.txt'].some(f => fs.existsSync(path.join(abs, f)));
    if (hasPkg || files.length > 150) { items.push({ cat: 'E', src: name }); continue; }
    for (const f of files) {
      const rel = path.relative(WS, f);
      if (/[\\/](node_modules|__pycache__|\.git)[\\/]/.test(rel)) continue;
      items.push({ cat: classify(rel), src: rel });
    }
  }

  const no = reuse ? reuse.slice(0, 2) : String(nextNo).padStart(2, '0');
  const plan = {
    sessions: [{
      no,
      dirName: reuse || undefined,
      date: iso,
      topic,
      ids: target ? [target.id] : [],
      goal: target ? '自动归档：' + sanitize(target.firstUser || target.title, 80) : '自动归档',
      items,
      inplace,
    }],
  };
  return { plan, session: target, sessionsScanned: sessions.length, matched: mine.length, reused: reuse }; 
}
