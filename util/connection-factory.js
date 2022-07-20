const jsforce = require('jsforce');
const { postForm } = require('../common/request-util');
const logger = require('../common/logger');

let openConnections = {};
const oauth2 = new jsforce.OAuth2({
    clientId: process.env.SF_CLIENT_ID,
    clientSecret: process.env.SF_CLIENT_SECRET,
    redirectUri: `${process.env.APP_BASE_URL}/sfauth/callback`
});

async function findOrgByTeamId(teamId, botController) {

    try {
        let orgs = await botController.plugins.database.orgs.get(teamId);
        return orgs;
    } catch (err) {
        console.log('error in findOrgByTeamId');
        console.dir(err);
        //throw err;
    }
}

async function getExistingConnection(teamId, botController) {

    try {
        let connectedOrg = await findOrgByTeamId(teamId, botController);

        if (connectedOrg) {
            let conn = new jsforce.Connection({
                oauth2: oauth2,
                accessToken: connectedOrg.access_token,
                refreshToken: connectedOrg.refresh_token,
                instanceUrl: connectedOrg.instance_url
            });

            conn.on('refresh', (accessToken, res) => {
                try {
                    connectedOrg.access_token = accessToken;
                    saveOrg(connectedOrg, botController);
                } catch (err) {
                    logger.log('connection refresh error:', err);
                }
            });
            openConnections[teamId] = conn;
            return conn;
        }
        return null;
    } catch (err) {
        console.log('error in getExistingConnection');
        console.dir(err);
        //throw err;
    }
}

async function saveOrg(data, botController) {

    try {
        await botController.plugins.database.orgs.save(data);
    } catch (err) {
        console.log('error in saveOrg');
        console.dir(err);
        //throw err;
    }
}

async function deleteOrg(teamId, botController) {

    try {
        await botController.plugins.database.orgs.delete(teamId);
        return 'success';
    } catch (err) {
        console.log('error in deleteOrg');
        console.dir(err);
        //throw err;
    }
}

module.exports = {
    getAuthUrl: teamId => {
        let authUrl = oauth2.getAuthorizationUrl({ scope: 'api refresh_token web' });
        return (authUrl + '&state=' + teamId);
    },
    getConnection: async (teamId, botController) => {

        if (teamId in openConnections) {
            return openConnections[teamId];
        }

        try {
            let conn = await getExistingConnection(teamId, botController);
            return conn;
        } catch (err) {
            console.log('error in getConnection');
            console.dir(err);
            //throw err;
        }
    },
    connect: async (authCode, botController, teamId) => {
        

        if (teamId in openConnections) {
            console.log('----------openConnections-----------');
            return openConnections[teamId];
        }

        try {
            let conn = await getExistingConnection(teamId, botController);

            if (conn) {console.log('found existing connection....')

                return conn;
            }
            conn = new jsforce.Connection({ oauth2: oauth2 });
            const userInfo = await conn.authorize(authCode);

            conn.on('refresh', async (accessToken, res) => {
                try {
                    let orgs = await findOrgByTeamId(teamId, botController);

                    if (orgs && orgs.length > 0) {
                        orgs[0].access_token = accessToken;
                        saveOrg(org, botController);
                    }
                } catch (err) {
                    logger.log('connection refresh error:', err);
                }
            });
            let org = {
                id: teamId,
                access_token: conn.accessToken,
                refresh_token: conn.refreshToken,
                instance_url: conn.instanceUrl,
                user_id: userInfo.id,
                org_id: userInfo.organizationId,
                revoke_url: conn.oauth2.revokeServiceUrl
            };
            saveOrg(org, botController);
            openConnections[teamId] = conn;
            return conn;
        } catch (err) {
            console.log('error in connect');
            console.dir(err);
            //throw err;
        }
    },
    revoke: async (orgData, botController) => {

        try {
            const result = await postForm(orgData.revokeUrl, { token: orgData.refreshToken });
            delete openConnections[orgData.teamId];
            const deleteResult = await deleteOrg(orgData.teamId, botController);
            return deleteResult;
        } catch (err) {
            console.log('error in revoke');
            console.dir(err);
            //throw err;
        }
    }
};
