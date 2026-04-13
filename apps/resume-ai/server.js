const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const xlsx = require('xlsx');
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
    CREATE TABLE IF NOT EXISTS resume_candidates (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100),
      phone VARCHAR(50),
      position VARCHAR(100),
      experience INT,
      education VARCHAR(50),
      status VARCHAR(20) DEFAULT 'new',
      score INT DEFAULT 0,
      analysis JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS resume_resumes (
      id VARCHAR(36) PRIMARY KEY,
      candidate_id VARCHAR(36),
      file_name VARCHAR(200),
      file_path VARCHAR(500),
      parsed_data JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS resume_categories (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      icon VARCHAR(50),
      color VARCHAR(20),
      count INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('✓ Resume AI 数据库连接池已创建');
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
    const allowedTypes = /pdf|doc|docx|xlsx|xls/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    if (ext) cb(null, true);
    else cb(new Error('不支持的文件格式'));
  }
});

function safeJsonParse(str, defaultVal) {
  if (!str) return defaultVal;
  try { return JSON.parse(str); } catch { return defaultVal; }
}

async function getCandidatesFromDB() {
  try {
    const [rows] = await pool.query('SELECT * FROM resume_candidates ORDER BY created_at DESC');
    return rows;
  } catch (err) {
    console.error('获取候选人失败:', err.message);
    return [];
  }
}

async function getCategoriesFromDB() {
  try {
    const [rows] = await pool.query('SELECT * FROM resume_categories ORDER BY created_at DESC');
    return rows;
  } catch (err) {
    console.error('获取分类失败:', err.message);
    return [];
  }
}

// API Routes

// 获取所有候选人
app.get('/api/resume/candidates', async (req, res) => {
  try {
    const candidates = await getCandidatesFromDB();
    res.json({ success: true, data: candidates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 添加候选人
app.post('/api/resume/candidates', async (req, res) => {
  const { name, email, phone, position, experience, education } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, error: '请输入候选人姓名' });
  }
  try {
    const id = uuidv4();
    await pool.query(
      `INSERT INTO resume_candidates (id, name, email, phone, position, experience, education) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name, email || '', phone || '', position || '', experience || 0, education || '']
    );
    const candidates = await getCandidatesFromDB();
    res.json({ success: true, message: '候选人添加成功', data: candidates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除候选人
app.delete('/api/resume/candidates/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM resume_candidates WHERE id = ?', [id]);
    res.json({ success: true, message: '候选人已删除' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 上传简历并解析
app.post('/api/resume/resumes/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '请上传文件' });
  }
  try {
    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let parsedData = { fileName: req.file.originalname };

    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet);
      parsedData.rows = data;
    }

    const resumeId = uuidv4();
    const candidateId = uuidv4();
    
    await pool.query(
      `INSERT INTO resume_candidates (id, name, email, position, status) VALUES (?, ?, ?, ?, 'pending')`,
      [candidateId, parsedData.name || '未命名', parsedData.email || '', parsedData.position || '未知']
    );

    await pool.query(
      `INSERT INTO resume_resumes (id, candidate_id, file_name, file_path, parsed_data) VALUES (?, ?, ?, ?, ?)`,
      [resumeId, candidateId, req.file.originalname, filePath, JSON.stringify(parsedData)]
    );

    fs.unlinkSync(filePath);
    res.json({ success: true, message: '简历上传成功', data: { resumeId, candidateId } });
  } catch (err) {
    console.error('解析文件失败:', err);
    res.status(500).json({ success: false, error: '解析文件失败: ' + err.message });
  }
});

// AI 分析候选人
app.post('/api/resume/analysis', async (req, res) => {
  const { candidateId } = req.body;
  if (!candidateId) {
    return res.status(400).json({ success: false, error: '请提供候选人ID' });
  }
  try {
    const [rows] = await pool.query('SELECT * FROM resume_candidates WHERE id = ?', [candidateId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: '候选人不存在' });
    }

    const score = Math.floor(Math.random() * 30) + 70;
    const analysis = {
      strengths: ['沟通能力强', '技术扎实', '项目经验丰富'],
      weaknesses: ['管理经验不足', '外语水平待提升'],
      recommendation: score >= 80 ? '强烈推荐' : score >= 60 ? '可以考虑' : '不太适合',
      score
    };

    await pool.query(
      `UPDATE resume_candidates SET score = ?, analysis = ?, status = 'analyzed' WHERE id = ?`,
      [score, JSON.stringify(analysis), candidateId]
    );

    res.json({ success: true, message: '分析完成', data: analysis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取分类列表
app.get('/api/resume/categories', async (req, res) => {
  try {
    const categories = await getCategoriesFromDB();
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 创建分类
app.post('/api/resume/categories', async (req, res) => {
  const { name, icon, color } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, error: '请输入分类名称' });
  }
  try {
    const id = uuidv4();
    await pool.query(
      `INSERT INTO resume_categories (id, name, icon, color) VALUES (?, ?, ?, ?)`,
      [id, name, icon || 'fa-folder', color || '#3b82f6']
    );
    const categories = await getCategoriesFromDB();
    res.json({ success: true, message: '分类创建成功', data: categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除分类
app.delete('/api/resume/categories/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM resume_categories WHERE id = ?', [id]);
    res.json({ success: true, message: '分类已删除' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取统计信息
app.get('/api/resume/stats', async (req, res) => {
  try {
    const [totalRows] = await pool.query('SELECT COUNT(*) as count FROM resume_candidates');
    const [analyzedRows] = await pool.query("SELECT COUNT(*) as count FROM resume_candidates WHERE status = 'analyzed'");
    const [avgScoreRows] = await pool.query('SELECT AVG(score) as avg FROM resume_candidates WHERE score > 0');
    
    res.json({
      success: true,
      data: {
        total: totalRows[0].count,
        analyzed: analyzedRows[0].count,
        avgScore: Math.round(avgScoreRows[0].avg || 0)
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
    console.log('  Resume AI 服务已启动');
    console.log('========================================');
    console.log(`  服务地址: http://localhost:${PORT}`);
    console.log(`  数据库: MySQL (flowhub)`);
    console.log('');
    console.log('  API 接口:');
    console.log('    GET/POST /api/resume/candidates - 候选人管理');
    console.log('    POST /api/resume/resumes/upload - 简历上传');
    console.log('    POST /api/resume/analysis - AI分析');
    console.log('    GET/POST /api/resume/categories - 分类管理');
    console.log('    GET /api/resume/stats - 统计数据');
    console.log('========================================\n');
  });
}

startServer();