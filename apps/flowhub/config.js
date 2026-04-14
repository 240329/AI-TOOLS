require('dotenv').config();

const sharedConfig = require('../../shared/config');

module.exports = {
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,

  port: parseInt(process.env.PORT_FLOWHUB) || 3001,

  database: sharedConfig.database,

  upload: sharedConfig.upload,

  scheduler: {
    maxTasks: 100,
    checkInterval: 60000
  }
};