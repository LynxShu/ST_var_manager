// ============================================================================
// == Situational Awareness Manager
// == Version: 1.7
// ==
// == This script provides a robust state management system for SillyTavern.
// == It correctly maintains a nested state object and passes it to the UI
// == functions, ensuring proper variable display and structure.
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
    const COMMAND_REGEX = /<(?<type>SET|ADD|DEL|REMOVE|TIMED_SET|RESPONSE_SUMMARY|CANCEL_SET)\s*::\s*(?<params>[\s\\S]*?)>/g;
    const INITIAL_STATE = { static: {}, volatile: [], responseSummary: [] };

    // --- Command Explanations ---
    // SET:          Sets a variable to a value. <SET :: path.to.var :: value>
    // ADD:          Adds a number to a variable, or an item to a list. <ADD :: path.to.var :: value>
    // DEL:          Deletes an item from a list by its numerical index. <DEL :: list_path :: index>
    // REMOVE:       Removes item(s) from a list of objects where a property matches a value. <REMOVE :: list_path :: property_name :: value>
    // TIMED_SET:    Schedules a SET command to run after a delay. <TIMED_SET :: ...>
    // CANCEL_SET:   Cancels a scheduled TIMED_SET. <CANCEL_SET :: ...>
    // RESPONSE_SUMMARY: Adds a summary of the AI's response to a list. <RESPONSE_SUMMARY :: text>


    var latest_gen_lvl = -1;

    // --- HELPER FUNCTIONS ---
    // TODO: refactor getchatmessages to JS-slash-runner version
    // TODO: refactor updates
    

    async function getRoundCounter(){

        return await getChatMessages("{{lastMessageId}}").message_id;
    }



    function parseStateFromMessage(messageContent) {
        if (!messageContent) return null;
        const match = messageContent.match(STATE_BLOCK_PARSE_REGEX);
        if (match && match[1]) {
            try {
                return JSON.parse(match[1].trim());
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Failed to parse state JSON.`, error);
                return null;
            }
        }
        return null;
    }

    async function findLatestState(chatHistory) {
        for (let i = chatHistory.length - 1; i >= 0; i--) {

            //console.log(`[SAM] [findLatestState] scanning message ${i}`);

            const message = chatHistory[i];
            if (message.role === "user") continue;
            const swipeContent = message.swipes?.[message.swipe_id ?? 0] ?? message.message;
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
        // Start with a clone of the NESTED static data.
        // Return the object with its nested structure intact.
        return _.cloneDeep(state) ?? {INITIAL_STATE};
    }


    // --- CORE LOGIC ---

    async function processVolatileUpdates(state) {
        if (!state.volatile?.length) return [];
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
                        state.responseSummary.push(command.params.trim());
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
                            console.log(`[${SCRIPT_NAME}] Canceled timed set at index ${index}.`);
                        } else {
                            state.volatile = state.volatile.filter(entry => {
                                const [varName, , , , reason] = entry;
                                return varName !== identifier && reason !== identifier;
                            });
                            if (state.volatile.length < originalCount) {
                                console.log(`[${SCRIPT_NAME}] Canceled timed set(s) matching identifier "${identifier}".`);
                            }
                        }
                        break;
                    }

                    // NEW: Deletes an item from a list at a specific index.
                    case 'DEL': {
                        const [listPath, indexStr] = params;
                        if (!listPath || indexStr === undefined) {
                            console.warn(`[${SCRIPT_NAME}] DEL command malformed. Params:`, params);
                            continue;
                        }
                        const index = parseInt(indexStr, 10);
                        if (isNaN(index)) {
                            console.warn(`[${SCRIPT_NAME}] DEL command received non-numeric index: "${indexStr}"`);
                            continue;
                        }
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) {
                            console.warn(`[${SCRIPT_NAME}] DEL: Target "${listPath}" is not an array.`);
                            continue;
                        }
                        if (index >= 0 && index < list.length) {
                            list.splice(index, 1); // Modifies the array in place
                            console.log(`[${SCRIPT_NAME}] DEL: Removed item at index ${index} from list "${listPath}".`);
                        } else {
                            console.warn(`[${SCRIPT_NAME}] DEL: Index ${index} is out of bounds for list "${listPath}" (length: ${list.length}).`);
                        }
                        break;
                    }

                    // NEW: Removes an item from a list of objects based on a property's value.
                    case 'REMOVE': {
                        const [listPath, identifier, targetId] = params;
                        if (!listPath || !identifier || targetId === undefined) {
                            console.warn(`[${SCRIPT_NAME}] REMOVE command malformed. Params:`, params);
                            continue;
                        }
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) {
                            console.warn(`[${SCRIPT_NAME}] REMOVE: Target "${listPath}" is not an array.`);
                            continue;
                        }

                        const originalLength = list.length;
                        // Filter the list, keeping only items that DON'T match the criteria.
                        const newList = list.filter(item => {
                            // Keep items that are not objects or don't have the property.
                            if (typeof item !== 'object' || item === null || !item.hasOwnProperty(identifier)) {
                                return true;
                            }
                            // Remove the item if its property value MATCHES the targetId (using non-strict comparison).
                            // So, we KEEP it if it DOES NOT match.
                            return item[identifier] != targetId;
                        });

                        if (newList.length < originalLength) {
                            // Use _.set because filter() creates a new array, which must be set back into the state.
                            _.set(state.static, listPath, newList);
                            console.log(`[${SCRIPT_NAME}] REMOVE: Removed ${originalLength - newList.length} item(s) from "${listPath}" where "${identifier}" matched "${targetId}".`);
                        } else {
                            console.log(`[${SCRIPT_NAME}] REMOVE: No item found in "${listPath}" where "${identifier}" matched "${targetId}".`);
                        }
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
    // TODO: Refactor
    // Logic incorrect. This only correlates to the LAST AI message.
    // however, we get at index anyways

    async function processMessageState(index) {
        
        // -> we must have that message at index exists. Therefore we do not need to search it down
        // getChatMessages returns an ERROR. we must try-catch it.

        var lastAIMessage = null;
        try{
            lastAIMessage = await getChatMessages(index)[0];
        }catch(e){
            console.log(`[SAM] processMessageState: Invalid index ${index}`);
            return;
        }

        // exc handling: if last message does not have content / role === "user" then return         
        if (!lastAIMessage || lastAIMessage.role === "user") return;

        // get latest tavern variable JSON
        var state = await getVariables();

        // handle all commands scheduled to execute at T = current
        // promote all promote-able commands
        const promotedCommands = await processVolatileUpdates(state);

        var messageContent = lastAIMessage.message;

        let match;
        const results = [];

        // .exec() finds the next match in the string
        while ((match = COMMAND_REGEX.exec(messageContent)) !== null) {
        const desiredResult = {type: match.groups.type, params: match.groups.params};
        results.push(desiredResult);
        }
        const newCommands = results;

        state = await applyCommandsToState([...promotedCommands, ...newCommands], state);

        // finally, write the newest state/ replace the newest state into the current latest message.
        await replaceVariables(goodCopy(state));
        state = await getVariables();
        
        const cleanNarrative = messageContent.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();

        const newStateBlock = `${STATE_BLOCK_START_MARKER}\n${JSON.stringify(state, null, 2)}\n${STATE_BLOCK_END_MARKER}`;
        const finalContent = `${cleanNarrative}\n\n${newStateBlock}`;

        // setting current chat message.
        index = lastAIMessage.message_id;
        await setChatMessage({message: finalContent}, index);

    }

    async function loadStateFromMessage(index) {

        var message = ""
        try {
            var message = await getChatMessages(index)[0];
        } catch (e) {
            console.log(`[SAM] Load state from message: Failed to get at index= ${index}, likely the index does not exist. SAM will keep old state. Error message: ${e}`);
            return;
        }

        const messageContent = message.message;

        const state = parseStateFromMessage(messageContent);
        if (state) {
            await replaceVariables(goodCopy(state));
        } else {
            const chatHistory = await getChatMessages(`0-${index}`);
            const lastKnownState = await findLatestState(chatHistory);
            await replaceVariables(goodCopy(lastKnownState));
        }
    }
    
    async function findLastAiMessageAndIndex(beforeIndex) {
        const chat = await getChatMessages("0-{{lastMessageId}}");

        if (beforeIndex === -1){
            beforeIndex = chat.length;
        }

        for (let i = beforeIndex - 1; i >= 0; i--) {
            if (chat[i].role !== "user") return i;
        }
        return -1;
    }

    // --- EVENT LISTENER REGISTRATION ---
$(async () => {
    try {
        console.log(`[${SCRIPT_NAME}] State management loading. GLHF, player.`);

        async function initializeOrReloadStateForCurrentChat() {
            console.log(`[${SCRIPT_NAME}] Loading state for current chat.`);
            const lastAiIndex = await findLastAiMessageAndIndex(-1);
            if (lastAiIndex === -1) {
                console.log(`[${SCRIPT_NAME}] No AI messages found. Initializing with default state.`);
                await replaceVariables(_.cloneDeep(INITIAL_STATE));
                return;
            }
            const lastIndex = (await getChatMessages("{{lastMessageId}}"))[0].message_id;
            
            latest_gen_lvl = lastIndex;

            await loadStateFromMessage(lastAiIndex);
        }

        const update_events = [
            tavern_events.GENERATION_STOPPED,
            tavern_events.GENERATION_ENDED
        ];

        update_events.forEach(eventName => {
            eventOn(eventName, async () => {
                console.log(`[${SCRIPT_NAME}] detected new message`);
                try {
                    const index = SillyTavern.chat.length - 1;
                    await processMessageState(index);
                } catch (error) { console.error(`[${SCRIPT_NAME}] Error in MESSAGE_RECEIVED handler:`, error); }
            });
        })

        eventOn(tavern_events.MESSAGE_SWIPED, (message) => {
            console.log(`[${SCRIPT_NAME}] detected swipe`);
            setTimeout(async () => {
                try {
                    const index = SillyTavern.chat.length - 1;
                    if (index !== -1) {
                        const lastAIMessageIndex = await findLastAiMessageAndIndex(-1);
                        await loadStateFromMessage(lastAIMessageIndex);
                    }
                } catch (error) {
                    console.error(`[${SCRIPT_NAME}] Error in deferred MESSAGE_SWIPED handler:`, error);
                }
            }, 0);
        });

        eventOn(tavern_events.MESSAGE_EDITED, async () => {
            console.log(`[${SCRIPT_NAME}] detected edit`);
            var message;
            try{
                message = (await getChatMessages("{{lastMessageId}}"))[0];
                if (message === undefined) return;
            } catch (e){
                return;
            }

            try {
                if (message.role !== "user") {
                    // if it is an AI message, reload its state. This allows manual editing of the state block.
                    const lastAiIndex = await findLastAiMessageAndIndex(-1);
                    await loadStateFromMessage(lastAiIndex);
                }
            } catch (error) { 
                console.error(`[${SCRIPT_NAME}] Error in MESSAGE_EDITED handler:`, error); 
            }
        });

        eventOn(tavern_events.CHAT_CHANGED, async () => {
            console.log(`[${SCRIPT_NAME}] detected new chat context load.`);
            try {
                await initializeOrReloadStateForCurrentChat();
            } catch(error) {
                console.error(`[${SCRIPT_NAME}] Error in CHAT_CHANGED handler:`, error);
            }
        });

        // Initial load for the very first time the script runs.
        await initializeOrReloadStateForCurrentChat();

    } catch (error) {
         console.error(`[${SCRIPT_NAME}] Error during initialization:`, error);
    }
});
})();
