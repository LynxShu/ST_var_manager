// ============================================================================
// == Situational Awareness Manager
// == Version: 1.9
// ==
// == This script provides a robust state management system for SillyTavern.
// == It correctly maintains a nested state object and passes it to the UI
// == functions, ensuring proper variable display and structure.
// == It now includes proper handling for deleted events.
// ============================================================================

(function () {
    // --- CONFIGURATION ---
    const SCRIPT_NAME = "Situational Awareness Manager";
    const STATE_BLOCK_START_MARKER = '<!--<|state|>';
    const STATE_BLOCK_END_MARKER = '</|state|>-->';

    // NON-GREEDY (lazy): Used for PARSING a single, valid state block. Note the `*?`.
    const STATE_BLOCK_PARSE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\|/g, '\\|')}([\\s\\S]*?)${STATE_BLOCK_END_MARKER.replace(/\|/g, '\\|')}`, 's');

    // GREEDY: Used for REMOVING all state blocks, from the first start to the last end. Note the `*`.
    const STATE_BLOCK_REMOVE_REGEX = new RegExp(`${STATE_BLOCK_START_MARKER.replace(/\|/g, '\\|')}([\\s\\S]*)${STATE_BLOCK_END_MARKER.replace(/\|/g, '\\|')}`, 's');

    // Use a global flag for the regex to find all commands in one go.
    const COMMAND_REGEX = /<(?<type>SET|ADD|DEL|REMOVE|TIMED_SET|RESPONSE_SUMMARY|CANCEL_SET)\s*::\s*(?<params>[\s\S]*?)>/g;
    const INITIAL_STATE = { static: {}, volatile: [], responseSummary: [] };
    let isProcessingState = false;

    // --- Command Explanations ---
    // SET:          Sets a variable to a value. <SET :: path.to.var :: value>
    // ADD:          Adds a number to a variable, or an item to a list. <ADD :: path.to.var :: value>
    // DEL:          Deletes an item from a list by its numerical index. <DEL :: list_path :: index>
    // REMOVE:       Removes item(s) from a list of objects where a property matches a value. <REMOVE :: list_path :: property lodash path :: value>
    // TIMED_SET:    Schedules a SET command to run after a delay. <TIMED_SET :: path.to.var :: new_value :: reason :: is_real_time? :: timepoint>
    // CANCEL_SET:   Cancels a scheduled TIMED_SET. <CANCEL_SET :: index or reason>
    // RESPONSE_SUMMARY: Adds a summary of the AI's response to a list. <RESPONSE_SUMMARY :: text>


    // --- HELPER FUNCTIONS ---
    async function getRoundCounter(){
        return SillyTavern.chat.length -1;
    }

    function parseStateFromMessage(messageContent) {
        if (!messageContent) return null;
        const match = messageContent.match(STATE_BLOCK_PARSE_REGEX);
        if (match && match[1]) {
            try {
                return JSON.parse(match[1].trim());
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Failed to parse state JSON.`, error);
                return {};
            }
        }
        return {};
    }

    async function findLatestState(chatHistory) {
        for (let i = chatHistory.length - 1; i >= 0; i--) {
            const message = chatHistory[i];
            if (message.is_user) continue;

            const swipeContent = message.mes;
            const state = parseStateFromMessage(swipeContent);
            if (state) {
                console.log(`[${SCRIPT_NAME}] State loaded from message at index ${i}.`);
                return _.cloneDeep(state);
            }
        }
        console.log(`[${SCRIPT_NAME}] No previous state found. Using initial state.`);
        return _.cloneDeep(INITIAL_STATE);
    }
    
    function goodCopy(state) {
        return _.cloneDeep(state) ?? {INITIAL_STATE};
    }


    // --- CORE LOGIC ---

    async function processVolatileUpdates(state) {
        if (!state.volatile.length) return [];
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
                    case 'SET': {
                        const [varName, varValue] = params;
                        if (!varName || varValue === undefined) continue;
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
                        state.volatile.push([varName, finalValue, isGameTime, targetTime, reason]);
                        break;
                    }
                    case 'CANCEL_SET': {
                        if (!params[0] || !state.volatile?.length) continue;
                        const identifier = params[0];
                        const originalCount = state.volatile.length;
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
                        const newList = list.filter(item => {
                            if (typeof item !== 'object' || item === null || !item.hasOwnProperty(identifier)) {
                                return true;
                            }
                            return item[identifier] != targetId;
                        });
                        _.set(state.static, listPath, newList);
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
            
            console.log(`[SAM] ---- Got commands ----`);
            for (let command of newCommands){
                console.log(`[SAM] Got command: ${command.type}, ${command.params} `);

            }
            const newState = await applyCommandsToState([...promotedCommands, ...newCommands], state); 
            // definitely called multiple times. This is an error.
            
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

            const messageContent = message.mes;
            const state = parseStateFromMessage(messageContent);
            
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
    // We define handlers here so we have a stable reference for adding and removing them.
    const eventHandlers = {
        // Handles new message generation.
        handleGenerationEnded: async () => {
            console.log(`[${SCRIPT_NAME}] Generation ended, processing state.`);
            try {
                const index = SillyTavern.chat.length - 1;
                await processMessageState(index);
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Error in GENERATION_ENDED handler:`, error);
            }
        },

        // Handles swiping to a different AI response.
        handleMessageSwiped: async () => {
            console.log(`[${SCRIPT_NAME}] Message swiped, reloading state.`);
            try {
                // upon swipe, it is definitely impossible to still read at level K. However, swipe means we already have length K. Therefore, we read at level K-1.
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
                // always load the latest json upon deletion.
                const lastAIMessageIndex = await findLastAiMessageAndIndex(SillyTavern.chat.length);
                if (lastAIMessageIndex !== -1) {
                    await loadStateFromMessage(lastAIMessageIndex);
                }
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Error in MESSAGE_DELETED handler:`, error);
            }

        },

        // Handles editing a message.
        handleMessageEdited: async () => {
            console.log(`[${SCRIPT_NAME}] Message edited, reloading state.`);
            try {
                const lastMessage = SillyTavern.chat[SillyTavern.chat.length - 1];
                if (lastMessage && !lastMessage.is_user) {
                    const lastAiIndex = await findLastAiMessageAndIndex(-1);
                    await loadStateFromMessage(lastAiIndex);
                }
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Error in MESSAGE_EDITED handler:`, error);
            }
        },

        // Handles loading a new chat.
        handleChatChanged: async () => {
            console.log(`[${SCRIPT_NAME}] Chat changed, initializing state.`);
            try {
                await eventHandlers.initializeOrReloadStateForCurrentChat();
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Error in CHAT_CHANGED handler:`, error);
            }
        },

        // Initializer function, also used by CHAT_CHANGED.
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
    


// --------------------------------------------------------- MORE ROBUST LISTENER MANAGEMENT ------------------------------------
    // A dedicated function to remove all listeners this script adds.
    const removeAllListeners = () => {
        console.log(`[${SCRIPT_NAME}] Removing existing event listeners.`);
        const update_events = [tavern_events.GENERATION_ENDED];
        update_events.forEach(eventName => {
            // Note: We use the same function reference from eventHandlers
            eventRemoveListener(eventName, eventHandlers.handleGenerationEnded);
        });
        eventRemoveListener(tavern_events.MESSAGE_SWIPED, eventHandlers.handleMessageSwiped);
        eventRemoveListener(tavern_events.MESSAGE_DELETED, eventHandlers.handleMessageDeleted);
        eventRemoveListener(tavern_events.MESSAGE_EDITED, eventHandlers.handleMessageEdited);
        eventRemoveListener(tavern_events.CHAT_CHANGED, eventHandlers.handleChatChanged);
    };

    // A dedicated function to add all listeners.
    const addAllListeners = () => {
        console.log(`[${SCRIPT_NAME}] Registering event listeners.`);
        const update_events = [tavern_events.GENERATION_ENDED];
        update_events.forEach(eventName => {
            eventOn(eventName, eventHandlers.handleGenerationEnded);
        });
        eventOn(tavern_events.MESSAGE_SWIPED, eventHandlers.handleMessageSwiped);
        eventOn(tavern_events.MESSAGE_DELETED, eventHandlers.handleMessageDeleted);
        eventOn(tavern_events.MESSAGE_EDITED, eventHandlers.handleMessageEdited);
        eventOn(tavern_events.CHAT_CHANGED, eventHandlers.handleChatChanged);
    };


    // --- MAIN EXECUTION ---
    $(() => {
        // This block now runs safely every time the script is injected or reloaded.
        try {
            console.log(`[${SCRIPT_NAME}] State management loading. GLHF, player.`);

            // 1. ALWAYS clean up first to remove any listeners from a previous script load.
            removeAllListeners();

            // 2. NOW, register the listeners fresh.
            addAllListeners();

            // 3. Perform initial load.
            eventHandlers.initializeOrReloadStateForCurrentChat();

        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Error during initialization:`, error);
        }
    });

    // The 'unload' handler is no longer necessary for listener cleanup,
    // as our setup is now self-healing. You could keep it for other
    // teardown tasks if needed, but it's not reliable for this purpose.
    //
    $(window).on('unload', () => { removeAllListeners();});

})();
