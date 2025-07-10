// ============================================================================
// == Situational Awareness Manager
// == Version: 2.1 (Listener Fix)
// ==
// == This script provides a robust state management system for SillyTavern.
// == It correctly maintains a nested state object and passes it to the UI
// == functions, ensuring proper variable display and structure.
// == It now includes a sandboxed EVAL command for user-defined functions.
// ============================================================================

(function () {
    // --- CONFIGURATION ---
    const SCRIPT_NAME = "Situational Awareness Manager";
    const STATE_BLOCK_START_MARKER = '<!--<|state|>';
    const STATE_BLOCK_END_MARKER = '</|state|>-->';
    const STATE_BLOCK_PARSE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\|/g, '\\|')}([\\s\\S]*?)${STATE_BLOCK_END_MARKER.replace(/\|/g, '\\|')}`, 's');
    const STATE_BLOCK_REMOVE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\|/g, '\\|')}([\\s\\S]*)${STATE_BLOCK_END_MARKER.replace(/\|/g, '\\|')}`, 's');

    const COMMAND_REGEX = /<(?<type>SET|ADD|DEL|REMOVE|TIMED_SET|RESPONSE_SUMMARY|CANCEL_SET|EVAL)\s*::\s*(?<params>[\s\\S]*?)>/g;

    const INITIAL_STATE = { static: {}, volatile: [], responseSummary: [], func: [] };
    let isProcessingState = false;

    // --- MODIFIED --- SCRIPT LIFECYCLE MANAGEMENT ---
    // This key is used to store our event handlers on the global window object.
    // This allows a new instance of the script to find and remove the listeners
    // from the old instance, preventing the "multiple listener" error.
    const HANDLER_STORAGE_KEY = `__SAM_V2_EVENT_HANDLERS__`;

    // This function can remove listeners using a given handler object.
    const cleanupListeners = (handlers) => {
        if (!handlers) return;
        console.log(`[${SCRIPT_NAME}] Removing listeners from a previous instance.`);
        eventRemoveListener(tavern_events.GENERATION_ENDED, handlers.handleGenerationEnded);
        eventRemoveListener(tavern_events.MESSAGE_SWIPED, handlers.handleMessageSwiped);
        eventRemoveListener(tavern_events.MESSAGE_DELETED, handlers.handleMessageDeleted);
        eventRemoveListener(tavern_events.MESSAGE_EDITED, handlers.handleMessageEdited);
        eventRemoveListener(tavern_events.CHAT_CHANGED, handlers.handleChatChanged);
    };

    // On script load, check if an old set of handlers exists on the window and clean them up.
    if (window[HANDLER_STORAGE_KEY]) {
        cleanupListeners(window[HANDLER_STORAGE_KEY]);
    }
    // --- END MODIFICATION ---

    // --- Command Explanations ---
    // SET:          Sets a variable to a value. <SET :: path.to.var :: value>
    // ADD:          Adds a number to a variable, or an item to a list. <ADD :: path.to.var :: value>
    // DEL:          Deletes an item from a list by its numerical index. <DEL :: list_path :: index>
    // REMOVE:       Removes item(s) from a list where a property matches a value. <REMOVE :: list_path :: property's relative path :: value>
    // TIMED_SET:    Schedules a SET command. <TIMED_SET :: path.to.var :: new_value :: reason :: is_real_time? :: timepoint>
    // CANCEL_SET:   Cancels a scheduled TIMED_SET. <CANCEL_SET :: index or reason>
    // RESPONSE_SUMMARY: Adds a summary of the AI's response to a list. <RESPONSE_SUMMARY :: text>
    //
    // EVAL command documentation
    // EVAL:         Executes a user-defined function stored in the state.
    // Syntax:       <EVAL :: function_name :: param1 :: param2 :: ...>
    // WARNING: DANGEROUS FUNCTIONALITY. KNOW WHAT YOU ARE DOING, I WILL NOT TAKE RESPONSIBILITY FOR YOUR FAILURES AS STATED IN LICENSE.
    // YOU HAVE BEEN WARNED.
    /* ... (rest of documentation) ... */

    // --- HELPER FUNCTIONS ---
    async function getRoundCounter(){
        return SillyTavern.chat.length -1;
    }

    function tryParseJSON(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return str; // Return original string if it's not valid JSON
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

    async function findLatestState(chatHistory, lastIndex = chatHistory.length-1) {
        console.log(`[SAM] finding latest state down from ${lastIndex}`);
        for (let i = lastIndex; i >= 0; i--) {
            const message = chatHistory[i];
            if (message.is_user) continue;

            const state = parseStateFromMessage(message.mes);
            if (state) {
                console.log(`[${SCRIPT_NAME}] Found latest state, State loaded from message at index ${i}.`);
                return _.cloneDeep(state);
            }
        }
        console.log(`[${SCRIPT_NAME}] No previous state found. Using initial state.`);
        return _.cloneDeep(INITIAL_STATE);
    }
    
    function goodCopy(state) {
        return _.cloneDeep(state) ?? _.cloneDeep(INITIAL_STATE);
    }

    // --- NEW --- Sandboxed function executor
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
            console.log(`[${SCRIPT_NAME}] EVAL: Function '${funcName}' executed successfully.`, { result });
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] EVAL: Error executing function '${funcName}'.`, error);
        }
    }


    // --- CORE LOGIC ---
    // ... (All core logic functions like processVolatileUpdates, applyCommandsToState, etc. remain unchanged) ...
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
                promotedCommands.push({ type: 'SET', params: `${varName} :: ${varValue}` });
            } else {
                remainingVolatiles.push(volatile);
            }
        }
        state.volatile = remainingVolatiles;
        return promotedCommands;
    }

    async function applyCommandsToState(commands, state) {
        const currentRound = await getRoundCounter();
        for (const command of commands) {
            let params = command.params.split('::').map(p => p.trim());
            
            try {
                switch (command.type) {
                    case 'SET': {
                        let [varName, varValue] = params;
                        if (!varName || varValue === undefined) continue;

                        if (["true", "false", "undefined", "null"].includes(varValue.trim().toLowerCase())){
                            varValue = varValue.trim().toLowerCase();
                            if (varValue === "true") varValue = true;
                            if (varValue === "false") varValue = false;
                            if (varValue === "undefined") varValue = undefined;
                            if (varValue === "null") varValue = null;
                        }

                        

                        _.set(state.static, varName, isNaN(varValue) ? tryParseJSON(varValue) : Number(varValue));
                        break;
                    }
                    case 'ADD': {
                        const [varName, incrementStr] = params;
                        if (!varName || incrementStr === undefined) continue;
                        const existing = _.get(state.static, varName, 0);
                        if (Array.isArray(existing)) {
                            existing.push(tryParseJSON(incrementStr));
                        } else {
                            const increment = Number(incrementStr);
                            const baseValue = Number(existing) || 0;
                            if (isNaN(increment) || isNaN(baseValue)) continue;
                            _.set(state.static, varName, baseValue + increment);
                        }
                        break;
                    }
                    case 'RESPONSE_SUMMARY': {
                        if (!Array.isArray(state.responseSummary)) {
                            state.responseSummary = state.responseSummary ? [state.responseSummary] : [];
                        }
                        if (!state.responseSummary.includes(command.params.trim())){
                           state.responseSummary.push(command.params.trim());
                        }
                        break;
                    }
                    case 'TIMED_SET': {
                        const [varName, varValue, reason, isGameTimeStr, timeUnitsStr] = params;
                        if (!varName || !varValue || !reason || !isGameTimeStr || !timeUnitsStr) continue;
                        const isGameTime = isGameTimeStr.toLowerCase() === 'true';
                        const finalValue = isNaN(varValue) ? tryParseJSON(finalValue) : Number(varValue);
                        const targetTime = isGameTime ? new Date(timeUnitsStr).toISOString() : currentRound + Number(timeUnitsStr);
                        if(!state.volatile) state.volatile = [];
                        state.volatile.push([varName, finalValue, isGameTime, targetTime, reason]);
                        break;
                    }
                    case 'CANCEL_SET': {
                        if (!params[0] || !state.volatile?.length) continue;
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
                        break;
                    }
                    case 'DEL': {
                        const [listPath, indexStr] = params;
                        if (!listPath || indexStr === undefined) continue;
                        const index = parseInt(indexStr, 10);
                        if (isNaN(index)) continue;
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) continue;
                        if (index >= 0 && index < list.length) {
                            list.splice(index, 1);
                        }
                        break;
                    }
                    case 'REMOVE': {
                        const [listPath, identifier, targetId] = params;
                        if (!listPath || !identifier || targetId === undefined) continue;
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) continue;
                        _.set(state.static, listPath, _.reject(list, {[identifier]: targetId}));
                        break;
                    }
                    case 'EVAL': {
                        const [funcName, ...funcParams] = params;
                        if (!funcName) {
                            console.warn(`[${SCRIPT_NAME}] EVAL aborted: EVAL command requires a function name.`);
                            continue;
                        }
                        await runSandboxedFunction(funcName, funcParams, state);
                        break;
                    }
                }
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Error processing command: ${JSON.stringify(command)}`, error);
            }
        }
        return state;
    }

    // --- MAIN HANDLERS ---
    // ... (All main handlers like processMessageState, loadStateFromMessage, etc. remain unchanged) ...
    async function processMessageState(index) {
        console.log(`[SAM] processing message state at ${index}`);

        if (isProcessingState) return;
        isProcessingState = true;
        
        try {
            if (index === "{{lastMessageId}}"){
                index = SillyTavern.chat.length - 1;
            }
            const lastAIMessage = SillyTavern.chat[index];
            if (!lastAIMessage || lastAIMessage.is_user) return;
            
            const state = await getVariables();
            const promotedCommands = await processVolatileUpdates(state);
            const messageContent = lastAIMessage.mes;
            
            let match;
            const newCommands = [];
            while ((match = COMMAND_REGEX.exec(messageContent)) !== null) {
                newCommands.push({type: match.groups.type, params: match.groups.params});
            }
            
            if (newCommands.length > 0) {
                 console.log(`[SAM] ---- Found ${newCommands.length} command(s) to process ----`);
            }

            const newState = await applyCommandsToState([...promotedCommands, ...newCommands], state); 
            
            await replaceVariables(goodCopy(newState));
            
            const cleanNarrative = messageContent.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            const newStateBlock = `${STATE_BLOCK_START_MARKER}\n${JSON.stringify(newState, null, 2)}\n${STATE_BLOCK_END_MARKER}`;
            const finalContent = `${cleanNarrative}\n\n${newStateBlock}`;
            
            await setChatMessage({message: finalContent}, index);
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
                console.log(`[SAM] replacing variables with found state at index ${index}`);
                await replaceVariables(goodCopy(state));
            } else {
                console.log("[SAM] did not find valid state at index, replacing with latest state")
                const chatHistory = SillyTavern.chat;
                const lastKnownState = await findLatestState(chatHistory);
                await replaceVariables(goodCopy(lastKnownState));
            }
        } catch (e) {
            console.log(`[${SCRIPT_NAME}] Load state from message failed for index ${index}:`, e);
        }
    }
    
    async function loadPreviousStateFromMessage(index) {
        console.log("[SAM] LOADING previous state from a previous messgae");
        if (index === "{{lastMessageId}}") {
            index = SillyTavern.chat.length - 1;
        }

        try {
            const message = SillyTavern.chat[index];
            if (!message) return;

            const state = parseStateFromMessage(message.mes);
            
            if (state) {
                await replaceVariables(goodCopy(state));
            } else {
                const chatHistory = SillyTavern.chat;
                const lastKnownState = await findLatestState(chatHistory, index);
                await replaceVariables(goodCopy(lastKnownState));
            }
        } catch (e) {
            console.log(`[${SCRIPT_NAME}] Load state from message failed for index ${index}:`, e);
        }
    }
    
    async function findLastAiMessageAndIndex(beforeIndex) {
        const chat = SillyTavern.chat;
        if (beforeIndex === -1) {
            beforeIndex = chat.length;
        }
        for (let i = beforeIndex - 1; i >= 0; i--) {
            if (chat[i].is_user === false) return i;
        }
        return -1;
    }

    // --- EVENT HANDLER DEFINITIONS ---
    const eventHandlers = {
        handleGenerationEnded: async () => {
            console.log(`[${SCRIPT_NAME}] Generation ended, processing state.`);
            try {
                const index = SillyTavern.chat.length - 1;
                await processMessageState(index);
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Error in GENERATION_ENDED handler:`, error);
            }
        },
        handleMessageSwiped: async () => {
            console.log(`[${SCRIPT_NAME}] Message swiped, reloading state. `);
            try {
                let lastAIMessageIndex = await findLastAiMessageAndIndex(SillyTavern.chat.length);

                if (lastAIMessageIndex == 0){
                    await loadStateFromMessage(lastAIMessageIndex);
                }else{
                    await loadPreviousStateFromMessage(lastAIMessageIndex - 1); // always go for the previous one.
                }

                console.log("[SAM] swipe finished");
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Error in MESSAGE_SWIPED handler:`, error);
            }
        },
        handleMessageDeleted: async () => {
            console.log(`[${SCRIPT_NAME}] Message deleted, reloading last state`);
            try {
                const lastAIMessageIndex = await findLastAiMessageAndIndex(SillyTavern.chat.length);
                if (lastAIMessageIndex !== -1) {
                    await loadStateFromMessage(lastAIMessageIndex);
                } else {
                    await eventHandlers.initializeOrReloadStateForCurrentChat();
                }
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Error in MESSAGE_DELETED handler:`, error);
            }
        },
        handleMessageEdited: async () => {
            console.log(`[${SCRIPT_NAME}] Message edited, reloading state.`);
            try {
                const lastAiIndex = await findLastAiMessageAndIndex(-1);
                if (lastAiIndex !== -1) {
                    await loadStateFromMessage(lastAiIndex);
                }
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Error in MESSAGE_EDITED handler:`, error);
            }
        },
        handleChatChanged: async () => {
            console.log(`[${SCRIPT_NAME}] Chat changed, initializing state.`);
            try {
                await eventHandlers.initializeOrReloadStateForCurrentChat();
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Error in CHAT_CHANGED handler:`, error);
            }
        },
        initializeOrReloadStateForCurrentChat: async () => {
            const lastAiIndex = await findLastAiMessageAndIndex(-1);
            if (lastAiIndex === -1) {
                console.log(`[${SCRIPT_NAME}] No AI messages found. Initializing with default state.`);
                await replaceVariables(_.cloneDeep(INITIAL_STATE));
            } else {
                await loadStateFromMessage(lastAiIndex);
            }
        }
    };
    
    // --- MODIFIED --- Simplified listener management
    // We no longer need a separate `removeAllListeners` function for the hot-reload case.
    // The cleanup logic at the top of the file handles that.

    const addAllListeners = () => {
        console.log(`[${SCRIPT_NAME}] Registering event listeners.`);
        eventOn(tavern_events.GENERATION_ENDED, eventHandlers.handleGenerationEnded);
        eventOn(tavern_events.MESSAGE_SWIPED, eventHandlers.handleMessageSwiped);
        eventOn(tavern_events.MESSAGE_DELETED, eventHandlers.handleMessageDeleted);
        eventOn(tavern_events.MESSAGE_EDITED, eventHandlers.handleMessageEdited);
        eventOn(tavern_events.CHAT_CHANGED, eventHandlers.handleChatChanged);
    };

    // --- MAIN EXECUTION ---
    $(() => {
        try {
            console.log(`[${SCRIPT_NAME}] V2.1 loading. GLHF, player.`);
            // --- MODIFIED ---
            // The old listeners were already cleaned up. We just need to add the new ones.
            addAllListeners();
            // Store the newly created handlers on the window object for the *next* reload.
            window[HANDLER_STORAGE_KEY] = eventHandlers;
            // Initialize the state for the current chat.
            eventHandlers.initializeOrReloadStateForCurrentChat();
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Error during initialization:`, error);
        }
    });
    
    // --- MODIFIED ---
    // This `unload` event is for when the user closes the tab or navigates away.
    // We use the same cleanup function to be good citizens.
    $(window).on('unload', () => {
        cleanupListeners(window[HANDLER_STORAGE_KEY]);
    });

})();
