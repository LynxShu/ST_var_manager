# 🌟 SillyTavern SAMU 状态感知管理器

Situational Awareness Manager Unofficial

- **当前版本:** 0.0.3 (beta) / **项目地址:** [LynxShu/st_samu](https://github.com/LynxShu/st_samu)

- 正在重构 `Type Definitions` 和 `预置函数库`，不慌不慌... 我一直在纠结这个`EVAL`要不要写进`预置提示词`，但是真他娘的好用啊！！！所以我打算先搞一套`预置函数库`。


## 📄 核心理念与声明 (Core Concept & Disclaimer)

本项目是 **Situational Awareness Manager (SAM)** 的一个非官方分支 (unofficial fork)，内部代号 **SAMU**。

*   **原始项目 (SAM):** [DefinitelyNotProcrastinating/ST_var_manager](https://github.com/DefinitelyNotProcrastinating/ST_var_manager)
*   **原作者 (Originally Created By):** DefinitelyNotProcrastinating
*   **所有核心概念和基础架构均归功于原作者**

SAMU 的诞生并非为了改进或增强原版 SAM ，~~因为我非常的菜~~ 而是为了**适配一套特定的、基于世界书（WI）的通用角色卡框架**。在这个框架下，AI 可以根据**预设的全套提示词**自动生成所有世界书条目和初始状态及动态 UI 。

### ⚠️ 重要提示

如果您的需求是构建一个高度定制化、独立的游戏系统，或者您需要将 SAM 与其他复杂的 JS 脚本一同使用，我们**强烈推荐您使用原版 SAM** ，因为它提供了更强的健壮性和数据隔离性。SAMU 更专注于在我们的特定框架内提供无缝的开箱即用体验。

## ⚙️ 数据结构与路径 (Data Structure & Paths)

**重要提示**: 所有状态路径都位于 `SAM_data` 对象下。在 UI 或脚本中引用时，请确保添加 `SAM_data.` 前缀。例如：`{{SAM_data.character.player.name}}`。

正在重构......为了防止 AI 混淆指令，我打算重构类型定义，让 AI 无脑按格式加载命令... 

<del>
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

</del>

## ⌨️ 指令参考 (Command Reference)

| 指令               | 语法                                                              | 简述                                       |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------ |
| **SET**            | `<SET :: path :: new_value>`                                      | 修改一个已存在的数据值。                   |
| **ADD**            | `<ADD :: path :: value_or_object>`                                | 变更数值，或向列表中添加一个新项目。       |
| **REMOVE**         | `<REMOVE :: path :: key :: key_to_match :: count>`                | 根据内容的key从列表中移除一个或多个项目。  |
| **DEL**            | `<DEL :: path :: index_number>`                                   | 根据位置索引从列表中移除一个项目。         |
| **TIMED_SET**      | `<TIMED_SET :: path :: value :: reason :: is_real_time? :: time>` | 安排一个未来的状态变更。                   |
| **CANCEL_SET**     | `<CANCEL_SET :: reason>`                                          | 取消一个已安排的`TIMED_SET`。                |
| **RESPONSE_SUMMARY** | `<RESPONSE_SUMMARY :: text>`                                    | 记录本次回应的关键事件摘要。               |
| **EVAL**           | `<EVAL :: func_name :: params...>`                                | **(高风险)** 执行一个预定义的JS函数。      |

本模块详细定义了用于管理游戏状态的全部有效指令。所有指令都必须被包裹在 `<...>` 符号中，并严格遵循其语法。

**重要**: 指令内部的路径 **不应** 包含 `SAM_data.` 前缀。脚本会自动在 `SAM_data` 状态对象内部进行操作。

---

### **核心数据操作指令**

#### 指令: SET
- **概述**: 修改一个`已存在`的数据值。
- **核心用途**: 改变角色属性、世界状态等已经存在的值。
- **绝对禁止**: 禁止使用`SET`向列表中添加新的对象。这是`ADD`的职责。
- **语法**: `<SET :: path :: new_value>`
- **示例**:
  - 更新玩家力量: `<SET :: character.player.attr.strength.value :: 15>`
  - 更改天气状况: `<SET :: world.environment.weather :: "暴雨">`
  - 标记任务完成: `<SET :: plot.main_quest_01.value :: "completed">`

#### 指令: ADD
- **概述**: `变更数值`,或向列表中`添加一个全新的项目`。
- **核心用途**: 变更数值、创造一个全新的物品、赋予角色一个新状态或技能等。
- **数据完整性**: 添加新项目时,必须提供一个`完整的对象`。
- **自动堆叠**: 如果向一个列表中添加一个带`"key"`和`"count"`属性的对象,且列表中已存在相同`key`的对象,脚本会自动将它们的`count`相加,而不是添加一个重复的新对象。
- **语法**:
  - 变更数值: `<ADD :: path :: value_to_add>`
  - 添加新项目: `<ADD :: path :: complete_object_JSON>`
- **示例**:
  - 增加力量经验值: `<ADD :: character.player.attr.strength.current_exp :: 10>`
  - 添加"中毒"状态: `<ADD :: character.player.splst :: {"key": "status_poisoned", "name": "中毒", "type": "state", "value": "持续伤害"}>`
  - 添加一把剑: `<ADD :: character.player.inventory :: {"key": "sword_common", "name": "普通的剑", "type": "item", "desc": "一把标准的单手剑。", "count": 1}>`

#### 指令: REMOVE
- **概述**: 根据项目的`content identifier(key)`来移除列表中的项目。
- **核心用途**: 当你需要消耗、丢弃或移除一个`内容已知`的物品或状态时使用。将`count`设为`0`为移除所有匹配项。
- **智能数量处理**: 如果匹配到的项目拥有`"count"`属性,此指令会优先减少其数量,而不是直接移除整个对象。只有当`count`减至`0`或更少时,对象才会被彻底移除。
- **语法**: `<REMOVE :: path :: key :: key_to_match :: count>`
- **示例**:
  - 消耗`1`个药水: `<REMOVE :: character.player.inventory :: key :: "potion_health_small" :: 1>`
  - 丢弃`2`把匕首: `<REMOVE :: character.player.inventory :: key :: "dagger_iron" :: 2>`
  - "中毒"状态消失 (移除所有): `<REMOVE :: character.player.splst :: key :: "status_poisoned" :: 0>`

#### 指令: DEL
- **概述**: 根据项目在列表中的`positional index`来移除项目。
- **核心用途**: 当你需要移除列表中`第几个`项目时使用。这是一个备用选项，**强烈建议优先使用 `REMOVE`**。
- **语法**: `<DEL :: path :: index_number>`
- **注意**: 位置编号从`0`开始 (0是第1个, 1是第2个)。
- **示例**:
  - 移除背包中的第`1`个物品: `<DEL :: character.player.inventory :: 0>`
  - 移除状态列表中的第`3`个状态: `<DEL :: character.player.splst :: 2>`

---

### **定时与计划指令**

#### 指令: TIMED_SET
- **概述**: 安排一个未来的状态变更,它可以是`修改一个值`,也可以是`移除一个对象`。
- **语法**: `<TIMED_SET :: path :: new_value :: reason :: is_real_time? :: timepoint>`
- **关键参数**:
  - `reason`: 必须是一个**独一无二的字符串**,用于在之后取消它,格式通常为: `[角色key]_[效果名]`。
  - `is_real_time?` 和 `timepoint`:
    - 如果 `is_real_time?` 为 `false`, `timepoint` 则为`回合数` (一个纯数字)。
    - 如果 `is_real_time?` 为 `true`, `timepoint` 则为`完整的ISO日期字符串`(例如 `2024-12-31T23:59:59.000Z`)。
- **行为模式**:
  - **模式一: 修改值**: 当 `path` 指向具体属性时, `new_value` 是目标值。
    - *示例 (回合)*: 3回合后, 玩家力量(`strength`)的当前值(`value`)变为12。
      `<TIMED_SET :: character.player.attr.strength.value :: 12 :: "player_power_fades" :: false :: 3>`
  - **模式二: 移除对象**: 当 `path` 指向一个完整的对象时, `new_value` 必须是 `null` 。
    - *示例 (回合)*: 3回合后, "力量祝福" 效果(`buff_strength`)被移除。
      `<TIMED_SET :: character.player.splst.buff_strength :: null :: "player_strength_buff" :: false :: 3>`

#### 指令: CANCEL_SET
- **概述**: 取消一个已安排的`TIMED_SET`。
- **核心用途**: 可通过`TIMED_SET`指令中设置的唯一`reason`来精确匹配并取消。
- **语法**: `<CANCEL_SET :: reason>`
- **示例**: `<CANCEL_SET :: "player_strength_buff">`

---

### **摘要指令**

#### 指令: RESPONSE_SUMMARY
- **概述**: 记录本次回应中发生的最重要的事件，用于上下文记忆。
- **语法**: `<RESPONSE_SUMMARY :: text>`
- **示例**: `<RESPONSE_SUMMARY :: 玩家击败了哥布林,获得了生命药水和剑术经验,但失去了战意高昂状态.>`

#### 指令: EVAL
- **概述**: 执行一个预定义在`state.func`中的沙盒化JavaScript函数。
- **⚠️ 安全警告**: 此命令具有高风险性，它允许AI在您的浏览器环境中执行代码。除非您完全理解其工作原理和潜在风险，否则**绝对不要使用**。不当使用可能导致数据损坏或安全漏洞。

## 🛠️ SAMU通用角色卡与开局场景/变量/UI自动生成提示词

*(此部分内容正在编写中，请等待哔哩哔哩的介绍视频。)*

## 🧾 许可证 (License)

本项目沿用原项目的许可证。详情请参阅 `LICENSE` 文件。

