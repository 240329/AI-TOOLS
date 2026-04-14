require('dotenv').config();

const sharedConfig = require('../../shared/config');

module.exports = {
  port: parseInt(process.env.PORT_VGEN) || 3002,
  database: sharedConfig.database,
  upload: sharedConfig.upload
};
const sharedConfig = require('../../shared/config');

module.exports = {
  port: 3002,
  database: sharedConfig.database,
  upload: sharedConfig.upload
};