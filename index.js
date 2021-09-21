var cron = require('node-cron');
var shell = require('shelljs');

cron.schedule('0 3 */2 * *', function() {
    shell.exec("node updateproduct.js")
});