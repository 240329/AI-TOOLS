const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./config');
const PaiVideoAPI = require('./lib/pai-api');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let pool;
let paiApi;
let pollTimer = null;

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
      task_id VARCHAR(36) UNIQUE,
      type VARCHAR(20) DEFAULT 'text',
      content TEXT,
      \`character\` VARCHAR(50),
      voice VARCHAR(50),
      language VARCHAR(20),
      aspect_ratio VARCHAR(20) DEFAULT '16:9',
      resolution VARCHAR(20) DEFAULT '1080p',
      duration INT DEFAULT 5,
      document_url VARCHAR(500),
      status VARCHAR(20) DEFAULT 'pending',
      pixverse_video_id INT,
      pixverse_status INT DEFAULT 5,
      model VARCHAR(20) DEFAULT 'v5.6',
      motion_mode VARCHAR(20) DEFAULT 'normal',
      lip_sync_switch BOOLEAN DEFAULT false,
      lip_sync_tts_content TEXT,
      lip_sync_tts_speaker_id VARCHAR(50),
      sound_effect_switch BOOLEAN DEFAULT false,
      sound_effect_content TEXT,
      camera_movement VARCHAR(50),
      img_id INT,
      img_url VARCHAR(500),
      result_url VARCHAR(500),
      progress INT DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      completed_at DATETIME,
      INDEX idx_status (status),
      INDEX idx_pixverse_status (pixverse_status),
      INDEX idx_created_at (created_at)
    )
  `);

  await alterTableIfNeeded();

  console.log('✓ V-GEN 数据库连接池已创建');
}

async function alterTableIfNeeded() {
  try {
    const [columns] = await pool.query('SHOW COLUMNS FROM vgen_tasks LIKE "pixverse_video_id"');
    if (columns.length === 0) {
      await pool.query(`
        ALTER TABLE vgen_tasks 
        ADD COLUMN pixverse_video_id INT,
        ADD COLUMN pixverse_status INT DEFAULT 5,
        ADD COLUMN model VARCHAR(20) DEFAULT 'v5.6',
        ADD COLUMN motion_mode VARCHAR(20) DEFAULT 'normal',
        ADD COLUMN lip_sync_switch BOOLEAN DEFAULT false,
        ADD COLUMN lip_sync_tts_content TEXT,
        ADD COLUMN lip_sync_tts_speaker_id VARCHAR(50),
        ADD COLUMN sound_effect_switch BOOLEAN DEFAULT false,
        ADD COLUMN sound_effect_content TEXT,
        ADD COLUMN camera_movement VARCHAR(50),
        ADD COLUMN img_id INT,
        ADD COLUMN img_url VARCHAR(500),
        ADD COLUMN error_message TEXT,
        ADD COLUMN completed_at DATETIME
      `);
      console.log('✓ V-GEN 数据库表已更新');
    }
  } catch (err) {
    console.log('✓ V-GEN 数据库表结构检查完成');
  }
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
    const allowedTypes = /png|jpeg|jpg|webp|mp4|webm|avi|mov/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase().slice(1));
    if (ext) cb(null, true);
    else cb(new Error('不支持的文件格式'));
  }
});

const configMap = {
  '16:9': '16:9',
  '9:16': '9:16',
  '1:1': '1:1',
  '720p': '720p',
  '1080p': '1080p',
  '4k': '1080p',
  '15s': 5,
  '60s': 8,
  '300s': 10,
  '15': 5,
  '60': 8,
  '300': 10
};

function parseParam(key, defaultVal) {
  return configMap[key] || defaultVal;
}

async function getTasksFromDB(status = null) {
  try {
    let query = 'SELECT * FROM vgen_tasks';
    const params = [];
    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC LIMIT 100';
    const [rows] = await pool.query(query, params);
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

async function updateTaskStatus(id, updates) {
  try {
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    await pool.query(`UPDATE vgen_tasks SET ${fields} WHERE id = ?`, [...values, id]);
    return true;
  } catch (err) {
    console.error('更新任务失败:', err.message);
    return false;
  }
}

async function pollPendingTasks() {
  try {
    const tasks = await getTasksFromDB('processing');
    if (tasks.length === 0) return;

    console.log(`[V-GEN] 检查 ${tasks.length} 个进行中的任务...`);

    for (const task of tasks) {
      if (!task.pixverse_video_id) continue;

      try {
        const result = await paiApi.getVideoStatus(task.pixverse_video_id);
        
        let progress = task.progress;
        let status = task.status;
        let resultUrl = task.result_url;
        let errorMessage = task.error_message;

        if (result.isProcessing) {
          progress = Math.min(progress + Math.floor(Math.random() * 10) + 5, 90);
        } else if (result.isComplete) {
          progress = 100;
          status = 'completed';
          resultUrl = result.url;
          task.completed_at = new Date();
        } else if (result.isFailed) {
          status = 'failed';
          errorMessage = '视频生成失败';
        } else if (result.isReviewFailed) {
          status = 'failed';
          errorMessage = '内容审核失败';
        }

        await updateTaskStatus(task.id, {
          pixverse_status: result.status,
          progress,
          status,
          result_url: resultUrl,
          error_message: errorMessage
        });

        console.log(`[V-GEN] 任务 ${task.task_id} 状态: ${result.status} (${paiApi.getStatusText(result.status)})`);
      } catch (err) {
        console.error(`[V-GEN] 查询任务 ${task.task_id} 失败:`, err.message);
      }
    }
  } catch (err) {
    console.error('[V-GEN] 轮询任务失败:', err.message);
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollPendingTasks, config.pai.pollInterval);
  console.log(`✓ V-GEN 任务轮询已启动 (间隔: ${config.pai.pollInterval}ms)`);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('✓ V-GEN 任务轮询已停止');
  }
}

app.post('/api/vgen/generate', async (req, res) => {
  const {
    content,
    character,
    voice,
    language,
    aspectRatio,
    resolution,
    duration,
    model,
    motionMode,
    lipSyncSwitch,
    lipSyncTtsContent,
    lipSyncTtsSpeakerId,
    soundEffectSwitch,
    soundEffectContent,
    cameraMovement,
    thinkingType
  } = req.body;

  if (!content) {
    return res.status(400).json({ success: false, error: '请输入说话内容' });
  }

  const taskId = uuidv4();
  const dbTaskId = uuidv4();

  try {
    console.log(`[V-GEN] 收到文生视频请求:`, { content: content.substring(0, 50) + '...', model, lipSyncSwitch });

    const dbTaskId = uuidv4();
    await pool.query(
      `INSERT INTO vgen_tasks (id, task_id, type, content, \`character\`, voice, language, aspect_ratio, resolution, duration, model, motion_mode, lip_sync_switch, lip_sync_tts_content, lip_sync_tts_speaker_id, sound_effect_switch, sound_effect_content, camera_movement, status, progress)
       VALUES (?, ?, 'text', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', 0)`,
      [dbTaskId, taskId, content, character || '', voice || '', language || 'zh', 
       parseParam(aspectRatio, '16:9'), parseParam(resolution, '1080p'), parseParam(duration, 5),
       model || 'v5.6', motionMode || 'normal', lipSyncSwitch || false,
       lipSyncSwitch ? (lipSyncTtsContent || content) : '',
       lipSyncTtsSpeakerId || '', soundEffectSwitch || false, soundEffectContent || '', cameraMovement || '']
    );

    try {
      const result = await paiApi.textToVideo({
        prompt: content,
        aspectRatio: parseParam(aspectRatio, '16:9'),
        duration: parseParam(duration, 5),
        model: model || 'v5.6',
        quality: parseParam(resolution, '1080p'),
        motionMode: motionMode || 'normal',
        lipSyncSwitch: lipSyncSwitch || false,
        lipSyncTtsContent: lipSyncSwitch ? (lipSyncTtsContent || content) : '',
        lipSyncTtsSpeakerId: lipSyncTtsSpeakerId || '',
        soundEffectSwitch: soundEffectSwitch || false,
        soundEffectContent: soundEffectContent || '',
        cameraMovement: cameraMovement || null,
        thinkingType: thinkingType || 'auto'
      });

      if (result.videoId && result.videoId > 0) {
        await updateTaskStatus(dbTaskId, {
          pixverse_video_id: result.videoId,
          progress: 10
        });
        console.log(`[V-GEN] 拍我AI任务已创建: video_id=${result.videoId}`);
      } else {
        console.log(`[V-GEN] 拍我AI返回无效video_id: ${result.videoId}`);
      }

      res.json({
        success: true,
        message: '任务已提交到拍我AI',
        data: {
          taskId,
          videoId: result.videoId || 0,
          status: 'processing',
          progress: 10,
          estimatedTime: 60
        }
      });
    } catch (apiErr) {
      console.error('[V-GEN] 拍我AI调用失败:', apiErr.message);
      await updateTaskStatus(dbTaskId, {
        status: 'failed',
        error_message: apiErr.message
      });
      res.status(500).json({ success: false, error: '提交到拍我AI失败: ' + apiErr.message });
    }
  } catch (err) {
    console.error('[V-GEN] 创建任务失败:', err.message);
    res.status(500).json({ success: false, error: '创建任务失败: ' + err.message });
  }
});

app.post('/api/vgen/generate/image', async (req, res) => {
  const {
    imgId,
    content,
    aspectRatio,
    resolution,
    duration,
    model,
    motionMode,
    style,
    lipSyncSwitch,
    lipSyncTtsContent,
    lipSyncTtsSpeakerId,
    soundEffectSwitch,
    soundEffectContent,
    cameraMovement
  } = req.body;

  if (!imgId) {
    return res.status(400).json({ success: false, error: '缺少图片ID' });
  }

  const taskId = uuidv4();
  const dbTaskId = uuidv4();

  try {
    console.log(`[V-GEN] 收到图生视频请求: img_id=${imgId}, prompt=${content?.substring(0, 50) || ''}`);

    await pool.query(
      `INSERT INTO vgen_tasks (id, task_id, type, content, aspect_ratio, resolution, duration, model, motion_mode, lip_sync_switch, lip_sync_tts_content, lip_sync_tts_speaker_id, sound_effect_switch, sound_effect_content, camera_movement, img_id, status, progress)
       VALUES (?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', 0)`,
      [dbTaskId, taskId, content || '', parseParam(aspectRatio, '16:9'), parseParam(resolution, '1080p'),
       parseParam(duration, 5), model || 'v5.6', motionMode || 'normal',
       lipSyncSwitch || false, lipSyncTtsContent || '', lipSyncTtsSpeakerId || '',
       soundEffectSwitch || false, soundEffectContent || '', cameraMovement || '', imgId]
    );

    try {
      const result = await paiApi.imgToVideo({
        imgId,
        prompt: content || '',
        aspectRatio: parseParam(aspectRatio, '16:9'),
        duration: parseParam(duration, 5),
        model: model || 'v5.6',
        quality: parseParam(resolution, '1080p'),
        motionMode: motionMode || 'normal',
        style: style || null,
        lipSyncSwitch: lipSyncSwitch || false,
        lipSyncTtsContent: lipSyncTtsContent || '',
        lipSyncTtsSpeakerId: lipSyncTtsSpeakerId || '',
        soundEffectSwitch: soundEffectSwitch || false,
        soundEffectContent: soundEffectContent || '',
        cameraMovement: cameraMovement || null
      });

      if (result.videoId && result.videoId > 0) {
        await updateTaskStatus(dbTaskId, {
          pixverse_video_id: result.videoId,
          progress: 10
        });
        console.log(`[V-GEN] 拍我AI图生视频任务已创建: video_id=${result.videoId}`);
      } else {
        console.log(`[V-GEN] 拍我AI返回无效video_id: ${result.videoId}`);
      }

      res.json({
        success: true,
        message: '图生视频任务已提交到拍我AI',
        data: {
          taskId,
          videoId: result.videoId || 0,
          status: 'processing',
          progress: 10,
          estimatedTime: 60
        }
      });
    } catch (apiErr) {
      console.error('[V-GEN] 拍我AI调用失败:', apiErr.message);
      await updateTaskStatus(dbTaskId, {
        status: 'failed',
        error_message: apiErr.message
      });
      res.status(500).json({ success: false, error: '提交到拍我AI失败: ' + apiErr.message });
    }
  } catch (err) {
    console.error('[V-GEN] 创建图生视频任务失败:', err.message);
    res.status(500).json({ success: false, error: '创建任务失败: ' + err.message });
  }
});

app.post('/api/vgen/upload/image', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '请上传图片文件' });
  }

  try {
    console.log(`[V-GEN] 上传图片: ${req.file.originalname}`);

    const result = await paiApi.uploadImage(req.file.path);

    console.log(`[V-GEN] 图片上传成功: img_id=${result.imgId}`);

    fs.unlink(req.file.path, (err) => {
      if (err) console.error('删除临时文件失败:', err.message);
    });

    res.json({
      success: true,
      message: '图片上传成功',
      data: {
        imgId: result.imgId,
        imgUrl: result.imgUrl
      }
    });
  } catch (err) {
    console.error('[V-GEN] 图片上传失败:', err.message);
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
    res.status(500).json({ success: false, error: '图片上传失败: ' + err.message });
  }
});

app.get('/api/vgen/task/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query('SELECT * FROM vgen_tasks WHERE task_id = ?', [id]);
    if (rows.length === 0) {
      return res.json({ success: true, data: { taskId: id, status: 'not_found', message: '任务不存在' } });
    }
    const task = rows[0];
    res.json({
      success: true,
      data: {
        taskId: task.task_id,
        type: task.type,
        status: task.status,
        progress: task.progress,
        resultUrl: task.result_url,
        pixverseStatus: task.pixverse_status,
        pixverseStatusText: paiApi.getStatusText(task.pixverse_status),
        errorMessage: task.error_message,
        model: task.model,
        createdAt: task.created_at,
        completedAt: task.completed_at
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/vgen/tasks', async (req, res) => {
  try {
    const tasks = await getTasksFromDB();
    const formattedTasks = tasks.map(t => ({
      id: t.id,
      taskId: t.task_id,
      type: t.type,
      content: t.content?.substring(0, 100),
      status: t.status,
      progress: t.progress,
      resultUrl: t.result_url,
      pixverseStatus: t.pixverse_status,
      pixverseStatusText: paiApi.getStatusText(t.pixverse_status),
      model: t.model,
      createdAt: t.created_at,
      completedAt: t.completed_at
    }));
    res.json({ success: true, data: formattedTasks });
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

app.get('/api/vgen/config', async (req, res) => {
  res.json({
    success: true,
    data: {
      supportedModels: config.pai.supportedModels,
      defaultModel: config.pai.defaultModel,
      motionModes: ['normal', 'fast'],
      cameraMovements: [
        'horizontal_left', 'horizontal_right', 'vertical_up', 'vertical_down',
        'zoom_in', 'zoom_out', 'crane_up', 'quickly_zoom_in', 'quickly_zoom_out',
        'smooth_zoom_in', 'camera_rotation', 'robo_arm', 'super_dolly_out',
        'whip_pan', 'hitchcock', 'left_follow', 'right_follow', 'pan_left',
        'pan_right', 'fix_bg'
      ],
      aspectRatios: ['16:9', '9:16', '4:3', '3:4', '1:1'],
      qualities: ['360p', '540p', '720p', '1080p'],
      durations: {
        'v3.5': [5, 8],
        'v4': [5, 8],
        'v4.5': [5, 8],
        'v5': [5, 8],
        'v5.5': [5, 8, 10],
        'v5.6': [5, 8, 10],
        'v6': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        'c1': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
      },
      styles: ['anime', '3d_animation', 'day', 'cyberpunk', 'comic']
    }
  });
});

app.get('/api/vgen/status', async (req, res) => {
  res.json({
    success: true,
    data: {
      apiConnected: !!paiApi,
      pollInterval: config.pai.pollInterval,
      apiBaseUrl: config.pai.baseUrl
    }
  });
});

const PORT = config.port;

async function startServer() {
  await initDatabase();
  
  paiApi = new PaiVideoAPI();
  console.log(`✓ 拍我AI API 客户端已初始化`);
  console.log(`  API Key: ${config.pai.apiKey.substring(0, 10)}...`);
  console.log(`  Base URL: ${config.pai.baseUrl}`);

  startPolling();

  app.listen(PORT, '0.0.0.0', () => {
    console.log('\n========================================');
    console.log('  V-GEN Studio 服务已启动');
    console.log('========================================');
    console.log(`  服务地址: http://localhost:${PORT}`);
    console.log(`  数据库: MySQL (flowhub)`);
    console.log('');
    console.log('  API 接口:');
    console.log('    POST /api/vgen/generate - 文生视频');
    console.log('    POST /api/vgen/generate/image - 图生视频');
    console.log('    POST /api/vgen/upload/image - 上传图片');
    console.log('    GET  /api/vgen/task/:id - 获取任务状态');
    console.log('    GET  /api/vgen/tasks - 获取任务列表');
    console.log('    GET  /api/vgen/config - 获取配置信息');
    console.log('    DELETE /api/vgen/tasks/:id - 删除任务');
    console.log('========================================\n');
  });
}

process.on('SIGINT', () => {
  stopPolling();
  process.exit(0);
});

startServer();