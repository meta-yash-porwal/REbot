require('dotenv').config();

const { Botkit } = require('botkit');
const { SlackAdapter, SlackMessageTypeMiddleware, SlackEventMiddleware } = require('botbuilder-adapter-slack');
const { getFilterMiddleware } = require('./listeners/middleware/migration-filter');
const errorHandlerMiddleware = require('./api/middleware/error-handler');
const corsMiddleware = require('./api/middleware/cors');
/*Commented Dialogflow code due to error with Production account. 
Keeping here just for future reference.*/ 
//const projectId = process.env.PROJECT_ID;
//const client_email = process.env.CLIENT_EMAIL;
//const private_key = process.env.PRIVATE_KEY.replace(/\\n/gm, '\n');

/* const dialogflowMiddleware = require('botkit-middleware-dialogflow')({
    projectId,
    credentials: {
        client_email,
        private_key
    }
}); */
const mongoProvider = require('./db/mongo-provider')({
    mongoUri: process.env.MONGO_CONNECTION_STRING
});
const authRouter = require('./api/routes/oauth');
const sfAuthRouter = require('./api/routes/sfauth');
const sfMsgRouter = require('./api/routes/msg-handler'); 
const viewsRouter = require('./api/routes/views');

const adapter = new SlackAdapter({
    clientSigningSecret: process.env.SLACK_SIGNING_SECRET,
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    scopes: [
    'channels:history',
    'channels:join',
    'channels:manage',
    'channels:read',
    'chat:write',
    'team:read', 
    'users:read',
    'users:read.email', 
    'im:history',
    'im:write',
    'incoming-webhook',
    'commands'
    ],
    redirectUri: process.env.SLACK_REDIRECT_URI,
    getTokenForTeam: getTokenForTeam,
    getBotUserByTeam: getBotUserByTeam,
    oauthVersion: 'v2'

});
adapter.use(new SlackEventMiddleware());
adapter.use(new SlackMessageTypeMiddleware());

const controller = new Botkit({
    webhook_uri: '/slack/receive',
    adapter
});
controller.webserver.use(corsMiddleware);
controller.addPluginExtension('database', mongoProvider);

//controller.middleware.receive.use(dialogflowMiddleware.receive);
controller.middleware.receive.use(getFilterMiddleware);
controller.publicFolder('', __dirname + '/public');

controller.ready(() => {
    controller.loadModules(__dirname + '/dialogs');
    controller.loadModules(__dirname + '/listeners');
    console.log('----------------Ready-----------------');
    authRouter(controller);
    sfAuthRouter(controller);
    sfMsgRouter(controller);
    viewsRouter(controller);
    controller.webserver.use(errorHandlerMiddleware.notFound);
    controller.webserver.use(errorHandlerMiddleware.internalError);
});

async function getTokenForTeam(teamId) {
    try {
        const teamData = await controller.plugins.database.teams.get(teamId);
        if (!teamData) {
            console.log('team not found for id: ', teamId);
            throw new Error('Missing credentials for team.');
        }
        return teamData.bot.token;
    } catch (err) {
        console.log(err);
    }
}

async function getBotUserByTeam(teamId) {
    try {
        const teamData = await controller.plugins.database.teams.get(teamId);
        if (!teamData) {
            console.log('team not found for id: ', teamId);
            throw new Error('Missing credentials for team.........');
        }
        return teamData.bot.user_id;
    } catch (err) {
        console.log(err);
    }
}

module.exports = controller;