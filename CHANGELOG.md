# Changelog

## 1.0.0 — 2026-11-05

首个可用版本，提炼自一次真实工作区整理（33 个会话 / 647 个归档文件 / 564 个原件清理）。

### 新增
- `SKILL.md`：7 步工作流（盘点 → 归属 → 计划 → 归档 → 校验 → 清理 → 收尾）与 7 条实战陷阱。
- `scripts/session-inventory.mjs`：按 zstd frame 边界解码多帧会话转录，输出会话清单、时间窗与写入证据。
- `scripts/workspace-archive.mjs`：按 plan.json 做 8 段式分类复制，并生成每个会话的 README 与总览。
- `scripts/workspace-purge.mjs`：SHA-256 覆盖率校验后删除原件，默认 dry-run。
- `references/归属与分类规范.md`、`references/清理检查清单.md`。
- `templates/plan.example.json`。

### 说明
- 三个脚本均支持 `--help`，仅依赖 Node 内置模块，要求 Node ≥ 22。
