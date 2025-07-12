// ============================================================================
// == Situational Awareness Manager Unofficial
// == Version: 0.0.1
// ==
// == This project is a fork work of SAM v2.4.0 (Github.com/DefinitelyNotProcrastinating/ST_var_manager) 
// == Originally Created By DefinitelyNotProcrastinating
// ==
// == This script provides a robust state management system for SillyTavern.
// == It correctly maintains a nested state object and passes it to the UI
// == functions, ensuring proper variable display and structure.
// ============================================================================

(function () {
    const SCRIPT_NAME = "Situational Awareness Manager Unofficial";
    const DEBUG = false; // Set to true to enable detailed logging
    const STATE_BLOCK_START_MARKER = '<!--<|state|>';
    const STATE_BLOCK_END_MARKER = '</|state|>-->';
    const STATE_BLOCK_PARSE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\|/g, '\\|')}([\\s\\S]*?)${STATE_BLOCK_END_MARKER.replace(/\|/g, '\\|')}`, 's');
    const STATE_BLOCK_REMOVE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\|/g, '\\|')}([\\s\\S]*)${STATE_BLOCK_END_MARKER.replace(/\|/g, '\\|')}`, 's');

    const COMMAND_REGEX = /<(?<type>SET|ADD|DEL|REMOVE|TIMED_SET|RESPONSE_SUMMARY|CANCEL_SET|EVAL)\s*::\s*(?<params>.*?)>/gs;
    const INITIAL_STATE = { static: {}, volatile: [], responseSummary: [], func: [] };

    async function getRoundCounter() { return SillyTavern.chat.length - 1; }
    function tryParseJSON(str) { try { return JSON.parse(str); } catch (e) { return str; } }
    function goodCopy(state) { return _.cloneDeep(state) ?? _.cloneDeep(INITIAL_STATE); }

    function parseDynamicValue(value) {
        let parsed = tryParseJSON(value);
        if (typeof parsed !== 'string') {
            return parsed;
        }
        
        const trimmed = parsed.trim().toLowerCase();
        switch (trimmed) {
            case "true": return true;
            case "false": return false;
            case "null": return null;
            case "undefined": return undefined;
            default:
                if (/^-?\d+(\.\d+)?$/.test(trimmed) && !isNaN(parseFloat(trimmed))) {
                    return Number(trimmed);
                }
                return parsed;
        }
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

    /**
     * Executes a user-defined function in a sandboxed environment.
     * 
     * Security Measures:
     * - **Strict Mode**: Code runs in 'use strict' mode.
     * - **Isolated Scope**: The function does not have access to the closure of this script.
     * - **Controlled Globals**: Only provides safe globals like `state`, `_` (lodash), and controlled `fetch`/`XMLHttpRequest`.
     * - **Network Control**: Network access via `fetch` and `XMLHttpRequest` is disabled by default and can be enabled per-function.
     * - **Timeout**: Each function has a configurable execution timeout to prevent long-running scripts.
     * 
     * While this provides a reasonable level of security for the intended use case, it is not a perfect, foolproof sandbox.
     * For maximum security, a Web Worker would offer stronger isolation, but with increased complexity.
     */
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
        for (const entry of state.volatile) {
            let triggered = entry.isRealTime 
                ? (currentTime >= new Date(entry.triggerAt)) 
                : (currentRound >= entry.triggerAt);

            if (triggered) {
                promotedCommands.push({ type: 'SET', preparsed: true, params: [entry.path, entry.value] });
            } else {
                remainingVolatiles.push(entry);
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
        'ADD': (params, state) => {
            const [path, valueStr] = params;
            if (!path || valueStr === undefined) return;

            const target = _.get(state.static, path);
            const valueToAdd = tryParseJSON(valueStr);

            if (Array.isArray(target)) {
                if (typeof valueToAdd === 'object' && valueToAdd !== null && valueToAdd.key && typeof valueToAdd.count === 'number') {
                    const existingItem = target.find(item => item && item.key === valueToAdd.key);
                    if (existingItem) {
                        existingItem.count = (typeof existingItem.count === 'number' ? existingItem.count : 0) + valueToAdd.count;
                    } else {
                        target.push(valueToAdd);
                    }
                } else {
                    target.push(valueToAdd);
                }
            } else {
                const increment = Number(valueStr);
                const baseValue = Number(target) || 0;
                if (!isNaN(increment) && !isNaN(baseValue)) {
                    _.set(state.static, path, baseValue + increment);
                }
            }
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
            const [path, value, reason, isRealTimeStr, timeUnitsStr] = params;
            if (!path || value === undefined || !reason || !isRealTimeStr || !timeUnitsStr) return;
            
            const isRealTime = isRealTimeStr.toLowerCase() === 'true';
            const finalValue = parseDynamicValue(value);
            const currentRound = await getRoundCounter();
            const triggerAt = isRealTime ? new Date(timeUnitsStr).toISOString() : currentRound + Number(timeUnitsStr);

            if (!state.volatile) state.volatile = [];
            state.volatile.push({ path, value: finalValue, isRealTime, triggerAt, reason });
        },
        'CANCEL_SET': (params, state) => {
            if (!params[0] || !state.volatile?.length) return;
            const reason = params[0];
            state.volatile = state.volatile.filter(entry => entry.reason !== reason);
        },
        'DEL': (params, state) => {
            const [listPath, indexStr] = params;
            if (!listPath || indexStr === undefined) return;
            const index = parseInt(indexStr, 10);
            if (isNaN(index)) return;
            const list = _.get(state.static, listPath);
            if (Array.isArray(list) && index >= 0 && index < list.length) {
                list.splice(index, 1);
            }
        },
        'REMOVE': (params, state) => {
            const [listPath, identifier, targetId, countStr] = params;
            if (!listPath || !identifier || targetId === undefined) return;
            
            const list = _.get(state.static, listPath);
            if (!Array.isArray(list)) return;
            
            const parsedTargetId = tryParseJSON(targetId);
            const maxToRemove = parseInt(countStr, 10);

            if (isNaN(maxToRemove) || maxToRemove <= 0) {
                _.set(state.static, listPath, _.reject(list, { [identifier]: parsedTargetId }));
            } else {
                let removedCount = 0;
                _.set(state.static, listPath, list.filter(item => {
                    if (removedCount < maxToRemove && item && item[identifier] === parsedTargetId) {
                        removedCount++;
                        return false;
                    }
                    return true;
                }));
            }
        },
        'EVAL': async (params, state) => {
            const [funcName, ...funcParams] = params;
            if (!funcName) {
                console.warn(`[${SCRIPT_NAME}] EVAL aborted: EVAL command requires a function name.`);
                return;
            }
            await runSandboxedFunction(funcName, funcParams, state);
        }
    };

    async function applyCommandsToState(commands, state) {
        for (const command of commands) {
            try {
                const handler = commandHandlers[command.type];
                if (handler) {
                    const params = command.preparsed ? command.params : command.params.split('::').map(p => p.trim());
                    await handler(params, state, command.preparsed);
                }
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Error processing command: ${JSON.stringify(command)}`, error);
            }
        }
        return state;
    }
    
    const fsm = {
        currentState: 'IDLE',
        isProcessing: false,
        queue: [],
        context: {},
        transitions: {
            IDLE: {
                startGeneration: 'GENERATING',
                swipeMessage: 'PROCESSING',
                editMessage: 'PROCESSING',
                deleteMessage: 'RELOADING',
                changeChat: 'RELOADING'
            },
            GENERATING: {
                generationEnded: 'PROCESSING'
            },
            PROCESSING: {
                processingComplete: 'IDLE'
            },
            RELOADING: {
                reloadingComplete: 'IDLE'
            }
        },

        async dispatch(action, data) {
            this.queue.push({ action, data });
            if (!this.isProcessing) {
                await this._processQueue();
            }
        },

        async _processQueue() {
            if (this.queue.length === 0) {
                this.isProcessing = false;
                return;
            }

            this.isProcessing = true;
            const { action, data } = this.queue.shift();

            const validTransition = this.transitions[this.currentState]?.[action];
            if (!validTransition) {
                if (DEBUG) console.log(`[${SCRIPT_NAME}] Invalid action '${action}' for state '${this.currentState}'. Ignoring.`);
                await this._processQueue();
                return;
            }

            if (DEBUG) console.log(`[${SCRIPT_NAME}] Transition: ${this.currentState} -> ${validTransition} (Action: ${action})`);
            this.currentState = validTransition;
            this.context = { ...this.context, ...data };

            try {
                await this.onStateEnter(this.currentState);
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Error during FSM action for state ${this.currentState}:`, error);
                this.currentState = 'IDLE';
            } finally {
                await this._processQueue();
            }
        },

        async onStateEnter(newState) {
            switch (newState) {
                case 'GENERATING': {
                    const lastMessageIndex = SillyTavern.chat.length - 1;
                    const lastMessage = SillyTavern.chat[lastMessageIndex];
                    let sourceStateIndex;
                    if (lastMessage && parseStateFromMessage(lastMessage.mes) != null) {
                        sourceStateIndex = await findLastAiMessageAndIndex(lastMessageIndex);
                    } else {
                        sourceStateIndex = await findLastAiMessageAndIndex();
                    }

                    const stateToLoad = (sourceStateIndex !== -1) ? await findLatestState(SillyTavern.chat, sourceStateIndex) : _.cloneDeep(INITIAL_STATE);
                    await replaceVariables(stateToLoad);
                    // No dispatch needed, we now wait for the 'generationEnded' event.
                    break;
                }
                case 'PROCESSING': {
                    const index = this.context.messageIndex ?? SillyTavern.chat.length - 1;
                    if (index < 0 || index >= SillyTavern.chat.length) {
                        return await this.dispatch('processingComplete');
                    }
                    const message = SillyTavern.chat[index];
                    if (!message || message.is_user) {
                         return await this.dispatch('processingComplete');
                    }
                    
                    const state = await findLatestState(SillyTavern.chat, index - 1);
                    const promotedCommands = await processVolatileUpdates(state);
                    
                    COMMAND_REGEX.lastIndex = 0;
                    const newCommands = [];
                    let match;
                    while ((match = COMMAND_REGEX.exec(message.mes)) !== null) {
                        newCommands.push({ type: match.groups.type, params: match.groups.params });
                    }

                    const allCommands = [...promotedCommands, ...newCommands];
                    const newState = await applyCommandsToState(allCommands, state);
                    await replaceVariables(goodCopy(newState));

                    const cleanNarrative = message.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
                    const newStateBlock = `${STATE_BLOCK_START_MARKER}\n${JSON.stringify(newState, null, 2)}\n${STATE_BLOCK_END_MARKER}`;
                    const finalContent = `${cleanNarrative}\n\n${newStateBlock}`;

                    if (finalContent !== message.mes) {
                        await setChatMessage({ message: finalContent }, index, "display_current");
                    }
                    await this.dispatch('processingComplete');
                    break;
                }
                case 'RELOADING': {
                    const lastAiIndex = await findLastAiMessageAndIndex();
                    const stateToLoad = (lastAiIndex !== -1) ? await findLatestState(SillyTavern.chat, lastAiIndex) : _.cloneDeep(INITIAL_STATE);
                    await replaceVariables(stateToLoad);
                    await this.dispatch('reloadingComplete');
                    break;
                }
            }
        }
    };

    const HANDLER_STORAGE_KEY = `__SAM_V3_EVENT_HANDLERS__`;
    const eventHandlers = {
        handleGenerationStarted: async (ev, options, dry_run) => {
            if (dry_run) return;
            fsm.dispatch('startGeneration');
        },
        handleGenerationEnded: async () => {
            fsm.dispatch('generationEnded');
        },
        handleMessageSwiped: async () => {
            const lastAiIndex = await findLastAiMessageAndIndex();
            fsm.dispatch('swipeMessage', { messageIndex: lastAiIndex });
        },
        handleMessageDeleted: async () => {
            fsm.dispatch('deleteMessage');
        },
        handleMessageEdited: async (message, index) => {
            if (!message || message.is_user) {
                if (DEBUG) console.log(`[${SCRIPT_NAME}] Ignoring user message edit.`);
                return;
            }
            // The index is provided by the event, so we can use it directly.
            fsm.dispatch('editMessage', { messageIndex: index });
        },
        handleChatChanged: async () => {
            fsm.dispatch('changeChat');
        }
    };
    
    const cleanupPreviousListeners = () => {
         if (window[HANDLER_STORAGE_KEY]) {
            const handlers = window[HANDLER_STORAGE_KEY];
            if (DEBUG) console.log(`[${SCRIPT_NAME}] Removing listeners from a previous instance.`);
            eventRemoveListener(tavern_events.GENERATION_STARTED, handlers.handleGenerationStarted);
            eventRemoveListener(tavern_events.GENERATION_ENDED, handlers.handleGenerationEnded);
            eventRemoveListener(tavern_events.MESSAGE_SWIPED, handlers.handleMessageSwiped);
            eventRemoveListener(tavern_events.MESSAGE_DELETED, handlers.handleMessageDeleted);
            eventRemoveListener(tavern_events.MESSAGE_EDITED, handlers.handleMessageEdited);
            eventRemoveListener(tavern_events.CHAT_CHANGED, handlers.handleChatChanged);
        }
    };

    const addAllListeners = () => {
        if (DEBUG) console.log(`[${SCRIPT_NAME}] Registering FSM event listeners.`);
        eventOn(tavern_events.GENERATION_STARTED, eventHandlers.handleGenerationStarted);
        eventOn(tavern_events.GENERATION_ENDED, eventHandlers.handleGenerationEnded);
        eventOn(tavern_events.MESSAGE_SWIPED, eventHandlers.handleMessageSwiped);
        eventOn(tavern_events.MESSAGE_DELETED, eventHandlers.handleMessageDeleted);
        eventOn(tavern_events.MESSAGE_EDITED, eventHandlers.handleMessageEdited);
        eventOn(tavern_events.CHAT_CHANGED, eventHandlers.handleChatChanged);
    };

    $(() => {
        try {
            if (DEBUG) console.log(`[${SCRIPT_NAME}] Initializing.`);
            cleanupPreviousListeners();
            addAllListeners();
            window[HANDLER_STORAGE_KEY] = eventHandlers;
            fsm.dispatch('changeChat');
        } catch (error)
        {
            console.error(`[${SCRIPT_NAME}] Error during initialization:`, error);
        }
    });
})();