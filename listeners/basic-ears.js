const connFactory = require('../util/connection-factory');
const logger = require('../common/logger');

const { getRefTypes, getOpp, getOppfromName, getOppfromAcc, saveTeamId, checkOrgSettingAndGetData, getRefUseReqModal, getAdditionalModal, submitP2PRequest, getSearchedContact } = require('../util/refedge');

const { checkTeamMigration } = require('../listeners/middleware/migration-filter');

module.exports = controller => {

    /**
     * Controller for Direct Message like Hello, Help & Connect to sf 
     */
    controller.on('direct_message,direct_mention',
        async (bot, message) => {

            try {
                console.log('------direct mention---');
                const supportUrl = `https://www.point-of-reference.com/contact/`;
                let messageText = message.text ? message.text.toLowerCase() : '';

                if (messageText.includes('hello')) {
                    console.log('IN Hello section');
                    await bot.replyEphemeral(message, `Hi, you can invite me to the channel for Customer Reference Team to receive updates!`);
                    console.log('End of Hello Section');
                } else if (messageText == 'connect to a salesforce instance' || messageText == 'connect to sf'
                    || (messageText.includes('connect') && messageText.includes('salesforce'))) {//|| message.intent === 'connect_to_sf'
                    console.log('In connect to sf section');
                    let existingConn = await connFactory.getConnection(message.team, controller);

                    if (!existingConn) {
                        console.log('For New Connection to SF-Slack 28 EARS');
                        const authUrl = connFactory.getAuthUrl(message.team);
                        await bot.replyEphemeral(message, `click this link to connect\n<${authUrl}|Connect to Salesforce>`);
                    } else {
                        console.log('For Existing Connection');
                        /* await controller.plugins.database.orgs.delete(message.team);
                        const authUrl = connFactory.getAuthUrl(message.team);
                        await bot.reply(message, `click this link to connect\n<${authUrl}|Connect to Salesforce>`); */
                        await bot.beginDialog('sf_auth');
                    }
                } else if (messageText.includes('help')) {
                    console.log('IN help SECTION');
                    await bot.replyEphemeral(message,
                        `Hello, Referencebot here. I can help you find customer references, and deliver messages related to your customer reference requests. \n`
                        + `Use the /references command to start a search for reference accounts or reference content. \n`
                        + `Are you an administrator? I can connect you to a Salesforce instance. Just type "connect to a Salesforce instance" to get started. \n`
                        + `Please visit the <${supportUrl}|support page> if you have any further questions.`);
                } else {
                    console.log('NONE OF the aBOVe section');
                    await bot.replyEphemeral(message, `Sorry, I didn't understand that.`);
                }
            } catch (err) {
                console.log('CATCh of direct-mention');
                logger.log(err);
            }
        });

    /**
     * controller which is call when post message to chat/bot from Salesforce (like)
     */
    controller.on('post-message', reqBody => {
        console.log('posting message for org----', reqBody.orgId);
        console.log('REQUEST BODY -> ', reqBody);

        reqBody.messages.forEach(async msg => {
            console.log('Message EARS LINE 63', msg);

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
                            // console.log('...getting userData...');

                            const userData = await bot.api.users.lookupByEmail({//Bot token - users:read.email
                                token: teams[index].bot.token,
                                email: msg.userEmail
                            });

                            if (!userData || !userData.user) {
                                return logger.log('user not found in team ' + teams[index].id + ' for email:', msg.userEmail);
                            }

                            if (parseFloat(msg.packageVersion) >= 2.30 && msg.text && msg.text.includes("selectreferenceusecontact")) {
                                let mestxt = msg.text.split("\n<https://");
                                console.log('URL1', mestxt);
                                let url = mestxt[1];
                                console.log('URL2', url);
                                urlList = url.split('|');
                                url = urlList[0];
                                buttonText = urlList[1].slice(0, -1);
                                console.log('URL3', url);
                                url = 'https://' + url;
                                url = new URL(url);
                                let rraID = url.searchParams.get("id");
                                await bot.startPrivateConversation(userData.user.id);
                                await bot.say(
                                    {
                                        // "channel": "",
                                        // "text": msg.text,
                                        "blocks": [
                                            {
                                                "type": "section",
                                                "text": {
                                                    "type": "mrkdwn",
                                                    "text": mestxt[0]
                                                }
                                            },
                                            {
                                                "type": "actions",
                                                "block_id": "refUseReqMainBlock",
                                                "elements": [
                                                    {
                                                        "type": "button",
                                                        "text": {
                                                            "type": "plain_text",
                                                            "text": buttonText,
                                                            "emoji": true
                                                        },
                                                        "value": rraID,
                                                        "action_id": "refUseReqMainBlock"
                                                    }
                                                ]
                                            }
                                        ]
                                    });
                            } else {
                                console.log('...starting conversation...');
                                await bot.startPrivateConversation(userData.user.id);
                                await bot.say(msg.text);
                            }
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

    controller.on('app_home_opened', async (bot, event) => {
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
                    + `Please visit the <${support_page}|support page> if you have any further questions.`
                );
                console.log('.....message posted.....');
            }
        } catch (error) {
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
            } else {
                console.log('found existing team...');
            }
            existingTeam.bot = {
                token: authData.access_token,
                user_id: authData.bot_user_id,
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
        const internal_url = 'slack://channel?team=' + params.teamId + '&id=' + params.channelId;
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
                userId: authData.authed_user.id,
                channelId: crpTeamChannel.id,
                teamId: crpTeamChannel.team_id
            };
            controller.trigger('onboard', bot, params);

        } catch (err) {
            console.log('error setting up crp_team channel:', err);
        }
    });

    /**
     * First dialog box(Modal) in Slack when we first use /slash command
     */
    controller.on(
        'slash_command',
        async (bot, message) => {
            try {
                console.log('slash_command');
                let pvt_metadata = {
                    'email': '', 'isContentType': false, 'isRefType': false,
                    'isBoth': false, 'actionName': '', 'contentTypes': '', 'refTypes': '',
                    'searchURL': '', 'pkg_version': 0
                };
                console.log('PVT_DATA 249 Ears');

                if (message.text && message.text.toLowerCase() == 'help') {
                    await bot.replyEphemeral(message,
                        `This command allows you to start a search for customer reference resources, without being in Salesforce.\n`
                        + `You’ll be taken to the Reference Search page where you can refine your search, request the use of an account, and, if enabled, share content.`
                    );
                } else {
                    let existingConn = await connFactory.getConnection(message.team, controller);
                    console.log('EXistingCONn 258 Ears');

                    if (existingConn) {
                        const userProfile = await bot.api.users.info({//users.read scope
                            token: bot.api.token,
                            user: message.user
                        });
                        console.log('USER PROFILE 265 Ears', userProfile.user.profile.email);
                        console.log('.......checking org settings ....');
                        let response = null;
                        try {
                            response = await checkOrgSettingAndGetData(existingConn, userProfile.user.profile.email);
                            console.log('RESponse 270 Ears', response);

                            if (response !== 'both') {

                                let temp = JSON.parse(response);
                                if (temp.hasOwnProperty('action')) {//added in 2.26 release.
                                    response = temp.action;
                                    pvt_metadata.pkg_version = parseFloat(temp.pkg_version);
                                }
                            }
                        } catch (err) {
                            response = 'both';
                            console.log('...exception in checking org... 286 EARS');
                            logger.log(err);
                        }

                        if (response != 'false' && response != 'both') {

                            response = JSON.parse(response);

                            if (!response.hasOwnProperty('account_search')) {
                                let content_search = '';
                                if (!response.hasOwnProperty('pkg_version')) {
                                    let contentData = processContentResponse(response);
                                    await opportunityFlow(bot, message, existingConn, pvt_metadata, userProfile.user.profile.email, contentData);
                                } else {
                                    if (response.hasOwnProperty('pkg_version')) {
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
                                            "notify_on_close": true,
                                            "callback_id": "oppselect",
                                            "private_metadata": JSON.stringify(pvt_metadata),
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
                                                    "optional": true,
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
                                }
                            } else {
                                console.log('...Reftype flow...');
                                let account_search = '';
                                if (response.hasOwnProperty('pkg_version')) {
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
                                        "notify_on_close": true,
                                        "callback_id": "oppselect",
                                        "private_metadata": JSON.stringify(pvt_metadata),
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
                        if (response == 'both') {
                            console.log('...opening both view...');
                            pvt_metadata.email = userProfile.user.profile.email;
                            pvt_metadata.actionName = 'both';
                            pvt_metadata.isBoth = true;
                            const result = await bot.api.views.open({//no scope required.
                                trigger_id: message.trigger_id,
                                view: {
                                    "type": "modal",
                                    "notify_on_close": true,
                                    "callback_id": "actionSelectionView",
                                    "private_metadata": JSON.stringify(pvt_metadata),
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

    /**
     * called this controller when click on close button on Modal which has 'notify_on_close' set to true
     */
    controller.on('view_closed', async (bot, message) => {
        bot.httpBody({
            "response_action": "clear"
        });

    });

    async function opportunityFlow(bot, message, existingConn, metadata, email, mapval) {//actionName
        let refselected = metadata.refTypes;
        let contentTypeSelected = metadata.contentTypes;
        console.log('oppo flow..');

        if (metadata.actionName == 'content_search' && metadata.pkg_version >= 2.26) {
            contentTypeSelected = message && message.view && message.view.state.values.blkref && message.view.state.values.blkref.reftype_select.selected_options != null
                ? message.view.state.values.blkref.reftype_select.selected_options : 'NONE';
            let selectedValues = [];
            contentTypeSelected.forEach(function (ref) {
                selectedValues.push(ref.value);
            });
            contentTypeSelected = selectedValues.join(',');
        } else {
            refselected = message && message.view && message.view.state.values.blkref && message.view.state.values.blkref.reftype_select.selected_option != null ? message.view.state.values.blkref.reftype_select.selected_option : 'NONE';
            refselected = refselected && refselected != 'NONE' && refselected != '' && refselected != null ? (refselected.value.indexOf('::') > -1 ? refselected.value.split('::')[1] : refselected.value) : '';
        }
        let openView = false;
        let viewObject = {};

        if (!mapval) {
            if (metadata.actionName == 'account_search' && contentTypeSelected) {
                metadata.actionName = 'both';
            }
            mapval = await getOpp(existingConn, email, metadata.actionName);
        } else {
            console.log('map val exists.');
            openView = true;
        }
        let searchURL = mapval['searchURL'];
        let opps = mapval['opp'];

        if (opps != null && opps.length > 0 && opps.length < 10) {
            let pvt_metadata = {};
            metadata.searchURL = searchURL;
            metadata.refTypes = refselected;

            if (contentTypeSelected) {
                metadata.contentTypes = contentTypeSelected;
            }
            pvt_metadata = metadata;
            viewObject = {
                view: {
                    "type": "modal",
                    "notify_on_close": true,
                    "callback_id": "searchselect",
                    "private_metadata": JSON.stringify(pvt_metadata),
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
            metadata.searchURL = searchURL;
            metadata.refTypes = refselected;
            metadata.email = email;

            if (contentTypeSelected) {
                metadata.contentTypes = contentTypeSelected;
            }
            pvt_metadata = metadata;
            viewObject = {
                view: {
                    "type": "modal",
                    "notify_on_close": true,
                    "callback_id": "searchselectopplarge",
                    "private_metadata": JSON.stringify(pvt_metadata),
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
                            "block_id": "accblock",
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
                            "block_id": "oppblock",
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
            if (contentTypeSelected) {
                searchURL += '&contype=' + contentTypeSelected;
            }

            searchURL = 'Thanks! Please <' + searchURL + '|click to complete your request in Salesforce.>';
            viewObject = {
                view: {
                    "type": "modal",
                    "notify_on_close": true,
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

        if (openView) {
            console.log('in open view.');
            viewObject.trigger_id = message.trigger_id;
            await bot.api.views.open(viewObject);////no scope required.
        } else {
            console.log('in else of open view.');
            viewObject.response_action = 'update';
            bot.httpBody(viewObject);
        }
    }

    /**
     * 
     * @param {*} bot 
     * @param {*} message 
     * used in updating Reference Use Request Main modal when user clicks on Contact from Dropdown;
     * Use this in both dropdown of contact (active or inactive)
     */
    async function refUseRequestModalWithContactInfo(bot, message) {
        try {
            console.log('VALUES EARS 805 ', message.view.private_metadata);
            // console.log("MESSAGE ERAS 806 ", JSON.stringify(message));
            let pvt_metadata = JSON.parse(message.view.private_metadata);

            if (message.view.state.values.blkCon1 || message.view.state.values.blkCon2) {
                console.log('In if condition of AD_MODAL');
                let selConId = message.view.state.values.blkCon1.con_select1.selected_option ? message.view.state.values.blkCon1.con_select1.selected_option.value :
                    message.view.state.values.blkCon2.con_select2.selected_option ? message.view.state.values.blkCon2.con_select2.selected_option.value :
                        null;
                pvt_metadata = setSelectedContactInfo(pvt_metadata, selConId);
                pvt_metadata.Id = selConId;
            }

            if (pvt_metadata.activeContacts.length && pvt_metadata.inactiveContacts.length) {
                // console.log('pvtDATA ', pvt_metadata);
                await bot.api.views.update({
                    view_id: message.view.id,
                    view: {
                        "type": "modal",
                        "callback_id": "approveDeclinePopup",
                        "clear_on_close": true,
                        "private_metadata": JSON.stringify(pvt_metadata),
                        "submit": {
                            "type": "plain_text",
                            "text": "Next",
                            "emoji": true
                        },
                        "close": {
                            "type": "plain_text",
                            "text": "Close",
                            "emoji": true
                        },
                        "title": {
                            "type": "plain_text",
                            "text": "Reference Use Request",
                            "emoji": true
                        },
                        "blocks": [
                            {
                                "type": "section",
                                "fields": [
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Reference Account*\n" + pvt_metadata["Account Name"]
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Opportunity Account*\n" + pvt_metadata["Opportunity Account Name"]
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Reference Type*\n" + pvt_metadata["Reference Type"]
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Opportunity Name*\n" + pvt_metadata["Opportunity Name"]
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Requester*\n" + pvt_metadata["Requester Name"]
                                    }
                                ]
                            },
                            {
                                "type": "actions",
                                "block_id": "additionalBlock",
                                "elements": [
                                    {
                                        "type": "button",
                                        "action_id": "additionalModal",
                                        "text": {
                                            "type": "plain_text",
                                            "text": "More Request Details"
                                        },
                                        "style": "primary",
                                        "value": pvt_metadata.rraId
                                    }
                                ]
                            },
                            {
                                "type": "divider"
                            },
                            {
                                "type": "input",
                                "block_id": "approveDeclineBlock",
                                "dispatch_action": true,
                                "label": {
                                    "type": "plain_text",
                                    "text": "What would you like to do?",
                                },
                                "element": {
                                    "type": "radio_buttons",
                                    "action_id": "approveDeclineRadio",
                                    "options": [
                                        {
                                            "text": {
                                                "type": "mrkdwn",
                                                "text": "*Approve*"
                                            },
                                            "value": "Approve"
                                        },
                                        {
                                            "text": {
                                                "type": "mrkdwn",
                                                "text": "*Decline*"
                                            },
                                            "value": "Decline"
                                        }
                                    ]
                                }
                            },
                            {
                                "type": "divider"
                            },
                            {
                                "type": "input",
                                "optional": true,
                                "block_id": "blkCon1",
                                "dispatch_action": true,
                                "element": {
                                    "type": "static_select",
                                    "action_id": "con_select1",
                                    "placeholder": {
                                        "type": "plain_text",
                                        "text": "Select a type",
                                        "emoji": true
                                    },
                                    "options": pvt_metadata.activeContacts
                                },
                                "label": {
                                    "type": "plain_text",
                                    "text": "Select an existing reference contact....",
                                    "emoji": true
                                }
                            },
                            {
                                "type": "input",
                                "optional": true,
                                "block_id": "blkCon2",
                                "dispatch_action": true,
                                "element": {
                                    "type": "static_select",
                                    "action_id": "con_select2",
                                    "placeholder": {
                                        "type": "plain_text",
                                        "text": "Select a type",
                                        "emoji": true
                                    },
                                    "options": pvt_metadata.inactiveContacts
                                },
                                "label": {
                                    "type": "plain_text",
                                    "text": "OR activate a reference contact",
                                    "emoji": true
                                }
                            },
                            {
                                "type": "divider"
                            },
                            {
                                "type": "section",
                                "block_id": "editContactBlock",
                                "text": {
                                    "type": "mrkdwn",
                                    "text": "*Selected Contact Info*"
                                },
                                "accessory": {
                                    "type": "button",
                                    "action_id": "editContactModal",
                                    "text": {
                                        "type": "plain_text",
                                        "text": "Edit",
                                        "emoji": true
                                    },
                                    "style": "primary",
                                    "value": pvt_metadata.Id
                                }
                            },
                            {
                                "type": "section",
                                "fields": [
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Name*\n" + pvt_metadata.Name,
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Title*\n" + pvt_metadata.Title,
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Email*\n" + pvt_metadata.Email,
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Program Member*\n" + pvt_metadata.Status,
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Phone*\n" + pvt_metadata.Phone,
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Last Used*\n" + pvt_metadata.Last_Used,
                                    },
                                ]
                            },
                            {
                                "type": "divider"
                            },
                            {
                                "type": "input",
                                "block_id": "contactNotesBlock",
                                "element": {
                                    "type": "plain_text_input",
                                    "multiline": true,
                                    "action_id": "contactNotes"
                                },
                                "label": {
                                    "type": "plain_text",
                                    "text": "Add a Note",
                                }
                            }
                        ]
                    }
                });
            } else if (pvt_metadata.activeContacts.length || pvt_metadata.inactiveContacts.length) {
                console.log('In this if of ONE');
                let tmpCons, label = "Select a contact";

                if (pvt_metadata.activeContacts.length) {
                    tmpCons = pvt_metadata.activeContacts;
                } else if (pvt_metadata.inactiveContacts.length) {
                    console.log('In this if of ONE 2');
                    tmpCons = pvt_metadata.inactiveContacts;
                }
                await bot.api.views.update({
                    view_id: message.view.id,
                    view: {
                        "type": "modal",
                        "callback_id": "AD_Modal",
                        // "notify_on_close": true,
                        "clear_on_close": true,
                        "private_metadata": JSON.stringify(pvt_metadata),
                        // "submit_disabled": true,
                        "submit": {
                            "type": "plain_text",
                            "text": "Next",
                            "emoji": true
                        },
                        "close": {
                            "type": "plain_text",
                            "text": "Close",
                            "emoji": true
                        },
                        "title": {
                            "type": "plain_text",
                            "text": "Reference Use Request",
                            "emoji": true
                        },
                        "blocks": [
                            {
                                "type": "section",
                                "block_id": "additionalBlock",
                                "text": {
                                    "type": "mrkdwn",
                                    "text": " "
                                },
                                "accessory": {
                                    "type": "button",
                                    "action_id": "additionalModal",
                                    "text": {
                                        "type": "plain_text",
                                        "text": "Additional Request Info",
                                        "emoji": true
                                    },
                                    "style": "primary",
                                    "value": pvt_metadata.rraId
                                }
                            },
                            {
                                "type": "section",
                                "fields": [
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Reference Account*\n" + pvt_metadata["Account Name"]
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Opportunity Account*\n" + pvt_metadata["Opportunity Account Name"]
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Reference Type*\n" + pvt_metadata["Reference Type"]
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Opportunity Name*\n" + pvt_metadata["Opportunity Name"]
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Requester*\n" + pvt_metadata["Requester Name"]
                                    }
                                ]
                            },
                            {
                                "type": "divider"
                            },
                            {
                                "type": "actions",
                                "block_id": "approveDeclineBlock",
                                "elements": [
                                    {
                                        "type": "radio_buttons",
                                        "options": [
                                            {
                                                "text": {
                                                    "type": "mrkdwn",
                                                    "text": "*Approve*"
                                                },
                                                "value": "Approve"
                                            },
                                            {
                                                "text": {
                                                    "type": "mrkdwn",
                                                    "text": "*Decline*"
                                                },
                                                "value": "Decline"
                                            }
                                        ],
                                        "action_id": "approveDeclineRadio",
                                        "initial_option": {
                                            "value": "Approve",
                                            "text": {
                                                "type": "mrkdwn",
                                                "text": "*Approve*"
                                            }
                                        }
                                    }
                                ]
                            },
                            {
                                "type": "divider"
                            },
                            {
                                "type": "input",
                                "optional": false,
                                "block_id": "blkCon1",
                                "dispatch_action": true,
                                "element": {
                                    "type": "static_select",
                                    "action_id": "con_select1",
                                    "placeholder": {
                                        "type": "plain_text",
                                        "text": "Select a type",
                                        "emoji": true
                                    },
                                    "options": tmpCons
                                },
                                "label": {
                                    "type": "plain_text",
                                    "text": label,
                                    "emoji": true
                                }
                            },
                            {
                                "type": "divider"
                            },
                            {
                                "type": "section",
                                "block_id": "editContactBlock",
                                "text": {
                                    "type": "mrkdwn",
                                    "text": "*Selected Contact Info*"
                                },
                                "accessory": {
                                    "type": "button",
                                    "action_id": "editContactModal",
                                    "text": {
                                        "type": "plain_text",
                                        "text": "Edit",
                                        "emoji": true
                                    },
                                    "style": "primary",
                                    "value": pvt_metadata.Id
                                }
                            },
                            {
                                "type": "section",
                                "fields": [
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Name*\n" + pvt_metadata.Name,
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Title*\n" + pvt_metadata.Title,
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Email*\n" + pvt_metadata.Email,
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Program Member*\n" + pvt_metadata.Status,
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Phone*\n" + pvt_metadata.Phone,
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*Last Used*\n" + pvt_metadata.Last_Used,
                                    },
                                ]
                            },
                            {
                                "type": "divider"
                            },
                            {
                                "type": "input",
                                "block_id": "contactNotesBlock",
                                "element": {
                                    "type": "plain_text_input",
                                    "multiline": true,
                                    "action_id": "contactNotes"
                                },
                                "label": {
                                    "type": "plain_text",
                                    "text": "Add a Note",
                                }
                            }
                        ]
                    }
                });
            }
        } catch (err) {
            console.log('IN Catch of refUseRequestModalWithContactInfo Ears');
            logger.log(err);
        }
    }

    function processContentResponse(response) {

        let ref = [];
        let opp = [];
        let returnVal = {};
        if (!response.hasOwnProperty('searchURL')) {
            Object.keys(response).forEach(function (k) {
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
        } else if (response != 'false') {
            let oppList = response['opp'];
            returnVal['searchURL'] = response['searchURL'];
            oppList.forEach(function (oppWrapper) {
                let entry = {
                    "text": {
                        "type": "plain_text",
                        "text": oppWrapper['oppName'] + ' (' + oppWrapper['accName'] + ')'
                    },
                    "value": oppWrapper['id']
                }
                opp.push(entry);
            });
            returnVal['opp'] = opp;
            return returnVal;
        }
    }

    function processRefTypeResponse(response) {
        console.log('RESPONSE IN processRefTypeResponse ', response);
        let ref = [];
        Object.keys(response).forEach(function (k) {
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

    /**
     * 
     * @param {*} metadata get private metadata
     * @returns private metadata after some updation
     * update private metadata as per Slack requirement to print Active/Inactive Contacts in dropdown;
     * These are used to print contacts in dropdown as per Active Inactive Contacts
     */
    function forActiveInactiveCons(metadata) {
        let activeCons = [], inactiveCons = [];

        if (metadata.Contacts.length) {
            metadata.Contacts.forEach(con => {

                if (con.Status == 'Active') {
                    let entry = {
                        "text": {
                            "type": "plain_text",
                            "text": con.Name
                        },
                        "value": con.id
                    }
                    activeCons.push(entry);
                } else {
                    let entry = {
                        "text": {
                            "type": "plain_text",
                            "text": con.Name
                        },
                        "value": con.id
                    }
                    inactiveCons.push(entry);
                }
            });
        }
        metadata.activeContacts = activeCons;
        metadata.inactiveContacts = inactiveCons;
        return metadata;
    }

    /**
     * 
     * @param {*} metadata get private metadata
     * @param {*} selectedContactId require Id of selected contact from dropdown (both - Active/Inactive)
     * @returns updated private metadata
     * add Name, Phone, Email, Title, Status, Last_Used as per Contact detail, getting from Salesforce and
     * update these in private metadata (object).
     */
    function setSelectedContactInfo(metadata, selectedContactId) {

        metadata.Contacts.forEach(con => {

            if (con.id == selectedContactId) {
                metadata.Name = con.Name;
                metadata.Phone = con.Phone;
                metadata.Email = con.Email;
                metadata.Title = con.Title;
                metadata.Status = con.Status;
                metadata.Last_Used = con.Last_Used ? con.Last_Used : '';
            }
        });
        return metadata;
    }

    /**
     * this function is for - 
     * 1. when user coming from edit Contact Modal 
     * 2. click on change contact from 2nd modal page (Add a Note)
     * Opens a modal of main modal of Ref Use Request with Contact selected & also display Contact information
     * @param {*} bot 
     * @param {*} message 
     * @param {*} pvt_metadata
     */
    async function mainModalRefUseReqWith_editContact_selectedContact(bot, message, pvt_metadata) {

            /**
             * this is for inital options selected by user as user comes from Edit Contact Modal to here
             * so as we have difference select box of Contact - Active, Inactive
             * we need to check selected contact is in Active select box or in Inactive box 
             * to automatically display that selected contact from these select box
             */
        if (pvt_metadata.Status) {
            console.log('In Status of Main Modal after selected Contact 1');
            bot.httpBody({
                response_action: 'update',
                view: {
                    "type": "modal",
                    "callback_id": "approveDeclinePopup",
                    "clear_on_close": true,
                    "private_metadata": JSON.stringify(pvt_metadata),
                    "submit": {
                        "type": "plain_text",
                        "text": "Next",
                        "emoji": true
                    },
                    "close": {
                        "type": "plain_text",
                        "text": "Close",
                        "emoji": true
                    },
                    "title": {
                        "type": "plain_text",
                        "text": "Reference Use Request",
                        "emoji": true
                    },
                    "blocks": [
                        {
                            "type": "section",
                            "fields": [
                                {
                                    "type": "mrkdwn",
                                    "text": "*Reference Account*\n" + pvt_metadata["Account Name"]
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Opportunity Account*\n" + pvt_metadata["Opportunity Account Name"]
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Reference Type*\n" + pvt_metadata["Reference Type"]
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Opportunity Name*\n" + pvt_metadata["Opportunity Name"]
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Requester*\n" + pvt_metadata["Requester Name"]
                                }
                            ]
                        },
                        {
                            "type": "actions",
                            "block_id": "additionalBlock",
                            "elements": [
                                {
                                    "type": "button",
                                    "action_id": "additionalModal",
                                    "text": {
                                        "type": "plain_text",
                                        "text": "More Request Details"
                                    },
                                    "style": "primary",
                                    "value": pvt_metadata.rraId
                                }
                            ]
                        },
                        {
                            "type": "divider"
                        },
                        {
                            "type": "input",
                            "block_id": "approveDeclineBlock",
                            "dispatch_action": true,
                            "label": {
                                "type": "plain_text",
                                "text": "What would you like to do?",
                            },
                            "element": {
                                "type": "radio_buttons",
                                "action_id": "approveDeclineRadio",
                                "options": [
                                    {
                                        "text": {
                                            "type": "mrkdwn",
                                            "text": "*Approve*"
                                        },
                                        "value": "Approve"
                                    },
                                    {
                                        "text": {
                                            "type": "mrkdwn",
                                            "text": "*Decline*"
                                        },
                                        "value": "Decline"
                                    }
                                ],
                                "initial_option": {
                                    "value": "Approve",
                                    "text": {
                                        "type": "mrkdwn",
                                        "text": "*Approve*"
                                    }
                                }
                            }
                        },
                        {
                            "type": "divider"
                        },
                        {
                            "type": "input",
                            "optional": true,
                            "block_id": "blkCon1",
                            "dispatch_action": true,
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "con_select1",
                                "placeholder": {
                                    "type": "plain_text",
                                    "text": "Select a contact"
                                },
                                "dispatch_action_config": {
                                    "trigger_actions_on": ["on_enter_pressed"]
                                }
                            },
                            "label": {
                                "type": "plain_text",
                                "text": "Existing reference contacts....",
                            }
                        },
                        {
                            "type": "input",
                            "optional": true,
                            "block_id": "blkCon2",
                            "dispatch_action": true,
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "con_select2",
                                "placeholder": {
                                    "type": "plain_text",
                                    "text": "Select a contact"
                                },
                                "dispatch_action_config": {
                                    "trigger_actions_on": ["on_enter_pressed"]
                                }
                            },
                            "label": {
                                "type": "plain_text",
                                "text": "Other contacts....",
                                "emoji": true
                            }
                        },
                        {
                            "type": "divider"
                        },
                        {
                            "type": "section",
                            "block_id": "editContactBlock",
                            "text": {
                                "type": "mrkdwn",
                                "text": "*Selected Contact Info*"
                            },
                            "accessory": {
                                "type": "button",
                                "action_id": "editContactModal",
                                "text": {
                                    "type": "plain_text",
                                    "text": "Edit",
                                    "emoji": true
                                },
                                "style": "primary",
                                "value": pvt_metadata.Id
                            }
                        },
                        {
                            "type": "section",
                            "fields": [
                                {
                                    "type": "mrkdwn",
                                    "text": "*Name*\n" + pvt_metadata.Name,
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Title*\n" + pvt_metadata.Title,
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Email*\n" + pvt_metadata.Email,
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Program Member*\n" + pvt_metadata.Status,
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Phone*\n" + pvt_metadata.Phone,
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Last Used*\n" + pvt_metadata.Last_Used,
                                },
                            ]
                        },
                        {
                            "type": "divider"
                        },
                        {
                            "type": "input",
                            "block_id": "contactNotesBlock",
                            "element": {
                                "type": "plain_text_input",
                                "multiline": true,
                                "action_id": "contactNotes",
                                "focus_on_load": true
                            },
                            "label": {
                                "type": "plain_text",
                                "text": "Add a Note",
                            }
                        },




                        /* {
                            "type": "section",
                            "text": {
                                "type": "plain_text",
                                "text": "Check out these charming checkboxes"
                            },
                            "accessory": {
                                "type": "checkboxes",
                                "action_id": "this_is_an_action_id",
                                "initial_options": [{
                                    "value": "A1",
                                    "text": {
                                        "type": "plain_text",
                                        "text": "Checkbox 1"
                                    }
                                }],
                                "options": [
                                    {
                                        "value": "A1",
                                        "text": {
                                            "type": "plain_text",
                                            "text": "Checkbox 1"
                                        }
                                    },
                                    {
                                        "value": "A2",
                                        "text": {
                                            "type": "plain_text",
                                            "text": "Checkbox 2"
                                        }
                                    }
                                ],
                                "focus_on_load": true
                            }
                        } */
                    ]
                }
            });
        } else {
            console.log('In Status of Main Modal after selected Contact');
            bot.httpBody({
                response_action: 'update',
                view: {
                    "type": "modal",
                    "callback_id": "approveDeclinePopup",
                    "clear_on_close": true,
                    "private_metadata": JSON.stringify(pvt_metadata),
                    "submit": {
                        "type": "plain_text",
                        "text": "Next",
                        "emoji": true
                    },
                    "close": {
                        "type": "plain_text",
                        "text": "Close",
                        "emoji": true
                    },
                    "title": {
                        "type": "plain_text",
                        "text": "Reference Use Request",
                        "emoji": true
                    },
                    "blocks": [
                        {
                            "type": "section",
                            "fields": [
                                {
                                    "type": "mrkdwn",
                                    "text": "*Reference Account*\n" + pvt_metadata["Account Name"]
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Opportunity Account*\n" + pvt_metadata["Opportunity Account Name"]
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Reference Type*\n" + pvt_metadata["Reference Type"]
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Opportunity Name*\n" + pvt_metadata["Opportunity Name"]
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Requester*\n" + pvt_metadata["Requester Name"]
                                }
                            ]
                        },
                        {
                            "type": "actions",
                            "block_id": "additionalBlock",
                            "elements": [
                                {
                                    "type": "button",
                                    "action_id": "additionalModal",
                                    "text": {
                                        "type": "plain_text",
                                        "text": "More Request Details"
                                    },
                                    "style": "primary",
                                    "value": pvt_metadata.rraId
                                }
                            ]
                        },
                        {
                            "type": "divider"
                        },
                        {
                            "type": "input",
                            "block_id": "approveDeclineBlock",
                            "dispatch_action": true,
                            "label": {
                                "type": "plain_text",
                                "text": "What would you like to do?",
                            },
                            "element": {
                                "type": "radio_buttons",
                                "action_id": "approveDeclineRadio",
                                "options": [
                                    {
                                        "text": {
                                            "type": "mrkdwn",
                                            "text": "*Approve*"
                                        },
                                        "value": "Approve"
                                    },
                                    {
                                        "text": {
                                            "type": "mrkdwn",
                                            "text": "*Decline*"
                                        },
                                        "value": "Decline"
                                    }
                                ],
                                "initial_option": {
                                    "value": "Approve",
                                    "text": {
                                        "type": "mrkdwn",
                                        "text": "*Approve*"
                                    }
                                }
                            }
                        },
                        {
                            "type": "divider"
                        },
                        {
                            "type": "input",
                            "optional": true,
                            "block_id": "blkCon1",
                            "dispatch_action": true,
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "con_select1",
                                "placeholder": {
                                    "type": "plain_text",
                                    "text": "Select a contact"
                                },
                                "dispatch_action_config": {
                                    "trigger_actions_on": ["on_enter_pressed"]
                                }
                            },
                            "label": {
                                "type": "plain_text",
                                "text": "Existing reference contacts....",
                            }
                        },
                        {
                            "type": "input",
                            "optional": true,
                            "block_id": "blkCon2",
                            "dispatch_action": true,
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "con_select2",
                                "placeholder": {
                                    "type": "plain_text",
                                    "text": "Select a contact"
                                },
                                "dispatch_action_config": {
                                    "trigger_actions_on": ["on_enter_pressed"]
                                }
                            },
                            "label": {
                                "type": "plain_text",
                                "text": "Other contacts....",
                                "emoji": true
                            }
                        },
                        {
                            "type": "divider"
                        },
                        {
                            "type": "section",
                            "block_id": "editContactBlock",
                            "text": {
                                "type": "mrkdwn",
                                "text": "*Selected Contact Info*"
                            },
                            "accessory": {
                                "type": "button",
                                "action_id": "editContactModal",
                                "text": {
                                    "type": "plain_text",
                                    "text": "Edit",
                                    "emoji": true
                                },
                                "style": "primary",
                                "value": pvt_metadata.Id
                            }
                        },
                        {
                            "type": "section",
                            "fields": [
                                {
                                    "type": "mrkdwn",
                                    "text": "*Name*\n" + pvt_metadata.Name,
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Title*\n" + pvt_metadata.Title,
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Email*\n" + pvt_metadata.Email,
                                },
                                {
                                    "type": "mrkdwn",
                                    "text": "*Phone*\n" + pvt_metadata.Phone,
                                },
                            ]
                        },
                        {
                            "type": "divider"
                        },
                        {
                            "type": "input",
                            "block_id": "contactNotesBlock",
                            "element": {
                                "type": "plain_text_input",
                                "multiline": true,
                                "action_id": "contactNotes",
                                "focus_on_load": true
                            },
                            "label": {
                                "type": "plain_text",
                                "text": "Add a Note",
                            }
                        }
                    ]
                }
            });
        }
    }

    /**
     * 
     * @param {*} bot 
     * @param {*} message 
     * @param {*} pvt_metadata 
     */
    async function contactEditModal(bot, message, pvt_metadata, fromEditContactButton) {
        let updateCheckbox = {
            "type": "checkboxes",
            "action_id": "isUpdateableCon",
            "options": [
                {
                    "value": "true",
                    "text": {
                        "type": "plain_text",
                        "text": " "
                    }
                },
            ]
        };
        let display = {
            "title": {
                "type": "plain_text",
                "text": "Edit Contact",
                "emoji": true
            },
            "submit": {
                "type": "plain_text",
                "text": "Save",
                "emoji": true
            },
            "type": "modal",
            "callback_id": "refUseReqMainBlockWithContacts",
            "private_metadata": JSON.stringify(pvt_metadata),
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "*Selected Contact Info*"
                    },
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "*Name*\n" + pvt_metadata.Name
                    },
                },
                {
                    "type": "input",
                    "block_id": "conEmailBlock",
                    "label": {
                        "type": "plain_text",
                        "text": "Email",
                        "emoji": true
                    },
                    "element": {
                        "type": "plain_text_input",
                        "action_id": "conEmail",
                        "initial_value": pvt_metadata.Email
                    }

                },
                {
                    "type": "input",
                    "block_id": "conPhoneBlock",
                    "label": {
                        "type": "plain_text",
                        "text": "Phone",
                        "emoji": true
                    },
                    "element": {
                        "type": "plain_text_input",
                        "action_id": "conPhone",
                        "initial_value": pvt_metadata.Phone
                    }
                },
                {
                    "type": "input",
                    "optional": true,
                    "block_id": "conTitleBlock",
                    "label": {
                        "type": "plain_text",
                        "text": "Title",
                        "emoji": true
                    },
                    "element": {
                        "type": "plain_text_input",
                        "action_id": "conTitle",
                        "initial_value": pvt_metadata.Title
                    }
                },
                {
                    "type": "section",
                    "block_id": "isUpdateableConBlock",
                    "text": {
                        "type": "plain_text",
                        "text": "Write these changes back to the Contact record?"
                    },
                    "accessory": updateCheckbox
                }
            ]
        };

        if (fromEditContactButton) {

            /**
             * this if condition is to check that isUpdate checked or not 
             * if checked then display check on modal and vice-versa.
             */
            if (pvt_metadata.isUpdateable === "true") {
                /**
                 * this is to display already selected option of to Update Contact by User
                 * so we pass initial value of that checkbox
                 */
                updateCheckbox["initial_options"] = [{
                    "value": "true",
                        "text": {
                            "type": "plain_text",
                            "text": " "
                        }
                }];
            }
            await bot.api.views.push({
                trigger_id: message.trigger_id,
                view: display
            });
        } else {
            await bot.api.views.update({
                view_id: message.view.id,
                view: display
            });
        }
    }

    /**
     * 
     * @param {*} bot 
     * @param {*} message 
     * @param {*} pvt_metadata 
     * @param {*} obj 
     * @param {*} fromSubmitButton 
     */
    async function selectContactModal(bot, message, pvt_metadata, obj, fromSubmitButton) {

        pvt_metadata.Contacts = obj.Contacts;
        let slackCons = [];

        pvt_metadata.Contacts.forEach(con => {

            let entry = {
                "text": {
                    "type": "plain_text",
                    "text": con.Name
                },
                "value": con.id
            }
            slackCons.push(entry);
        });
        pvt_metadata.contactsInDropDown = slackCons;
        let display = {
            "title": {
                "type": "plain_text",
                "text": "Select Contact",
            },
            "type": "modal",
            "private_metadata": JSON.stringify(pvt_metadata),
            "blocks": [
                {
                    "type": "input",
                    "block_id": "conSelectBlock",
                    "dispatch_action": true,
                    "element": {
                        "type": "static_select",
                        "action_id": "conSelect",
                        "placeholder": {
                            "type": "plain_text",
                            "text": "Select"
                        },
                        "options": pvt_metadata.contactsInDropDown
                    },
                    "label": {
                        "type": "plain_text",
                        "text": "Contacts",
                    }
                }
            ]
        };

        if (fromSubmitButton) {
            bot.httpBody({
                response_action: 'push',
                view: display
            });
        } else {
            await bot.api.views.push({
                trigger_id: message.trigger_id,
                view: display
            });
        }
    }

    /**
     * when user clicks on submit button of Modal then this controller is called;
     * then it works as per callback_id of Modal
     */
    controller.on(
        'view_submission',
        async (bot, message) => {
            console.log('view_submission');
            try {
                let existingConn = await connFactory.getConnection(message.team.id, controller);
                console.log('In view_submission TRY 796');
                let refselected = null;
                if (!existingConn) {
                    console.log('NOT EXisting Connection');
                    const authUrl = connFactory.getAuthUrl(message.team);
                    await bot.replyEphemeral(message, `click this link to connect\n<${authUrl}|Connect to Salesforce>`);
                } else {
                    console.log('In Else 793 Ears Having Existing Connection');
                    // When Account Name entered
                    if (message.view.callback_id == 'actionSelectionView') {
                        let actionName = 'account_search';

                        if (message.view.state.values.accblock) {
                            // retrieved what we select in the 1st modal 
                            actionName = message.view.state.values.accblock.searchid.selected_option.value;
                            console.log('Action Name 810 Ears', actionName);
                        } else {
                            //selected values of Content type is in refselected
                            refselected = message && message.view && message.view.state.values.blkref && message.view.state.values.blkref.reftype_select.selected_options != null ? message.view.state.values.blkref.reftype_select.selected_options : 'NONE';
                            let selectedValues = [];
                            refselected.forEach(function (ref) {
                                selectedValues.push(ref.value);
                            });
                            refselected = selectedValues.join(',');
                            console.log('Ref Selected EARS', refselected);
                        }
                        let pvt_metadata = JSON.parse(message.view.private_metadata);
                        pvt_metadata.actionName = actionName;

                        if (refselected) {
                            pvt_metadata.contentTypes = refselected;
                            console.log('PVT Metadata COntent Type');
                        }

                        if (actionName == 'content_search') {
                            if (pvt_metadata.pkg_version < 2.26) {
                                await opportunityFlow(bot, message, existingConn, pvt_metadata, pvt_metadata.email, null);
                            } else {
                                console.log('...view submission content opp flow....');
                                let mapval = await getRefTypes(existingConn, actionName);
                                console.log('CONTENT search in MAPVAL 837 Ears ', mapval);
                                bot.httpBody({
                                    response_action: 'update',
                                    view: {
                                        "type": "modal",
                                        "notify_on_close": true,
                                        "callback_id": "oppselect",
                                        "private_metadata": JSON.stringify(pvt_metadata),
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
                                                "optional": true,
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
                        } else if (actionName == 'account_search') {
                            try {
                                console.log('...view submission Account Search ref type flow....');
                                let mapval = await getRefTypes(existingConn, actionName);
                                // Referenceability Type
                                console.log('Account Search MAPVAL 883 Ears', mapval);
                                
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

                                

                            } catch (err) {
                                console.log('error occured during Account Search...');
                                logger.log(err);
                            }
                        } else {
                            console.log('ACTION name BOTH');
                            let titleText = 'Content Type';
                            let block_element_type = 'multi_static_select';
                            let block_label_text = 'What type of reference content do you need?';
                            let callbackId = 'actionSelectionView';
                            if (pvt_metadata.pkg_version < 2.26) {
                                console.log('PCKG Verison', pvt_metadata.pkg_version);
                                titleText = 'Referenceability Type';
                                block_element_type = 'static_select';
                                block_label_text = 'What type of reference accounts do you need?';
                                callbackId = 'oppselect';
                            }
                            let mapval = await getRefTypes(existingConn, actionName);
                            //Content Type
                            //mapval are all values of content type
                            console.log('BOTH in MAPVAL EARS 935', mapval);
                            bot.httpBody({
                                response_action: 'update',
                                view: {
                                    "type": "modal",
                                    "notify_on_close": true,
                                    "callback_id": callbackId,
                                    "private_metadata": JSON.stringify(pvt_metadata),
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
                                            "optional": true,
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
                        console.log('Opp Selected Ears');
                        let metdata = JSON.parse(message.view.private_metadata);
                        const email = metdata.email;
                        await opportunityFlow(bot, message, existingConn, metdata, email, null);

                    } else if (message.view.callback_id == 'searchselectopplarge') {
                        console.log('searchselectopplarge Ears');
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
                            searchURL = metadata.searchURL.replace('@@', oppSelected);
                            if (refselected && refselected != 'NONE' && refselected != '' && refselected != null) {
                                searchURL += '&type=';
                                searchURL += refselected;
                            }
                            if (contentTypeSelected) {
                                searchURL += '&contype=';
                                searchURL += contentTypeSelected;
                            }
                            searchURL = 'Thanks! Please <' + searchURL + '|click to complete your request in Salesforce.>';
                            metadata.searchURL = searchURL;
                            bot.httpBody({
                                response_action: 'update',
                                view: {
                                    "type": "modal",
                                    "notify_on_close": true,
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
                            opps = await getOppfromAcc(existingConn, email, acctext);
                            if (opps == null || opps.length == 0) {
                                bot.httpBody({
                                    response_action: 'errors',
                                    errors: {
                                        "accblock": 'No Opportunity matching the Opportunity Account Name found.Please retry.'
                                    }
                                });
                            }
                        } else if (acctext == '' && opptext != '') {
                            opps = await getOppfromName(existingConn, email, opptext);
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
                                    "notify_on_close": true,
                                    "callback_id": "searchselect",
                                    "private_metadata": JSON.stringify(metadata),
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

                        console.log('Search Selected EARS');
                        let metadata = JSON.parse(message.view.private_metadata);
                        const refselected = metadata.refTypes;
                        let contentTypeSelected = metadata.contentTypes;

                        let oppSelected = message.view.state.values.blkselectopp != null ? message.view.state.values.blkselectopp.opp_select.selected_option.value :
                            (message.view.state.values.blkselectoppFinal != null ? message.view.state.values.blkselectoppFinal.opp_select.selected_option.value : '');
                        let searchURL = metadata.searchURL;
                        searchURL = searchURL.replace('@@', oppSelected);

                        if (refselected && refselected != 'NONE' && refselected != '' && refselected != null) {
                            searchURL += '&type=';
                            searchURL += refselected;
                        }

                        if (contentTypeSelected) {
                            searchURL += '&contype=';
                            searchURL += contentTypeSelected;
                        }
                        searchURL = 'Thanks! Please <' + searchURL + '|click to complete your request in Salesforce.>';
                        bot.httpBody({
                            response_action: 'update',
                            view: {
                                "type": "modal",
                                "notify_on_close": true,
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
                    } else if (message.view.callback_id == 'approveDeclinePopup') {
                        //this is the final popup to confirm that user want to Decline the Request
                        let pvt_metadata = JSON.parse(message.view.private_metadata);
                        let contactSearchKeyword, hasRBI = false;
                        console.log('CON1', message.view.state.values.blkCon1, message.view.state.values.blkCon2);

                        if (message.view.state.values.blkCon1 && message.view.state.values.blkCon1.con_select1 && 
                            message.view.state.values.blkCon1.con_select1.value && message.view.state.values.blkCon2 && 
                            message.view.state.values.blkCon2.con_select2 && message.view.state.values.blkCon2.con_select2.value) {
                                hasRBI = true;
                                bot.httpBody({
                                    "response_action": "errors",
                                    "errors": {
                                        "blkCon2": "OR"
                                    }
                                });
                        } else if (message.view.state.values.blkCon1 && message.view.state.values.blkCon1.con_select1 && message.view.state.values.blkCon1.con_select1.value) {
                            contactSearchKeyword = message.view.state.values.blkCon1.con_select1.value;
                            hasRBI = true;
                        } else if (message.view.state.values.blkCon2 && message.view.state.values.blkCon2.con_select2 && message.view.state.values.blkCon2.con_select2.value) {
                            contactSearchKeyword = message.view.state.values.blkCon2.con_select2.value;
                            hasRBI = false;
                        }
                        console.log('In Approve Decline Popup', contactSearchKeyword, );

                        if (pvt_metadata.requestStatus == "Decline" || (pvt_metadata.requestStatus == "Approve" && pvt_metadata.ApproveWithoutContact) ||
                        (pvt_metadata.requestStatus == "Approve" && pvt_metadata.Id && !contactSearchKeyword)) {
                            console.log('IN approve decline Popup');

                            if (pvt_metadata.requestStatus == "Decline" || pvt_metadata.EmailPhoneNotRequired || 
                               (!pvt_metadata.EmailPhoneNotRequired && pvt_metadata.Email && pvt_metadata.Phone) ||
                               (pvt_metadata.requestStatus == "Approve" && pvt_metadata.ApproveWithoutContact)) {
                                let notes = message.view.state.values.contactNotesBlock.contactNotes.value;
                                pvt_metadata.Notes = notes;
                                bot.httpBody({
                                    response_action: 'update',
                                    view: {
                                        "title": {
                                            "type": "plain_text",
                                            "text": pvt_metadata.requestStatus + " Request"
                                        },
                                        "submit": {
                                            "type": "plain_text",
                                            "text": "Yes"
                                        },
                                        "type": "modal",
                                        "clear_on_close": true,
                                        "private_metadata": JSON.stringify(pvt_metadata),
                                        "callback_id": "approveDeclineRequest",
                                        "close": {
                                            "type": "plain_text",
                                            "text": "No",
                                        },
                                        "blocks": [
                                            {
                                                "type": "section",
                                                "text": {
                                                    "type": "plain_text",
                                                    "text": "Are you sure you want to "+ pvt_metadata.requestStatus + " this Reference Request?"
                                                }
                                            }
                                        ]
                                    }
                                });
                            } else {
                                    bot.httpBody({
                                        "response_action": "errors",
                                        "errors": {
                                            "contactNotesBlock": "Email and Phone number must be provided when you approve a request."
                                        }
                                    });
                            }
                        } else if (contactSearchKeyword) {
                            let obj = await getSearchedContact(existingConn, pvt_metadata.Accountid, contactSearchKeyword, hasRBI);
                            // pvt_metadata.EmailPhoneNotRequired = obj.EmailPhoneNotRequired;

                            if (obj.Contacts && obj.Contacts.length) {
                                /* pvt_metadata.Contacts = obj.Contacts;
                                let slackCons = [];

                                pvt_metadata.Contacts.forEach(con => {

                                    let entry = {
                                        "text": {
                                            "type": "plain_text",
                                            "text": con.Name
                                        },
                                        "value": con.id
                                    }
                                    slackCons.push(entry);
                                });

                                bot.httpBody({
                                    response_action: 'update',
                                    view: {
                                        "title": {
                                            "type": "plain_text",
                                            "text": "Select Contact",
                                        },
                                        "submit": {
                                            "type": "plain_text",
                                            "text": "Next"
                                        },
                                        "type": "modal",
                                        "clear_on_close": true,
                                        "private_metadata": JSON.stringify(pvt_metadata),
                                        "callback_id": "refUseReqMainBlockWithContacts",
                                        "blocks": [
                                            {
                                                "type": "input",
                                                "block_id": "conSelectBlock",
                                                "dispatch_action": true,
                                                "element": {
                                                    "type": "static_select",
                                                    "action_id": "conSelect",
                                                    "placeholder": {
                                                        "type": "plain_text",
                                                        "text": "Select"
                                                    },
                                                    "options": slackCons
                                                },
                                                "label": {
                                                    "type": "plain_text",
                                                    "text": "Contacts",
                                                }
                                            },
                                        ]
                                    }
                                }); */
                                selectContactModal(bot, message, pvt_metadata, obj, true);
                            } else {

                                if (hasRBI) {
                                    bot.httpBody({
                                        "response_action": "errors",
                                        "errors": {
                                            "blkCon1": "No matching contact found."
                                        }
                                    });
                                } else if (!hasRBI) {
                                    bot.httpBody({
                                        "response_action": "errors",
                                        "errors": {
                                            "blkCon2": "No matching contact found."
                                        }
                                    });
                                }
                            }
                            
                        } else if (!contactSearchKeyword && !pvt_metadata.Id && !hasRBI) {
                            console.log('HAS RBI', hasRBI);
                            bot.httpBody({
                                "response_action": "errors",
                                "errors": {
                                    "blkCon1": "Please provide Contact information."
                                }
                            });
                        }
                    } else if (message.view.callback_id == 'approveDeclineRequest') {
                        /* it sends(post) data to Salesforce from refedge.js function of
                        rraId(Reference Request Id), Notes, type
                        Use in Declining Request & Approving also
                        */
                        let pvt_metadata = JSON.parse(message.view.private_metadata);
                        let approveData = {};
                        approveData.rraId = pvt_metadata.rraId;
                        approveData.notes = pvt_metadata.Notes;

                        if (pvt_metadata.requestStatus == "Decline") {
                            approveData.type = 'Decline';
                        } else if (pvt_metadata.requestStatus == "Approve") {
                            approveData.type = 'Approve';
                            approveData.ApproveWithoutContact = pvt_metadata.ApproveWithoutContact;

                            if (!approveData.ApproveWithoutContact) {
                                approveData.selectedContactId = pvt_metadata.Id;
                                approveData.isUpdate = pvt_metadata.isUpdateable;
                                approveData.Title = pvt_metadata.Title;
                                approveData.Email = pvt_metadata.Email;
                                approveData.Phone = pvt_metadata.Phone;
                            }
                        }
                        submitP2PRequest(existingConn, approveData);

                        /**
                         * to clear all modal which are in stack so that user does not get any modal which are in stack
                         */
                        bot.httpBody({
                            "response_action": "clear"
                        });
                    } else if (message.view.callback_id == 'refUseReqMainBlockWithContacts') {
                        /* this part use in when user click on submit button of Edit Contact Modal
                        then we update the values of Title, Email & Phone of Contact if user change
                        it also check that these values are use for this Request only or update in Salesforce contact section also
                        */
                        let pvt_metadata = JSON.parse(message.view.private_metadata);

                        if (message.view.state.values.conEmailBlock && message.view.state.values.conPhoneBlock) {
                            pvt_metadata.Title = message.view.state.values.conTitleBlock && message.view.state.values.conTitleBlock.conTitle
                                ? message.view.state.values.conTitleBlock.conTitle.value : pvt_metadata.Title;
                            // as title is showing null on Modal.
                            pvt_metadata.Title = pvt_metadata.Title ? pvt_metadata.Title : "";
                            pvt_metadata.Email = message.view.state.values.conEmailBlock && message.view.state.values.conEmailBlock.conEmail
                                ? message.view.state.values.conEmailBlock.conEmail.value : pvt_metadata.Email;
                            pvt_metadata.Phone = message.view.state.values.conPhoneBlock && message.view.state.values.conPhoneBlock.conPhone
                                ? message.view.state.values.conPhoneBlock.conPhone.value : pvt_metadata.Phone;
                            console.log('Before isUpdateable in EARS with COntact Section', message.view.state.values.isUpdateableConBlock.isUpdateableCon.selected_options);
                            pvt_metadata.isUpdateable = message.view.state.values.isUpdateableConBlock.isUpdateableCon && message.view.state.values.isUpdateableConBlock.isUpdateableCon.selected_options[0] ?
                                message.view.state.values.isUpdateableConBlock.isUpdateableCon.selected_options[0].value :
                                false;
                            console.log('pvt_metadata.isUpdateable', pvt_metadata.isUpdateable);
                            // message.view.private_metadata = JSON.stringify(pvt_metadata);
                            // refUseRequestModalWithContactInfo(bot, message);

                            // this is for to check that this RR Account has both Active & Inactive Contacts 
                            // as we display them in different select box.
                            if (!(/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(pvt_metadata.Email))) {
                                bot.httpBody({
                                    "response_action": "errors",
                                    "errors": {
                                        "conEmailBlock": "Invalid Email."
                                    }
                                });
                            } else if (isNaN(pvt_metadata.Phone)) {
                                bot.httpBody({
                                    "response_action": "errors",
                                    "errors": {
                                        "conPhoneBlock": "Invalid Phone number."
                                    }
                                });
                            }
                        } else if (message.view.state.values.conSelectBlock) {
                            pvt_metadata.Id = message.view.state.values.conSelectBlock.conSelect.selected_option.value;
                            pvt_metadata = setSelectedContactInfo(pvt_metadata, pvt_metadata.Id);
                        }
                        mainModalRefUseReqWith_editContact_selectedContact(bot, message, pvt_metadata);
                    }
                }
            } catch (err) {
                console.log('IN Catch 1152 Ears');
                logger.log(err);
            }
        }
    );

    /**
     * this controller called when we click on button in Slack
     */
    controller.on('interactive_message_callback,block_actions',
        async (bot, message) => {
            console.log('interactive_message_callback, block_actions');
            try {
                let existingConn = await connFactory.getConnection(message.team.id, controller);

                if (existingConn) {

                    try {
                        console.log('MESSAGE 1281 EARS', message.actions[0].block_id, message.actions[0].action_id);

                        if (message.actions[0].block_id == 'refUseReqMainBlock' && message.actions[0].action_id == 'refUseReqMainBlock') {
                            /**
                             * this is from where our main modal of p2p request display as user Click on Approve/Decline button in chat 
                             */
                            console.log('IN refUseReqMainBlock EARS 1536');
                            let obj = await getRefUseReqModal(existingConn, message.actions[0].value);

                            if (obj && Object.keys(obj).length > 0 /* && Object.getPrototypeOf(obj) === Object.prototype */) {

                                if (obj["Slack_Error:"]) {
                                    console.log("Error from Salesforce Side");
                                    logger.log(obj["Slack_Error:"]);
                                } else if (obj.Approved_Declined) {
                                    await bot.api.views.open({
                                        trigger_id: message.trigger_id,
                                        view: {
                                            "type": "modal",
                                            "clear_on_close": true,
                                            "close": {
                                                "type": "plain_text",
                                                "text": "Close",
                                                "emoji": true
                                            },
                                            "title": {
                                                "type": "plain_text",
                                                "text": "Reference Use Request",
                                                "emoji": true
                                            },
                                            "blocks": [
                                                {
                                                    "type": "section",
                                                    "text": {
                                                        "text": "The approve/decline action has already been processed for this request OR the deadline for response has passed. No further modification is possible at this time.",
                                                        "type": "plain_text"
                                                    }
                                                }
                                            ]
                                        }
                                    });
                                } else {
                                    let pvt_metadata = obj;
                                    pvt_metadata.rraId = message.actions[0].value;
                                    pvt_metadata.isUpdateable = false;

                                    await bot.api.views.open({
                                        trigger_id: message.trigger_id,
                                        view: {
                                            "type": "modal",
                                            "clear_on_close": true,
                                            "private_metadata": JSON.stringify(pvt_metadata),
                                            // "submit": {
                                            //     "type": "plain_text",
                                            //     "text": "Next",
                                            //     "emoji": true
                                            // },
                                            "close": {
                                                "type": "plain_text",
                                                "text": "Close",
                                                "emoji": true
                                            },
                                            "title": {
                                                "type": "plain_text",
                                                "text": "Reference Use Request",
                                                "emoji": true
                                            },
                                            "blocks": [
                                                {
                                                    "type": "section",
                                                    "fields": [
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Reference Account*\n" + pvt_metadata["Account Name"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Opportunity Account*\n" + pvt_metadata["Opportunity Account Name"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Reference Type*\n" + pvt_metadata["Reference Type"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Opportunity Name*\n" + pvt_metadata["Opportunity Name"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Requester*\n" + pvt_metadata["Requester Name"]
                                                        }
                                                    ]
                                                },
                                                {
                                                    "type": "actions",
                                                    "block_id": "additionalBlock",
                                                    "elements": [
                                                        {
                                                            "type": "button",
                                                            "action_id": "additionalModal",
                                                            "text": {
                                                                "type": "plain_text",
                                                                "text": "More Request Details"
                                                            },
                                                            "style": "primary",
                                                            "value": pvt_metadata.rraId
                                                        }
                                                    ]
                                                },
                                                {
                                                    "type": "divider"
                                                },
                                                {
                                                    "type": "input",
                                                    "block_id": "approveDeclineBlock",
                                                    "dispatch_action": true,
                                                    "label": {
                                                        "type": "plain_text",
                                                        "text": "What would you like to do?",
                                                    },
                                                    "element": {
                                                        "type": "radio_buttons",
                                                        "action_id": "approveDeclineRadio",
                                                        "options": [
                                                            {
                                                                "text": {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Approve*"
                                                                },
                                                                "value": "Approve"
                                                            },
                                                            {
                                                                "text": {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Decline*"
                                                                },
                                                                "value": "Decline"
                                                            }
                                                        ]
                                                    }
                                                }
                                            ]
                                        }
                                    });
                                }
                            }
                        } else if (message.actions[0].action_id == "additionalModal" && message.actions[0].block_id == 'additionalBlock') {
                            console.log('In Additional Modal EARS 1688');
                            let obj = await getAdditionalModal(existingConn, message.actions[0].value);

                            if (obj && Object.keys(obj).length > 0) {
                                let jsonArray = [];
                                obj["Requester Notes"] = obj["Requester Notes"] ? obj["Requester Notes"] : '';
                                jsonArray.push(
                                    {
                                        "type": "section",
                                        "text": {
                                            "type": "mrkdwn",
                                            "text": "*Requester Notes*\n" + obj["Requester Notes"]
                                        }
                                    },
                                    {
                                        "type": "section",
                                        "text": {
                                            "type": "mrkdwn",
                                            "text": " "
                                        }
                                    }
                                );

                                Object.keys(obj).forEach(con => {

                                    if (con != "Requester Notes") {
                                        let entry = {
                                            "type": "section",
                                            "text": {
                                                "type": "mrkdwn",
                                                "text": "*" + con + "*\n" + obj[con]
                                            }
                                        };
                                        jsonArray.push(entry);
                                    }
                                });

                                await bot.api.views.push({
                                    trigger_id: message.trigger_id,
                                    view: {
                                        "title": {
                                            "type": "plain_text",
                                            "text": "More Request Details",
                                            "emoji": true
                                        },
                                        "type": "modal",
                                        "close": {
                                            "type": "plain_text",
                                            "text": "Close",
                                            "emoji": true
                                        },
                                        "blocks": jsonArray
                                    }
                                });
                            } 
                        } else if (message.actions[0].action_id == "editContactModal" && message.actions[0].block_id == 'editContactBlock') {
                            console.log('In editContactModal & editContactBlock EARS 2232');
                            let pvt_metadata = JSON.parse(message.view.private_metadata);
                            contactEditModal(bot, message, pvt_metadata, true);
                        } else if (message.actions[0].block_id == 'approveDeclineBlock' && message.actions[0].action_id == 'approveDeclineRadio') {
                            let pvt_metadata = JSON.parse(message.view.private_metadata);
                            requestStatus = message.view.state.values.approveDeclineBlock.approveDeclineRadio.selected_option.value;

                            if (requestStatus == "Decline" || (requestStatus == "Approve" && pvt_metadata.ApproveWithoutContact)) {
                                pvt_metadata.requestStatus = requestStatus;

                                await bot.api.views.update({
                                    view_id: message.view.id,
                                    view: {
                                        "type": "modal",
                                        "callback_id": "approveDeclinePopup",
                                        "clear_on_close": true,
                                        "private_metadata": JSON.stringify(pvt_metadata),
                                        "submit": {
                                            "type": "plain_text",
                                            "text": "Next",
                                            "emoji": true
                                        },
                                        "close": {
                                            "type": "plain_text",
                                            "text": "Close",
                                            "emoji": true
                                        },
                                        "title": {
                                            "type": "plain_text",
                                            "text": "Reference Use Request",
                                            "emoji": true
                                        },
                                        "blocks": [
                                            {
                                                "type": "section",
                                                "fields": [
                                                    {
                                                        "type": "mrkdwn",
                                                        "text": "*Reference Account*\n" + pvt_metadata["Account Name"]
                                                    },
                                                    {
                                                        "type": "mrkdwn",
                                                        "text": "*Opportunity Account*\n" + pvt_metadata["Opportunity Account Name"]
                                                    },
                                                    {
                                                        "type": "mrkdwn",
                                                        "text": "*Reference Type*\n" + pvt_metadata["Reference Type"]
                                                    },
                                                    {
                                                        "type": "mrkdwn",
                                                        "text": "*Opportunity Name*\n" + pvt_metadata["Opportunity Name"]
                                                    },
                                                    {
                                                        "type": "mrkdwn",
                                                        "text": "*Requester*\n" + pvt_metadata["Requester Name"]
                                                    }
                                                ]
                                            },
                                            {
                                                "type": "actions",
                                                "block_id": "additionalBlock",
                                                "elements": [
                                                    {
                                                        "type": "button",
                                                        "action_id": "additionalModal",
                                                        "text": {
                                                            "type": "plain_text",
                                                            "text": "More Request Details"
                                                        },
                                                        "style": "primary",
                                                        "value": pvt_metadata.rraId
                                                    }
                                                ]
                                            },
                                            {
                                                "type": "divider"
                                            },
                                            {
                                                "type": "input",
                                                "block_id": "approveDeclineBlock",
                                                "dispatch_action": true,
                                                "label": {
                                                    "type": "plain_text",
                                                    "text": "What would you like to do?",
                                                },
                                                "element": {
                                                    "type": "radio_buttons",
                                                    "action_id": "approveDeclineRadio",
                                                    "options": [
                                                        {
                                                            "text": {
                                                                "type": "mrkdwn",
                                                                "text": "*Approve*"
                                                            },
                                                            "value": "Approve"
                                                        },
                                                        {
                                                            "text": {
                                                                "type": "mrkdwn",
                                                                "text": "*Decline*"
                                                            },
                                                            "value": "Decline"
                                                        }
                                                    ]
                                                }
                                            },
                                            {
                                                "type": "input",
                                                "block_id": "contactNotesBlock",
                                                "element": {
                                                    "type": "plain_text_input",
                                                    "multiline": true,
                                                    "action_id": "contactNotes"
                                                },
                                                "label": {
                                                    "type": "plain_text",
                                                    "text": "Add a Note",
                                                }
                                            }
                                        ]
                                    }
                                });
                            } else if (requestStatus == "Approve" && pvt_metadata.ContactURL) {
                                await bot.api.views.update({
                                    view_id: message.view.id,
                                    view: {
                                        "type": "modal",
                                        "clear_on_close": true,
                                        "private_metadata": JSON.stringify(pvt_metadata),
                                        "close": {
                                            "type": "plain_text",
                                            "text": "Close",
                                            "emoji": true
                                        },
                                        "title": {
                                            "type": "plain_text",
                                            "text": "Reference Use Request",
                                            "emoji": true
                                        },
                                        "blocks": [
                                            {
                                                "type": "section",
                                                "fields": [
                                                    {
                                                        "type": "mrkdwn",
                                                        "text": "*Reference Account*\n" + pvt_metadata["Account Name"]
                                                    },
                                                    {
                                                        "type": "mrkdwn",
                                                        "text": "*Opportunity Account*\n" + pvt_metadata["Opportunity Account Name"]
                                                    },
                                                    {
                                                        "type": "mrkdwn",
                                                        "text": "*Reference Type*\n" + pvt_metadata["Reference Type"]
                                                    },
                                                    {
                                                        "type": "mrkdwn",
                                                        "text": "*Opportunity Name*\n" + pvt_metadata["Opportunity Name"]
                                                    },
                                                    {
                                                        "type": "mrkdwn",
                                                        "text": "*Requester*\n" + pvt_metadata["Requester Name"]
                                                    }
                                                ]
                                            },
                                            {
                                                "type": "actions",
                                                "block_id": "additionalBlock",
                                                "elements": [
                                                    {
                                                        "type": "button",
                                                        "action_id": "additionalModal",
                                                        "text": {
                                                            "type": "plain_text",
                                                            "text": "More Request Details"
                                                        },
                                                        "style": "primary",
                                                        "value": pvt_metadata.rraId
                                                    }
                                                ]
                                            },
                                            {
                                                "type": "divider"
                                            },
                                            {
                                                "type": "input",
                                                "block_id": "approveDeclineBlock",
                                                "dispatch_action": true,
                                                "label": {
                                                    "type": "plain_text",
                                                    "text": "What would you like to do?",
                                                },
                                                "element": {
                                                    "type": "radio_buttons",
                                                    "action_id": "approveDeclineRadio",
                                                    "options": [
                                                        {
                                                            "text": {
                                                                "type": "mrkdwn",
                                                                "text": "*Approve*"
                                                            },
                                                            "value": "Approve"
                                                        },
                                                        {
                                                            "text": {
                                                                "type": "mrkdwn",
                                                                "text": "*Decline*"
                                                            },
                                                            "value": "Decline"
                                                        }
                                                    ]
                                                }
                                            },
                                            {
                                                "type": "divider"
                                            },
                                            {
                                                "type": "section",
                                                "text": {
                                                    "type": "mrkdwn",
                                                    "text": "The requested Account, " + pvt_metadata["Account Name"] + ", does not have any associated Contacts."
                                                        + "\nTo approve this request, please "
                                                        + "<" + pvt_metadata.ContactURL + "|add a contact to this Account in Salesforce>."
                                                }
                                            }
                                        ]
                                    }
                                });
                            } else if (requestStatus == "Approve") {
                                pvt_metadata.requestStatus = requestStatus;

                                await bot.api.views.update({
                                    view_id: message.view.id,
                                    view: {
                                        "type": "modal",
                                        "callback_id": "approveDeclinePopup",
                                        "clear_on_close": true,
                                        "private_metadata": JSON.stringify(pvt_metadata),
                                        "submit": {
                                            "type": "plain_text",
                                            "text": "Next",
                                            "emoji": true
                                        },
                                        "close": {
                                            "type": "plain_text",
                                            "text": "Close",
                                            "emoji": true
                                        },
                                        "title": {
                                            "type": "plain_text",
                                            "text": "Reference Use Request",
                                            "emoji": true
                                        },
                                        "blocks": [
                                            {
                                                "type": "section",
                                                "fields": [
                                                    {
                                                        "type": "mrkdwn",
                                                        "text": "*Reference Account*\n" + pvt_metadata["Account Name"]
                                                    },
                                                    {
                                                        "type": "mrkdwn",
                                                        "text": "*Opportunity Account*\n" + pvt_metadata["Opportunity Account Name"]
                                                    },
                                                    {
                                                        "type": "mrkdwn",
                                                        "text": "*Reference Type*\n" + pvt_metadata["Reference Type"]
                                                    },
                                                    {
                                                        "type": "mrkdwn",
                                                        "text": "*Opportunity Name*\n" + pvt_metadata["Opportunity Name"]
                                                    },
                                                    {
                                                        "type": "mrkdwn",
                                                        "text": "*Requester*\n" + pvt_metadata["Requester Name"]
                                                    }
                                                ]
                                            },
                                            {
                                                "type": "actions",
                                                "block_id": "additionalBlock",
                                                "elements": [
                                                    {
                                                        "type": "button",
                                                        "action_id": "additionalModal",
                                                        "text": {
                                                            "type": "plain_text",
                                                            "text": "More Request Details"
                                                        },
                                                        "style": "primary",
                                                        "value": pvt_metadata.rraId
                                                    }
                                                ]
                                            },
                                            {
                                                "type": "divider"
                                            },
                                            {
                                                "type": "input",
                                                "block_id": "approveDeclineBlock",
                                                "dispatch_action": true,
                                                "label": {
                                                    "type": "plain_text",
                                                    "text": "What would you like to do?",
                                                },
                                                "element": {
                                                    "type": "radio_buttons",
                                                    "action_id": "approveDeclineRadio",
                                                    "options": [
                                                        {
                                                            "text": {
                                                                "type": "mrkdwn",
                                                                "text": "*Approve*"
                                                            },
                                                            "value": "Approve"
                                                        },
                                                        {
                                                            "text": {
                                                                "type": "mrkdwn",
                                                                "text": "*Decline*"
                                                            },
                                                            "value": "Decline"
                                                        }
                                                    ]
                                                }
                                            },
                                            {
                                                "type": "divider"
                                            },
                                            {
                                                "type": "section",
                                                "text": {
                                                    "type": "mrkdwn",
                                                    "text": "*Search and select from one of the following:*"
                                                    }
                                            },
                                            {
                                                "type": "input",
                                                "optional": true,
                                                "block_id": "blkCon1",
                                                "dispatch_action": true,
                                                "element": {
                                                    "type": "plain_text_input",
                                                    "action_id": "con_select1",
                                                    "placeholder": {
                                                        "type": "plain_text",
                                                        "text": "Select a contact"
                                                    },
                                                    "dispatch_action_config": {
                                                        "trigger_actions_on": ["on_enter_pressed"]
                                                    }
                                                },
                                                "label": {
                                                    "type": "plain_text",
                                                    "text": "Existing reference contacts....",
                                                }
                                            },
                                            {
                                                "type": "input",
                                                "optional": true,
                                                "block_id": "blkCon2",
                                                "dispatch_action": true,
                                                "element": {
                                                    "type": "plain_text_input",
                                                    "action_id": "con_select2",
                                                    "placeholder": {
                                                        "type": "plain_text",
                                                        "text": "Select a contact"
                                                    },
                                                    "dispatch_action_config": {
                                                        "trigger_actions_on": ["on_enter_pressed"]
                                                    }
                                                },
                                                "label": {
                                                    "type": "plain_text",
                                                    "text": "Other contacts....",
                                                    "emoji": true
                                                }
                                            },
                                            {
                                                "type": "divider"
                                            },
                                            {
                                                "type": "input",
                                                "block_id": "contactNotesBlock",
                                                "optional": true,
                                                "element": {
                                                    "type": "plain_text_input",
                                                    "multiline": true,
                                                    "action_id": "contactNotes"
                                                },
                                                "label": {
                                                    "type": "plain_text",
                                                    "text": "Add a Note",
                                                }
                                            }
                                        ]
                                    }
                                });
                            } 
                            
                        } else if ((message.actions[0].block_id == 'blkCon1' && message.actions[0].action_id == 'con_select1') || 
                                   (message.actions[0].block_id == 'blkCon2' && message.actions[0].action_id == 'con_select2')) {

                            let pvt_metadata = JSON.parse(message.view.private_metadata);
                            let contactSearchKeyword, hasRBI, obj;

                            if (message.view.state.values.blkCon1 && message.view.state.values.blkCon1.con_select1 && message.view.state.values.blkCon1.con_select1.value) {
                                contactSearchKeyword = message.view.state.values.blkCon1.con_select1.value;
                                hasRBI = true;
                                obj = await getSearchedContact(existingConn, pvt_metadata.Accountid, contactSearchKeyword, hasRBI);
                            } else if (message.view.state.values.blkCon2 && message.view.state.values.blkCon2.con_select2 && message.view.state.values.blkCon2.con_select2.value) {
                                contactSearchKeyword = message.view.state.values.blkCon2.con_select2.value;
                                hasRBI = false;
                                obj = await getSearchedContact(existingConn, pvt_metadata.Accountid, contactSearchKeyword, hasRBI);
                            }
                            console.log('HAS RBI -> ', contactSearchKeyword, hasRBI);

                            if (obj.Contacts && obj.Contacts.length) {
                                selectContactModal(bot, message, pvt_metadata, obj, false);
                            } else {

                                if (hasRBI) {
                                    await bot.api.views.update({
                                        view_id: message.view.id,
                                        view: {
                                            "type": "modal",
                                            "callback_id": "approveDeclinePopup",
                                            "clear_on_close": true,
                                            "private_metadata": JSON.stringify(pvt_metadata),
                                            "submit": {
                                                "type": "plain_text",
                                                "text": "Next",
                                                "emoji": true
                                            },
                                            "close": {
                                                "type": "plain_text",
                                                "text": "Close",
                                                "emoji": true
                                            },
                                            "title": {
                                                "type": "plain_text",
                                                "text": "Reference Use Request",
                                                "emoji": true
                                            },
                                            "blocks": [
                                                {
                                                    "type": "section",
                                                    "fields": [
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Reference Account*\n" + pvt_metadata["Account Name"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Opportunity Account*\n" + pvt_metadata["Opportunity Account Name"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Reference Type*\n" + pvt_metadata["Reference Type"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Opportunity Name*\n" + pvt_metadata["Opportunity Name"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Requester*\n" + pvt_metadata["Requester Name"]
                                                        }
                                                    ]
                                                },
                                                {
                                                    "type": "actions",
                                                    "block_id": "additionalBlock",
                                                    "elements": [
                                                        {
                                                            "type": "button",
                                                            "action_id": "additionalModal",
                                                            "text": {
                                                                "type": "plain_text",
                                                                "text": "More Request Details"
                                                            },
                                                            "style": "primary",
                                                            "value": pvt_metadata.rraId
                                                        }
                                                    ]
                                                },
                                                {
                                                    "type": "divider"
                                                },
                                                {
                                                    "type": "input",
                                                    "block_id": "approveDeclineBlock",
                                                    "dispatch_action": true,
                                                    "label": {
                                                        "type": "plain_text",
                                                        "text": "What would you like to do?",
                                                    },
                                                    "element": {
                                                        "type": "radio_buttons",
                                                        "action_id": "approveDeclineRadio",
                                                        "options": [
                                                            {
                                                                "text": {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Approve*"
                                                                },
                                                                "value": "Approve"
                                                            },
                                                            {
                                                                "text": {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Decline*"
                                                                },
                                                                "value": "Decline"
                                                            }
                                                        ]
                                                    }
                                                },
                                                {
                                                    "type": "divider"
                                                },
                                                {
                                                    "type": "section",
                                                    "text": {
                                                        "type": "mrkdwn",
                                                        "text": "*Search and select from one of the following:*"
                                                        }
                                                },
                                                {
                                                    "type": "input",
                                                    "optional": true,
                                                    "block_id": "blkCon1",
                                                    "dispatch_action": true,
                                                    "element": {
                                                        "type": "plain_text_input",
                                                        "action_id": "con_select1",
                                                        "placeholder": {
                                                            "type": "plain_text",
                                                            "text": "Select a contact"
                                                        },
                                                        "dispatch_action_config": {
                                                            "trigger_actions_on": ["on_enter_pressed"]
                                                        }
                                                    },
                                                    "label": {
                                                        "type": "plain_text",
                                                        "text": "Existing reference contacts....",
                                                    },
                                                    "hint": {
                                                        "type": "plain_text",
                                                        "text": "No matching contact found."
                                                    }
                                                },
                                                {
                                                    "type": "input",
                                                    "optional": true,
                                                    "block_id": "blkCon2",
                                                    "dispatch_action": true,
                                                    "element": {
                                                        "type": "plain_text_input",
                                                        "action_id": "con_select2",
                                                        "placeholder": {
                                                            "type": "plain_text",
                                                            "text": "Select a contact"
                                                        },
                                                        "dispatch_action_config": {
                                                            "trigger_actions_on": ["on_enter_pressed"]
                                                        }
                                                    },
                                                    "label": {
                                                        "type": "plain_text",
                                                        "text": "Other contacts....",
                                                        "emoji": true
                                                    }
                                                },
                                                {
                                                    "type": "divider"
                                                },
                                                {
                                                    "type": "input",
                                                    "block_id": "contactNotesBlock",
                                                    "optional": true,
                                                    "element": {
                                                        "type": "plain_text_input",
                                                        "multiline": true,
                                                        "action_id": "contactNotes"
                                                    },
                                                    "label": {
                                                        "type": "plain_text",
                                                        "text": "Add a Note",
                                                    }
                                                }
                                            ]
                                        }
                                    });
                                } else {
                                    await bot.api.views.update({
                                        view_id: message.view.id,
                                        view: {
                                            "type": "modal",
                                            "callback_id": "approveDeclinePopup",
                                            "clear_on_close": true,
                                            "private_metadata": JSON.stringify(pvt_metadata),
                                            "submit": {
                                                "type": "plain_text",
                                                "text": "Next",
                                                "emoji": true
                                            },
                                            "close": {
                                                "type": "plain_text",
                                                "text": "Close",
                                                "emoji": true
                                            },
                                            "title": {
                                                "type": "plain_text",
                                                "text": "Reference Use Request",
                                                "emoji": true
                                            },
                                            "blocks": [
                                                {
                                                    "type": "section",
                                                    "fields": [
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Reference Account*\n" + pvt_metadata["Account Name"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Opportunity Account*\n" + pvt_metadata["Opportunity Account Name"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Reference Type*\n" + pvt_metadata["Reference Type"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Opportunity Name*\n" + pvt_metadata["Opportunity Name"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Requester*\n" + pvt_metadata["Requester Name"]
                                                        }
                                                    ]
                                                },
                                                {
                                                    "type": "actions",
                                                    "block_id": "additionalBlock",
                                                    "elements": [
                                                        {
                                                            "type": "button",
                                                            "action_id": "additionalModal",
                                                            "text": {
                                                                "type": "plain_text",
                                                                "text": "More Request Details"
                                                            },
                                                            "style": "primary",
                                                            "value": pvt_metadata.rraId
                                                        }
                                                    ]
                                                },
                                                {
                                                    "type": "divider"
                                                },
                                                {
                                                    "type": "input",
                                                    "block_id": "approveDeclineBlock",
                                                    "dispatch_action": true,
                                                    "label": {
                                                        "type": "plain_text",
                                                        "text": "What would you like to do?",
                                                    },
                                                    "element": {
                                                        "type": "radio_buttons",
                                                        "action_id": "approveDeclineRadio",
                                                        "options": [
                                                            {
                                                                "text": {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Approve*"
                                                                },
                                                                "value": "Approve"
                                                            },
                                                            {
                                                                "text": {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Decline*"
                                                                },
                                                                "value": "Decline"
                                                            }
                                                        ]
                                                    }
                                                },
                                                {
                                                    "type": "divider"
                                                },
                                                {
                                                    "type": "section",
                                                    "text": {
                                                        "type": "mrkdwn",
                                                        "text": "*Search and select from one of the following:*"
                                                        }
                                                },
                                                {
                                                    "type": "input",
                                                    "optional": true,
                                                    "block_id": "blkCon1",
                                                    "dispatch_action": true,
                                                    "element": {
                                                        "type": "plain_text_input",
                                                        "action_id": "con_select1",
                                                        "placeholder": {
                                                            "type": "plain_text",
                                                            "text": "Select a contact"
                                                        },
                                                        "dispatch_action_config": {
                                                            "trigger_actions_on": ["on_enter_pressed"]
                                                        }
                                                    },
                                                    "label": {
                                                        "type": "plain_text",
                                                        "text": "Existing reference contacts....",
                                                    }
                                                },
                                                {
                                                    "type": "input",
                                                    "optional": true,
                                                    "block_id": "blkCon2",
                                                    "dispatch_action": true,
                                                    "element": {
                                                        "type": "plain_text_input",
                                                        "action_id": "con_select2",
                                                        "placeholder": {
                                                            "type": "plain_text",
                                                            "text": "Select a contact"
                                                        },
                                                        "dispatch_action_config": {
                                                            "trigger_actions_on": ["on_enter_pressed"]
                                                        }
                                                    },
                                                    "label": {
                                                        "type": "plain_text",
                                                        "text": "Other contacts....",
                                                        "emoji": true
                                                    },
                                                    "hint": {
                                                        "type": "plain_text",
                                                        "text": "No matching contact found."
                                                    }
                                                },
                                                {
                                                    "type": "divider"
                                                },
                                                {
                                                    "type": "input",
                                                    "block_id": "contactNotesBlock",
                                                    "optional": true,
                                                    "element": {
                                                        "type": "plain_text_input",
                                                        "multiline": true,
                                                        "action_id": "contactNotes",
                                                    },
                                                    "label": {
                                                        "type": "plain_text",
                                                        "text": "Add a Note",
                                                    }
                                                }
                                            ]
                                        }
                                    });
                                }
                            }
                        } else if (message.actions[0].block_id == 'conSelectBlock' && message.actions[0].action_id == 'conSelect') {
                            let pvt_metadata = JSON.parse(message.view.private_metadata);
                            pvt_metadata.isUpdateable = false;
                            pvt_metadata.Id = message.view.state.values.conSelectBlock.conSelect.selected_option.value;
                            pvt_metadata = setSelectedContactInfo(pvt_metadata, pvt_metadata.Id);
                            contactEditModal(bot, message, pvt_metadata, false);

                            /* await bot.api.views.push({
                                trigger_id: message.trigger_id,
                            // await bot.api.views.update({
                            //     view_id: message.view.id,
                                view: {
                                    "title": {
                                        "type": "plain_text",
                                        "text": "Edit Contact",
                                    },
                                    "submit": {
                                        "type": "plain_text",
                                        "text": "Next"
                                    },
                                    "type": "modal",
                                    "private_metadata": JSON.stringify(pvt_metadata),
                                    "callback_id": "refUseReqMainBlockWithContacts",
                                    "blocks": [
                                        {
                                            "type": "input",
                                            "block_id": "conSelectBlock",
                                            "dispatch_action": true,
                                            "element": {
                                                "type": "static_select",
                                                "action_id": "conSelect",
                                                "placeholder": {
                                                    "type": "plain_text",
                                                    "text": "Select"
                                                },
                                                "options": pvt_metadata.contactsInDropDown,
                                                "initial_option": {
                                                    "value": pvt_metadata.Id,
                                                    "text": {
                                                        "type": "plain_text",
                                                        "text": pvt_metadata.Name
                                                    }
                                                }
                                            },
                                            "label": {
                                                "type": "plain_text",
                                                "text": "Contacts",
                                            }
                                        },
                                        {
                                            "type": "divider"
                                        },
                                        {
                                            "type": "section",
                                            "text": {
                                                "type": "mrkdwn",
                                                "text": "*Selected Contact Info*"
                                            },
                                        },
                                        {
                                            "type": "section",
                                            "text": {
                                                "type": "mrkdwn",
                                                "text": "*Name*\n" + pvt_metadata.Name
                                            },
                                        },
                                        {
                                            "type": "input",
                                            "block_id": "conEmailBlock",
                                            "label": {
                                                "type": "plain_text",
                                                "text": "Email",
                                                "emoji": true
                                            },
                                            "element": {
                                                "type": "plain_text_input",
                                                "action_id": "conEmail",
                                                "initial_value": pvt_metadata.Email
                                            }
                                        },
                                        {
                                            "type": "input",
                                            "block_id": "conPhoneBlock",
                                            "label": {
                                                "type": "plain_text",
                                                "text": "Phone",
                                                "emoji": true
                                            },
                                            "element": {
                                                "type": "plain_text_input",
                                                "action_id": "conPhone",
                                                "initial_value": pvt_metadata.Phone
                                            }
                                        },
                                        {
                                            "type": "input",
                                            "optional": true,
                                            "block_id": "conTitleBlock",
                                            "label": {
                                                "type": "plain_text",
                                                "text": "Title",
                                                "emoji": true
                                            },
                                            "element": {
                                                "type": "plain_text_input",
                                                "action_id": "conTitle",
                                                "initial_value": pvt_metadata.Title
                                            }
                                        },
                                        {
                                            "type": "section",
                                            "block_id": "isUpdateableConBlock",
                                            "text": {
                                                "type": "plain_text",
                                                "text": "Write these changes back to the Contact record?"
                                            },
                                            "accessory": {
                                                "type": "checkboxes",
                                                "action_id": "isUpdateableCon",
                                                "options": [
                                                    {
                                                        "value": "true",
                                                        "text": {
                                                            "type": "plain_text",
                                                            "text": " "
                                                        }
                                                    },
                                                ]
                                            }
                                        }
                                    ]
                                }
                            }); */
                        }
                    } catch (err) {
                        console.log('...exception in block_actions interactive_message_callback ... 2367 EARS');
                        logger.log(err);
                    }
                }
                // else if (!existingConn) {
                //     const authUrl = connFactory.getAuthUrl(message.team);
                //     await bot.replyEphemeral(message, `click this link to connect\n<${authUrl}|Connect to Salesforce>`);
                // }
            } catch (err) {
                console.log('Error in interactive_message_callback, block_actions');
                logger.log(err);
            }
        }
    );

}
