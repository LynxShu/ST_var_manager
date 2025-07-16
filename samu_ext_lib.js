// ============================================================================
// == SAMU Core Logic Library v0.0.1
// == Introduces a generic, event-driven, condition-action rule engine.
// ============================================================================

// 检查 SAMU_Logic_Library 是否已存在，如果不存在则初始化
if (typeof window.SAMU_Logic_Library === 'undefined') {
    window.SAMU_Logic_Library = {};
}

/**
 * @typedef {object} State - SAMU 的全局状态对象
 * @property {object} static - 静态数据
 * @property {Array} volatile - 易失性数据
 */

/**
 * advanceTimeAndUpdateStatus
 * 
 * 这个函数是 SAMU 状态系统的核心。它由 AI 通过 <EVAL> 指令在每轮对话后调用。
 * 其主要职责是：
 * 1. 推进游戏世界内的全局时间。
 * 2. 扫描所有角色，检查其特殊状态。
 * 3. 事件驱动更新 (event_driven_update): 根据条件检查是否要触发动作(SET/ADD/REMOVE等)。
 * 4. 时间驱动更新 (time_based_update): 根据时间流逝更新状态 (cyclic/linear)。
 * 
 * @param {State} state - 由 samu.js 传入的当前全局状态对象。
 * @param {Array} params - 从 <EVAL> 指令中解析出的参数数组 (e.g., ["1h"])。
 * @returns {Array} - 返回一个由事件驱动逻辑生成的、需要主引擎执行的指令数组。
 */
window.SAMU_Logic_Library.advanceTimeAndUpdateStatus = function(state, params) {
    'use strict';
    
    // --- 辅助工具函数 ---
    function parseTimeIncrement(incrementString) {
        const result = { hours: 0, minutes: 0, seconds: 0 };
        if (typeof incrementString !== 'string') { return result; }
        const match = incrementString.toLowerCase().match(/(-?\d+)([hms])/);
        if (!match) { return result; }
        const value = parseInt(match[1], 10);
        const unit = match[2];
        if (unit === 'h') result.hours = value;
        if (unit === 'm') result.minutes = value;
        if (unit === 's') result.seconds = value;
        return result;
    }

    function daysBetween(date1, date2) {
        const oneDay = 1000 * 60 * 60 * 24;
        const diffInTime = date2.getTime() - date1.getTime();
        return Math.floor(diffInTime / oneDay);
    }

    // --- 1. 时间推进 ---
    const timeIncrementStr = params[0];
    if (!timeIncrementStr) {
        console.warn('[SAMU Logic Lib] advanceTimeAndUpdateStatus 调用缺少时间增量参数。');
        return [];
    }
    
    const worldTimePath = 'world.time';
    const currentTimeStr = _.get(state.static, worldTimePath);
    if (!currentTimeStr) {
        console.error('[SAMU Logic Lib] 无法在 state.static.world.time 找到当前时间。');
        return [];
    }
    
    const currentDate = new Date(currentTimeStr);
    if (isNaN(currentDate.getTime())) {
        console.error(`[SAMU Logic Lib] 'world.time' 中的日期字符串 "${currentTimeStr}" 无效。`);
        return [];
    }
    const increment = parseTimeIncrement(timeIncrementStr);

    currentDate.setHours(currentDate.getHours() + increment.hours);
    currentDate.setMinutes(currentDate.getMinutes() + increment.minutes);
    currentDate.setSeconds(currentDate.getSeconds() + increment.seconds);
    
    const newTimeStr = currentDate.toISOString();
    _.set(state.static, worldTimePath, newTimeStr);

    // --- 2. 状态扫描与更新 ---
    const characters = _.get(state.static, 'character', {});
    const commandsToExecute = []; // 用于收集事件驱动生成的指令

    for (const charKey in characters) {
        if (!characters.hasOwnProperty(charKey)) continue;
        const character = characters[charKey];
        const specialStatuses = _.get(character, 'splst', {});

        // 迭代器改为对象迭代
        for (const statusKey in specialStatuses) {
            if (!specialStatuses.hasOwnProperty(statusKey)) continue;
            
            const status = specialStatuses[statusKey];
            if (!status || !status.rules) continue;

            const baseStatusPath = `character.${charKey}.splst.${statusKey}`;

            // --- 2A. 事件驱动更新 (Event-Driven Updates) ---
            if (status.rules.event_driven_update && Array.isArray(status.rules.event_driven_update.events)) {
                const events = status.rules.event_driven_update.events;
                for (const event of events) {
                    if (!event.condition || !Array.isArray(event.actions)) continue;

                    try {
                        // 为 condition 提供 state, character, _ 作为上下文
                        const conditionFunc = new Function('state', 'character', '_', `return ${event.condition};`);
                        if (conditionFunc(state, character, _)) {
                            // 条件满足，生成指令
                            for (const action of event.actions) {
                                let finalValue = action.value;
                                // 替换路径和值中的占位符
                                let finalActionPath = action.path.replace('{{self}}', baseStatusPath);

                                if (typeof finalValue === 'string') {
                                    finalValue = finalValue.replace('{{world.time}}', newTimeStr);
                                }
                                
                                commandsToExecute.push({
                                    type: action.command,
                                    params: [finalActionPath, finalValue, ...(action.extra_params || [])],
                                    preparsed: true // 标记参数为已解析，避免主引擎再次分割
                                });
                            }
                        }
                    } catch (e) {
                        console.error(`[SAMU Logic Lib] 事件驱动条件执行失败: 状态='${status.name}', 事件='${event.name || '未命名'}'`, e);
                    }
                }
            }
            
            // --- 2B. 时间驱动更新 (Time-Based Updates) ---
            const timeRules = status.rules.time_based_update;
            if (timeRules) {
                let newValue = null;
                const currentStatusValue = status.value;

                if (timeRules.mode === 'cyclic') {
                    const cases = timeRules.cases || [];
                    let matched = false;
                    const context = {
                        day: currentDate.getDate(),
                        month: currentDate.getMonth() + 1,
                        year: currentDate.getFullYear(),
                        dayOfWeek: currentDate.getDay()
                    };
                    for (const caseItem of cases) {
                        try {
                            const conditionFunc = new Function(...Object.keys(context), `return ${caseItem.condition};`);
                            if (conditionFunc(...Object.values(context))) {
                                newValue = caseItem.set_value;
                                matched = true;
                                break;
                            }
                        } catch(e) { console.error(`[SAMU Logic Lib] Cyclic条件执行失败: 状态='${status.name}'`, e); }
                    }
                    if (!matched && timeRules.default !== undefined) {
                        newValue = timeRules.default;
                    }
                }
                else if (timeRules.mode === 'linear') {
                    const triggerFieldPath = timeRules.trigger_field;
                    if (!triggerFieldPath) continue;

                    // 1. 优先尝试从 status 对象自身查找 (用于自包含的临时状态, e.g., trigger_field: "start_date")
                    let startDateStr = _.get(status, triggerFieldPath);

                    // 2. 如果在 status 自身找不到, 则尝试从角色根对象查找 (用于引用其他状态的计时器)
                    if (startDateStr === undefined) {
                        startDateStr = _.get(character, triggerFieldPath);
                    }
                    
                    if (startDateStr && !isNaN(new Date(startDateStr).getTime())) {
                        const startDate = new Date(startDateStr);
                        const progressDays = daysBetween(startDate, currentDate);
                        const stages = timeRules.stages || [];
                        let matched = false;
                         const context = { progress_days: progressDays };
                        for (const stage of stages) {
                            try {
                                const conditionFunc = new Function(...Object.keys(context), `return ${stage.condition};`);
                                if (conditionFunc(...Object.values(context))) {
                                    newValue = stage.set_value;
                                    matched = true;
                                    break;
                                }
                            } catch(e) { console.error(`[SAMU Logic Lib] Linear条件执行失败: 状态='${status.name}'`, e); }
                        }
                        if (!matched) {
                            newValue = currentStatusValue; 
                        }
                    } else {
                        if (timeRules.default !== undefined) {
                            newValue = timeRules.default;
                        }
                    }
                }
                
                if (newValue !== null && currentStatusValue !== newValue) {
                    console.log(`[SAMU Logic Lib] 时间驱动状态更新: 角色 '${character.name || charKey}' 的 '${status.name}' 从 '${currentStatusValue}' 变为 '${newValue}'`);
                    status.value = newValue;
                }
            }
        }
    }
    
    console.log(`[SAMU Logic Lib] 时间推进和状态扫描完成。准备执行 ${commandsToExecute.length} 条事件指令。`);
    return commandsToExecute; // 返回需要主引擎执行的指令
};
