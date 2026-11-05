#!/usr/bin/env node
// 列出所有 DSH 会话：解码 zstd 多帧 JSONL 转录，汇总标题、时间窗、文件写入证据。
// 用法: node session-inventory.mjs [--store <sessions 根目录>] [--out <json 路径>]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

export function frameEnd(buf, off) {
  let p = off + 4;
  const fhd = buf[p++];
  const fcsFlag = fhd >> 6, single = (fhd >> 5) & 1, checksum = (fhd >> 2) & 1, didFlag = fhd & 3;
  if (!single) p += 1;
  p += [0, 1, 2, 4][didFlag];
  p += fcsFlag === 0 ? (single ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8;
  for (;;) {
    const h = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
    p += 3;
    const last = h & 1, type = (h >> 1) & 3, size = h >>> 3;
    p += type === 1 ? 1 : size;
    if (last) break;
    if (p > buf.length) throw new Error('frame overrun');
  }
  return p + (checksum ? 4 : 0);
}

export function decodeSession(file) {
  const buf = fs.readFileSync(file);
  const parts = [];
  let off = 0;
  while (off < buf.length - 4) {
    if (!MAGIC.every((b, i) => buf[off + i] === b)) break;
    const end = frameEnd(buf, off);
    parts.push(zlib.zstdDecompressSync(buf.subarray(off, end)));
    off = end;
  }
  return Buffer.concat(parts).toString('utf8');
}

function collectStrings(v, acc) {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, acc);
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) collectStrings(v[k], acc);
  return acc;
}

const WRITE_TOOLS = new Set(['write', 'edit', 'ops_replace', 'str_replace_editor']);

// 以会话自身 cwd 为工作区根，把参数里的绝对路径裁剪成该根下的相对路径
function makeNorm(root) {
  const r = (root || '').replace(/\//g, '\\').replace(/\\+$/, '');
  return s => {
    if (!r) return null;
    const t = s.replace(/\//g, '\\');
    const i = t.toLowerCase().indexOf(r.toLowerCase());
    if (i < 0) return null;
    return t.slice(i).split(/[<>|?*\r\n"']/)[0].replace(/[\\.,;:)\]]+$/, '');
  };
}

export function scanStore(storeRoot, cacheDir) {
  const out = [];
  if (!fs.existsSync(storeRoot)) return out;
  for (const d of fs.readdirSync(storeRoot)) {
    const dir = path.join(storeRoot, d);
    let st; try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    const f = fs.readdirSync(dir).find(x => x.startsWith('session.'));
    if (!f) continue;
    let events;
    try { events = decodeSession(path.join(dir, f)).split('\n').filter(Boolean).map(l => JSON.parse(l)); }
    catch (e) { out.push({ id: d, error: String(e) }); continue; }
    const head = events[0] || {};
    const id = head.id || d;
    const normPath = makeNorm(head.cwd);
    let last = head.createdAt || 0;
    const userTexts = [];
    const writes = new Set(), mentions = new Set();
    for (const e of events) {
      if (e.time && e.time > last) last = e.time;
      if (e.type === 'user/message' && e.data && e.data.source && e.data.source.kind === 'user') {
        const t = (e.data.content || []).map(c => c.text || '').join('\n').trim();
        if (t) userTexts.push(t);
      }
      if (e.type !== 'tool/call' || !e.data) continue;
      const name = e.data.name;
      let args = e.data.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = { raw: args }; } }
      if (!args) continue;
      const direct = args.file_path || args.path || args.output_path || args.dest;
      if (typeof direct === 'string') {
        const p = normPath(direct);
        if (p) (WRITE_TOOLS.has(name) ? writes : mentions).add(p);
      }
      for (const s of collectStrings(args, [])) {
        if (!head.cwd || !s.replace(/\//g, '\\').toLowerCase().includes(String(head.cwd).replace(/\//g, '\\').toLowerCase())) continue;
        const re = /[A-Za-z]:[\\/][^\r\n"'<>|?*]*/g;
        let m;
        while ((m = re.exec(s))) {
          const p = normPath(m[0]);
          if (!p || p.length < 20) continue;
          (WRITE_TOOLS.has(name) ? writes : mentions).add(p);
        }
      }
    }
    let title = '';
    if (cacheDir) {
      const cf = path.join(cacheDir, id.replace(/^session-/, '') + '.json');
      try { const rec = JSON.parse(fs.readFileSync(cf, 'utf8')).record; title = (rec.rows.title && rec.rows.title.val) || ''; } catch {}
    }
    out.push({ id, store: path.basename(storeRoot), cwd: head.cwd, created: head.createdAt, last,
      depth: head.delegationDepth || 0, title, firstUser: (userTexts[0] || '').slice(0, 400),
      turns: userTexts.length, writes: [...writes], mentions: [...mentions] });
  }
  return out;
}

const invokedDirectly = (() => {
  try { return path.resolve(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')) === path.resolve(process.argv[1] || ''); }
  catch { return true; }
})();
if (invokedDirectly) {
const USAGE = [
  'session-inventory — 列出所有 DSH 会话及其文件写入证据',
  '',
  '用法: node session-inventory.mjs [选项]',
  '',
  '  --dsh-home <dir>  DSH 配置目录，默认 ~/.dsh',
  '  --store <dir>     会话库根目录，默认 <dsh-home>/sessions',
  '  --cache <dir>     标题缓存目录，默认 <dsh-home>/storages/session_projcache/sessions',
  '  --out <file>      输出 JSON，默认 session-inventory.json',
  '  -h, --help        显示帮助',
].join(String.fromCharCode(10));
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
  const arg = (k, dflt) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : dflt; };
  const dshHome = arg('dsh-home', path.join(os.homedir(), '.dsh'));
  const storeRoot = arg('store', path.join(dshHome, 'sessions'));
  const cacheDir = arg('cache', path.join(dshHome, 'storages', 'session_projcache', 'sessions'));
  const outPath = arg('out', 'session-inventory.json');
  const all = [];
  for (const store of fs.existsSync(storeRoot) ? fs.readdirSync(storeRoot) : []) {
    const p = path.join(storeRoot, store);
    if (fs.statSync(p).isDirectory()) all.push(...scanStore(p, cacheDir));
  }
  all.sort((a, b) => (a.created || 0) - (b.created || 0));
  fs.writeFileSync(outPath, JSON.stringify(all, null, 1), 'utf8');
  for (const s of all) {
    console.log([new Date(s.created || 0).toISOString().slice(0, 16), (s.id || '').slice(0, 20), 'd' + (s.depth || 0),
      'w=' + (s.writes || []).length, 'm=' + (s.mentions || []).length,
      ((s.firstUser || s.title || '') + '').replace(/\s+/g, ' ').slice(0, 50)].join(' | '));
  }
  console.log('sessions=' + all.length + ' -> ' + outPath);
}
