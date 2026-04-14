const sharedConfig = require('../../shared/config');

module.exports = {
  // 飞书应用凭证 - 请在飞书开发者后台获取
  appId: 'cli_a94e15520db71cd5',
  appSecret: 'NUlaDSXUj5zlbHQmk0jIfR11shr8zdRu',

  // 服务配置
  port: 3001,

  // 共享数据库配置
  database: sharedConfig.database,

  // 上传文件配置
  upload: sharedConfig.upload,

  // 定时任务配置
  scheduler: {
    maxTasks: 100,
    checkInterval: 60000
  }
};