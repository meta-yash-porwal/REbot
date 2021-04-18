
module.exports = {
    log: (...messages) => {
        console.log('-----@@@@');
        messages.forEach(m => {
            console.log(m);
        });
        console.log('-----@@@@');
    }
};