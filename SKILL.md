---
name: workspace-manager
description: 按 DSH 会话归档并瘦身工作区。读取 ~/.dsh/sessions 下的 zstd 转录，定位「哪个会话产出了哪些文件」，按 8 段式分类（最终交付/过程版本/策划文档/调研资料/源码与工作区/预览与校验/脚本/其他）整理成「一个会话一个归档目录」，再经 SHA-256 覆盖率校验删除原件与临时文件。当用户要求整理/分类工作区文件、按会话归档、清理临时文件或释放磁盘时使用。
---

# 管理工作区（按会话归档 + 安全瘦身）

把一个被多个会话共用、散落着脚本/缓存/中间产物的 DSH 工作区，变成「一个会话一个归档目录 + 少量环境资产」的结构，并在删除前用哈希证明归档里确有副本。

## 何时用
- 用户说：整理工作区、按会话分类、把同一会话的产物放一起、清理临时文件、释放磁盘。
- 工作区里有 `_tmp_*.py`、`_dbg*.py`、`crop*.png`、`__pycache__`、`.pptx-build-*`、多个互不相干的项目目录。

## 不适用
- 单一项目重构（直接改代码即可）。
- 用户只要一份文件清单（用 glob/ls 即可，不必跑归档流程）。

## 五条铁律
1. **会话是归属单元**：同一会话的所有产物（含其子代理）进同一个归档目录。
2. **证据优先，不靠目录名猜**：从会话转录的 tool/call 参数里提取写入路径，再用文件 mtime 与会话时间窗交叉验证。
3. **分类沿用 8 段式**：01_最终交付 / 02_过程版本 / 03_策划文档 / 04_调研资料 / 05_源码与工作区 / 06_预览与校验 / 07_脚本 / 08_其他（出处：大学生职业规划会话的“职业生涯规划大赛_交付汇总”）。只创建非空分类目录。
4. **先复制，后校验，最后才删**：删除任何原件前，必须证明归档中存在 SHA-256 相同的副本。
5. **环境不搬**：venv、插件源码、探包工作区、.git 不进归档，只在 README 里登记「保留原位」。删除它们要单独确认。

## 工作流

### 第 1 步 摸清工作区
```bash
node scripts/session-inventory.mjs --out inventory.json
```
输出每个会话一行：时间、ID、子代理深度（d0 顶层 / d1 子代理）、写入数、首条用户消息。
再用 glob/ls 列出工作区顶层条目、文件数与体积，注意 __pycache__、.pptx-build-*、venv 这类噪声。

> 会话库位置：`~/.dsh/sessions/<按 cwd 编码的工作区>/`（Windows 下形如 `--D-workspace_for_deepseek--`）。同一工作区可能有多个 store（子目录被单独当工作区过），要一起扫。

### 第 2 步 给文件定归属
对每个顶层条目，统计各会话对它的写入/引用次数（inventory.json 的 writes/mentions），优先选写入次数最多的会话；没有证据时用 mtime 落在哪个会话的 [created, last] 窗口内。
判不准的不要硬塞，放进 00_未归属_历史会话与外部资源。

### 第 3 步 写归档计划（plan.json）
```json
{ "sessions": [ { "no": "01", "date": "2026-10-01", "topic": "插件安装与市场核查",
  "ids": ["session-…"], "goal": "一句话背景",
  "items": [ { "cat": "A", "src": "成品.docx" }, { "cat": "G", "src": "脚本.py" } ],
  "inplace": [ ["超大环境目录", "体量或引用原因，保留原位"] ] } ] }
```
模板见 templates/plan.example.json。src 用相对工作区的路径；目录会被整棵复制（自动跳过 .git）。

### 第 4 步 预演，再执行
```bash
node scripts/workspace-archive.mjs --workspace <ws> --plan plan.json --out 会话产出归档 --dry-run
node scripts/workspace-archive.mjs --workspace <ws> --plan plan.json --out 会话产出归档
```
生成 <out>/<NN>_<date>_<topic>/<分类>/ + 每个会话的 README_文件说明.md + <out>/README_总览.md。

### 第 5 步 核对覆盖率（必须）
```bash
node scripts/workspace-purge.mjs --workspace <ws> --archive <out> --keep "必须保留的目录1,目录2"
```
默认 dry-run：逐个文件算 SHA-256，只有归档里存在同哈希副本的条目才列为 WOULD-DELETE；缺口会打印 KEEP … 归档中缺 N 个文件。
**发现缺口先补归档，再谈删除**（常见缺口：子代理写的中间文本、系统 desktop.ini、被 .git 排除的文件）。

### 第 6 步 清理临时产物
先删无归档价值的：__pycache__、.pptx-build-*、_dbg*.py、_tmp_*、crop*.png、一次性 _*.mjs/.ps1、探针脚本。
环境类（venv、插件源码、市场探包）**先解释后果再问**：
- 用 ask_user_question 给出各组体积与「删了会失去什么」；
- 说明已安装插件是否真依赖它（查 ~/.dsh/profiles/*/cordis*.yml 与 package.json 有无指向工作区的路径；用 where python 确认解释器不在工作区）。
- 删配置备份目录（*install/*.before-*）要格外小心：那是插件装坏时的回滚点。

### 第 7 步 收尾
- 更新 README_总览.md 的「清理记录」表；
- 同步各会话 README 的「保留原位」与「归档为唯一副本」表述；
- 删掉自己产生的临时脚本（除非用户要求保留）。

## 实战陷阱（都踩过）
- **zstd 多帧**：会话转录是多个 zstd frame 拼接，zstdDecompressSync 只解第一帧。必须按 frame header 解析帧边界逐帧解压（scripts/session-inventory.mjs 已实现 frameEnd/decodeSession）。
- **用户消息事件**是 user/message，且要过滤 data.source.kind === 'user'（其余是审批与系统注入）。
- **子代理**：delegationDepth 为 1 的会话是子代理，产物归父会话；父会话 writes 常为 0，因为写入发生在子代理里。
- **run_code 里的路径**：该类会话所有写入都在代码字符串里，必须递归扫描参数并正则提取路径，不能只看 file_path。
- **命令里被删掉的临时脚本**（Remove-Item _t.cjs）不留痕迹，别把「提到过」等同于「现存」。
- **.pptx-build-* / .git** 可能因 ACL 或沙箱返回 EPERM/EIO：readdir 要 try/catch，复制时用 filter 跳过 .git；删不掉的空目录如实报告，不要反复换招。
- **大小不等于内容**：判断原件是否多余只认哈希，不认文件名或体积。

## 删除前必须做的三件事
1. 跑一遍 workspace-purge.mjs（dry-run）并把结论给用户看；
2. 明确列出保留清单（用户交付包、环境资产、个人照片等）；
3. 删除后回读目录树、汇报释放体积，并同步更新文档。
