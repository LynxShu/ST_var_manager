# 🌟 SillyTavern SAMU 状态感知管理器

Situational Awareness Manager Unofficial

- **当前版本:** 0.0.5 beta / **项目地址:** [LynxShu/st_samu](https://github.com/LynxShu/st_samu)

- 提示词和数据结构仍在编写中...不慌不慌


## 📄 核心理念与声明

本项目是 **Situational Awareness Manager (SAM)** 的一个非官方分支 (unofficial fork)，内部代号 **SAMU**。

*   **原始项目 (SAM):** [DefinitelyNotProcrastinating/ST_var_manager](https://github.com/DefinitelyNotProcrastinating/ST_var_manager)
*   **原作者 (Originally Created By):** DefinitelyNotProcrastinating
*   **所有核心概念和架构均归功于原作者**

SAMU 的诞生并非为了改进或增强原版 SAM ，~~因为我非常的菜~~ 而是为了**适配一套特定的、基于世界书（WI）的通用角色卡框架**。在这个框架下，AI 可以根据**预设的全套提示词**自动生成所有世界书条目和初始状态及动态 UI 。

### ⚠️ 重要提示

如果您的需求是构建一个高度定制化、独立的游戏系统，或者您需要将 SAM 与其他复杂的 JS 脚本一同使用，我们**强烈推荐您使用原版 SAM** ，因为它提供了更强的健壮性和数据隔离性。SAMU 更专注于在我们的特定框架内提供无缝的开箱即用体验。


## ⚙️ 系统架构

SAMU Beta 的系统由三大核心部件构成，它们像一套分工明确的硬件，协同工作。

*   **`samu.js` (主引擎)**:

    *   **职责**: 解析AI生成的所有指令 (`<SET>`, `<ADD>`等)、管理`state`对象、响应用户在UI上的操作。它是系统的**命令执行中心**。

    *   `applyCommandsToState`函数实现了一个**“动态任务队列”。当它执行一条指令（如`<EVAL>`）时，该指令可以返回一个**新的指令列表**，这个列表会被无缝地添加到当前任务队列的末尾继续执行。这使得“一个指令触发一连串新指令”的复杂自动化逻辑成为可能。

*   **`samu_ext_lib.js` (自动化引擎)**:

    *   **职责**: 专门处理时间流逝和复杂的条件判断，是所有“自动化”功能的核心。它本身不执行指令，而是像一个顾问，把计算和判断的结果（即一个“待办指令列表”）返回给主引擎去执行。

    *   **核心服务**: 通过`<EVAL :: advanceTimeAndUpdateStatus :: '1h'>`指令被主引擎调用，提供三种自动化模式。

*   **`世界书条目/规则蓝图`**:

    *   **职责**: 这是用户定义世界规则、角色状态和物品模板的地方。自动化引擎会读取这些文件中的`rules`字段，来决定如何行动。
    
    *   **核心文件**: 角色卡、世界书（WI）等都是规则蓝图的具体体现。

## ⚙️ 数据结构与路径

**重要提示**: 所有状态路径都位于 `SAM_data` 对象下。在 UI 或脚本中引用时，请确保添加 `SAM_data.` 前缀。例如：`{{SAM_data.character.player.name}}`。

### **数据类型定义 (Type Definitions)**

**正在重构......为了防止 AI 混淆指令....**

<del>

这是在我们的框架中推荐使用的标准数据对象类型。在使用 `ADD` 指令添加新元素时，应尽量保持字段完整，以确保AI能够正确理解和操作。

*   **`char`**: 游戏角色。
    *   *推荐字段*: `{key, name, type, gender, summary}`
*   **`item`**: 游戏物品。
    *   *推荐字段*: `{key, name, type, desc, count}`
*   **`state`**: 简单状态,如生物的属性、身体状态。
    *   *推荐字段*: `{key, name, type, value}`
*   **`leveled`**: 可成长项,如技能、特殊状态。
    *   *推荐字段*: `{key, name, type, current_exp, current_level}`
*   **`plot`**: 剧情或任务。
    *   *推荐字段*: `{key, name, type, required, value}`
*   **`combat`**: 特殊统计类型,如战斗力、角色实力。
    *   *推荐字段*: `{key, name, type, value}`

</del>

---

### **核心状态路径 (Core State Paths)**

以下是基于 SAMU 的 `state` 对象内标准数据访问路径约定（注意！未来不排除硬编码！）。

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

| 指令               | 语法                                                              | 简述                                       |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------ |
| **SET**            | `<SET :: path :: new_value>`                                      | 修改一个已存在的数据值。                   |
| **ADD**            | `<ADD :: path :: value_or_object>`                                | 变更数值，或向列表中添加一个新项目。       |
| **REMOVE**         | `<REMOVE :: list_path :: identifier :: target_id :: count>`       | 根据内容的标识从列表中移除一个或多个项目。 |
| **DEL**            | `<DEL :: list_path :: index_number>`                              | 根据位置索引从列表中移除一个项目。         |
| **TIMED_SET**      | `<TIMED_SET :: path :: value :: reason :: is_real_time? :: time>` | 安排一个未来的状态变更。                   |
| **CANCEL_SET**     | `<CANCEL_SET :: identifier>`                                      | 取消一个已安排的`TIMED_SET`。                |
| **RESPONSE_SUMMARY** | `<RESPONSE_SUMMARY :: text>`                                    | 记录本次回应的关键事件摘要。               |
| **EVAL**           | `<EVAL :: func_name :: params...>`                                | **(高风险)** 执行一个预定义的JS函数。      |

本模块详细定义了用于管理游戏状态的全部有效指令。所有指令都必须被包裹在 `<...>` 符号中，并严格遵循其语法。

**重要**: 指令内部的路径 **不应** 包含 `SAM_data.` 前缀。脚本会自动在 `SAM_data` 状态对象内部进行操作。

---

### **核心数据操作指令**

#### 指令: SET
- **概述**: 修改一个`已存在`的数据值。
- **核心用途**: 改变角色属性、世界状态等已经存在的值。它执行的是`覆盖`操作。
- **绝对禁止**: 禁止使用`SET`向列表中添加新的对象。这是`ADD`的职责。
- **语法**: `<SET :: path :: new_value>`
- **示例**:
  - 更新玩家力量: `<SET :: character.player.attr.strength.value :: 15>`
  - 更改天气状况: `<SET :: world.environment.weather :: "暴雨">`
  - 标记任务完成: `<SET :: plot.main_quest_01.value :: "completed">`
- **注解**：
  - 区分了与 `ADD` 的逻辑，`SET` 只能被允许修改`已存在`的数据。

#### 指令: ADD
- **概述**: `变更数值`,或向列表中`添加一个全新的项目`。
- **核心用途**: 变更数值、创造一个全新的物品、赋予角色一个新状态或技能等。
- **数据完整性**: 添加新项目时,必须提供一个`完整的对象`（参考`数据类型定义 (Type Definitions)`）。
- **自动堆叠**: 如果向一个列表中添加一个带`"key"`和`"count"`属性的对象,且列表中已存在相同`key`的对象,脚本会自动将它们的`count`相加,而不是添加一个重复的新对象。
- **语法**:
  - 变更数值: `<ADD :: path :: value_to_add>`
  - 添加新项目: `<ADD :: path :: complete_object_JSON>`
- **示例**:
  - 增加力量经验值: `<ADD :: character.player.attr.strength.current_exp :: 10>`
  - 添加"中毒"状态: `<ADD :: character.player.splst :: {"key": "status_poisoned", "name": "中毒", "type": "state", "value": "持续伤害"}>`
  - 添加一把剑: `<ADD :: character.player.inventory :: {"key": "sword_common", "name": "普通的剑", "type": "item", "desc": "一把标准的单手剑。", "count": 1}>`
- **注解**：
  - `ADD` 只管添加，根据我们的`数据类型定义`去进行`数值变更`或者将一个`完整对象`（预设及新创造的）添加进路径中，`完整的对象`是后续 AI 根据 `KEY` 执行任何指令或者供 `UI` 调用的基石。

#### 指令: REMOVE
- **概述**: 根据项目的`content identifier`来移除列表中的项目。
- **核心用途**: 当你需要消耗、丢弃或移除一个`内容已知`的物品或状态时使用。将`count`设为`0`为移除所有匹配项。
- **智能数量处理**: 如果匹配到的项目拥有`"count"`属性,此指令会优先减少其数量,而不是直接移除整个对象。只有当`count`减至`0`或更少时,对象才会被彻底移除。
- **语法**: `<REMOVE :: list_path :: identifier :: target_id :: count>`
  - `list_path`: 目标列表的路径, 如 `character.player.inventory`。
  - `identifier`: 用于匹配的`键`名, 通常是 `key`。
  - `target_id`: 要匹配的`值`, 如 `"potion_health_small"`。
  - `count`: 移除的数量。
- **示例**:
  - 消耗`1`个药水: `<REMOVE :: character.player.inventory :: key :: "potion_health_small" :: 1>`
  - 丢弃`2`把匕首: `<REMOVE :: character.player.inventory :: key :: "dagger_iron" :: 2>`
  - "中毒"状态消失 (移除所有): `<REMOVE :: character.player.splst :: key :: "status_poisoned" :: 0>`
- **注解**：
  - 为什么这么改，首先是杜绝 `幽灵对象`，还有提升精度，所有的对象都将以 `唯一KEY` 的形式存在与变量管理器中，能精确就绝对不要让 **智力随缘的 AI** 去靠脑子使用 `DEL`。

#### 指令: DEL
- **概述**: 根据项目在列表中的`positional index`来移除项目。
- **核心用途**: 当你需要移除列表中`第几个`项目时使用。这是一个备用选项，**强烈建议优先使用 `REMOVE`**。
- **语法**: `<DEL :: list_path :: index_number>`
- **注意**: 位置编号从`0`开始 (0是第1个, 1是第2个)。
- **示例**:
  - 移除背包中的第`1`个物品: `<DEL :: character.player.inventory :: 0>`
  - 移除状态列表中的第`3`个状态: `<DEL :: character.player.splst :: 2>`
- **注解**：
  - emmmm.... `DEL` 有它存在的意义。


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
  - **模式二: 移除对象 (智能)**: 当你需要定时移除列表中的一个对象时, `path` 应指向那个**完整的对象**，并将 `new_value` 设置为 `null`。脚本会自动将其转换为一个`REMOVE`指令。
    - *示例 (回合)*: 3回合后, "力量祝福" 效果(`buff_strength`)被移除。这里的 `path` 指向的是`buff_strength`对象本身，而不是包含它的`splst`列表。
      `<TIMED_SET :: character.player.splst.buff_strength :: null :: "player_strength_buff" :: false :: 3>`
- **注解**：
  - 看说明是有点复杂了，完了会预置到提示词里....嗯...


#### 指令: CANCEL_SET
- **概述**: 取消一个已安排的`TIMED_SET`。
- **核心用途**: 可通过`TIMED_SET`指令中设置的唯一`reason`或其`path`来精确匹配并取消。
- **语法**: `<CANCEL_SET :: identifier>`
  - `identifier` 可以是 `reason` 字符串或 `path` 字符串。
- **示例**:
  - `<CANCEL_SET :: "player_strength_buff">`
  - `<CANCEL_SET :: "character.player.splst.buff_strength">`
- **注解**：
  - 预置提示词中仅允许使用 `reason` ，即 `唯一标识符`。

---

### **摘要与代码执行指令**

#### 指令: RESPONSE_SUMMARY
- **概述**: 记录本次回应中发生的最重要的事件，用于上下文记忆。
- **语法**: `<RESPONSE_SUMMARY :: text>`
- **示例**: `<RESPONSE_SUMMARY :: 玩家击败了哥布林,获得了生命药水和剑术经验,但失去了战意高昂状态.>`

#### 指令: EVAL
- **概述**: 执行一个预定义在`state.func`或`window.SAMU_Logic_Library`中的沙盒化JavaScript函数。
- **语法**: `<EVAL :: func_name :: param1 :: param2...>`
- **核心用途**: **`EVAL`是驱动整个自动化系统的引擎点火器。** AI在每次回复的末尾，都应包含一条`<EVAL :: advanceTimeAndUpdateStatus :: '1h'>`（或其他时间增量）指令，以推进世界时间并触发所有自动化规则。

**⚠️ 安全警告**: 此命令具有高风险性，它允许AI在您的浏览器环境中执行代码。除非您完全理解其工作原理和潜在风险，否则**绝对不要使用**。**对于因使用此功能造成的任何问题，脚本作者概不负责。**

---

### 工作流：如何创造一个“活”的状态

在 SAMU Beta 中，创造一个自动化状态遵循一个流程。

#### 第一步: 定义模板

你需要在你的世界中，为这个状态创建一个“图纸”或“模板”。这个模板本身不生效，是供AI在游戏中复制和使用的。

###### 模板类型一：周期性状态 (Cyclic)

用于创建基于固定周期（天、星期、月）循环触发的状态。

```yaml
- key: "monthly_salary"
  name: "月度薪水"
  type: "automated"
  desc: "每月初自动发放薪水"
  value: 0
  rules:
    time_based_update:
      mode: "cyclic"
      cases:
        - condition: "day === 1" # 月份的第1天
          set_value: 5000
      default: 0
```

###### 模板类型二：线性临时状态 (Linear)

用于处理**临时性、有持续时间的状态**（如中毒、燃烧、属性增益Buff等）。

```yaml
# 这是一个“中毒”状态的“模板”或“图纸”
- key: "poison_debuff_template"
  name: "中毒"
  type: "automated"
  desc: "毒素在体内蔓延，持续造成影响。"
  value: "潜伏期"
  start_date: null # 计时器字段
  rules:
    time_based_update:
      mode: "linear"
      trigger_field: "start_date" # 引用自身内部的计时器
      stages:
        - condition: "progress_days <= 1"
          set_value: "潜伏期"
        - condition: "progress_days > 1 && progress_days <= 3"
          set_value: "发作期"
        - condition: "progress_days > 3"
          set_value: "衰弱期"
```

###### 模板类型三：事件驱动状态

用于定义“如果A发生，就自动执行B”的逻辑。**注意：这类规则通常不作为独立的模板存在，而是直接写在某个常驻的核心状态（如`vitals`）上。**

```yaml
# 定义在角色卡或WI文件中的 vitals 状态
- key: "vitals"
  name: "生命体征"
  type: "basic"
  desc: "角色的核心生命指标，包含驱动自动逻辑的规则。"
  health: 100 # 当前生命值
  health_max: 100 # 最大生命值
  rules:
    event_driven_update:
      events:
        - name: "生命值低于25%时触发狂怒"
          condition: |
            _.get(character, 'vitals.health') < (_.get(character, 'vitals.health_max') * 0.25) &&
            !_.some(_.get(character, 'splst'), {key: 'berserk_rage_buff'})
          actions:
            - command: "ADD"
              path: "splst"
              value: { "key": "berserk_rage_buff", "name": "狂怒", "type": "basic", "desc": "攻击力大幅提升", "value": "激活" }
        
        - name: "生命值恢复后移除狂怒"
          condition: |
            _.get(character, 'vitals.health') >= (_.get(character, 'vitals.health_max') * 0.25) &&
            _.some(_.get(character, 'splst'), {key: 'berserk_rage_buff'})
          actions:
            - command: "REMOVE"
              path: "splst"
              extra_params: ["key", "berserk_rage_buff", 1]
```

#### 第二步: AI动态应用

当故事中发生特定事件时，AI不再需要自己计算，而是调用相应的指令来应用状态。

*   **对于`Linear`状态 (中毒)**: AI使用`ADD`指令，复制模板，填入当前时间，然后添加到角色身上。
    `<ADD :: character.Elise.splst :: {"key":"poison_debuff_active_4g8d","name":"中毒", ... ,"start_date":"{{world.time}}", ...}>`

*   **对于`Event-Driven`状态 (狂怒)**: AI只需要正常地改变角色的生命值即可。
    `<ADD :: character.Elise.vitals.health :: -50>`

#### 第三步: 引擎自动处理

在AI的每次回复结尾，它必须包含一条指令：

*   `<EVAL :: advanceTimeAndUpdateStatus :: '1h'>` #时间流逝

当主引擎执行这条指令时：

1.  `samu_ext_lib.js` 被激活。

2.  世界时间推进`1`小时。

3.  自动化引擎扫描所有角色的所有状态。

    *   它会发现`Elise`身上的中毒状态，并根据`start_date`和`stages`更新其`.value`。

    *   它会检查`Elise`的`vitals`状态，发现生命值低于25%，于是**生成一个`ADD`指令**，并返回给主引擎。

4.  主引擎的动态任务队列接收到这个新的`ADD`指令，并立即执行，成功为`Elise`添加了“狂怒”buff。

---

## 🛠️ SAMU通用角色卡与开局场景/变量/UI自动生成提示词

*(此部分内容正在编写中，请等待哔哩哔-哔哩-的介绍视频。)*

## 🧾 许可证 (License)

本项目沿用原项目的许可证。详情请参阅 `LICENSE` 文件。
