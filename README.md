# workspace-manager

> 按「会话」归档 DSH 工作区，并在**证明归档里有副本之后**才删除原件。
> Archive a DeepSeek Harness workspace by conversation, then delete originals only after SHA-256 proves a copy exists.

被多个会话共用的工作区，最后往往变成这样：根目录躺着 `_tmp_fetch.py`、`_dbg3.py`、`crop33a.png`、`__pycache__`、`.pptx-build-*`，几个互不相干的项目混在一起，谁产出了什么都说不清。
这个技能把「哪个会话产出了哪些文件」变成可核查的事实，整理成 **一个会话一个归档目录**，再用哈希校验做安全清理。

## 特性

- **归属靠证据，不靠目录名**：解码 DSH 会话转录（zstd 多帧 JSONL），从 `tool/call` 参数里提取写入路径，再用文件 mtime 与会话时间窗交叉验证。
- **8 段式分类**：`01_最终交付 / 02_过程版本 / 03_策划文档 / 04_调研资料 / 05_源码与工作区 / 06_预览与校验 / 07_脚本 / 08_其他`。
- **删除前哈希校验**：`workspace-purge.mjs` 逐文件算 SHA-256，只删除「归档中存在同哈希副本」的条目，默认 dry-run。
- **环境不搬**：venv、插件源码、市场探包、`.git` 只登记「保留原位」，删除要单独确认。
- **零依赖**：只用 Node 内置模块（`node:fs` / `node:zlib` / `node:crypto`），Node ≥ 22（需要 zstd 支持）。

## 目录

```
.
├── SKILL.md                      # 技能主体：7 步工作流 + 实战陷阱
├── scripts/
│   ├── session-inventory.mjs     # 解码会话转录，输出每会话清单（含写入证据）
│   ├── workspace-archive.mjs     # 按 plan.json 分类复制 + 生成 README
│   └── workspace-purge.mjs       # SHA-256 覆盖率校验后删除原件（默认 dry-run）
├── references/
│   ├── 归属与分类规范.md          # 8 段式定义、归属判定顺序、保留原位判定
│   └── 清理检查清单.md            # 删除前后逐条打勾
└── templates/plan.example.json   # 归档计划模板
```

## 快速开始

```bash
# 1) 盘点所有会话（默认扫描 ~/.dsh/sessions 下全部工作区）
node scripts/session-inventory.mjs --out inventory.json

# 2) 参照 inventory 写 plan.json（模板：templates/plan.example.json），先预演
node scripts/workspace-archive.mjs --workspace /path/to/workspace --plan plan.json --dry-run
node scripts/workspace-archive.mjs --workspace /path/to/workspace --plan plan.json

# 3) 覆盖率校验 → 确认后删除
node scripts/workspace-purge.mjs --workspace /path/to/workspace --archive 会话产出归档 --keep "交付包,环境目录"
node scripts/workspace-purge.mjs --workspace /path/to/workspace --archive 会话产出归档 --keep "交付包,环境目录" --apply
```

每个脚本都支持 `--help`。

## plan.json 格式

```json
{
  "sessions": [
    {
      "no": "01",
      "date": "2026-10-01",
      "topic": "插件安装与市场核查",
      "ids": ["session-480fb0ed-18e2-4f83-9c19-a7c4e0aad072"],
      "goal": "一句话说明该会话做了什么",
      "items": [
        { "cat": "A", "src": "成品.docx" },
        { "cat": "G", "src": "脚本.py" }
      ],
      "inplace": [["超大环境目录", "体量大或仍被引用，保留原位"]]
    }
  ]
}
```

`cat` 取值：`A` 最终交付、`B` 过程版本、`C` 策划文档、`D` 调研资料、`E` 源码与工作区、`F` 预览与校验、`G` 脚本、`H` 其他。

## 安装到 DSH

**方式 A（最简单）**：不安装。新会话里说「按 `<技能目录>/SKILL.md` 执行，目标是整理 X 工作区」。

**方式 B（注册技能目录，推荐长期）**：在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 追加：

```yaml
- id: skill-filesystem
  name: "@deepseek-ai/dsh-skill-filesystem"
  config:
    customSkillDirs:
      - !!js >-
          process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('@deepseek-ai/dsh-agent-preset/package.json')), 'skills')
      - "/absolute/path/to/this/repo"
```

> 第一项是 DSH 内置技能目录，**必须保留**，否则 office 等内置技能会消失。修改后重启 DSH。

**方式 C（作为 skills-only 插件分发）**：参照 `dsh-plugin-word-docx-writer` 的结构，在 `package.json` 里声明
`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，补一个 no-op 插件入口与 insert patch 行，再用插件市场安装。

## 安全策略

1. 删除只认 **SHA-256**，不认文件名或体积。
2. `workspace-purge.mjs` 默认 dry-run，`--apply` 才动手。
3. 归档缺口会打印 `KEEP … 归档中缺 N 个文件`，此时**先补归档再谈删除**。
4. 环境目录（venv/插件源码/探包工作区）单独确认，并解释「删了会失去什么」。
5. 沙箱或 ACL 拒绝（`EPERM`/`EIO`）如实报告，不换招硬删。

## 实战数据（本技能第一次落地）

单个工作区、33 个会话（含 18 个转录子代理、4 个翻译子代理、1 个调研子代理）：
归档 647 个文件；随后按哈希校验删除 564 个原件，释放 41.3 MB；再清掉一次性环境目录与临时脚本约 268 MB。

## English

A DSH skill that archives a shared workspace **per conversation**, using the session transcripts (multi-frame zstd JSONL) as the source of truth for file ownership. Files are classified into an 8-part scheme (final deliverable / intermediate versions / specs / research / source workspace / previews / scripts / other), then originals are deleted only after a per-file SHA-256 match against the archive. Node ≥ 22, zero dependencies. See `SKILL.md` for the full workflow.

## License

MIT
