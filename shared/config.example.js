// 配置模板 - 复制此文件为 config.js 并填入实际值

module.exports = {
  // 数据库配置 (所有工具共享)
  database: {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'YOUR_PASSWORD_HERE',
    database: 'flowhub'
  },

  // 上传文件配置
  upload: {
    maxFileSize: 50 * 1024 * 1024, // 50MB
    allowedExtensions: ['.xlsx', '.xls', '.csv']
  }
};