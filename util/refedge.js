
const connFactory = require('../util/connection-factory');
const logger = require('../common/logger');
//replace /PORDEV with /refedge
module.exports = {
    saveTeamId: async (conn, teamData) => {
        await conn.apex.post(process.env.NAMESPACE +'/rebot/saveTeamId', teamData, (err, res) => {

            if (err) {
                logger.log(err);
            }
        });
    },
    submitRequest: async (conn, teamData) => {
        let returnVal = '';
        try {
            await conn.apex.post(process.env.NAMESPACE +'/rebot/submitRequest', teamData, (err, res) => {
                returnVal = res;
                if (err) {
                    logger.log(err);
                } 
            });
        } catch (err) {
            logger.log(err);
        }
            return returnVal;
    },
    getRefTypes: async (conn,action) => {
        let ref = [];
        let url = action == null || action == '' ? process.env.NAMESPACE +'/rebot/REF_TYPE' : process.env.NAMESPACE +'/rebot/REF_TYPE::' + action;
        await conn.apex.get(url, (err, response) => {
            if (err) {
                logger.log(err);
            } else  if (response) {
                if (response != 'false') {
                    response = JSON.parse(response);
                    console.log(response)
                    if (action == 'content_search' && response.hasOwnProperty('content_search')) {
                        Object.keys(response.content_search).forEach(function(k){
                            var entry = {
                                "text": {
                                    "type": "plain_text",
                                    "text": response.content_search[k]
                                },
                                "value": k
                            }
                            ref.push(entry);
                        });
                    } else if(response.hasOwnProperty('account_search')){
                        Object.keys(response.account_search).forEach(function(k){
                            let entry = {
                                "text": {
                                    "type": "plain_text",
                                    "text": k
                                },
                                "value": response.account_search[k]
                            }
                            ref.push(entry);
                        });
                    }
                }
            }
        });
        return ref;
    },
    getOpp: async (conn,email,action) => {
        let opp = [];
        let returnVal = {};
        let url = action == null || action == '' ? process.env.NAMESPACE +'/rebot/OPP_TYPE' + '::' + email : process.env.NAMESPACE +'/rebot/OPP_TYPE::' + email + '::' + action;
        await conn.apex.get(url, (err, response) => {
            if (err) {
                logger.log(err);
            } else  if (response) {
                if (response != 'false') {
                    console.log(response);
                    response = JSON.parse(response);
                    let oppList = response['opp'];
                    returnVal['searchURL'] = response['searchURL'];
                    oppList.forEach(function(oppWrapper){
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
                }
            }
        });
        return returnVal;
    },
    getOppfromName: async (conn,email,name) => {
        let opp = [];
        name = encodeURIComponent(name);
        let url = process.env.NAMESPACE +'/rebot/OPP_TYPE_NAME' + '::' + email + '::' + name;
        await conn.apex.get(url, (err, response) => {
            if (err) {
                logger.log(err);
            } else  if (response) {
                if (response != 'false') {
                    response = JSON.parse(response);;
                    response.forEach(function(oppWrapper){
                        let entry = {
                            "text": {
                                "type": "plain_text",
                                "text": oppWrapper['oppName'] + ' (' + oppWrapper['accName'] + ')'
                            },
                            "value": oppWrapper['id']
                        }
                        opp.push(entry);
                    });
                }
            }
        });
        return opp;
    },
    getOppfromAcc: async (conn,email,name) => {
        let opp = [];
        name = encodeURIComponent(name);
        let url = process.env.NAMESPACE +'/rebot/OPP_TYPE_ACCNAME' + '::' + email + '::' + name;
        console.log(url);
        await conn.apex.get(url, (err, response) => {
            if (err) {
                logger.log(err);
            } else  if (response) {
                if (response != 'false') {
                    response = JSON.parse(response);;
                    response.forEach(function(oppWrapper){
                        let entry = {
                            "text": {
                                "type": "plain_text",
                                "text": oppWrapper['oppName'] + ' (' + oppWrapper['accName'] + ')'
                            },
                            "value": oppWrapper['id']
                        }
                        opp.push(entry);
                    });
                }
            }
        });
        return opp;
    },
    getAccounts: async (conn, accName) => {
        if (accName == '' || accName == null) {
            return 'false';
        } else {
            let val = [];
            await conn.apex.get(process.env.NAMESPACE +'/rebot/' + accName , accName, (err, response) => {
                if (err) {
                    logger.log(err);
                } else  if (response) {
                    if (response != 'false') {
                        response = JSON.parse(response);
                        Object.keys(response).forEach(function(k){
                            var entry = {
                                "text": {
                                    "type": "plain_text",
                                    "text": response[k]
                                },
                                "value": k
                            }
                            val.push(entry);
                        });
                    }
                }
            });
            return val;
        }
    },
    getRequestURL: async (conn, accId) => {
        if (accId == '' || accId == null) {
            return 'false';
        } else {
            let val = '';
            await conn.apex.get(process.env.NAMESPACE +'/rebot/' + 'LINK_URL' ,'LINK_URL', (err, response) => {
                if (err) {
                    logger.log(err);
                } else  if (response) {
                    logger.log(err);
                    if (response != 'false') {
                        val = response.replace('@@', accId);
                    }
                }
            });
            return val;
        }
    },

    checkOrgSettingAndGetData : async(conn, email) => {
        console.log('namespace@@', process.env.NAMESPACE);
        let result;
        await conn.apex.get(process.env.NAMESPACE +'/rebot/check_setting::' + email , (err, response) => {
            if (err) {
                logger.log(err);
            } else  if (response) {
                console.log('response check org', response);
                if(response === '{}') {
                    response = 'both';
                }
                result = response;
            }
        });
        return result;
    }
};