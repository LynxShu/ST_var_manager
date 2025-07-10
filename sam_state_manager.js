// ============================================================================
// == Situational Awareness Manager
// == Version: 2.0
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

    // --- MODIFIED --- Added EVAL to the regex
    const COMMAND_REGEX = /<(?<type>SET|ADD|DEL|REMOVE|TIMED_SET|RESPONSE_SUMMARY|CANCEL_SET|EVAL)\s*::\s*(?<params>[\s\S]*?)>/g;

    // --- MODIFIED --- Added 'func' to the initial state
    const INITIAL_STATE = { static: {}, volatile: [], responseSummary: [], func: [] };
    let isProcessingState = false;

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
    // State Structure for functions:
    /*
    "func": [
        {
            "func_name": "myFunction",
            "func_params": ["param1", "someOtherParam"],
            "func_body": "state.static.someValue = param1 + someOtherParam; return 'Success!';",
            "timeout": 2000, // Optional, in milliseconds. Default is 2000ms.
            "network_access": false // Optional, boolean. Default is false.
        }
    ]
    */

    // --- HELPER FUNCTIONS ---
    async function getRoundCounter(){
        return SillyTavern.chat.length -1;
    }

    function parseStateFromMessage(messageContent) {
        if (!messageContent) return null;
        const match = messageContent.match(STATE_BLOCK_PARSE_REGEX);
        if (match && match[1]) {
            try {
                // --- MODIFIED --- Ensure the state has all required keys
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
        return null; // Return null if no state block is found
    }

    async function findLatestState(chatHistory) {
        for (let i = chatHistory.length - 1; i >= 0; i--) {
            const message = chatHistory[i];
            if (message.is_user) continue;

            const state = parseStateFromMessage(message.mes);
            if (state) {
                console.log(`[${SCRIPT_NAME}] State loaded from message at index ${i}.`);
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

        // Create a promise for the function execution
        const executionPromise = new Promise(async (resolve, reject) => {
            try {
                // 1. Prepare sandboxing for network access
                const networkBlocker = () => { throw new Error('EVAL: Network access is disabled for this function.'); };
                const fetchImpl = allowNetwork ? window.fetch.bind(window) : networkBlocker;
                const xhrImpl = allowNetwork ? window.XMLHttpRequest : networkBlocker;

                // 2. Define the arguments and their values for the dynamic function
                // The function will have access to: state, _ (lodash), its defined params, and the sandboxed network functions
                const argNames = ['state', '_', 'fetch', 'XMLHttpRequest', ...paramNames];
                const argValues = [state, _, fetchImpl, xhrImpl, ...params];

                // 3. Create the function from its string body
                // The 'use strict' pragma is a good security practice.
                const functionBody = `'use strict';\n${funcDef.func_body}`;
                const userFunction = new Function(...argNames, functionBody);

                // 4. Execute the function with the provided context and arguments
                const result = await userFunction.apply(null, argValues);
                resolve(result);

            } catch (error) {
                reject(error);
            }
        });

        // Create a timeout promise
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`EVAL: Function '${funcName}' timed out after ${timeout}ms.`)), timeout);
        });

        // Race the execution against the timeout
        try {
            const result = await Promise.race([executionPromise, timeoutPromise]);
            console.log(`[${SCRIPT_NAME}] EVAL: Function '${funcName}' executed successfully.`, { result });
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] EVAL: Error executing function '${funcName}'.`, error);
        }
    }


    // --- CORE LOGIC ---

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
            const params = command.params.split('::').map(p => p.trim());
            
            try {
                switch (command.type) {
                    // (Existing cases: SET, ADD, etc. remain unchanged)
                    case 'SET': {
                        const [varName, varValue] = params;
                        if (!varName || varValue === undefined) continue;


                        // special values.
                        if (["true", "false", "undefined", "null"].includes(varValue.trim().toLowerCase())){
                            
                            varValue = varValue.trim().toLowerCase();
                            if (varValue === "true"){
                                varValue = true;
                            }

                            if (varValue === "false"){
                                varValue = false;
                            }

                            if (varValue === "undefined"){
                                varValue = undefined;
                            }

                            if (varValue === "null"){
                                varValue = null;
                            }

                        }

                        _.set(state.static, varName, isNaN(varValue) ? varValue : Number(varValue));
                        break;
                    }
                    case 'ADD': {
                        const [varName, incrementStr] = params;
                        if (!varName || incrementStr === undefined) continue;
                        const existing = _.get(state.static, varName, 0);
                        if (Array.isArray(existing)) {
                            existing.push(incrementStr);
                        } else {
                            const increment = Number(incrementStr);
                            const baseValue = Number(existing) || 0;
                            if (isNaN(increment) || isNaN(baseValue)) continue;
                            _.set(state.static, varName, baseValue + increment);
                        }
                        break;
                    }
                    case 'RESPONSE_SUMMARY': {
                        if (!state.responseSummary) state.responseSummary = [];
                        if (!state.responseSummary.includes(command.params.trim())){
                           state.responseSummary.push(command.params.trim());
                        }
                        break;
                    }
                    case 'TIMED_SET': {
                        const [varName, varValue, reason, isGameTimeStr, timeUnitsStr] = params;
                        if (!varName || !varValue || !reason || !isGameTimeStr || !timeUnitsStr) continue;
                        const isGameTime = isGameTimeStr.toLowerCase() === 'true';
                        const finalValue = isNaN(varValue) ? varValue : Number(varValue);
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
                        // The state object is passed by reference, so any modifications
                        // made by the sandboxed function will persist.
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
    // (No changes needed in processMessageState, loadStateFromMessage, or the event handlers)
    async function processMessageState(index) {
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
                await replaceVariables(goodCopy(state));
            } else {
                const chatHistory = SillyTavern.chat;
                const lastKnownState = await findLatestState(chatHistory);
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
            console.log(`[${SCRIPT_NAME}] Message swiped, reloading state.`);
            try {
                const lastAIMessageIndex = await findLastAiMessageAndIndex(SillyTavern.chat.length);
                if (lastAIMessageIndex !== -1) {
                    await loadStateFromMessage(lastAIMessageIndex);
                }
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
    
    const removeAllListeners = () => {
        console.log(`[${SCRIPT_NAME}] Removing existing event listeners.`);
        eventRemoveListener(tavern_events.GENERATION_ENDED, eventHandlers.handleGenerationEnded);
        eventRemoveListener(tavern_events.MESSAGE_SWIPED, eventHandlers.handleMessageSwiped);
        eventRemoveListener(tavern_events.MESSAGE_DELETED, eventHandlers.handleMessageDeleted);
        eventRemoveListener(tavern_events.MESSAGE_EDITED, eventHandlers.handleMessageEdited);
        eventRemoveListener(tavern_events.CHAT_CHANGED, eventHandlers.handleChatChanged);
    };

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
            console.log(`[${SCRIPT_NAME}] V2.0 loading. GLHF, player.`);
            removeAllListeners();
            addAllListeners();
            eventHandlers.initializeOrReloadStateForCurrentChat();
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Error during initialization:`, error);
        }
    });
    
    $(window).on('unload', () => { removeAllListeners();});

})();
