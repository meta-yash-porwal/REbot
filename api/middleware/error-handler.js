
const logger = require('../../common/logger');

module.exports = {
    notFound: (req, res, next) => {
        const err = new Error('not found!!');
        err.status = 404;
        next(err);
    },
    internalError: (error, req, res, next) => {
        res.status(error.status || 500);

        if (error.status === 404) {
            res.redirect('/not-found.html');
        } else {
            logger.log(error.message, error.stack);
            res.redirect('/internal-error.html');
        }
    }
};