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
    CREATE TABLE IF NOT EXISTS visionary_projects (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      type VARCHAR(20) DEFAULT 'text',
      status VARCHAR(20) DEFAULT 'pending',
      prompt TEXT,
      settings JSON,
      result_url VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS visionary_media (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36),
      type VARCHAR(20) DEFAULT 'image',
      url VARCHAR(500),
      thumbnail VARCHAR(500),
      metadata JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('✓ Visionary AI 数据库连接池已创建');
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
    const allowedTypes = /jpg|jpeg|png|gif|webp|mp4|avi|mov/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    if (ext) cb(null, true);
    else cb(new Error('不支持的文件格式'));
  }
});

function safeJsonParse(str, defaultVal) {
  if (!str) return defaultVal;
  try { return JSON.parse(str); } catch { return defaultVal; }
}

async function getProjectsFromDB() {
  try {
    const [rows] = await pool.query('SELECT * FROM visionary_projects ORDER BY created_at DESC');
    return rows;
  } catch (err) {
    console.error('获取项目失败:', err.message);
    return [];
  }
}

async function getMediaFromDB(projectId = null) {
  try {
    let query = 'SELECT * FROM visionary_media';
    let params = [];
    if (projectId) {
      query += ' WHERE project_id = ?';
      params = [projectId];
    }
    query += ' ORDER BY created_at DESC';
    const [rows] = await pool.query(query, params);
    return rows;
  } catch (err) {
    console.error('获取媒体失败:', err.message);
    return [];
  }
}

// API Routes

// 文生视觉
app.post('/api/visionary/generate/text', async (req, res) => {
  const { prompt, settings } = req.body;
  if (!prompt) {
    return res.status(400).json({ success: false, error: '请输入提示词' });
  }
  try {
    const projectId = uuidv4();
    const settingsObj = safeJsonParse(settings, {
      style: 'realistic',
      quality: 'high',
      size: '1024x1024'
    });

    await pool.query(
      `INSERT INTO visionary_projects (id, name, type, status, prompt, settings) VALUES (?, ?, 'text', 'processing', ?, ?)`,
      [projectId, `文生视觉-${Date.now()}`, prompt, JSON.stringify(settingsObj)]
    );

    setTimeout(async () => {
      await pool.query(
        `UPDATE visionary_projects SET status = 'completed', result_url = ? WHERE id = ?`,
        [`/uploads/result-${projectId}.jpg`, projectId]
      );
    }, 3000);

    res.json({
      success: true,
      message: '任务已提交',
      data: {
        projectId,
        status: 'processing',
        estimatedTime: 30
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 图生视频
app.post('/api/visionary/generate/image', upload.single('image'), async (req, res) => {
  try {
    const projectId = uuidv4();
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : '';
    const { settings } = req.body;

    await pool.query(
      `INSERT INTO visionary_projects (id, name, type, status, prompt, settings) VALUES (?, ?, 'image', 'processing', ?, ?)`,
      [projectId, `图生视频-${Date.now()}`, imageUrl, settings || '{}']
    );

    setTimeout(async () => {
      await pool.query(
        `UPDATE visionary_projects SET status = 'completed', result_url = ? WHERE id = ?`,
        [`/uploads/result-${projectId}.mp4`, projectId]
      );
    }, 5000);

    res.json({
      success: true,
      message: '任务已提交',
      data: {
        projectId,
        status: 'processing',
        estimatedTime: 60
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 海报优化
app.post('/api/visionary/generate/poster', async (req, res) => {
  const { imageUrl, prompt } = req.body;
  if (!imageUrl) {
    return res.status(400).json({ success: false, error: '请提供图片地址' });
  }
  try {
    const projectId = uuidv4();

    await pool.query(
      `INSERT INTO visionary_projects (id, name, type, status, prompt, settings) VALUES (?, ?, 'poster', 'processing', ?, ?)`,
      [projectId, `海报优化-${Date.now()}`, prompt || '优化海报', '{}']
    );

    setTimeout(async () => {
      await pool.query(
        `UPDATE visionary_projects SET status = 'completed', result_url = ? WHERE id = ?`,
        [`/uploads/result-${projectId}.jpg`, projectId]
      );
    }, 4000);

    res.json({
      success: true,
      message: '任务已提交',
      data: {
        projectId,
        status: 'processing',
        estimatedTime: 45
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取项目列表
app.get('/api/visionary/projects', async (req, res) => {
  try {
    const projects = await getProjectsFromDB();
    res.json({ success: true, data: projects });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取单个项目
app.get('/api/visionary/projects/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query('SELECT * FROM visionary_projects WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除项目
app.delete('/api/visionary/projects/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM visionary_projects WHERE id = ?', [id]);
    res.json({ success: true, message: '项目已删除' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取媒体库
app.get('/api/visionary/media', async (req, res) => {
  const projectId = req.query.projectId;
  try {
    const media = await getMediaFromDB(projectId);
    res.json({ success: true, data: media });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 上传媒体到媒体库
app.post('/api/visionary/media/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '请上传文件' });
  }
  try {
    const id = uuidv4();
    const fileUrl = `/uploads/${req.file.filename}`;
    const fileType = req.file.mimetype.startsWith('image') ? 'image' : 'video';

    await pool.query(
      `INSERT INTO visionary_media (id, type, url, metadata) VALUES (?, ?, ?, ?)`,
      [id, fileType, fileUrl, JSON.stringify({ originalName: req.file.originalname, size: req.file.size })]
    );

    res.json({ success: true, message: '上传成功', data: { id, url: fileUrl } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除媒体
app.delete('/api/visionary/media/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM visionary_media WHERE id = ?', [id]);
    res.json({ success: true, message: '媒体已删除' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取统计信息
app.get('/api/visionary/stats', async (req, res) => {
  try {
    const [projectRows] = await pool.query('SELECT COUNT(*) as count FROM visionary_projects');
    const [mediaRows] = await pool.query('SELECT COUNT(*) as count FROM visionary_media');
    const [processingRows] = await pool.query("SELECT COUNT(*) as count FROM visionary_projects WHERE status = 'processing'");

    res.json({
      success: true,
      data: {
        projects: projectRows[0].count,
        media: mediaRows[0].count,
        processing: processingRows[0].count
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = config.port;

async function startServer() {
  await initDatabase();
  app.listen(PORT, '127.0.0.1', () => {
    console.log('\n========================================');
    console.log('  Visionary AI 服务已启动');
    console.log('========================================');
    console.log(`  服务地址: http://localhost:${PORT}`);
    console.log(`  数据库: MySQL (flowhub)`);
    console.log('');
    console.log('  API 接口:');
    console.log('    POST /api/visionary/generate/text - 文生视觉');
    console.log('    POST /api/visionary/generate/image - 图生视频');
    console.log('    POST /api/visionary/generate/poster - 海报优化');
    console.log('    GET/DELETE /api/visionary/projects - 项目管理');
    console.log('    GET/POST /api/visionary/media - 媒体库');
    console.log('    GET /api/visionary/stats - 统计数据');
    console.log('========================================\n');
  });
}

startServer();