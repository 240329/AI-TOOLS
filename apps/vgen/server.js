const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./config');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static('uploads'));

let pool;
async function initDatabase() {
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
    CREATE TABLE IF NOT EXISTS vgen_tasks (
      id VARCHAR(36) PRIMARY KEY,
      task_id VARCHAR(36),
      content TEXT,
      character VARCHAR(50),
      voice VARCHAR(50),
      language VARCHAR(20),
      aspect_ratio VARCHAR(20),
      resolution VARCHAR(20),
      duration INT,
      document_url VARCHAR(500),
      status VARCHAR(20) DEFAULT 'pending',
      result_url VARCHAR(500),
      progress INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  console.log('✓ V-GEN 数据库连接池已创建');
}

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /xlsx|xls|csv|pdf|doc|docx/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    if (ext) cb(null, true);
    else cb(new Error('不支持的文件格式'));
  }
});

async function getTasksFromDB() {
  try {
    const [rows] = await pool.query('SELECT * FROM vgen_tasks ORDER BY created_at DESC');
    return rows;
  } catch (err) {
    console.error('获取任务失败:', err.message);
    return [];
  }
}

async function deleteTaskFromDB(id) {
  try {
    await pool.query('DELETE FROM vgen_tasks WHERE id = ?', [id]);
    return true;
  } catch (err) {
    console.error('删除任务失败:', err.message);
    return false;
  }
}

// API Routes
app.post('/api/vgen/generate', async (req, res) => {
  const {
    content,
    character,
    voice,
    language,
    aspectRatio,
    resolution,
    duration,
    documentUrl
  } = req.body;

  if (!content) {
    return res.status(400).json({ success: false, error: '请输入说话内容' });
  }

  try {
    console.log(`[V-GEN] 收到生成请求:`, { content: content.substring(0, 50) + '...', character, voice });

    const taskId = uuidv4();
    const dbTaskId = uuidv4();

    await pool.query(
      `INSERT INTO vgen_tasks (id, task_id, content, character, voice, language, aspect_ratio, resolution, duration, document_url, status, progress)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', 0)`,
      [dbTaskId, taskId, content, character || '', voice || '', language || '', aspectRatio || '', resolution || '', duration || 0, documentUrl || '']
    );

    setTimeout(async () => {
      await pool.query(
        `UPDATE vgen_tasks SET status = 'completed', progress = 100, result_url = ? WHERE id = ?`,
        [`/uploads/result-${taskId}.mp4`, dbTaskId]
      );
    }, 5000);

    res.json({
      success: true,
      message: '任务已提交',
      data: {
        taskId,
        status: 'processing',
        estimatedTime: 60,
        previewUrl: `/uploads/preview-${taskId}.mp4`
      }
    });
  } catch (err) {
    console.error('V-GEN 生成失败:', err.message);
    res.status(500).json({ success: false, error: '生成失败: ' + err.message });
  }
});

app.get('/api/vgen/task/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query('SELECT * FROM vgen_tasks WHERE task_id = ?', [id]);
    if (rows.length === 0) {
      return res.json({ success: true, data: { taskId: id, status: 'completed', progress: 100, resultUrl: `/uploads/result-${id}.mp4` } });
    }
    const task = rows[0];
    res.json({
      success: true,
      data: {
        taskId: task.task_id,
        status: task.status,
        progress: task.progress,
        resultUrl: task.result_url
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/vgen/tasks', async (req, res) => {
  try {
    const tasks = await getTasksFromDB();
    res.json({ success: true, data: tasks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/vgen/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const result = await deleteTaskFromDB(id);
  if (result) {
    res.json({ success: true, message: '任务已删除' });
  } else {
    res.status(500).json({ success: false, error: '删除失败' });
  }
});

const PORT = config.port;

async function startServer() {
  await initDatabase();
  app.listen(PORT, '127.0.0.1', () => {
    console.log('\n========================================');
    console.log('  V-GEN Studio 服务已启动');
    console.log('========================================');
    console.log(`  服务地址: http://localhost:${PORT}`);
    console.log(`  数据库: MySQL (flowhub)`);
    console.log('');
    console.log('  API 接口:');
    console.log('    POST /api/vgen/generate - 创建生成任务');
    console.log('    GET  /api/vgen/task/:id - 获取任务状态');
    console.log('    GET  /api/vgen/tasks - 获取任务列表');
    console.log('    DELETE /api/vgen/tasks/:id - 删除任务');
    console.log('========================================\n');
  });
}

startServer();