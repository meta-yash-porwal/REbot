const connFactory = require('../util/connection-factory');
const logger = require('../common/logger');

const { getRefTypes, getOpp, getOppfromName, getOppfromAcc, saveTeamId, checkOrgSettingAndGetData} = require('../util/refedge');

const { checkTeamMigration } = require('../listeners/middleware/migration-filter');

module.exports = controller => {

    controller.on('direct_message,direct_mention', 
    async (bot, message) => {

        try {
            console.log('------direct mention---');
            const supportUrl = `https://www.point-of-reference.com/contact/`;
            let messageText = message.text ? message.text.toLowerCase() : '';
            
            if (messageText.includes('hello')) {
                bot.replyEphemeral(message, `Hi, you can invite me to the channel for Customer Reference Team to receive updates!`);
            } else if (messageText == 'connect to a salesforce instance' || messageText == 'connect to sf'  
                || (messageText.includes('connect') && messageText.includes('salesforce') )) {//|| message.intent === 'connect_to_sf'
                let existingConn = await connFactory.getConnection(message.team, controller);

                if (!existingConn) {
                    const authUrl = connFactory.getAuthUrl(message.team);
                    bot.replyEphemeral(message, `click this link to connect\n<${authUrl}|Connect to Salesforce>`);
                }else {
                        /* await controller.plugins.database.orgs.delete(message.team);
                        const authUrl = connFactory.getAuthUrl(message.team);
                        await bot.reply(message, `click this link to connect\n<${authUrl}|Connect to Salesforce>`); */
                        await bot.beginDialog('sf_auth');
                 }
            } else if (messageText.includes('help')) {
                bot.replyEphemeral(message, 
                `Hello, Referencebot here. I can help you find customer references, and deliver messages related to your customer reference requests. \n`
                +`Use the /references command to start a search for reference accounts or reference content. \n`
                + `Are you an administrator? I can connect you to a Salesforce instance. Just type "connect to a Salesforce instance" to get started. \n`
                + `Please visit the <${supportUrl}|support page> if you have any further questions.`);
            } else {
                bot.replyEphemeral(message, `Sorry, I didn't understand that.`);
            }
        } catch (err) {
            logger.log(err);
        }
    });

    controller.on('post-message', reqBody => {
        console.log('posting message for org----', reqBody.orgId);
        
        reqBody.messages.forEach(async msg => {

            try {
                let teamIdsArray = reqBody.teamId.split(',');
                const teams = await controller.plugins.database.teams.find({ id: { $in: teamIdsArray } });
                
                if (!teams) {
                    return logger.log('team not found for id:', reqBody.teamId);
                }

                for (let index = 0, len = teams.length; index < len; index++) {
                    console.log('...checking migration...');
                    const isTeamMigrating = await checkTeamMigration(teams[index].id, controller);
                    if (!isTeamMigrating) {
                        console.log('...spawning bot...');
                        const bot = await controller.spawn(teams[index].id);
                        console.log('...spawning bot2...');
                        if (msg.userEmail) {
                            console.log('...getting userData...');
                            const userData = await bot.api.users.lookupByEmail({//Bot token - users:read.email
                                token: teams[index].bot.token,
                                email: msg.userEmail
                            });

                            if (!userData || !userData.user) {
                                return logger.log('user not found in team ' + teams[index].id + ' for email:', msg.userEmail);
                            }
                            console.log('...starting conversation...');
                            await bot.startPrivateConversation(userData.user.id);
                            await bot.say(msg.text);
                        } else {
                            console.log('....getting channels...');
                            const channels = await controller.plugins.database.channels.find({ team_id: teams[index].id });
                            if (channels && channels.length > 0) {
                                console.log('posting message in channel');
                                await bot.startConversationInChannel(channels[0].id);
                                await bot.say(msg.text);
                            }
                        }
                    } else {
                        logger.log(`cannot post message for team id ${teams[index].id}, this team is in migration `);
                    }
                }
            } catch (err) {
                logger.log(err);
            }
        });
    });

    controller.on('app_home_opened', async (bot, event) =>{
        console.log('----------App-home-opened---------');
        console.log('bot information');
        
        try {
            // Call the conversations.history method.
            const result = await bot.api.conversations.history({//im:history
                channel: event.channel
            });
            
            let conversationHistory = result.messages;
            console.log('----------messages----------------');
            
            if (conversationHistory.length <= 0) {
                console.log('....posting first msg for new user......');
                const support_page = 'https://www.point-of-reference.com/contact/';
                await bot.say(`Hello, I'm Referencebot. I'm here to assist you with finding customer references, and to help deliver messages related to your reference requests from ReferenceEdge to you. \n`
                + `Use the /references command to request reference accounts or reference content. \n` 
                + `Are you an administrator? I can connect you to a Salesforce instance. Just type 'connect to a Salesforce instance' to get started.\n`
                +`Please visit the <${support_page}|support page> if you have any further questions.`
                );
                console.log('.....message posted.....');
            }
        }catch (error) {
            console.log('--error in app home opened event--');
            console.error(error);
        }
        
    });

    controller.on('app_uninstalled', async (ctrl, event) => {

        try {
        	const channels = await controller.plugins.database.channels.find({ team_id: event.team });

            if (channels && channels.length > 0) {
                await controller.plugins.database.channels.delete(channels[0].id);
            }
            //controller.plugins.database.teams.delete(event.team_id); uncomment it if any issue.
            const existingConn = await connFactory.getConnection(event.team, controller);
            if (existingConn) {
                let teamData = { removeTeam: event.team };
                saveTeamId(existingConn, teamData);
                const revokeResult = await connFactory.revoke({
                    revokeUrl: existingConn.oauth2.revokeServiceUrl,
                    refreshToken: existingConn.refreshToken,
                    teamId: event.team
                }, controller);
                logger.log('delete org result:', revokeResult);
            }
            const deletion_result = await controller.plugins.database.teams.delete(event.team);
            console.log('deletion result------');
            console.dir(deletion_result);
        } catch (err) {
            console.log('error occured during uninstall...');
        	logger.log(err);
        }
    });

    controller.on('oauth_success', async authData => {
        console.log('******************-----/oauth_success/-----******************');
        console.log('-----/authData/-----')
        
        try {
            let existingTeam = await controller.plugins.database.teams.get(authData.team.id);

            let isNew = false;

            if (!existingTeam) {
                console.log('....creating new team....');
                isNew = true;
                existingTeam = {
                    id: authData.team.id,
                    name: authData.team.name,
                    is_migrating: false
                };
            }else{
                console.log('found existing team...');
            }
            existingTeam.bot = {
                token : authData.access_token,
                user_id : authData.bot_user_id,
                created_by: authData.authed_user.id
            };
            console.log('....saving team....');
            const savedTeam = await controller.plugins.database.teams.save(existingTeam);
            console.log('saved team');
            console.dir(savedTeam);
			if (isNew) {
                console.log('....creation of crp channel.....');
                let bot = await controller.spawn(authData.team.id);
                controller.trigger('create_channel', bot, authData);
            }
        } catch (err) {
            console.log('-------error-----------');
            console.log(err);
        }
    });

    controller.on('onboard', async (bot, params) => {
        console.log('....onboarding message.....');
        const internal_url = 'slack://channel?team='+ params.teamId +'&id='+ params.channelId;
        const support_page = 'https://www.point-of-reference.com/contact/';
        
        await bot.startPrivateConversation(params.userId);
        await bot.say(`Hello, Referencebot here. I have joined your workspace. I deliver messages from ReferenceEdge to your Customer Reference Program (CRP) team and individual users, and assist users with finding customer references.\n`
                + `I have created a public channel with the name <${internal_url}|crp_team> for the CRP Team. All updates for the CRP Team will be posted in this channel. `
                + `You should add the members of the Customer Reference Team to this channel to ensure they receive these updates. `
                + `You can do this by selecting the crp_team channel then clicking the add people icon. `
                + `To connect your workspace to ReferenceEdge you can type "connect to a salesforce instance". `
                + `Please visit the <${support_page}|support page> if you have any further questions.`);
    });

    controller.on('create_channel', async (bot, authData) => {
        console.log('******************-----/create_channel/-----******************');
        try {
            let result = await bot.api.conversations.create({ //channels:manage
                token: authData.access_token,
                name: 'crp_team'
            });
            console.log('....channel created....');
            const crpTeamChannel = {
                id: result.channel.id,
                name: result.channel.name,
                team_id: authData.team.id
            };
            console.log('-----/ saving crpTeamChannel/-----');
            const savedData = await controller.plugins.database.channels.save(crpTeamChannel);
            console.log('savedData');
            
            const params = {
                userId : authData.authed_user.id,
                channelId : crpTeamChannel.id,
                teamId : crpTeamChannel.team_id
            };
            controller.trigger('onboard', bot, params);

        } catch (err) {
            console.log('error setting up crp_team channel:', err);
        }
    });

    controller.on(
        'slash_command',
        async (bot, message) => {
            try {
                console.log('slash_command');
                let pvt_metadata = {'email':'', 'isContentType':false, 'isRefType':false, 
                'isBoth':false, 'actionName':'', 'contentTypes': '', 'refTypes':'', 
                'searchURL':'', 'pkg_version':''};
                if(message.text && message.text.toLowerCase()  == 'help'){
                    await bot.replyEphemeral(message,
                        `This command allows you to start a search for customer reference resources, without being in Salesforce.\n`
                        + `You’ll be taken to the Reference Search page where you can refine your search, request the use of an account, and, if enabled, share content.`
                    );
                }else{
                    let existingConn = await connFactory.getConnection(message.team, controller);
                    
                    if (existingConn) {
                        const userProfile = await bot.api.users.info({//users.read scope
                            token : bot.api.token,
                            user : message.user
                        });
                        console.log('.......checking org settings ....');
                        let response = null;
                        try {
                            response = await checkOrgSettingAndGetData(existingConn, userProfile.user.profile.email);
                            console.log('###response ', response);
                            if(response !== 'both') {

                                let temp = JSON.parse(response);
                                if(temp.hasOwnProperty('action')) {//added in 2.26 release.
                                    response = temp.action;
                                    pvt_metadata.pkg_version = parseFloat(temp.pkg_version);
                                    console.log('pkg version: ', pvt_metadata.pkg_version);
                                    console.log('floating...', parseFloat(pvt_metadata.pkg_version));
                                }
                            }
                            console.log('checking org settings!!!!', response);
                        }catch(err) {
                            response = 'both';
                            console.log('...exception in checking org...');
                            logger.log(err);
                        }
                        
                        if (response != 'false' && response != 'both') {
                            
                            response = JSON.parse(response);
                            console.log('response', response);
                            if(!response.hasOwnProperty('account_search')) {
                                let content_search = '';
                                if(response.hasOwnProperty('pkg_version')) {
                                    pvt_metadata.pkg_version = response.pkg_version;
                                    content_search = JSON.parse(response.content_search);
                                } else {
                                    content_search = response.content_search;
                                }
                                let contentData = processContentResponse(content_search);
                                console.log('...content opp flow...');
                                pvt_metadata.email = userProfile.user.profile.email;
                                pvt_metadata.actionName = 'content_search';
                                pvt_metadata.isContentType = true;
                                
                                await bot.api.views.open({
                                    trigger_id: message.trigger_id,
                                    view: {
                                        "type": "modal",
                                        "notify_on_close" : true,
                                        "callback_id": "oppselect",
                                        "private_metadata" : JSON.stringify(pvt_metadata),
                                        "submit": {
                                            "type": "plain_text",
                                            "text": "Next",
                                            "emoji": true
                                        },
                                        "title": {
                                            "type": "plain_text",
                                            "text": "Content Type",
                                            "emoji": true
                                        },
                                        "blocks": [
                                            {
                                                "type": "input",
                                                "optional" : true,
                                                "block_id": "blkref",
                                                "element": {
                                                    "type": "multi_static_select",
                                                    "action_id": "reftype_select",
                                                    "placeholder": {
                                                        "type": "plain_text",
                                                        "text": "Select a type",
                                                        "emoji": true
                                                    },
                                                    "options": contentData
                                                },
                                                "label": {
                                                    "type": "plain_text",
                                                    "text": "What type of reference content do you need?",
                                                    "emoji": true
                                                }
                                            }
                                        ]
                                    }
                                }); 
                            } else {
                                console.log('...Reftype flow...');
                                let account_search = '';
                                if(response.hasOwnProperty('pkg_version')) {
                                    pvt_metadata.pkg_version = response.pkg_version;
                                    account_search = JSON.parse(response.account_search);
                                } else {
                                    account_search = response.account_search;
                                }
                                pvt_metadata.email = userProfile.user.profile.email;
                                pvt_metadata.actionName = 'account_search';
                                pvt_metadata.isRefType = true;
                                let refTypeData = processRefTypeResponse(account_search);
                                await bot.api.views.open({//no scope required
                                    trigger_id: message.trigger_id,
                                    view: {
                                        "type": "modal",
                                        "notify_on_close" : true,
                                        "callback_id": "oppselect",
                                        "private_metadata" : JSON.stringify(pvt_metadata),
                                        "submit": {
                                            "type": "plain_text",
                                            "text": "Next",
                                            "emoji": true
                                        },
                                        "title": {
                                            "type": "plain_text",
                                            "text": "Referenceability Type",
                                            "emoji": true
                                        },
                                        "blocks": [
                                            {
                                                "type": "input",
                                                "block_id": "blkref",
                                                "element": {
                                                    "type": "static_select",
                                                    "action_id": "reftype_select",
                                                    "placeholder": {
                                                        "type": "plain_text",
                                                        "text": "Select a type",
                                                        "emoji": true
                                                    },
                                                    "options": refTypeData
                                                },
                                                "label": {
                                                    "type": "plain_text",
                                                    "text": "What type of reference accounts do you need?",
                                                    "emoji": true
                                                }
                                            }
                                        ]
                                    }
                                });

                            }
                        }
                        if(response == 'both') {
                            console.log('...opening both view...');
                            pvt_metadata.email = userProfile.user.profile.email;
                            pvt_metadata.actionName = 'both';
                            pvt_metadata.isBoth = true;
                            const result = await bot.api.views.open({//no scope required.
                                trigger_id: message.trigger_id,
                                view: {
                                    "type": "modal",
                                    "notify_on_close" : true,
                                    "callback_id" : "actionSelectionView",
                                    "private_metadata" : JSON.stringify(pvt_metadata),
                                    "title": {
                                        "type": "plain_text",
                                        "text": "Reference Assistant",
                                        "emoji": true
                                    },
                                    "submit": {
                                        "type": "plain_text",
                                        "text": "Next",
                                        "emoji": true
                                    },
                                    "close": {
                                        "type": "plain_text",
                                        "text": "Cancel",
                                        "emoji": true
                                    },
                                    
                                    "blocks": [
                                        {
                                            "type": "input",
                                            "block_id": "accblock",
                                            "element": {
                                                "type": "radio_buttons",
                                                "action_id": "searchid",
                                                "options": [
                                                    {
                                                        "value": "account_search",
                                                        "text": {
                                                            "type": "plain_text",
                                                            "text": "Reference Account(s)"
                                                        }
                                                    },
                                                    {
                                                        "value": "content_search",
                                                        "text": {
                                                            "type": "plain_text",
                                                            "text": "Reference Content"
                                                        }
                                                    },
                                                    {
                                                        "value": "both",
                                                        "text": {
                                                            "type": "plain_text",
                                                            "text": "Both"
                                                        }
                                                    }
                                                ]
                                            },
                                            "label": {
                                                "type": "plain_text",
                                                "text": "What do you need?",
                                                "emoji": true
                                            }
                                        }
                                    ]
                                }
                                
                            });
                        }
                        
                        console.log('open view');
                        
                    } else if (!existingConn) {
                        const authUrl = connFactory.getAuthUrl(message.team);
                        await bot.replyEphemeral(message, `click this link to connect\n<${authUrl}|Connect to Salesforce>`);
                    }
                }
            } catch (err) {
                console.log('...exception in opening view 1 ....');
                logger.log(err);
            }
        }
    );
    
    controller.on(
        'view_closed',
        async (bot, message) => {
            bot.httpBody({
                "response_action": "clear"
            });
            
    });

    async function opportunityFlow (bot, message, existingConn, metadata, email, mapval) {//actionName
        console.log('metadata initially::: ', metadata);
        let refselected = metadata.refTypes;
        let contentTypeSelected = metadata.contentTypes;
        console.log('oppo flow..');
        
        if(metadata.actionName == 'content_search' && metadata.pkg_version >= 2.26) {
            contentTypeSelected = message && message.view && message.view.state.values.blkref && message.view.state.values.blkref.reftype_select.selected_options != null 
                ? message.view.state.values.blkref.reftype_select.selected_options : 'NONE';
            let selectedValues = [];
            contentTypeSelected.forEach(function(ref) {
                selectedValues.push(ref.value);
            });
            contentTypeSelected = selectedValues.join(',');
        } else {
            refselected = message && message.view && message.view.state.values.blkref && message.view.state.values.blkref.reftype_select.selected_option != null ? message.view.state.values.blkref.reftype_select.selected_option : 'NONE';
            refselected = refselected && refselected != 'NONE' && refselected != '' && refselected != null ? (refselected.value.indexOf('::') > -1 ? refselected.value.split('::')[1] : refselected.value) : '';
        }
        console.log('metadata QQQQ:::', metadata);
        let openView = false;
        let viewObject = {};
        console.log('refselected::', refselected);
        console.log('contentTypeSelected::', contentTypeSelected);
        if(!mapval){
            if(metadata.actionName == 'account_search' && contentTypeSelected) {
                metadata.actionName = 'both';
            }
            mapval = await getOpp(existingConn,email,metadata.actionName);
            console.log('oppos:::', mapval);
        } else{
            console.log('map val exists.');
            openView = true;
        }
        console.log('metadata WWWW:::', metadata);
        let searchURL = mapval['searchURL'];
        let opps = mapval['opp'];

        if (opps != null && opps.length > 0 && opps.length < 10) {
            let pvt_metadata = {};
            if(contentTypeSelected) {
                metadata.searchURL = searchURL;
                metadata.refTypes = refselected;
                metadata.contentTypes = contentTypeSelected;
                pvt_metadata = metadata;
                console.log('opp<10::if');
            } else{
                metadata.searchURL = searchURL;
                metadata.refTypes = refselected;
                pvt_metadata = metadata;
                console.log('opp<10::else', searchURL);
                console.log('opp<10::else', refselected);
                console.log('opp<10::else', metadata.searchURL);
                console.log('opp<10::else', pvt_metadata);
            }
            viewObject = {
                view: {
                    "type": "modal",
                    "notify_on_close" : true,
                    "callback_id": "searchselect",
                    "private_metadata" : JSON.stringify(pvt_metadata),
                    "submit": {
                        "type": "plain_text",
                        "text": "Next",
                        "emoji": true
                    },
                    "title": {
                        "type": "plain_text",
                        "text": "Select an Opportunity",
                        "emoji": true
                    },
                    "blocks": [
                        {
                            "type": "input",
                            "block_id": "blkselectopp",
                            "element": {
                                "type": "static_select",
                                "action_id": "opp_select",
                                "placeholder": {
                                    "type": "plain_text",
                                    "text": "Select an Opp",
                                    "emoji": true
                                },
                                "options": opps
                            },
                            "label": {
                                "type": "plain_text",
                                "text": "Recent Opportunities",
                                "emoji": true
                            }
                        }
                    ]
                }
            };
        } else if (opps != null && opps.length >= 10) {
            let pvt_metadata = null;
            if(contentTypeSelected) {
                metadata.searchURL = searchURL;
                metadata.refTypes = refselected;
                metadata.contentTypes = contentTypeSelected;
                metadata.email = email;
                pvt_metadata = metadata;

            } else{
                metadata.searchURL = searchURL;
                metadata.refTypes = refselected;
                metadata.email = email;
                pvt_metadata = metadata;
            }
            viewObject = {
                view: {
                    "type": "modal",
                    "notify_on_close" : true,
                    "callback_id": "searchselectopplarge",
                    "private_metadata" : JSON.stringify(pvt_metadata),
                    "submit": {
                        "type": "plain_text",
                        "text": "Next",
                        "emoji": true
                    },
                    "title": {
                        "type": "plain_text",
                        "text": "Select an Opportunity",
                        "emoji": true
                    },
                    "blocks": [
                        {
                            "type": "section",
                            "text": {
                                "type": "plain_text",
                                "text": "•Select from the 10 most recently accessed opportunities.\n•Or lookup an opportunity by name or account.",
                            }
                        },
                        {
                            "type": "input",
                            "optional": true,
                            "block_id": "blkselectopp",
                            "element": {
                                "type": "static_select",
                                "action_id": "opp_select",
                                "placeholder": {
                                    "type": "plain_text",
                                    "text": "Select",
                                    "emoji": true
                                },
                                "options": opps
                            },
                            "label": {
                                "type": "plain_text",
                                "text": "Recent Opportunities",
                                "emoji": true
                            }
                        },
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": "*OR*"
                            }
                        },
                        {
                            "type": "input",
                            "optional": true,
                            "block_id" : "accblock",
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "account_name",
                                "placeholder": {
                                    "type": "plain_text",
                                    "text": "Type account"
                                },
                                "multiline": false
                            },
                            "label": {
                                "type": "plain_text",
                                "text": "Account Lookup",
                                "emoji": true
                            }
                        },
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": "*OR*"
                            }
                        },
                        {
                            "type": "input",
                            "optional": true,
                            "block_id" : "oppblock",
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "opp_name",
                                "placeholder": {
                                    "type": "plain_text",
                                    "text": "Type opportunity"
                                },
                                "multiline": false
                            },
                            "label": {
                                "type": "plain_text",
                                "text": "Opportunity Lookup",
                                "emoji": true
                            }
                        }
                    ]
                }
            };
        } else {

            if (refselected && refselected != 'NONE' && refselected != '' && refselected != null) {
                searchURL += '&type=' + refselected;
            } 
            if(contentTypeSelected) {
                searchURL += '&contype=' + contentTypeSelected;
            }
            
            searchURL = 'Thanks! Please <' + searchURL + '|click to complete your request in Salesforce.>';
            viewObject = {
                view: {
                    "type": "modal",
                    "notify_on_close" : true,
                    "close": {
                        "type": "plain_text",
                        "text": "Close",
                        "emoji": true
                    },
                    "title": {
                        "type": "plain_text",
                        "text": "Continue Search",
                        "emoji": true
                    },
                    "blocks": [
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": searchURL
                            }
                        }
                    ]
                }
            };
        }
        if(openView) {
            console.log('in open view.');
            viewObject.trigger_id = message.trigger_id;
            await bot.api.views.open(viewObject);////no scope required.
        } else {
            console.log('in else of open view.');
            viewObject.response_action = 'update';
            bot.httpBody(viewObject);
        }
    } 

    function processContentResponse(response) {
        
        let ref = [];
        Object.keys(response).forEach(function(k){
            let entry = {
                "text": {
                    "type": "plain_text",
                    "text": response[k]
                },
                "value": k
            }
            ref.push(entry);
        });
        return ref;
    }

    function processRefTypeResponse(response) {
        let ref = [];
        Object.keys(response).forEach(function(k){
            let entry = {
                "text": {
                    "type": "plain_text",
                    "text": k
                },
                "value": response[k]
            }
            ref.push(entry);
        });
        return ref;
    }
    
    controller.on(
        'view_submission',
        async (bot, message) => {
            console.log('view_submission');
            try {
                let existingConn = await connFactory.getConnection(message.team.id, controller);
                let refselected = null;
                if (!existingConn) {
                    const authUrl = connFactory.getAuthUrl(message.team);
                    await bot.replyEphemeral(message, `click this link to connect\n<${authUrl}|Connect to Salesforce>`);
                } else {
                    console.log('callbackid', message.view.callback_id);
                    // When Account Name entered
                    if (message.view.callback_id == 'actionSelectionView') {
                        let actionName = 'account_search';
                        console.log('accblock::', message.view.state.values.accblock);
                        if(message.view.state.values.accblock) {
                            actionName = message.view.state.values.accblock.searchid.selected_option.value;
                        } else{
                            refselected = message && message.view && message.view.state.values.blkref && message.view.state.values.blkref.reftype_select.selected_options != null ? message.view.state.values.blkref.reftype_select.selected_options : 'NONE';
                            let selectedValues = [];
                            refselected.forEach(function(ref) {
                                selectedValues.push(ref.value);
                            });
                            refselected = selectedValues.join(',');
                        }
                        let pvt_metadata = JSON.parse(message.view.private_metadata);
                        pvt_metadata.actionName = actionName;

                        if(refselected) {
                            pvt_metadata.contentTypes = refselected;
                        }
                        console.log('actionName:: ', actionName);
                        console.log('pvt_metadata::', pvt_metadata.pkg_version);
                        
                        if (actionName == 'content_search') {
                            if(pvt_metadata.pkg_version < 2.26) {
                                await opportunityFlow(bot, message, existingConn, pvt_metadata, pvt_metadata.email, null);
                            } else{
                                console.log('...view submission content opp flow....');
                                let mapval = await getRefTypes(existingConn,actionName);
                                bot.httpBody({
                                    response_action: 'update',
                                    view: {
                                        "type": "modal",
                                        "notify_on_close" : true,
                                        "callback_id": "oppselect",
                                        "private_metadata" : JSON.stringify(pvt_metadata),//email,
                                        "submit": {
                                            "type": "plain_text",
                                            "text": "Next",
                                            "emoji": true
                                        },
                                        "title": {
                                            "type": "plain_text",
                                            "text": "Content Type",
                                            "emoji": true
                                        },
                                        "blocks": [
                                            {
                                                "type": "input",
                                                "optional" : true,
                                                "block_id": "blkref",
                                                "element": {
                                                    "type": "multi_static_select",
                                                    "action_id": "reftype_select",
                                                    "placeholder": {
                                                        "type": "plain_text",
                                                        "text": "Select a type",
                                                        "emoji": true
                                                    },
                                                    "options": mapval
                                                },
                                                "label": {
                                                    "type": "plain_text",
                                                    "text": "What type of reference content do you need?",
                                                    "emoji": true
                                                }
                                            }
                                        ]
                                    }
                                });
                            }
                        } else if(actionName == 'account_search'){
                            console.log('...view submission ref type flow....');
                            let mapval = await getRefTypes(existingConn,actionName);
                            bot.httpBody({
                                response_action: 'update',
                                view: {
                                    "type": "modal",
                                    "notify_on_close" : true,
                                    "callback_id": "oppselect",
                                    "private_metadata" : JSON.stringify(pvt_metadata),
                                    "submit": {
                                        "type": "plain_text",
                                        "text": "Next",
                                        "emoji": true
                                    },
                                    "title": {
                                        "type": "plain_text",
                                        "text": "Referenceability Type",
                                        "emoji": true
                                    },
                                    "blocks": [
                                        {
                                            "type": "input",
                                            "block_id": "blkref",
                                            "element": {
                                                "type": "static_select",
                                                "action_id": "reftype_select",
                                                "placeholder": {
                                                    "type": "plain_text",
                                                    "text": "Select a type",
                                                    "emoji": true
                                                },
                                                "options": mapval
                                            },
                                            "label": {
                                                "type": "plain_text",
                                                "text": "What type of reference accounts do you need?",
                                                "emoji": true
                                            }
                                        }
                                    ]
                                }
                            });
                        } else {
                            let titleText = 'Content Type';
                            let block_element_type = 'multi_static_select';
                            let block_label_text = 'What type of reference content do you need?';
                            if(pvt_metadata.pkg_version < 2.26) {
                                titleText = 'Referenceability Type';
                                block_element_type = 'static_select';
                                block_label_text = 'What type of reference accounts do you need?';
                            }
                            let mapval = await getRefTypes(existingConn,actionName);
                            bot.httpBody({
                                response_action: 'update',
                                view: {
                                    "type": "modal",
                                    "notify_on_close" : true,
                                    "callback_id": "actionSelectionView",
                                    "private_metadata" : JSON.stringify(pvt_metadata),
                                    "submit": {
                                        "type": "plain_text",
                                        "text": "Next",
                                        "emoji": true
                                    },
                                    "title": {
                                        "type": "plain_text",
                                        "text": titleText,
                                        "emoji": true
                                    },
                                    "blocks": [
                                        {
                                            "type": "input",
                                            "optional" : true,
                                            "block_id": "blkref",
                                            "element": {
                                                "type": block_element_type,
                                                "action_id": "reftype_select",
                                                "placeholder": {
                                                    "type": "plain_text",
                                                    "text": "Select a type",
                                                    "emoji": true
                                                },
                                                "options": mapval
                                            },
                                            "label": {
                                                "type": "plain_text",
                                                "text": block_label_text,
                                                "emoji": true
                                            }
                                        }
                                    ]
                                }
                            });
                        }
                    } else if (message.view.callback_id == 'oppselect') {
                        console.log('@@@metadata_2');
                        let metdata = JSON.parse(message.view.private_metadata);
                        console.log('multi metadata ::', metdata);
                        const email = metdata.email;
                        await opportunityFlow(bot, message, existingConn, metdata, email, null);
                        
                    } else if (message.view.callback_id == 'searchselectopplarge') {
                        console.log('@@@metadata_3');
                        
                        let metadata = JSON.parse(message.view.private_metadata);
                        let searchURL = metadata.searchURL;
                        const refselected = metadata.refTypes;
                        let email = metadata.email;
                        let contentTypeSelected = metadata.contentTypes;

                        let oppSelected = message.view.state.values.blkselectopp != null && message.view.state.values.blkselectopp.opp_select.selected_option != null ? message.view.state.values.blkselectopp.opp_select.selected_option.value : '';
                        let acctext = message.view.state.values.accblock != null && message.view.state.values.accblock.account_name.value != null ? message.view.state.values.accblock.account_name.value : '';
                        let opptext = message.view.state.values.oppblock != null && message.view.state.values.oppblock.opp_name.value != null ? message.view.state.values.oppblock.opp_name.value : '';
                        let opps = [];
                        if (oppSelected != '') {
                            searchURL = metadata.searchURL.replace('@@',oppSelected);
                            if (refselected && refselected != 'NONE' && refselected != '' && refselected != null) {
                                searchURL += '&type=';
                                searchURL += refselected;
                            }
                            if(contentTypeSelected) {
                                searchURL += '&contype=';
                                searchURL += contentTypeSelected;
                            }
                            searchURL = 'Thanks! Please <' + searchURL + '|click to complete your request in Salesforce.>';
                            metadata.searchURL = searchURL;
                            bot.httpBody({
                            response_action: 'update',
                            view: {
                                "type": "modal",
                                "notify_on_close" : true,
                                "close": {
                                    "type": "plain_text",
                                    "text": "Close",
                                    "emoji": true
                                },
                                "title": {
                                    "type": "plain_text",
                                    "text": "Continue Search",
                                    "emoji": true
                                },
                                "blocks": [
                                    {
                                        "type": "section",
                                        "text": {
                                            "type": "mrkdwn",
                                            "text": searchURL
                                        }
                                    }
                                ]
                            }
                        });
                        } else if (oppSelected == '' && acctext == '' && opptext == '') {
                            bot.httpBody({
                                response_action: 'errors',
                                errors: {
                                    "oppblock": 'Please provide Opportunity information.'
                                }
                            });
                        } else if (acctext != '' && opptext != '') {
                            bot.httpBody({
                                response_action: 'errors',
                                errors: {
                                    "oppblock": 'Please enter Account Name OR Opportunity name;'
                                }
                            });
                        } else if (acctext != '' && opptext == '') {
                            opps = await getOppfromAcc(existingConn,email,acctext);
                            if (opps == null || opps.length == 0) {
                                bot.httpBody({
                                    response_action: 'errors',
                                    errors: {
                                        "accblock": 'No Opportunity matching the Opportunity Account Name found.Please retry.'
                                    }
                                });
                            } 
                        } else if (acctext == '' && opptext != '') {
                            opps = await getOppfromName(existingConn,email,opptext);
                            if (opps == null || opps.length == 0) {
                                bot.httpBody({
                                    response_action: 'errors',
                                    errors: {
                                        "oppblock": 'No Opportunity matching the Opportunity Name found.Please retry.'
                                    }
                                });
                            }
                        } 
                        if (opps != null && opps.length > 0) {
                            bot.httpBody({
                                response_action: 'update',
                                view: {
                                    "type": "modal",
                                    "notify_on_close" : true,
                                    "callback_id": "searchselect",
                                    "private_metadata" : JSON.stringify(metadata),
                                    "submit": {
                                        "type": "plain_text",
                                        "text": "Next",
                                        "emoji": true
                                    },
                                    "title": {
                                        "type": "plain_text",
                                        "text": "Select an Opportunity",
                                        "emoji": true
                                    },
                                    "blocks": [
                                        {
                                            "type": "input",
                                            "block_id": "blkselectoppFinal",
                                            "element": {
                                                "type": "static_select",
                                                "action_id": "opp_select",
                                                "placeholder": {
                                                    "type": "plain_text",
                                                    "text": "Select",
                                                    "emoji": true
                                                },
                                                "options": opps
                                            },
                                            "label": {
                                                "type": "plain_text",
                                                "text": "Recent Opportunities",
                                                "emoji": true
                                            }
                                        }
                                    ]
                                }
                            });
                        } 
                    } else if (message.view.callback_id == 'searchselect') {
                        
                        
                        let metadata = JSON.parse(message.view.private_metadata);
                        console.log('@@@metadata_4', metadata);
                        const refselected = metadata.refTypes;
                        let contentTypeSelected = metadata.contentTypes;
                        
                        let oppSelected = message.view.state.values.blkselectopp != null ? message.view.state.values.blkselectopp.opp_select.selected_option.value :
                                            (message.view.state.values.blkselectoppFinal != null ? message.view.state.values.blkselectoppFinal.opp_select.selected_option.value : '');
                        let searchURL = metadata.searchURL;
                        console.log('search URL : ', searchURL);
                        console.log('oppSelected : ', oppSelected);
                        searchURL = searchURL.replace('@@',oppSelected);

                        if (refselected && refselected != 'NONE' && refselected != '' && refselected != null) {
                            searchURL += '&type=';
                            searchURL += refselected;
                        }
                        
                        if(contentTypeSelected) {
                            searchURL += '&contype=';
                            searchURL += contentTypeSelected;
                        }
                        searchURL = 'Thanks! Please <' + searchURL + '|click to complete your request in Salesforce.>';
                        bot.httpBody({
                            response_action: 'update',
                            view: {
                                "type": "modal",
                                "notify_on_close" : true,
                                "close": {
                                    "type": "plain_text",
                                    "text": "Close",
                                    "emoji": true
                                },
                                "title": {
                                    "type": "plain_text",
                                    "text": "Continue Search",
                                    "emoji": true
                                },
                                "blocks": [
                                    {
                                        "type": "section",
                                        "text": {
                                            "type": "mrkdwn",
                                            "text": searchURL
                                        }
                                    }
                                ]
                            }
                        });
                    }
                }
            } catch (err) {
                logger.log(err);
            }
        }
    );

}