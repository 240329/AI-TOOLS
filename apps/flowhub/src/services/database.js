const mysql = require('mysql2/promise');

let pool;

async function initDatabase(config) {
  pool = mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowhub_employees (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100),
      hire_date DATE,
      department VARCHAR(100),
      position VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowhub_flows (
      id VARCHAR(20) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      positions VARCHAR(200),
      url VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowhub_scheduled_tasks (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      target_type VARCHAR(20) DEFAULT 'all',
      target_department VARCHAR(100),
      target_users JSON,
      schedule_time DATETIME NOT NULL,
      recurrence VARCHAR(20) DEFAULT 'once',
      status VARCHAR(20) DEFAULT 'pending',
      result JSON,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      INDEX idx_status (status),
      INDEX idx_completed_at (completed_at),
      INDEX idx_schedule_time (schedule_time)
    )
  `);

  try {
    await pool.query('SELECT tags FROM flowhub_flows LIMIT 1');
    await pool.query('ALTER TABLE flowhub_flows DROP COLUMN tags, DROP COLUMN target');
  } catch (err) { }

  try {
    await pool.query('SELECT positions FROM flowhub_flows LIMIT 1');
  } catch (err) {
    await pool.query('ALTER TABLE flowhub_flows ADD COLUMN positions VARCHAR(200) DEFAULT ""');
  }

  console.log('✓ MySQL 数据库连接池已创建');
  return pool;
}

function getPool() {
  return pool;
}

async function query(sql, params) {
  return pool.query(sql, params);
}

module.exports = {
  initDatabase,
  getPool,
  query
};