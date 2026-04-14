const path = require('path');

module.exports = {
  // 数据库配置 (所有工具共享)
  database: {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'Dreame2026',
    database: 'flowhub'
  },

  // 上传文件配置
  upload: {
    maxFileSize: 50 * 1024 * 1024, // 50MB
    allowedExtensions: ['.xlsx', '.xls', '.csv']
  }
};