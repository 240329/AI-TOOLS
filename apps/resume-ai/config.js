const sharedConfig = require('../../shared/config');

module.exports = {
  port: 3003,
  database: sharedConfig.database,
  upload: sharedConfig.upload
};