# 🌟 Situational Awareness Manager Unofficial

**当前版本:** 0.0.2 (beta) / [LynxShu 的个人分享仓库](github.com/LynxShu/lynxshu.share)

## 📄 核心理念与声明 (Core Concept & Disclaimer)

本项目是 **Situational Awareness Manager (SAM)** 的一个非官方分支 (unofficial fork)，内部代号 **SAMU**。

*   **原始项目 (SAM):** [github.com/DefinitelyNotProcrastinating/ST_var_manager](https://github.com/DefinitelyNotProcrastinating/ST_var_manager)
*   **原作者 (Originally Created By):** DefinitelyNotProcrastinating
*   **所有核心概念和基础架构均归功于原作者**

SAMU 的诞生并非为了改进或增强原版 SAM ，而是为了**适配一套特定的、基于世界书（WI）的通用角色卡框架**。在这个框架下，AI 可以根据**预设的全套提示词**自动生成所有世界书条目和初始状态及动态 UI 。

### ⚠️ 重要提示

如果您的需求是构建一个高度定制化、独立的游戏系统，或者您需要将 SAM 与其他复杂的 JS 脚本一同使用，我们**强烈推荐您使用原版 SAM** ，因为它提供了更强的健壮性和数据隔离性。SAMU 更专注于在我们的特定框架内提供无缝的开箱即用体验。

## ⚙️ 数据结构与路径 (Data Structure & Paths)

**重要提示**: 所有状态路径都位于 `SAM_data` 对象下。在 UI 或脚本中引用时，请确保添加 `SAM_data.` 前缀。例如：`{{SAM_data.character.player.name}}`。

### **数据类型定义 (Type Definitions)**

这是在我们的框架中使用的标准数据对象类型。在使用 `ADD` 指令添加新元素时，应尽量保持字段完整。

*   **`char`**: 游戏角色。
    *   *必须字段*: `{key, name, type, gender, summary}`
*   **`item`**: 游戏物品。
    *   *必须字段*: `{key, name, type, desc, count}`
*   **`state`**: 简单状态,如生物的属性、身体状态。
    *   *必须字段*: `{key, name, type, value}`
*   **`leveled`**: 可成长项,如技能、特殊状态。
    *   *必须字段*: `{key, name, type, current_exp, current_level}`
*   **`plot`**: 剧情或任务。
    *   *必须字段*: `{key, name, type, required, value}`
*   **`combat`**: 特殊统计类型,如战斗力、角色实力。
    *   *必须字段*: `{key, name, type, value}`

---

### **核心状态路径 (Core State Paths)**

以下是 `state` 对象内的标准数据访问路径。

*   **顶级路径**:
    *   `character`: 包含所有角色对象的容器。
        *   `character.player`: 特指玩家角色。
    *   `world`: 包含世界环境信息（如时间、天气、地点）。
    *   `plot`: 包含所有剧情和任务。
    *   `func`: 包含所有可执行的 `EVAL` 函数。
*   **角色子路径** (以任意角色 `[char_key]` 为例):
    *   `character.[char_key].attr`: 存放角色的核心属性 (如 `strength`, `health`)。
    *   `character.[char_key].splst`: 存放角色的特殊状态 (如 `status_poisoned`)。
    *   `character.[char_key].skills`: 存放角色的技能 (如 `sword_mastery`)。
    *   `character.[char_key].inventory`: 存放角色的物品库存列表。
    *   `character.[char_key].combat`: 存放角色的战斗力相关数值。



## ⌨️ 指令参考 (Command Reference)

所有指令都需要被包裹在 `<...>` 符号中。

**注意**: 指令内部的路径 **不应** 包含 `SAM_data.` 前缀。指令会自动在 `SAM_data` 内部进行操作。

### **核心指令**

| Command | Syntax | Description |
| :--- | :--- | :--- |
| **SET** | `<SET :: path.to.var :: value>` | **(变更)** 设定一个变量的值。对布尔、null、数字类型有更强的自动识别能力。|
| **ADD** | `<ADD :: path.to.var :: value>` | **(变更)** 核心指令。为数字变量增加数值；或向列表中添加一个元素。 |
| **REMOVE** | `<REMOVE :: path.to.var :: prop :: val :: [count]>` | **(变更)** 核心指令。从列表中移除一个或多个元素。 |
| **DEL** | `<DEL :: list_path :: index>` | 按索引删除列表中的一个项目。**（不推荐使用，请优先考虑REMOVE）** |

---

#### **`ADD` 指令详解**

`ADD` 的行为取决于目标路径和值的类型。

*   **对数字**:
    ```
    // 假设 character.player.gold.value 为 100
    <ADD :: character.player.gold.value :: 50>
    // 结果: character.player.gold.value 变为 150
    ```

*   **对列表 (可堆叠物品)**:
    当 `value` 是一个包含 `key` 和 `count` 属性的对象时，`ADD` 会尝试在列表中寻找一个拥有相同 `key` 的对象并增加其 `count`。如果找不到，则添加为新物品。
    ```
    // 假设 inventory 中已有: {"key": "potion_health", "count": 2}
    <ADD :: character.player.inventory :: {"key": "potion_health", "count": 1}>
    // 结果: inventory 中的药水变为 {"key": "potion_health", "count": 3}

    <ADD :: character.player.inventory :: {"key": "scroll_fire", "count": 1}>
    // 结果: inventory 中新增 {"key": "scroll_fire", "count": 1}
    ```

---

#### **`REMOVE` 指令详解**

`REMOVE` 同样是为游戏化场景设计的。

*   `path.to.var`: 目标列表的路径。
*   `prop`: 用于匹配的属性名（通常是 `key`）。
*   `val`: 要匹配的属性值。
*   `[count]`: (可选) 要移除的数量，默认为 `1`。如果设为 `0`，则移除所有匹配项。

*   **对可堆叠物品**:
    `REMOVE` 会优先减少物品的 `count`。只有当 `count` 减至 `0` 或更少时，才会将整个物品对象从列表中移除。
    ```
    // 假设 inventory 中有: {"key": "potion_health", "count": 5}
    <REMOVE :: character.player.inventory :: key :: "potion_health" :: 2>
    // 结果: 药水的 count 变为 3

    <REMOVE :: character.player.inventory :: key :: "potion_health" :: 5>
    // 结果: 药水对象被从 inventory 列表中完全移除
    ```
*   **对普通状态**:
    对于不含 `count` 属性的对象，`REMOVE` 会直接将其从列表中删除。
    ```
    // 假设 splst 列表中有: {"key": "status_poisoned", "name": "中毒"}
    <REMOVE :: character.player.splst :: key :: "status_poisoned">
    // 结果: "中毒"状态被从 splst 列表中移除
    ```

---

### **高级指令**

这些指令的行为与原版SAM基本一致。

| Command | Syntax | Description |
| :--- | :--- | :--- |
| **TIMED_SET**| `<TIMED_SET :: var :: val :: reason :: is_real_time? :: time>` | 安排一个未来的`SET`操作。`reason`需唯一。 |
| **CANCEL_SET**| `<CANCEL_SET :: reason>` | 通过`reason`取消一个已安排的`TIMED_SET`。 |
| **RESPONSE_SUMMARY** | `<RESPONSE_SUMMARY :: text>` | 记录本次回应的关键事件摘要。 |
| **EVAL** | `<EVAL :: func_name :: param1 :: ...>` | 执行一个预定义在`state.func`中的沙盒化JS函数。 |

### ⚠️ `EVAL` 安全警告

警告：此命令允许 AI 在您的浏览器中直接执行任意 JavaScript 代码。

这意味着它可获得权限，直接访问并操纵您的全部状态数据。请务必极度谨慎使用。仅当您完全理解其运行机制后才可操作。开发者对由此造成的任何损失、损害或安全漏洞概不负责。

## 🛠️ SAMU通用角色卡与开局场景/变量/UI自动生成提示词

*(此部分内容正在编写中，请等待哔哩哔哩的介绍视频。)*

## 🧾 许可证 (License)

本项目沿用原项目的许可证。详情请参阅 `LICENSE` 文件。