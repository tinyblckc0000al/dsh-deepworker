# 命令按钮：工作区 JSON 配置文件

> 给 **agent 批量配置**用的入口，不是新的存储根。客户端读它、校验、回填到
> `localStorage["dsh.deepworker.workspaces.v1"]`；之后仍可在 UI 里编辑。

## 位置

```
<当前会话的工作区>/.dsh-deepworker.buttons.json
```

- 文件从**当前会话的 cwd**（归属账 / session snapshot 解析）定位；只读，客户端**不写**它。
- 打开「设置 → DeepWorker → 命令按钮」，点 **「立即读取」** 才回填。
- **不轮询**：文件改了以后，再点一次「立即读取」。
- **整份替换**现有工作区列表；不是合并。
- 文件里的命令**绝不会自动执行**。批量启动仍由「启动选中（N）」触发。

## 格式

```json
{
  "version": 1,
  "workspaces": [
    {
      "path": "/Users/me/project-a",
      "label": "project-a",
      "start": { "label": "启动", "command": "bash scripts/serve.sh start" },
      "stop":  { "label": "停止", "command": "bash scripts/serve.sh stop" },
      "extras": [
        { "label": "重启", "command": "bash scripts/serve.sh restart", "pre": ["stop"] },
        { "label": "状态", "command": "bash scripts/serve.sh status" }
      ],
      "preStart": ["stop"],
      "header": ["stop", "start", "重启", "状态"],
      "timeoutSec": 30,
      "stopBeforeStart": false
    },
    {
      "path": "/Users/me/project-b",
      "start": { "command": "npm run dev" }
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `version` | 否 | 只能是 `1` |
| `workspaces[].path` | 是 | **绝对路径**；唯一键；去尾斜杠后比较 |
| `workspaces[].label` | 否 | 显示名；默认取路径末段 |
| `start` / `stop` | 否 | `{label, command}`；固定两个按钮，标签可改 |
| `extras[]` | 否 | `{label, command, pre}`；label/command 必填；最多 32 个 |
| `preStart` | 否 | 启动前的前置命令序列；引用 `stop` 或某个 extra 的 **label** |
| `header` | 否 | 会话头部显示哪些按钮、顺序如何；引用 `start` / `stop` / 某个 extra 的 **label**。省略 = 全部按原顺序；`[]` = 一个都不显示 |
| `extras[].pre` | 否 | 这个额外按钮自己的前置命令序列；引用 `stop` 或其它 extra 的 **label**；每个动作最多一次 |
| `logToFile` | 否 | 每次运行把输出写入 `<workspace>/.dsh-deepworker/logs/`；默认 `false` |
| `timeoutSec` | 否 | 1–600，默认 30 |
| `stopBeforeStart` | 否 | 点「启动」时先跑一次停止命令 |

一个工作区至少要有一条非空命令（start / stop / extras 之一）。

`preStart` / `extras[].pre` 都只引用**本工作区已定义且带命令**的动作（`stop` 或额外按钮的 label），
每个动作最多出现一次；引用其它额外按钮时只跑它的**命令**，不会递归它自己的前置序列。

## 校验（严格）

任一错误 ⇒ **整份不应用**，页面列出错误；不会半份生效。会拒绝：

- 非绝对路径 / 空 path
- 重复 path
- extra 缺 label 或 command
- `preStart` 引用了不存在的动作
- `header` 不是数组、引用不存在的动作、或重复引用
- `version` 不是 1
- 超过 64 个工作区 / 32 个额外按钮
- JSON 语法错误

## 边界

- “文件”只覆盖**命令按钮**这一档，不影响笔记、专注锁、通知等设置。
- 文件按**当前工作区**定位；换到另一个工作区且那里没有文件时，现有配置保持不变。
- 文件内容 hash 没变时不会重复应用；UI 里手改不会回写文件。
- 配置保存在浏览器 localStorage；换电脑 / 清站点数据会回到默认，文件可用来快速恢复。
- 执行仍走终端：终端的 cwd 是**当前会话**的 cwd；跑别的工作区的命令会先 `cd` 到该工作区。
- 终端不会出现在侧栏终端面板里，输出也不显示；这一档只负责启动/停止。
