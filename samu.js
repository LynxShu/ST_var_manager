// ============================================================================
// == Situational Awareness Manager Unofficial
// == Version: 0.0.3 beta
// ==
// == Current Maintainer: LynxShu (Github.com/LynxShu/ST_var_manager)
// == This project is a fork work of SAM (Github.com/DefinitelyNotProcrastinating/ST_var_manager) 
// == This script provides a robust state management system for SillyTavern.
// == It correctly maintains a nested state object and passes it to the UI
// == functions, ensuring proper variable display and structure.
// ============================================================================

(function () {
    const SCRIPT_NAME = "Situational Awareness Manager Unofficial";
    const DEBUG = false;
    const STATE_BLOCK_START_MARKER = '<!--<|state|>';
    const STATE_BLOCK_END_MARKER = '</|state|>-->';
    const STATE_BLOCK_PARSE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\|/g, '\\|')}([\\s\\S]*?)${STATE_BLOCK_END_MARKER.replace(/\|/g, '\\|')}`, 's');
    const STATE_BLOCK_REMOVE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\|/g, '\\|')}([\\s\\S]*)${STATE_BLOCK_END_MARKER.replace(/\|/g, '\\|')}`, 's');
    const COMMAND_REGEX = /<(?<type>SET|ADD|REMOVE|DEL|TIMED_SET|RESPONSE_SUMMARY|CANCEL_SET|EVAL)\s*::\s*(?<params>.*?)>/gs;
    const INITIAL_STATE = { static: {}, volatile: [], responseSummary: [], func: [] };
    const STATES = {
        IDLE: "IDLE",
        AWAIT_GENERATION: "AWAIT_GENERATION",
        PROCESSING: "PROCESSING"
    };
    let curr_state = STATES.IDLE;
    const event_queue = [];
    let isDispatching = false;
    let isProcessingState = false;
    async function getRoundCounter() { return SillyTavern.chat.length - 1; }
    function tryParseJSON(str) { try { return JSON.parse(str); } catch (e) { return str; } }
    function goodCopy(state) { return _.cloneDeep(state) ?? _.cloneDeep(INITIAL_STATE); }
    function parseDynamicValue(value) {
        if (typeof value !== 'string') {
            return value;
        }
        const trimmed = value.trim();
        switch (trimmed.toLowerCase()) {
            case "true": return true;
            case "false": return false;
            case "null": return null;
            case "undefined": return undefined;
        }
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            const num = Number(trimmed);
            if (!isNaN(num)) return num;
        }
        return value;
    }
    function parseStateFromMessage(messageContent) {
        if (!messageContent) return null;
        const match = messageContent.match(STATE_BLOCK_PARSE_REGEX);
        if (match && match[1]) {
            try {
                const parsed = JSON.parse(match[1].trim());
                return {
                    static: parsed.static ?? {},
                    volatile: parsed.volatile ?? [],
                    responseSummary: parsed.responseSummary ?? [],
                    func: parsed.func ?? []
                };
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Failed to parse state JSON.`, error);
                return _.cloneDeep(INITIAL_STATE);
            }
        }
        return null;
    }
    async function findLatestState(chatHistory, lastIndex = chatHistory.length - 1) {
        if (DEBUG) console.log(`[${SCRIPT_NAME}] finding latest state down from ${lastIndex}`);
        for (let i = lastIndex; i >= 0; i--) {
            const message = chatHistory[i];
            if (message.is_user) continue;
            const state = parseStateFromMessage(message.mes);
            if (state) {
                if (DEBUG) console.log(`[${SCRIPT_NAME}] Found latest state at index ${i}.`);
                return _.cloneDeep(state);
            }
        }
        if (DEBUG) console.log(`[${SCRIPT_NAME}] No previous state found. Using initial state.`);
        return _.cloneDeep(INITIAL_STATE);
    }
    async function findLastAiMessageAndIndex(beforeIndex = -1) {
        const chat = SillyTavern.chat;
        const searchUntil = (beforeIndex === -1) ? chat.length : beforeIndex;
        for (let i = searchUntil - 1; i >= 0; i--) {
            if (chat[i] && !chat[i].is_user) return i;
        }
        return -1;
    }
    function findLatestUserMsgIndex(){
        for (let i = SillyTavern.chat.length -1; i >= 0; i--){
            const message = SillyTavern.chat[i];
            if (message.is_user){
                return i;
            }
        }
        return -1;
    }
    async function runSandboxedFunction(funcName, params, state) {
        const funcDef = state.func?.find(f => f.func_name === funcName);
        if (!funcDef) {
            console.warn(`[${SCRIPT_NAME}] EVAL: Function '${funcName}' not found in state.func array.`);
            return;
        }
        const timeout = funcDef.timeout ?? 2000;
        const allowNetwork = funcDef.network_access === true;
        const paramNames = funcDef.func_params || [];
        const executionPromise = new Promise(async (resolve, reject) => {
            try {
                const networkBlocker = () => { throw new Error('EVAL: Network access is disabled for this function.'); };
                const fetchImpl = allowNetwork ? window.fetch.bind(window) : networkBlocker;
                const xhrImpl = allowNetwork ? window.XMLHttpRequest : networkBlocker;
                const argNames = ['state', '_', 'fetch', 'XMLHttpRequest', ...paramNames];
                const argValues = [state, _, fetchImpl, xhrImpl, ...params];
                const functionBody = `'use strict';\n${funcDef.func_body}`;
                const userFunction = new Function(...argNames, functionBody);
                const result = await userFunction.apply(null, argValues);
                resolve(result);
            } catch (error) {
                reject(error);
            }
        });
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`EVAL: Function '${funcName}' timed out after ${timeout}ms.`)), timeout);
        });
        try {
            const result = await Promise.race([executionPromise, timeoutPromise]);
            if (DEBUG) console.log(`[${SCRIPT_NAME}] EVAL: Function '${funcName}' executed successfully.`, { result });
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] EVAL: Error executing function '${funcName}'.`, error);
        }
    }
    async function processVolatileUpdates(state) {
        if (!state.volatile || !state.volatile.length) return [];
        const promotedCommands = [];
        const remainingVolatiles = [];
        const currentRound = await getRoundCounter();
        const currentTime = new Date();
        for (const volatile of state.volatile) {
            const [varName, varValue, isGameTime, targetTime] = volatile;
            let triggered = isGameTime ? (currentTime >= new Date(targetTime)) : (currentRound >= targetTime);
            if (triggered) {
                // Smart TIMED_SET logic: Determine if it's a SET or REMOVE operation.
                if (varValue === null) {
                    // This is an object removal request.
                    // The path points to the object to be removed, e.g., "character.player.splst.buff_strength".
                    const pathParts = varName.split('.');
                    const keyToRemove = pathParts.pop();
                    const listPath = pathParts.join('.');
                    // We construct a REMOVE command to remove the object with the matching key from the list.
                    // The '0' means remove all matching instances, which is safer for this operation.
                    promotedCommands.push({ type: 'REMOVE', params: `${listPath}::key::${keyToRemove}::0` });
                } else {
                    // This is a standard value-setting request.
                    promotedCommands.push({ type: 'SET', params: `${varName}::${varValue}` });
                }
            } else {
                remainingVolatiles.push(volatile);
            }
        }
        state.volatile = remainingVolatiles;
        return promotedCommands;
    }
    const commandHandlers = {
        'SET': (params, state, isPreparsed) => {
            let [path, value] = params;
            if (!path || value === undefined) return;
            const finalValue = isPreparsed ? value : parseDynamicValue(value);
            _.set(state.static, path, finalValue);
        },
        'ADD': (params, state, isPreparsed, context) => {
            let [path, valueStr] = params;
            if (!path || valueStr === undefined) return;
            
            const target = _.get(state.static, path);
            const valueToAdd = tryParseJSON(valueStr);

            if (Array.isArray(target)) {
                context.modifiedListPaths.add(path);
                
                if (typeof valueToAdd === 'object' && valueToAdd !== null && 'key' in valueToAdd && typeof valueToAdd.count === 'number') {
                    const itemsToMerge = _.filter(target, item => 
                        typeof item === 'object' && item !== null && item.key === valueToAdd.key && typeof item.count === 'number'
                    );
                    
                    const totalCount = valueToAdd.count + _.sumBy(itemsToMerge, 'count');
                    
                    if (itemsToMerge.length > 0) {
                        _.remove(target, item => typeof item === 'object' && item !== null && item.key === valueToAdd.key);
                    }

                    // Use a template from the item being added or an existing item to preserve other properties
                    const template = itemsToMerge.length > 0 ? itemsToMerge[0] : valueToAdd;
                    const mergedItem = _.cloneDeep(template);
                    mergedItem.count = totalCount;
                    
                    target.push(mergedItem);

                } else {
                    target.push(valueToAdd);
                }
                return;
            }

            // Handle Numeric Addition
            const increment = Number(valueStr);
            if (!isNaN(increment)) {
                if (typeof target === 'number' || target === undefined) {
                    const baseValue = Number(target) || 0;
                    _.set(state.static, path, baseValue + increment);
                    return;
                }
            }

            console.warn(`[${SCRIPT_NAME}] ADD command aborted: Target at "${path}" is not an Array or a Number. Its type is "${typeof target}". Received value:`, valueToAdd);
        },
        'RESPONSE_SUMMARY': (params, state) => {
            if (!Array.isArray(state.responseSummary)) {
                state.responseSummary = state.responseSummary ? [state.responseSummary] : [];
            }
            const summary = Array.isArray(params) ? params.join('::') : params;
            if (!state.responseSummary.includes(summary.trim())) {
                state.responseSummary.push(summary.trim());
            }
        },
        'TIMED_SET': async (params, state) => {
            const [varName, varValue, reason, isGameTimeStr, timeUnitsStr] = params;
            if (!varName || varValue === undefined || !reason || !isGameTimeStr || !timeUnitsStr) return;
            const isGameTime = isGameTimeStr.toLowerCase() === 'true' || isGameTimeStr === '1';

            // Correctly parse the value, preserving `null` for object removal signals.
            let finalValue;
            if (varValue === null || varValue.trim().toLowerCase() === 'null') {
                finalValue = null;
            } else {
                finalValue = parseDynamicValue(varValue);
            }

            const currentRound = await getRoundCounter();
            const targetTime = isGameTime ? new Date(timeUnitsStr).toISOString() : currentRound + Number(timeUnitsStr);
            if(!state.volatile) state.volatile = [];
            state.volatile.push([varName, finalValue, isGameTime, targetTime, reason]);
        },
        'CANCEL_SET': (params, state) => {
            if (!params[0] || !state.volatile?.length) return;
            const identifier = params[0];
            const index = parseInt(identifier, 10);
            if (!isNaN(index) && index >= 0 && index < state.volatile.length) {
                state.volatile.splice(index, 1);
            } else {
                state.volatile = state.volatile.filter(entry => {
                    const [varName, , , , reason] = entry;
                    return varName !== identifier && reason !== identifier;
                });
            }
        },
        'REMOVE': (params, state, isPreparsed, context) => {
            const [listPath, identifier, targetId, countStr] = params;
            if (!listPath || !identifier || targetId === undefined) {
                if (DEBUG) console.warn(`[${SCRIPT_NAME}] REMOVE: Missing required parameters.`, params);
                return;
            }
            const list = _.get(state.static, listPath);
            if (!Array.isArray(list)) {
                if (DEBUG) console.warn(`[${SCRIPT_NAME}] REMOVE: Path "${listPath}" is not an array.`);
                return;
            }
            const count = countStr !== undefined ? Number(countStr) : 1;
            if (!Number.isInteger(count) || count < 0) {
                if (DEBUG) console.warn(`[${SCRIPT_NAME}] REMOVE: Count must be a non-negative integer. Received: "${countStr}"`);
                return;
            }
            const parsedTargetId = tryParseJSON(targetId);
            const initialLength = list.length;
            
            let totalRemoved = 0;
            const toRemove = count === 0 ? Infinity : count;

            _.remove(list, item => {
                if (totalRemoved >= toRemove) return false;

                if (_.get(item, identifier) === parsedTargetId) {
                    if (typeof item === 'object' && item !== null && 'count' in item && typeof item.count === 'number') {
                        const canRemoveFromThisStack = toRemove - totalRemoved;
                        if (item.count > canRemoveFromThisStack) {
                            item.count -= canRemoveFromThisStack;
                            totalRemoved = toRemove;
                            return false;
                        } else {
                            totalRemoved += item.count;
                            return true;
                        }
                    } else {
                        totalRemoved++;
                        return true;
                    }
                }
                return false;
            });

            if (list.length < initialLength) {
                context.modifiedListPaths.add(listPath);
            }
        },
        'DEL': (params, state, isPreparsed, context) => {
            const [listPath, indexStr] = params;
            if (!listPath || indexStr === undefined) return;
            const index = parseInt(indexStr, 10);
            if (isNaN(index)) return;
            const list = _.get(state.static, listPath);
            if (!Array.isArray(list)) return;
            if (index >= 0 && index < list.length) {
                list[index] = undefined;
                context.modifiedListPaths.add(listPath);
            }
        },
        'EVAL': async (params, state) => {
            const [funcName, ...funcParams] = params;
            if (!funcName) return;
            await runSandboxedFunction(funcName, funcParams, state);
        }
    };
    async function applyCommandsToState(commands, state) {
        const context = { modifiedListPaths: new Set() };
        for (const command of commands) {
            try {
                const handler = commandHandlers[command.type];
                if (handler) {
                    const params = command.preparsed ? command.params : command.params.split('::').map(p => p.trim());
                    const isPreparsed = command.preparsed || false;
                    await handler(params, state, isPreparsed, context);
                }
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Error processing command: ${JSON.stringify(command)}`, error);
            }
        }
        for (const path of context.modifiedListPaths) {
            const list = _.get(state.static, path);
            if (Array.isArray(list)) {
                // Step 1: Compact the array to remove empty slots from DEL operations.
                _.remove(list, (item) => item === undefined);

                // Step 2: Merge stackable items.
                // An item is considered stackable if it's an object with a 'key' and a numeric 'count'.
                const stackableItems = list.filter(item => 
                    typeof item === 'object' && item !== null && item.key !== undefined && typeof item.count === 'number'
                );
                const nonStackableItems = list.filter(item => 
                    !(typeof item === 'object' && item !== null && item.key !== undefined && typeof item.count === 'number')
                );

                if (stackableItems.length > 0) {
                    const grouped = _.groupBy(stackableItems, 'key');
                    const mergedStackableItems = Object.values(grouped).map(group => {
                        if (group.length === 1) {
                            return group[0];
                        }
                        const totalCount = _.sumBy(group, 'count');
                        // Use the first item as a template for the merged item.
                        const mergedItem = _.cloneDeep(group[0]);
                        mergedItem.count = totalCount;
                        return mergedItem;
                    });
                    
                    // Replace the original list content with the new, sanitized list.
                    list.length = 0; 
                    Array.prototype.push.apply(list, [...nonStackableItems, ...mergedStackableItems]);
                }
            }
        }
        return state;
    }
    async function processMessageState(index) {
        if (isProcessingState) {
            console.warn(`[${SCRIPT_NAME}] Aborting processMessageState: Already processing.`);
            return;
        }
        isProcessingState = true;
        if (DEBUG) console.log(`[${SCRIPT_NAME}] processing message state at ${index}`);
        try {
            if (index === "{{lastMessageId}}"){
                index = SillyTavern.chat.length - 1;
            }
            const lastAIMessage = SillyTavern.chat[index];
            if (!lastAIMessage || lastAIMessage.is_user) {
                isProcessingState = false;
                return;
            }
            var state = await getVariables();
            if (state && state.SAM_data) {
                state = state.SAM_data;
            } else {
                state = _.cloneDeep(INITIAL_STATE);
            }
            const promotedCommands = await processVolatileUpdates(state);
            const messageContent = lastAIMessage.mes;
            COMMAND_REGEX.lastIndex = 0;
            const newCommands = [];
            let match;
            while ((match = COMMAND_REGEX.exec(messageContent)) !== null) {
                newCommands.push({type: match.groups.type, params: match.groups.params});
            }
            if (DEBUG) console.log(`[${SCRIPT_NAME}] ---- Found ${newCommands.length} command(s) to process ----`);
            const newState = await applyCommandsToState([...promotedCommands, ...newCommands], state);
            await insertOrAssignVariables({"SAM_data": goodCopy(newState)});
            const cleanNarrative = messageContent.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            const newStateBlock = `${STATE_BLOCK_START_MARKER}\n${JSON.stringify(newState, null, 2)}\n${STATE_BLOCK_END_MARKER}`;
            const finalContent = `${cleanNarrative}\n\n${newStateBlock}`;
            await setChatMessage({message: finalContent}, index, "display_current");
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Error in processMessageState for index ${index}:`, error);
        } finally {
            isProcessingState = false;
        }
    }
    async function loadStateFromMessage(index) {
        if (index === "{{lastMessageId}}") {
            index = SillyTavern.chat.length - 1;
        }
        try {
            const message = SillyTavern.chat[index];
            if (!message) return;
            const state = parseStateFromMessage(message.mes);
            if (state) {
                if (DEBUG) console.log(`[${SCRIPT_NAME}] replacing variables with found state at index ${index}`);
                await insertOrAssignVariables({"SAM_data": goodCopy(state)});
            } else {
                if (DEBUG) console.log(`[${SCRIPT_NAME}] did not find valid state at index, replacing with latest state`)
                const lastKnownState = await findLatestState(SillyTavern.chat, index);
                await insertOrAssignVariables({"SAM_data": goodCopy(lastKnownState)});
            }
        } catch (e) {
            console.error(`[${SCRIPT_NAME}] Load state from message failed for index ${index}:`, e);
        }
    }
    async function sync_latest_state(){
        let lastAIMessageIdx = await findLastAiMessageAndIndex();
        if (lastAIMessageIdx !== -1) {
            await loadStateFromMessage(lastAIMessageIdx);
        } else {
            await insertOrAssignVariables({"SAM_data": _.cloneDeep(INITIAL_STATE)});
        }
    }
    async function dispatcher(event, ...event_params){
        if (DEBUG) console.log(`[${SCRIPT_NAME}] [FSM Dispatcher] Event: ${event}, State: ${curr_state}`);
        try {
            switch(curr_state){
                case STATES.IDLE: {
                    switch (event) {
                        case tavern_events.GENERATION_STARTED: {
                            if (event_params[2]) {
                                if (DEBUG) console.log(`[${SCRIPT_NAME}] [IDLE] Dry run detected, aborting.`);
                                return;
                            }
                            if (event_params[0] === "swipe" ){
                                if (DEBUG) console.log("[SAMU] [IDLE handler] Swipe generate to GENERATE during IDLE detected. Loading from before latest user msg.");
                                const latestUserMsg = await findLatestUserMsgIndex();
                                await loadStateFromMessage(latestUserMsg);
                            }
                            curr_state = STATES.AWAIT_GENERATION;
                            break;
                        }
                        case tavern_events.MESSAGE_SENT: {
                            curr_state = STATES.AWAIT_GENERATION;
                            break;
                        }
                        case tavern_events.MESSAGE_SWIPED:
                        case tavern_events.MESSAGE_EDITED:
                        case tavern_events.MESSAGE_DELETED:
                        case tavern_events.CHAT_CHANGED: {
                             if (DEBUG) console.log(`[${SCRIPT_NAME}] [IDLE] Chat state changed by ${event}. Syncing latest state.`);
                             await sync_latest_state();
                             break;
                        }
                    }
                    break;
                }
                case STATES.AWAIT_GENERATION: {
                    switch (event){
                        case tavern_events.GENERATION_STOPPED:
                        case tavern_events.GENERATION_ENDED: {
                            curr_state = STATES.PROCESSING;
                            if (DEBUG) console.log(`[${SCRIPT_NAME}] [AWAIT_GENERATION] Generation ended. Processing message.`);
                            await new Promise(resolve => setTimeout(resolve, 500));
                            const index = SillyTavern.chat.length - 1;
                            await processMessageState(index);
                            if (DEBUG) console.log(`[${SCRIPT_NAME}] [AWAIT_GENERATION] Processing complete. Returning to IDLE.`);
                            curr_state = STATES.IDLE;
                            break;
                        }
                        case tavern_events.CHAT_CHANGED: {
                            console.log(`[${SCRIPT_NAME}] [AWAIT_GENERATION] Chat changed during generation. Aborting and returning to IDLE.`);
                            await sync_latest_state();
                            curr_state = STATES.IDLE;
                            break;
                        }
                    }
                    break;
                }
                case STATES.PROCESSING: {
                    console.warn(`[${SCRIPT_NAME}] [PROCESSING] Received event ${event} while in PROCESSING state. Ignoring.`);
                    break;
                }
            }
        } catch(e) {
            console.error(`[${SCRIPT_NAME}] [Dispatcher] FSM Scheduling failed. Error: ${e}`);
            curr_state = STATES.IDLE;
        }
    }
    async function unifiedEventHandler(event, ...args) {
        if (DEBUG) console.log(`[${SCRIPT_NAME}] [Unified Handler] Queuing event: [${event}]`);
        event_queue.push({event_id: event, args: [...args]});
        unified_dispatch_executor();
    }
    async function unified_dispatch_executor(){
        if (isDispatching) return;
        isDispatching = true;
        while (event_queue.length > 0) {
            const { event_id, args } = event_queue.shift();
            if (DEBUG) console.log(`[${SCRIPT_NAME}] [Executor] Dequeuing and dispatching: ${event_id}`);
            try {
                await dispatcher(event_id, ...args);
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] [Executor] Unhandled error for ${event_id}:`, error);
                curr_state = STATES.IDLE;
            }
        }
        isDispatching = false;
    }
    const HANDLER_STORAGE_KEY = `__SAM_V3_MERGED_EVENT_HANDLERS__`;
    const cleanupPreviousInstance = () => {
        const oldHandlers = window[HANDLER_STORAGE_KEY];
        if (!oldHandlers) {
            if (DEBUG) console.log(`[${SCRIPT_NAME}] No previous instance found.`);
            return;
        }
        console.log(`[${SCRIPT_NAME}] Found previous instance. Removing its listeners.`);
        eventRemoveListener(tavern_events.GENERATION_STARTED, oldHandlers.handleGenerationStarted);
        eventRemoveListener(tavern_events.GENERATION_ENDED, oldHandlers.handleGenerationEnded);
        eventRemoveListener(tavern_events.MESSAGE_SWIPED, oldHandlers.handleMessageSwiped);
        eventRemoveListener(tavern_events.MESSAGE_DELETED, oldHandlers.handleMessageDeleted);
        eventRemoveListener(tavern_events.MESSAGE_EDITED, oldHandlers.handleMessageEdited);
        eventRemoveListener(tavern_events.CHAT_CHANGED, oldHandlers.handleChatChanged);
        eventRemoveListener(tavern_events.MESSAGE_SENT, oldHandlers.handleMessageSent);
        eventRemoveListener(tavern_events.GENERATION_STOPPED, oldHandlers.handleGenerationStopped);
        delete window[HANDLER_STORAGE_KEY];
    };
    const handlers = {
        handleGenerationStarted: async (ev, options, dry_run) => unifiedEventHandler(tavern_events.GENERATION_STARTED, ev, options, dry_run),
        handleGenerationEnded: async () => unifiedEventHandler(tavern_events.GENERATION_ENDED),
        handleMessageSwiped: async () => unifiedEventHandler(tavern_events.MESSAGE_SWIPED),
        handleMessageDeleted: async (message) => unifiedEventHandler(tavern_events.MESSAGE_DELETED, message),
        handleMessageEdited: async () => unifiedEventHandler(tavern_events.MESSAGE_EDITED),
        handleChatChanged: async () => unifiedEventHandler(tavern_events.CHAT_CHANGED),
        handleMessageSent: async () => unifiedEventHandler(tavern_events.MESSAGE_SENT),
        handleGenerationStopped: async () => unifiedEventHandler(tavern_events.GENERATION_STOPPED)
    };
    $(() => {
        cleanupPreviousInstance();
        const initializeOrReloadStateForCurrentChat = async () => {
            console.log(`[${SCRIPT_NAME}] Initializing or reloading state for current chat.`);
            await sync_latest_state();
            console.log(`[${SCRIPT_NAME}] Initialization complete.`);
        };
        console.log(`[${SCRIPT_NAME}] Registering new event listeners.`);
        // Make sure SAMU runs before other extensions that might read the state.
        eventMakeFirst(tavern_events.GENERATION_STARTED, handlers.handleGenerationStarted);
        eventOn(tavern_events.GENERATION_ENDED, handlers.handleGenerationEnded);
        eventOn(tavern_events.MESSAGE_SWIPED, handlers.handleMessageSwiped);
        eventOn(tavern_events.MESSAGE_DELETED, handlers.handleMessageDeleted);
        eventOn(tavern_events.MESSAGE_EDITED, handlers.handleMessageEdited);
        eventOn(tavern_events.CHAT_CHANGED, handlers.handleChatChanged);
        eventOn(tavern_events.MESSAGE_SENT, handlers.handleMessageSent);
        eventOn(tavern_events.GENERATION_STOPPED, handlers.handleGenerationStopped);
        window[HANDLER_STORAGE_KEY] = handlers;
        try {
            console.log(`[${SCRIPT_NAME}] Version 0.0.2 (Merged FSM) loaded.`);
            initializeOrReloadStateForCurrentChat();
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Error during final initialization:`, error);
        }
    });
})();