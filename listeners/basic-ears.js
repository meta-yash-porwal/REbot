const connFactory = require('../util/connection-factory');
const logger = require('../common/logger');

const { getRefTypes, getOpp, getOppfromName, getOppfromAcc, saveTeamId, checkOrgSettingAndGetData, getRefUseReqModal, getAdditionalModal, submitP2PRequest } = require('../util/refedge');

const { checkTeamMigration } = require('../listeners/middleware/migration-filter');
const text = require('body-parser/lib/types/text');

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

                        const userList = await bot.api.users.list({
                            token: teams[index].bot.token
                        });
                        
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
                            console.log("msg.packageVersion", msg.packageVersion);

                            if (msg.packageVersion >= 2.29  && msg.text) {
                                console.log('In NEW if with Package Version');
                                let mestxt = msg.text.split("\n<https://");
                                let url = mestxt[1];
                                url = url.split('|Approve/Decline')[0];
                                url = 'https://' + url;
                                console.log('NEW url', url);
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
                                                            "text": "Approve/Decline",
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
                            await getRefUseReqModal(existingConn, 'a0h1P000007TRDzQAO');
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
                        "callback_id": "AD_Modal",
                        "notify_on_close": true,
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
                        // "submit_disabled": true,
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
                                    "text": "Select an existing program member....",
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
                                    "text": "or add another contact to the reference program",
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
                        ]
                    }
                });
            } else if (pvt_metadata.activeContacts.length || pvt_metadata.inactiveContacts.length) {
                console.log('In this if of ONE');
                let tmpCons, label;

                if (pvt_metadata.activeContacts.length) {
                    tmpCons = pvt_metadata.activeContacts;
                    label = "Select an existing program member....";
                } else if (pvt_metadata.inactiveContacts.length) {
                    console.log('In this if of ONE 2');
                    tmpCons = pvt_metadata.inactiveContacts;
                    label = "or add another contact to the reference program";
                }
                await bot.api.views.update({
                    view_id: message.view.id,
                    view: {
                        "type": "modal",
                        "callback_id": "AD_Modal",
                        "notify_on_close": true,
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
                metadata.Last_Used = con.Last_Used ? con.Last_Used : ' ';
            }
        });
        return metadata;
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
                                // bot.httpBody({
                                //     response_action: 'update',
                                //     view: {
                                //         "type": "modal",
                                //         "notify_on_close": true,
                                //         "callback_id": "oppselect",
                                //         "private_metadata": JSON.stringify(pvt_metadata),
                                //         "submit": {
                                //             "type": "plain_text",
                                //             "text": "Next",
                                //             "emoji": true
                                //         },
                                //         "title": {
                                //             "type": "plain_text",
                                //             "text": "Referenceability Type",
                                //             "emoji": true
                                //         },
                                //         "blocks": [
                                //             {
                                //                 "type": "input",
                                //                 "block_id": "blkref",
                                //                 "element": {
                                //                     "type": "static_select",
                                //                     "action_id": "reftype_select",
                                //                     "placeholder": {
                                //                         "type": "plain_text",
                                //                         "text": "Select a type",
                                //                         "emoji": true
                                //                     },
                                //                     "options": mapval
                                //                 },
                                //                 "label": {
                                //                     "type": "plain_text",
                                //                     "text": "What type of reference accounts do you need?",
                                //                     "emoji": true
                                //                 }
                                //             }
                                //         ]
                                //     }
                                // });

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
                                                    "options": ["Hello", "Hii", "Ceeeee", "Peeee"]
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
                    } else if (message.view.callback_id == 'AD_Modal') {
                        /* this callbackId is called when user click on submit button of Reference Use Request Main Block
                           then open Approve Modal or Decline Modal whichever option the user select 
                        */
                        let pvt_metadata = JSON.parse(message.view.private_metadata);
                        console.log('PRIVATE data EARS 1744 Approve', message.view.private_metadata);
                        let selCon;

                        // this condition is use to check for select contact block & selected contact id is store in selCon;
                        // as this Modal is also use in Approve Without Contact
                        if (message.view.state.values.blkCon1 || message.view.state.values.blkCon2) {
                            selCon = message.view.state.values.blkCon1.con_select1.selected_option ?
                                message.view.state.values.blkCon1.con_select1.selected_option.value :
                                message.view.state.values.blkCon2.con_select2.selected_option ?
                                    message.view.state.values.blkCon2.con_select2.selected_option.value : '';
                        }
                        let requestStatus;

                        if (pvt_metadata.Contacts.length) {
                            requestStatus = message.view.state.values.approveDeclineBlock && message.view.state.values.approveDeclineBlock.approveDeclineRadio
                                ? message.view.state.values.approveDeclineBlock.approveDeclineRadio.selected_option.value : "";
                        } else {
                            requestStatus = message.view.state.values.approveDeclineBlockForNoContacts.approveDeclineRadioForNoContacts.selected_option.value;
                        }

                        // validation for contact - email & phone number
                        if (selCon && requestStatus !== "Decline") {
                            requestStatus = pvt_metadata.Email && pvt_metadata.Phone ? requestStatus : "";
                        }

                        // selCon is not null & empty 
                        if (selCon && requestStatus === "Approve") {
                            pvt_metadata.Id = selCon;
                            bot.httpBody({
                                response_action: 'update',
                                view: {
                                    "title": {
                                        "type": "plain_text",
                                        "text": "Reference Use Request",
                                        "emoji": true
                                    },
                                    "submit": {
                                        "type": "plain_text",
                                        "text": "Approve",
                                        "emoji": true
                                    },
                                    "type": "modal",
                                    "callback_id": "approvePopup",
                                    "private_metadata": JSON.stringify(pvt_metadata),
                                    "close": {
                                        "type": "plain_text",
                                        "text": "Cancel",
                                        "emoji": true
                                    },
                                    "blocks": [
                                        {
                                            "type": "section",
                                            "text": {
                                                "type": "mrkdwn",
                                                "text": "*Selected Contact Info*"
                                            }
                                        },
                                        {
                                            "type": "section",
                                            "fields": [
                                                {
                                                    "type": "mrkdwn",
                                                    "text": "*Name*\n" + pvt_metadata.Name
                                                },
                                                {
                                                    "type": "mrkdwn",
                                                    "text": "*Title*\n" + pvt_metadata.Title
                                                },
                                                {
                                                    "type": "mrkdwn",
                                                    "text": "*Email*\n" + pvt_metadata.Email
                                                },
                                                {
                                                    "type": "mrkdwn",
                                                    "text": "*Program Member*\n" + pvt_metadata.Status
                                                },
                                                {
                                                    "type": "mrkdwn",
                                                    "text": "*Phone*\n" + pvt_metadata.Phone
                                                },
                                                {
                                                    "type": "mrkdwn",
                                                    "text": "*Last Used*\n" + pvt_metadata.Last_Used
                                                }
                                            ]
                                        },
                                        {
                                            "type": "divider"
                                        },
                                        {
                                            "type": "input",
                                            "block_id": "noteBlock",
                                            "element": {
                                                "type": "plain_text_input",
                                                "multiline": true,
                                                "action_id": "contactnotes"
                                            },
                                            "label": {
                                                "type": "plain_text",
                                                "text": "Add a Note",
                                                "emoji": true
                                            }
                                        }
                                    ]
                                }
                            });
                        } else if (requestStatus === "Decline" || (requestStatus === "Approve" && (selCon || pvt_metadata.ApproveWithoutContact))) {
                            // this block is use in Decline Request & Approve Without Request (both - Approve/Decline)
                            console.log('In DECLINE NOTES MODAL ears 1389');
                            let popup = requestStatus === "Approve" ? "approvePopup" : "declinePopup";
                            let text = requestStatus === "Approve" ? "Approve" : "Decline";
                            pvt_metadata.Id = selCon;
                            bot.httpBody({
                                response_action: 'update',
                                view: {
                                    "title": {
                                        "type": "plain_text",
                                        "text": "Reference Use Request",
                                        "emoji": true
                                    },
                                    "submit": {
                                        "type": "plain_text",
                                        "text": text,
                                        "emoji": true
                                    },
                                    "type": "modal",
                                    "private_metadata": JSON.stringify(pvt_metadata),
                                    "callback_id": popup,
                                    "close": {
                                        "type": "plain_text",
                                        "text": "Cancel",
                                        "emoji": true
                                    },
                                    "blocks": [
                                        {
                                            "type": "input",
                                            "block_id": "noteBlock",
                                            "element": {
                                                "type": "plain_text_input",
                                                "multiline": true,
                                                "action_id": "contactnotes"
                                            },
                                            "label": {
                                                "type": "plain_text",
                                                "text": "Add a Note",
                                                "emoji": true
                                            }
                                        }
                                    ]
                                }
                            });
                        } else {

                            if (!selCon) {
                                //display error if user click submit button without selecting any Contact from select boxes in Main Block (Reference Use Request)
                                bot.httpBody({
                                    "response_action": "errors",
                                    "errors": {
                                        "blkCon1": "A contact must be selected before approving a request."
                                    }
                                });
                            } else if (message.view.state.values.blkCon2) {
                                bot.httpBody({
                                    "response_action": "errors",
                                    "errors": {
                                        "blkCon2": "Email and Phone number must be provided when you approve a request."
                                    }
                                });
                            } else {
                                bot.httpBody({
                                    "response_action": "errors",
                                    "errors": {
                                        "blkCon1": "Email and Phone number must be provided when you approve a request."
                                    }
                                });
                            }
                        }
                    } else if (message.view.callback_id == 'approvePopup') {
                        //this is the final popup to confirm that user want to approve the Request
                        let pvt_metadata = JSON.parse(message.view.private_metadata);
                        let notes = message.view.state.values.noteBlock.contactnotes.value;
                        pvt_metadata.Notes = notes;
                        bot.httpBody({
                            response_action: 'update',
                            view: {
                                "title": {
                                    "type": "plain_text",
                                    "text": "Reference Use Request",
                                    "emoji": true
                                },
                                "submit": {
                                    "type": "plain_text",
                                    "text": "Yes",
                                    "emoji": true
                                },
                                "type": "modal",
                                "private_metadata": JSON.stringify(pvt_metadata),
                                "callback_id": "approveRequest",
                                "close": {
                                    "type": "plain_text",
                                    "text": "No",
                                    "emoji": true
                                },
                                "blocks": [
                                    {
                                        "type": "section",
                                        "text": {
                                            "type": "plain_text",
                                            "text": "Are you sure you want to approve this Reference use Request?",
                                            "emoji": true
                                        }
                                    }
                                ]
                            }
                        });
                    } else if (message.view.callback_id == 'declinePopup') {
                        //this is the final popup to confirm that user want to Decline the Request
                        console.log('In Decline Popup EARS BEfore 1473 ', message.view);
                        let pvt_metadata = JSON.parse(message.view.private_metadata);
                        let notes = message.view.state.values.noteBlock.contactnotes.value;
                        pvt_metadata.Notes = notes;
                        console.log('In Decline Popup EARS 1473');
                        bot.httpBody({
                            response_action: 'update',
                            view: {
                                "title": {
                                    "type": "plain_text",
                                    "text": "Reference Use Request",
                                    "emoji": true
                                },
                                "submit": {
                                    "type": "plain_text",
                                    "text": "Yes",
                                    "emoji": true
                                },
                                "type": "modal",
                                "private_metadata": JSON.stringify(pvt_metadata),
                                "callback_id": "declineRequest",
                                "close": {
                                    "type": "plain_text",
                                    "text": "No",
                                    "emoji": true
                                },
                                "blocks": [
                                    {
                                        "type": "section",
                                        "text": {
                                            "type": "plain_text",
                                            "text": "Are you sure you want to decline this Reference use Request?",
                                            "emoji": true
                                        }
                                    }
                                ]
                            }
                        });
                    } else if (message.view.callback_id == 'approveRequest') {
                        /* it sends(post) data to Salesforce from refedge.js function of 
                        rraId(Reference Request Id), Notes, type, ApproveWithoutContact & Contact details
                        Use in Approving Request
                        */
                        let pvt_metadata = JSON.parse(message.view.private_metadata);
                        let approveData = {};
                        approveData.rraId = pvt_metadata.rraId;
                        approveData.notes = pvt_metadata.Notes;
                        approveData.type = 'Approve';
                        approveData.ApproveWithoutContact = pvt_metadata.ApproveWithoutContact;

                        if (!approveData.ApproveWithoutContact) {
                            approveData.selectedContactId = pvt_metadata.Id;
                            approveData.isUpdate = pvt_metadata.isUpdateable;
                            approveData.Title = pvt_metadata.Title;
                            approveData.Email = pvt_metadata.Email;
                            approveData.Phone = pvt_metadata.Phone;
                        }
                        submitP2PRequest(existingConn, approveData);
                        //then clear the screen
                        /* bot.httpBody({
                            "response_action": "clear"
                        }); */
                    } else if (message.view.callback_id == 'declineRequest') {
                        /* it sends(post) data to Salesforce from refedge.js function of
                        rraId(Reference Request Id), Notes, type
                        Use in Declining Request
                        */
                        let pvt_metadata = JSON.parse(message.view.private_metadata);
                        let approveData = {};
                        approveData.rraId = pvt_metadata.rraId;
                        approveData.notes = pvt_metadata.Notes;
                        approveData.type = 'Decline';
                        submitP2PRequest(existingConn, approveData);
                        /* bot.httpBody({
                            "response_action": "clear"
                        }); */
                    } else if (message.view.callback_id == 'refUseReqMainBlockWithContacts') {
                        /* this part use in when user click on submit button of Edit Contact Modal
                        then we update the values of Title, Email & Phone of Contact if user change
                        it also check that these values are use for this Request only or update in Salesforce contact section also
                        */
                        let pvt_metadata = JSON.parse(message.view.private_metadata);
                        console.log('HELLO MetaData', pvt_metadata.isUpdateable);
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
                        if (pvt_metadata.activeContacts.length && pvt_metadata.inactiveContacts.length) {
                            let state;
                            pvt_metadata.Contacts.forEach(con => {

                                if (con.id == pvt_metadata.Id) {
                                    state = con.Status;
                                }
                            })

                            /**
                             * this is for inital options selected by user as user comes from Edit Contact Modal to here
                             * so as we have difference select box of Contact - Active, Inactive
                             * we need to check selected contact is in Active select box or in Inactive box 
                             * to automatically display that selected contact from these select box
                             */
                            if (state == "Active") {
                                bot.httpBody({
                                    response_action: 'update',
                                    view: {
                                        "type": "modal",
                                        "callback_id": "AD_Modal",
                                        // "notify_on_close": true,
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
                                        // "submit_disabled": true,
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
                                                    "options": pvt_metadata.activeContacts,
                                                    "initial_option": {
                                                        "value": pvt_metadata.Id,
                                                        "text": {
                                                            "type": "plain_text",
                                                            "text": pvt_metadata.Name
                                                        }
                                                    },
                                                },
                                                "label": {
                                                    "type": "plain_text",
                                                    "text": "Select an existing program member....",
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
                                                    "text": "or add another contact to the reference program",
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
                                            
                                        ]
                                    }
                                });
                            } else {
                                bot.httpBody({
                                    response_action: 'update',
                                    view: {
                                        "type": "modal",
                                        "callback_id": "AD_Modal",
                                        // "notify_on_close": true,
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
                                        // "submit_disabled": true,
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
                                                    "text": "Select an existing program member....",
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
                                                    "options": pvt_metadata.inactiveContacts,
                                                    "initial_option": {
                                                        "value": pvt_metadata.Id,
                                                        "text": {
                                                            "type": "plain_text",
                                                            "text": pvt_metadata.Name
                                                        }
                                                    },
                                                },
                                                "label": {
                                                    "type": "plain_text",
                                                    "text": "or add another contact to the reference program",
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
                                        ]
                                    }
                                });
                            }
                        } else if (pvt_metadata.activeContacts.length || pvt_metadata.inactiveContacts.length) {
                            // this is for only one type Contacts - Active/Inactive in RR Account 
                            // so we need to display only one select box
                            let tmpCons, label;

                            if (pvt_metadata.activeContacts.length) {
                                tmpCons = pvt_metadata.activeContacts;
                                label = "Select an existing program member....";
                            } else if (pvt_metadata.inactiveContacts.length) {
                                tmpCons = pvt_metadata.inactiveContacts;
                                label = "or add another contact to the reference program";
                            }
                            bot.httpBody({
                                response_action: 'update',
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
                                                "options": tmpCons,
                                                "initial_option": {
                                                    "value": pvt_metadata.Id,
                                                    "text": {
                                                        "type": "plain_text",
                                                        "text": pvt_metadata.Name
                                                    }
                                                },
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
                                    ]
                                }
                            });
                        }
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
                    // const userProfile = await bot.api.users.info({//users.read scope
                    //     token: bot.api.token,
                    //     user: message.user
                    // });
                    try {
                        console.log('MESSAGE 1281 EARS', message.actions[0].block_id, message.actions[0].action_id);

                        if (message.actions[0].block_id == 'refUseReqMainBlock' && message.actions[0].action_id == 'refUseReqMainBlock') {
                            /**
                             * this is from where our main modal of p2p request display as user Click on Approve/Decline button in chat 
                             */
                            console.log('IN refUseReqMainBlock EARS 1536');
                            console.log('RRAID EARS', message.actions[0].value);
                            let obj = await getRefUseReqModal(existingConn, message.actions[0].value);

                            if (obj) {

                                if (obj.Approved_Declined) {
                                    await bot.api.views.open({
                                        trigger_id: message.trigger_id,
                                        view: {
                                            "type": "modal",
                                            // "notify_on_close": true,
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
                                } else if (!obj.ApproveWithoutContact) {
                                    let pvt_metadata = forActiveInactiveCons(obj);
                                    pvt_metadata.rraId = message.actions[0].value;
                                    pvt_metadata.isUpdateable = false;
                                    {
                                        /* if (pvt_metadata.activeContacts.length && pvt_metadata.inactiveContacts.length) {
                                        
                                            await bot.api.views.open({
                                                trigger_id: message.trigger_id,
                                                view: {
                                                    "type": "modal",
                                                    "callback_id": "AD_Modal",
                                                    // "notify_on_close": true,
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
                                                                "options": obj.activeContacts
                                                            },
                                                            "label": {
                                                                "type": "plain_text",
                                                                "text": "Select an existing program member....",
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
                                                                "options": obj.inactiveContacts
                                                            },
                                                            "label": {
                                                                "type": "plain_text",
                                                                "text": "or add another contact to the reference program",
                                                                "emoji": true
                                                            }
                                                        },
                                                        {
                                                            "type": "divider"
                                                        },
                                                        {
                                                            "type": "section",
                                                            "fields": [
                                                                {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Reference Account*\n" + obj["Account Name"]
                                                                },
                                                                {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Opportunity Account*\n" + obj["Opportunity Account Name"]
                                                                },
                                                                {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Reference Type*\n" + obj["Reference Type"]
                                                                },
                                                                {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Opportunity Name*\n" + obj["Opportunity Name"]
                                                                },
                                                                {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Requester*\n" + obj["Requester Name"]
                                                                }
                                                            ]
                                                        }
                                                    ]
                                                }
                                            });
                                        } else if (pvt_metadata.activeContacts.length || pvt_metadata.inactiveContacts.length) {
                                            let tmpCons, label;
    
                                            if (pvt_metadata.activeContacts.length) {
                                                tmpCons = pvt_metadata.activeContacts;
                                                label = "Select an existing program member....";
                                            } else if (pvt_metadata.inactiveContacts.length) {
                                                tmpCons = pvt_metadata.inactiveContacts;
                                                label = "or add another contact to the reference program";
                                            }
                                            await bot.api.views.open({
                                                trigger_id: message.trigger_id,
                                                view: {
                                                    "type": "modal",
                                                    "callback_id": "AD_Modal",
                                                    // "notify_on_close": true,
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
                                                            "fields": [
                                                                {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Reference Account*\n" + obj["Account Name"]
                                                                },
                                                                {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Opportunity Account*\n" + obj["Opportunity Account Name"]
                                                                },
                                                                {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Reference Type*\n" + obj["Reference Type"]
                                                                },
                                                                {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Opportunity Name*\n" + obj["Opportunity Name"]
                                                                },
                                                                {
                                                                    "type": "mrkdwn",
                                                                    "text": "*Requester*\n" + obj["Requester Name"]
                                                                }
                                                            ]
                                                        }
                                                    ]
                                                }
                                            });
                                        } */
                                    }

                                    if (pvt_metadata.activeContacts.length && pvt_metadata.inactiveContacts.length) {
                                        await bot.api.views.open({
                                            view_id: message.view.id,
                                            view: {
                                                "type": "modal",
                                                "callback_id": "AD_Modal",
                                                "notify_on_close": true,
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
                                                            "text": "Select an existing program member....",
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
                                                            "text": "or add another contact to the reference program",
                                                            "emoji": true
                                                        }
                                                    }
                                                ]
                                            }
                                        });
                                    } else if (pvt_metadata.activeContacts.length || pvt_metadata.inactiveContacts.length) {
                                        let tmpCons, label;

                                        if (pvt_metadata.activeContacts.length) {
                                            tmpCons = pvt_metadata.activeContacts;
                                            label = "Select an existing program member....";
                                        } else if (pvt_metadata.inactiveContacts.length) {
                                            tmpCons = pvt_metadata.inactiveContacts;
                                            label = "or add another contact to the reference program";
                                        }
                                        await bot.api.views.open({
                                            trigger_id: message.trigger_id,
                                            view: {
                                                "type": "modal",
                                                "callback_id": "AD_Modal",
                                                // "notify_on_close": true,
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
                                                                "text": "*Reference Account*\n" + obj["Account Name"]
                                                            },
                                                            {
                                                                "type": "mrkdwn",
                                                                "text": "*Opportunity Account*\n" + obj["Opportunity Account Name"]
                                                            },
                                                            {
                                                                "type": "mrkdwn",
                                                                "text": "*Reference Type*\n" + obj["Reference Type"]
                                                            },
                                                            {
                                                                "type": "mrkdwn",
                                                                "text": "*Opportunity Name*\n" + obj["Opportunity Name"]
                                                            },
                                                            {
                                                                "type": "mrkdwn",
                                                                "text": "*Requester*\n" + obj["Requester Name"]
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
                                                    } 
                                                ]
                                            }
                                        });
                                    } else {
                                        
                                        await bot.api.views.open({
                                            trigger_id: message.trigger_id,
                                            view: {
                                                "type": "modal",
                                                // "notify_on_close": true,
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
                                                                "text": "*Reference Account*\n" + obj["Account Name"]
                                                            },
                                                            {
                                                                "type": "mrkdwn",
                                                                "text": "*Opportunity Account*\n" + obj["Opportunity Account Name"]
                                                            },
                                                            {
                                                                "type": "mrkdwn",
                                                                "text": "*Reference Type*\n" + obj["Reference Type"]
                                                            },
                                                            {
                                                                "type": "mrkdwn",
                                                                "text": "*Opportunity Name*\n" + obj["Opportunity Name"]
                                                            },
                                                            {
                                                                "type": "mrkdwn",
                                                                "text": "*Requester*\n" + obj["Requester Name"]
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "type": "divider"
                                                    },
                                                    {
                                                        "type": "actions",
                                                        "block_id": "approveDeclineBlockForNoContacts",
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
                                                                "action_id": "approveDeclineRadioForNoContacts",
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
                                                        "type": "section",
                                                        "text": {
                                                            "type": "mrkdwn",
                                                            "text": "The requested Account, " + obj["Account Name"] + ", does not have any associated Contacts."
                                                                     + "\nTo approve this request, please \n"
                                                                     + "<http://www.example.com|add a contact to this Account in Salesforce> \n"
                                                                     + "then return here to complete the process."
                                                        }
                                                    }
                                                ]
                                            }
                                        });
                                    }
                                } else {
                                    /* use in Approve Without Contact 
                                    means we can approve p2p request without contact
                                    */
                                    let pvt_metadata = obj;
                                    pvt_metadata.rraId = message.actions[0].value;
                                    pvt_metadata.isUpdateable = false;

                                    await bot.api.views.open({
                                        trigger_id: message.trigger_id,
                                        view: {
                                            "type": "modal",
                                            "callback_id": "AD_Modal",
                                            // "notify_on_close": true,
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
                                                    "type": "section",
                                                    "fields": [
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Reference Account*\n" + obj["Account Name"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Opportunity Account*\n" + obj["Opportunity Account Name"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Reference Type*\n" + obj["Reference Type"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Opportunity Name*\n" + obj["Opportunity Name"]
                                                        },
                                                        {
                                                            "type": "mrkdwn",
                                                            "text": "*Requester*\n" + obj["Requester Name"]
                                                        }
                                                    ]
                                                }
                                            ]
                                        }
                                    });
                                }
                            }
                        } else if (message.actions[0].action_id == "additionalModal" && message.actions[0].block_id == 'additionalBlock') {
                            console.log('In Additional Modal EARS 1688');
                            let obj = await getAdditionalModal(existingConn, message.actions[0].value);
                            if (obj) {
                                let jsonArray = [];
                                obj["Requester Notes"] = obj["Requester Notes"] ? obj["Requester Notes"] : '';
                                jsonArray.push({
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
                                    });

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
                                // console.log('JSON ARRAY 1519 EARS', jsonArray);
                                await bot.api.views.push({
                                    trigger_id: message.trigger_id,
                                    view: {
                                        "title": {
                                            "type": "plain_text",
                                            "text": "Additional Request Info",
                                            "emoji": true
                                        },
                                        "submit": {
                                            "type": "plain_text",
                                            "text": "Back",
                                            "emoji": true
                                        },
                                        "type": "modal",
                                        "clear_on_close": true,
                                        "close": {
                                            "type": "plain_text",
                                            "text": "Close",
                                            "emoji": true
                                        },
                                        "blocks": jsonArray
                                    }
                                });
                            }
                        } else if (message.actions[0].action_id == "con_select1" && message.actions[0].block_id == 'blkCon1') {
                            console.log('In blkCon1 & con_select1 EARS 1746');
                            await refUseRequestModalWithContactInfo(bot, message);
                        } else if (message.actions[0].action_id == "con_select2" && message.actions[0].block_id == 'blkCon2') {
                            console.log('In blkCon2 & con_select2 EARS 1990');
                            await refUseRequestModalWithContactInfo(bot, message);
                        } else if (message.actions[0].action_id == "editContactModal" && message.actions[0].block_id == 'editContactBlock') {
                            console.log('In editContactModal & editContactBlock EARS 2232');
                            let pvt_metadata = JSON.parse(message.view.private_metadata);

                            if (pvt_metadata.isUpdateable === "true") {
                                /**
                                 * this is to display already selected option of to Update Contact by User
                                 * so we pass initial value of that checkbox
                                 */
                                await bot.api.views.push({
                                    trigger_id: message.trigger_id,
                                    view: {
                                        "title": {
                                            "type": "plain_text",
                                            "text": "Reference Use Request",
                                            "emoji": true
                                        },
                                        "submit": {
                                            "type": "plain_text",
                                            "text": "Back",
                                            "emoji": true
                                        },
                                        "type": "modal",
                                        "callback_id": "refUseReqMainBlockWithContacts",
                                        "private_metadata": JSON.stringify(pvt_metadata),
                                        "close": {
                                            "type": "plain_text",
                                            "text": "Close",
                                            "emoji": true
                                        },
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
                                                    ],
                                                    "initial_options": [{
                                                        "value": "true",
                                                        "text": {
                                                            "type": "plain_text",
                                                            "text": " "
                                                        }
                                                    }],
                                                }
                                            }
                                        ]
                                    }
                                });
                            } else {
                                // this is for not selected checkbox
                                await bot.api.views.push({
                                    trigger_id: message.trigger_id,
                                    view: {
                                        "title": {
                                            "type": "plain_text",
                                            "text": "Reference Use Request",
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
                                        "close": {
                                            "type": "plain_text",
                                            "text": "Close",
                                            "emoji": true
                                        },
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
                                });
                            }
                        } else if (message.actions[0].block_id == 'approveDeclineBlockForNoContacts' && message.actions[0].action_id == 'approveDeclineRadioForNoContacts') {
                            console.log('In ApproveDeclineBlockForNoContacts & approveDeclineRadioForNoContacts');
                            
                            let requestStatus = message.view.state.values.approveDeclineBlockForNoContacts.approveDeclineRadioForNoContacts.selected_option.value;
                            console.log('REQUEST status -', requestStatus);
                            let pvt_metadata = JSON.parse(message.view.private_metadata);

                            if (requestStatus == "Decline") {
                                await bot.api.views.update({
                                    view_id: message.view.id,
                                    view: {
                                        "type": "modal",
                                        "callback_id": "AD_Modal",
                                        // "notify_on_close": true,
                                        "clear_on_close": true,
                                        "private_metadata": JSON.stringify(pvt_metadata),
                                        "close": {
                                            "type": "plain_text",
                                            "text": "Close",
                                            "emoji": true
                                        },
                                        "submit": {
                                            "type": "plain_text",
                                            "text": "Next",
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
                                                "block_id": "approveDeclineBlockForNoContacts",
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
                                                        "action_id": "approveDeclineRadioForNoContacts",
                                                        "initial_option": {
                                                            "value": "Decline",
                                                            "text": {
                                                                "type": "mrkdwn",
                                                                "text": "*Decline*"
                                                            }
                                                        }
                                                    }
                                                ]
                                            },
                                        ]
                                    }
                                });
                            } else if (requestStatus == "Approve") {

                                await bot.api.views.update({
                                    view_id: message.view.id,
                                    view: {
                                        "type": "modal",
                                        "callback_id": "AD_Modal",
                                        // "notify_on_close": true,
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
                                                "block_id": "approveDeclineBlockForNoContacts",
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
                                                        "action_id": "approveDeclineBlockForNoContacts",
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
                                                "type": "section",
                                                "text": {
                                                    "type": "mrkdwn",
                                                    "text": "The requested Account, " + pvt_metadata["Account Name"] + ", does not have any associated Contacts."
                                                        + "\nTo approve this request, please \n"
                                                        + "<http://www.example.com|add a contact to this Account in Salesforce> \n"
                                                        + "then return here to complete the process."
                                                }
                                            }
                                        ]
                                    }
                                });
                            }
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
                logger.log(err);
            }
        }
    );

}
