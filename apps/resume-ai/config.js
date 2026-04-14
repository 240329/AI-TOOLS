
require('dotenv').config();

const sharedConfig = require('../../shared/config');

module.exports = {
  port: parseInt(process.env.PORT_RESUME) || 3003,
  database: sharedConfig.database,
  upload: sharedConfig.upload
};
const sharedConfig = require('../../shared/config');

module.exports = {
  port: 3003,
  database: sharedConfig.database,
  upload: sharedConfig.upload
};
No newline at end of file