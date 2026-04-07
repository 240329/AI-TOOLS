module.exports = {
  // 飞书应用凭证 - 请在飞书开发者后台获取
  appId: 'cli_a94e15520db71cd5',      // 飞书应用 App ID
  appSecret: 'NUlaDSXUj5zlbHQmk0jIfR11shr8zdRu', // 飞书应用 App Secret
  
  // 服务配置
  port: 3000,
  
  // 数据库配置
  database: {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'Dreame2026',
    database: 'flowhub'
  },
  
  // 定时任务配置
  scheduler: {
    maxTasks: 100,  // 最大任务数
    checkInterval: 60000  // 任务检查间隔（毫秒）
  }
};