ENGLISH ver below.

# SillyTavern 状态感知管理器 (SAM)

SAM 是一个为 SillyTavern 设计的强大且安全的状态管理脚本。它允许 AI 使用一套简单、明确的指令来跟踪变量、管理列表和触发定时事件，从而帮助你创建富有动态和状态的角色扮演体验。

该系统的核心设计理念是 **安全、可预测，足够绿皮，和透明**。你的虚拟世界的所有状态都直接（但隐藏地）存储在聊天记录中，以求在你加载、编辑或切换消息时，数据能保持完美的一致性和可追溯性。

## 核心功能

*   **持久化状态：** 你可以跟踪任何能想到的数值——玩家属性、库存、关系分数、世界状态、任务标记等等，并通过 SillyTavern 的 `{{...}}` 语法在你的提示词、角色卡等地方使用它们。
*   **设计安全：** AI 只能使用一小部分预先定义好的安全指令。不存在因 AI 回复格式错误而导致代码注入或状态被破坏的风险。
*   **定时事件：** 可以设定变量在若干聊天回合后或在特定真实世界时间后发生改变。这对于实现技能冷却、临时效果或时间敏感的事件非常有用。
*   **高级列表管理：** 轻松地向列表中添加、移除或删除项目。无论是简单的项目列表（如物品名称），还是复杂的对象列表（如包含各自属性的 NPC 名单），都能轻松处理。
*   **自包含设计：** SAM 没有外部依赖，并将所有状态都保存在你的聊天记录中。**俺寻思能跑！**。

## 工作原理

SAM 的工作方式是在每条 AI 的消息中嵌入一个隐藏的 JSON 数据块。这个数据块由 `<!--<|state|>` 和 `</|state|>-->` 标记，包含了在该对话时间点上世界的完整“状态”。

当 AI 生成一条包含 SAM 指令（如 `<SET :: ...>`）的新消息时，脚本会执行以下操作：
1.  它会读取**上一条** AI 消息中的状态块。
2.  它将新指令应用到该状态上。
3.  它将一个全新的、已更新的状态块写入到**新的** AI 消息中。

这样就创建了一个不间断的状态链，确保数据永远不会丢失。

## 快速入门：初始化

要使用 SAM，你必须在**对话的第一条 AI 消息中“初始化”状态**。

1.  **安装脚本：** 复制 `SAM.js` 的代码，并将其粘贴到你 SillyTavern `public/extensions` 文件夹下的一个新文件中，例如命名为 `SAM.js`。然后在扩展面板中激活它。
2.  **开始新对话：** 与你的角色创建一个新的聊天。
3.  **编辑第一条消息：** 编辑角色的第一句问候语。在消息的末尾，添加初始状态块。

这是一个你可以直接使用的模板，它为一个简单的 RPG 冒险创建了基础状态。

```html
你好！我是你的游戏主持人。我们的冒险即将开始，你准备好了吗？

<!--<|state|>
{
  "static": {
    "player": {
      "name": "阿伟",
      "hp": 100,
      "max_hp": 100,
      "status": "健康"
    },
    "inventory": [],
    "gold": 50,
    "world": {
      "day": 1,
      "weather": "晴朗"
    }
  },
  "volatile": [],
  "responseSummary": []
}
</|state|>-->
```

现在，你就可以在提示词、角色卡、作者笔记等地方使用这些变量了。
*   `你当前的生命值是 {{static.player.hp}}。`
*   `你拥有 {{static.gold}} 枚金币。`
*   `今天的天气是 {{static.world.weather}}。`

## 状态对象详解

状态是一个包含三个主要键的 JSON 对象：

*   `"static"`: 这是你 99% 的变量存放的地方。这些是持久化数值，只有在指令明确修改它们时才会改变。你可以根据需要进行深度嵌套（例如 `player.stats.strength`）。
*   `"volatile"`: 这是一个由 `<TIMED_SET>` 指令创建的待处理定时事件列表。通常你不需要直接与它交互。
*   `"responseSummary"`: 一个由 `<RESPONSE_SUMMARY>` 指令添加的字符串列表，用于记录每次 AI 响应中的关键事件摘要。

## 指令参考

你需要引导你的 AI 在其回复中使用这些指令来修改状态。

---

### `<SET :: 变量路径 :: 值>`

将一个变量设置为特定的值。如果变量不存在，它将被创建。

*   **`变量路径`**: 你想设置的变量名，使用点（.）表示法来访问嵌套对象。
*   **`值`**: 新的数值。数字将被存储为数字类型，其他所有内容都将作为字符串存储。

**示例：**
玩家受到了10点伤害。
`<SET :: player.hp :: 90>`

天气变了。
`<SET :: world.weather :: 雨天>`

---

### `<ADD :: 变量路径 :: 值>`

有两个功能：为一个数值变量增加一个数字，或者向一个列表（数组）中添加一个项目。

**1. 用于数字：**
*   **`变量路径`**: 指向一个数值变量的路径。
*   **`值`**: 要增加的数字。使用负数来表示减少。

**示例：**
玩家找到了15枚金币。
`<ADD :: gold :: 15>`

玩家花了5枚金币。
`<ADD :: gold :: -5>`

**2. 用于列表：**
*   **`变量路径`**: 指向一个列表/数组的路径。
*   **`值`**: 要添加到列表末尾的项目。

**示例：**
玩家捡到了一把钥匙。
`<ADD :: inventory :: 生锈的钥匙>`

---

### `<DEL :: 列表路径 :: 索引>`

通过项目在列表中的数字位置（索引）来删除它。列表的第一个项目索引为 `0`。

*   **`列表路径`**: 指向列表/数组的路径。
*   **`索引`**: 要删除的项目的数字位置。

**示例：**
玩家使用了他们物品栏中的第一个物品。
`<DEL :: inventory :: 0>`

---

### `<REMOVE :: 列表路径 :: 属性 :: 值>`

这是一个强大的指令，用于从一个**对象列表**中移除其属性与特定值匹配的项目。这对于管理那些本身就是对象的物品库存非常有用。

*   **`列表路径`**: 指向对象列表的路径。
*   **`属性`**: 要检查的对象内部的键名。
*   **`值`**: 要匹配的值。任何满足 `项目[属性] == 值` 的对象都将被移除。

**示例：**
假设你的 `inventory` 如下所示: `[{"name": "治疗药水", "amount": 1}, {"name": "长剑", "amount": 1}]`

要移除 "治疗药水":
`<REMOVE :: inventory :: name :: 治疗药水>`

---

### `<TIMED_SET :: 路径 :: 值 :: 理由 :: 是否游戏时间 :: 时间单位>`

安排一个 `<SET>` 指令在未来执行。

*   **`路径`**: 要设置的变量。
*   **`值`**: 要设置成的值。
*   **`理由`**: 这个计时器的唯一名称，用于取消操作。
*   **`是否游戏时间`**: `false` 表示基于回合，`true` 表示基于真实世界时间。
*   **`时间单位`**:
    *   如果 `是否游戏时间` 是 `false`，这里是需要等待的**聊天回合数**。
    *   如果 `是否游戏时间` 是 `true`，这里是事件触发的完整 ISO 日期字符串（例如 `2024-12-31T23:59:59.000Z`）。这个功能比较复杂，通常不常用。

**示例 (基于回合)：**
玩家中毒了，将在3个回合后恢复。
`<SET :: player.status :: 中毒>`
`<TIMED_SET :: player.status :: 健康 :: 毒效消失 :: false :: 3>`

---

### `<CANCEL_SET :: 标识符>`

取消一个待处理的 `TIMED_SET` 事件。

*   **`标识符`**: 你想要取消的 `TIMED_SET` 的 `理由` 或 `路径`。

**示例：**
玩家喝下了解毒剂，在计时器到期前取消了“毒效消失”事件。
`<CANCEL_SET :: 毒效消失>`

---

### `<RESPONSE_SUMMARY :: 文本>`

向 `responseSummary` 列表中添加一条对 AI 回应的简短摘要。

*   **`文本`**: 要添加的摘要内容。

**示例：**
`<RESPONSE_SUMMARY :: 玩家击败了哥布林并找到了10枚金币。>`

## 常见问题解答

*   **我的变量没有更新！**
    检查 AI 的最后一条消息。编辑它并查看 `<!--<|state|>...` 数据块。很可能它的 JSON 格式是无效的。使用一个在线的“JSON 校验器”来找到错误（通常是缺少逗号或引号）并修复它。
*   **脚本好像没有运行。**
    打开你的浏览器开发者控制台（按 F12 键），检查是否有任何以 `[Situational Awareness Manager]` 开头的错误信息。




# Situational Awareness Manager (SAM) for SillyTavern

SAM is a robust and safe state management script for SillyTavern. It allows you to create dynamic, stateful characters and roleplays by giving the AI a simple, declarative language to track variables, manage lists, and trigger timed events.

This system is designed to be **safe, predictable, and transparent**. The entire state of your world is stored directly (but hidden) in the chat log, ensuring perfect recall and consistency when you load, edit, or swipe messages.

## Key Features

*   **Persistent State:** Track any value you can imagine—player stats, inventory, relationship scores, world state, quest flags—and use them in your prompts with SillyTavern's `{{...}}` syntax.
*   **Safe by Design:** The AI can only use a small, predefined set of safe commands. There is no risk of code injection or state corruption from a malformed response.
*   **Timed Events:** Schedule variables to change after a certain number of chat turns or after a specific real-world time. Perfect for cooldowns, temporary effects, or time-sensitive events.
*   **Advanced List Management:** Easily add, remove, or delete items from lists, whether they are simple lists (like an inventory of strings) or complex lists of objects (like a roster of NPCs with their own stats).
*   **Self-Contained:** SAM has no external dependencies and keeps the state within your chat history. It just works.

## How It Works

SAM works by embedding a hidden block of JSON data inside each AI message. This block, marked by `<!--<|state|>` and `</|state|>-->`, contains the complete "state" of the world at that point in the conversation.

When the AI generates a new message containing SAM commands (like `<SET :: ...>`), the script does the following:
1.  It reads the state block from the *previous* AI message.
2.  It applies the new commands to that state.
3.  It writes a new, updated state block into the *new* AI message.

This creates an unbroken chain of state, ensuring data is never lost.

## Getting Started: Initialization

To use SAM, you must "initialize" the state in the **first AI message of the chat**.

1.  **Install the Script:** Copy the `SAM.js` code and paste it into a new file in your SillyTavern `public/extensions` folder. Give it a name like `SAM.js`. Activate it in the extensions panel.
2.  **Start a New Chat:** Create a new chat with your character.
3.  **Edit the First Message:** Edit the character's very first greeting message. At the end of the message, add the initial state block.

Here is a template you can use. This creates a basic state for a simple RPG adventure.

```html
Hello! I am the Game Master. Our adventure is about to begin. Are you ready?

<!--<|state|>
{
  "static": {
    "player": {
      "name": "Alex",
      "hp": 100,
      "max_hp": 100,
      "status": "Healthy"
    },
    "inventory": [],
    "gold": 50,
    "world": {
      "day": 1,
      "weather": "Sunny"
    }
  },
  "volatile": [],
  "responseSummary": []
}
</|state|>-->
```

Now, you can use these variables in your prompts, Character Card, Author's Note, etc.
*   `Your current health is {{static.player.hp}}.`
*   `You have {{static.gold}} gold.`
*   `The weather is currently {{static.world.weather}}. `

## The State Object

The state is a JSON object with three main keys:

*   `"static"`: This is where 99% of your variables will live. These are persistent values that only change when a command explicitly modifies them. You can nest objects as deeply as you need (e.g., `player.stats.strength`).
*   `"volatile"`: This is a list of pending timed events created by the `<TIMED_SET>` command. You generally won't interact with this directly.
*   `"responseSummary"`: A simple list of strings added by the `<RESPONSE_SUMMARY>` command, useful for keeping track of the key events in each AI response.

## Command Reference

Instruct your AI to use these commands in its responses to modify the state.

---

### `<SET :: path.to.var :: value>`

Sets a variable to a specific value. If the variable doesn't exist, it will be created.

*   **`path.to.var`**: The name of the variable you want to set, using dot notation for nested objects.
*   **`value`**: The new value. Numbers will be stored as numbers, everything else as a string.

**Example:**
The player takes 10 damage.
`<SET :: player.hp :: 90>`

The weather changes.
`<SET :: world.weather :: Rainy>`

---

### `<ADD :: path.to.var :: value>`

Has two functions: adds a number to a numerical variable, or adds an item to a list (array).

**1. For Numbers:**
*   **`path.to.var`**: The path to a numerical variable.
*   **`value`**: The number to add. Use a negative number to subtract.

**Example:**
The player finds 15 gold.
`<ADD :: gold :: 15>`

The player spends 5 gold.
`<ADD :: gold :: -5>`

**2. For Lists:**
*   **`path.to.var`**: The path to a list/array.
*   **`value`**: The item to add to the end of the list.

**Example:**
The player picks up a key.
`<ADD :: inventory :: Rusty Key>`

---

### `<DEL :: list_path :: index>`

Deletes an item from a list by its numerical position (index). The first item is index `0`.

*   **`list_path`**: The path to the list/array.
*   **`index`**: The numerical position of the item to delete.

**Example:**
The player uses the first item in their inventory.
`<DEL :: inventory :: 0>`

---

### `<REMOVE :: list_path :: property :: value>`

A powerful command for removing item(s) from a list of *objects* where a property matches a certain value. This is perfect for inventories where items are objects.

*   **`list_path`**: The path to the list of objects.
*   **`property`**: The name of the key inside the objects to check.
*   **`value`**: The value to match. Any object where `item[property] == value` will be removed.

**Example:**
Assume your `inventory` looks like this: `[{"name": "Health Potion", "amount": 1}, {"name": "Sword", "amount": 1}]`

To remove the "Health Potion":
`<REMOVE :: inventory :: name :: Health Potion>`

---

### `<TIMED_SET :: path :: value :: reason :: isGameTime :: timeUnits>`

Schedules a `<SET>` command to run in the future.

*   **`path`**: The variable to set.
*   **`value`**: The value to set it to.
*   **`reason`**: A unique name for this timer, used for cancellation.
*   **`isGameTime`**: `false` for turn-based, `true` for real-world time.
*   **`timeUnits`**:
    *   If `isGameTime` is `false`, this is the number of **chat turns** to wait.
    *   If `isGameTime` is `true`, this is the full ISO date string for when it should trigger (e.g., `2024-12-31T23:59:59.000Z`). This is complex and usually not needed.

**Example (Turn-based):**
The player is poisoned and will be cured in 3 turns.
`<SET :: player.status :: Poisoned>`
`<TIMED_SET :: player.status :: Healthy :: Poison Wears Off :: false :: 3>`

---

### `<CANCEL_SET :: identifier>`

Cancels a pending `TIMED_SET` event.

*   **`identifier`**: The `reason` or `path` of the `TIMED_SET` you want to cancel.

**Example:**
The player drinks an antidote, which cancels the "Poison Wears Off" timer before it runs out.
`<CANCEL_SET :: Poison Wears Off>`

---

### `<RESPONSE_SUMMARY :: text>`

Adds a brief summary of the AI's response to the `responseSummary` list.

*   **`text`**: The summary to add.

**Example:**
`<RESPONSE_SUMMARY :: Player defeated the goblin and found 10 gold.>`

## Troubleshooting

*   **My variables aren't updating!** Check the AI's last message. Edit it and look at the `<!--<|state|>...` block. It is likely invalid JSON. Use a JSON validator to find the error (usually a missing comma or quote) and fix it.
*   **The script doesn't seem to be running.** Open your browser's developer console (F12) and check for any errors prefixed with `[Situational Awareness Manager]`.<ctrl63>
