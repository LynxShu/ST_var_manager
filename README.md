# Situational Awareness Manager Unofficial

**Version:** 0.0.1 beta

**Current Maintainer:** [LynxShu](https://github.com/LynxShu)

---

## 声明 (Disclaimer)

本项目是 **Situational Awareness Manager (SAM) v2.4.0** 的一个非官方分叉 (unofficial fork)。

*   **原始项目 (SAM):** [github.com/DefinitelyNotProcrastinating/ST_var_manager](https://github.com/DefinitelyNotProcrastinating/ST_var_manager)
*   **原作者 (Originally Created By):** DefinitelyNotProcrastinating

所有核心概念和基础架构均归功于原作者。

## 指令参考 (Command Reference)

指令需要被包裹在 `<...>` 符号中。建议给所有元素指定唯一`key`，指令对`key`强依赖。

| Command | Syntax | Description |
| :--- | :--- | :--- |
| **SET** | `<SET :: path.to.var :: value>` | **(update)** Sets a variable to a value（stronger type correction capability） |
| **ADD** | `<ADD :: path.to.var :: value>` | **(update)** Adds a number to a variable, or an item to a list. If value is {key, count}, it aggregates counts for existing keys in a list. |
| **DEL** | `<DEL :: list_path :: index>` | Deletes an item from a list by its numerical index.**（Not recommended）** |
| **REMOVE** | `<REMOVE :: list_path :: prop :: value :: [count]>` | **(update)** Removes item(s) from a list where a property matches a value，The optional `count` parameter limits the number of deletions. |
| **TIMED_SET**| `<TIMED_SET :: var :: value :: reason :: is_real_time? :: time>` | Schedules a `SET` command.|
| **CANCEL_SET**| `<CANCEL_SET :: reason>` | Cancels a scheduled `TIMED_SET`. |
| **RESPONSE_SUMMARY** | `<RESPONSE_SUMMARY :: text>` | Adds a summary of the AI's response to a list. |
| **EVAL** | `<EVAL :: func_name :: param1 :: ...>` | Executes a user-defined function stored in the state. |

### `EVAL` Safety Warning
!!! WARNING: DANGEROUS FUNCTIONALITY. KNOW WHAT YOU ARE DOING, I WILL NOT TAKE RESPONSIBILITY FOR YOUR FAILURES AS STATED IN LICENSE.

## 许可证 (License)

本项目沿用原项目的许可证。详情请参阅 `LICENSE` 文件。