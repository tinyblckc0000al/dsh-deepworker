# dsh-focus-lock

专注锁：**锁定一个会话或一个工作区**，然后在**非目标**会话里拒绝任何**会改变状态**的工具调用。

从 `dsh-history-actions` 拆出来的第一个插件（见 `dsh-history-actions/docs/archive/plugin-split-plan.md`）。

## 组成

| 文件 | 作用 |
|---|---|
| `lib/index.js` | 宿主守卫：挂 `tools/pre-execute`，读锁文件，按 `decide()` 判定 |
| `lib/focus-lock-cli.mjs` | 控制 CLI：`status` / `lock` / `unlock`（**agent 用它来锁**） |
| `verify/verify_focus_host.mjs` | 自检：判定矩阵 / 冷却 / 记录 / CLI / 镜像 / 测试隔离 |

## 状态在哪

| 文件 | 谁写 | 谁读 |
|---|---|---|
| `~/.dsh/focus-lock.json` | CLI | **宿主守卫**（权威） |
| `<cwd>/.dsh-focus-lock.json` | CLI | 客户端 UI（工作区镜像） |

## 用法

```bash
node lib/focus-lock-cli.mjs lock   --kind session|workspace --target <id> [--minutes 30] [--cooldown 10]
node lib/focus-lock-cli.mjs status
node lib/focus-lock-cli.mjs unlock --went-to <where>
```

**不误伤**：只拒绝已知的 mutator（`bash`/`write`/`edit`/`subagent`/…），**只读与未知工具一律放行**；
目标会话内**全部放行**；未锁 / 过期 / 文件损坏 → **全部放行**。
**出路**：冷却可设 0；`untilMs` 到期自动失效；冷却未到就解锁 → **退出码 3**（对 agent 同样生效）。
