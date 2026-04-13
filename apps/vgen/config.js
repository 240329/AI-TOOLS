const sharedConfig = require('../../shared/config');

module.exports = {
  port: 3002,
  database: sharedConfig.database,
  upload: sharedConfig.upload
};