const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const schedule = require('node-schedule');
const { v4: uuidv4 } = require('uuid');
const lark = require('@larksuiteoapi/node-sdk');
const config = require('./config');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static('uploads'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// MySQL 连接池
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

  // 创建 flowhub_employees 表
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

  // 创建 flowhub_flows 表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flowhub_flows (
      id VARCHAR(20) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      positions VARCHAR(200),
      url VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 迁移旧表结构（移除 tags 和 target 列）
  try {
    await pool.query('SELECT tags FROM flowhub_flows LIMIT 1');
    await pool.query('ALTER TABLE flowhub_flows DROP COLUMN tags, DROP COLUMN target');
  } catch (err) { /* 列不存在或已删除 */ }

  // 添加 positions 列（如果不存在）
  try {
    await pool.query('SELECT positions FROM flowhub_flows LIMIT 1');
  } catch (err) {
    await pool.query('ALTER TABLE flowhub_flows ADD COLUMN positions VARCHAR(200) DEFAULT ""');
  }

  // 创建 flowhub_scheduled_tasks 表
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

  console.log('✓ MySQL 数据库连接池已创建');
}

// 飞书客户端初始化
const client = new lark.Client({
  appId: config.appId,
  appSecret: config.appSecret,
  logLevel: lark.LoggerLevel.INFO
});

// 飞书长连接状态
let feishuStatus = {
  connected: false,
  reconnectAttempts: 0,
  lastConnected: null
};

// 定时任务存储
const tasks = new Map();

// ==================== MySQL 数据库操作 ====================

// 从数据库获取所有员工
async function getEmployeesFromDB() {
  try {
    const [rows] = await pool.query('SELECT * FROM flowhub_employees ORDER BY created_at DESC');
    return rows;
  } catch (err) {
    console.error('获取员工失败:', err.message);
    return [];
  }
}

// 从数据库获取单个员工
async function getEmployeeById(id) {
  try {
    const [rows] = await pool.query('SELECT * FROM flowhub_employees WHERE id = ?', [id]);
    return rows[0] || null;
  } catch (err) {
    console.error('获取员工失败:', err.message);
    return null;
  }
}

// 批量保存员工到数据库 (分批插入，防止占位符超限)
async function saveEmployeesToDB(flowhub_employees) {
  if (flowhub_employees.length === 0) return true;

  const chunkSize = 500;
  try {
    for (let i = 0; i < flowhub_employees.length; i += chunkSize) {
      const chunk = flowhub_employees.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const values = chunk.flatMap(emp => [
        emp.id, emp.name, emp.email, emp.hireDate, emp.department, emp.position
      ]);

      await pool.query(
        `INSERT INTO flowhub_employees (id, name, email, hire_date, department, position) 
         VALUES ${placeholders} 
         ON DUPLICATE KEY UPDATE 
         name=VALUES(name), email=VALUES(email), hire_date=VALUES(hire_date), department=VALUES(department), position=VALUES(position)`,
        values
      );
    }
    return true;
  } catch (err) {
    console.error('保存员工失败:', err.message);
    return false;
  }
}

// 从数据库删除单个员工
async function deleteEmployeeFromDB(id) {
  try {
    await pool.query('DELETE FROM flowhub_employees WHERE id = ?', [id]);
    return true;
  } catch (err) {
    console.error('删除员工失败:', err.message);
    return false;
  }
}

// 从数据库获取所有流程
async function getFlowsFromDB() {
  try {
    const [rows] = await pool.query('SELECT * FROM flowhub_flows ORDER BY id');
    return rows;
  } catch (err) {
    console.error('获取流程失败:', err.message);
    return [];
  }
}

// 批量保存流程到数据库 (分批插入)
async function saveFlowsToDB(flowhub_flows) {
  if (flowhub_flows.length === 0) return true;

  const chunkSize = 500;
  try {
    for (let i = 0; i < flowhub_flows.length; i += chunkSize) {
      const chunk = flowhub_flows.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ');
      const values = chunk.flatMap(flow => [
        flow.id, flow.name, flow.positions || '', flow.url
      ]);

      await pool.query(
        `INSERT INTO flowhub_flows (id, name, positions, url) 
         VALUES ${placeholders} 
         ON DUPLICATE KEY UPDATE 
         name=VALUES(name), positions=VALUES(positions), url=VALUES(url)`,
        values
      );
    }
    return true;
  } catch (err) {
    console.error('保存流程失败:', err.message);
    return false;
  }
}

// ==================== 流程匹配逻辑 ====================

// 🟢 性能优化：改为纯同步函数，要求外部一次性传入全量 allFlows 防止 N+1 查询问题
function matchFlowsByPosition(position, allFlows) {
  if (!position) return [];
  const posLower = position.toLowerCase();

  return allFlows.filter(flow => {
    if (!flow.positions || flow.positions.trim() === '') return false;
    const keywords = flow.positions.split(',').map(k => k.trim().toLowerCase());

    // 模糊匹配：员工岗位包含关键词 或 关键词包含员工岗位
    return keywords.some(keyword => {
      if (!keyword) return false;
      return posLower.includes(keyword) || keyword.includes(posLower);
    });
  });
}

// ==================== 任务与文件配置 ====================

async function saveTaskToDB(task) {
  try {
    await pool.query(
      `INSERT INTO flowhub_scheduled_tasks (id, name, target_type, target_department, target_users, schedule_time, recurrence, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), status=VALUES(status), schedule_time=VALUES(schedule_time)`, [task.id, task.name, task.targetType || 'all', task.targetDepartment || null,
    JSON.stringify(task.targetUsers || []), task.scheduleTime, task.recurrence || 'once', task.status || 'pending']
    );
    return true;
  } catch (err) {
    console.error('保存任务失败:', err.message);
    return false;
  }
}

async function updateTaskStatus(taskId, status, result = null, errorMessage = null) {
  try {
    await pool.query(
      `UPDATE flowhub_scheduled_tasks SET status = ?, result = ?, error_message = ?, completed_at = ? WHERE id = ?`,
      [status, result ? JSON.stringify(result) : null, errorMessage, new Date(), taskId]
    );
    return true;
  } catch (err) {
    console.error('更新任务状态失败:', err.message);
    return false;
  }
}

async function deleteTaskFromDB(taskId) {
  try {
    await pool.query('DELETE FROM flowhub_scheduled_tasks WHERE id = ?', [taskId]);
    return true;
  } catch (err) {
    console.error('删除任务失败:', err.message);
    return false;
  }
}

async function loadTasksFromDB() {
  try {
    const [rows] = await pool.query("SELECT * FROM flowhub_scheduled_tasks WHERE status = 'pending'");

    const safeJsonParse = (str, defaultVal) => {
      if (!str) return defaultVal;
      try { return JSON.parse(str); } catch { return defaultVal; }
    };

    rows.forEach(task => {
      const scheduleTime = new Date(task.schedule_time);
      const now = new Date();

      const taskData = {
        id: task.id,
        name: task.name,
        targetType: task.target_type,
        targetDepartment: task.target_department,
        targetUsers: safeJsonParse(task.target_users, []),
        scheduleTime: task.schedule_time,
        recurrence: task.recurrence,
        status: task.status,
        createdAt: task.created_at
      };

      tasks.set(task.id, taskData);

      if (scheduleTime > now) {
        schedule.scheduleJob(task.id, scheduleTime, () => {
          executePushTask(task.id);
        });
        console.log(`  - 已恢复任务 "${task.name}"，计划执行时间: ${scheduleTime.toLocaleString()}`);
      } else {
        console.log(`  - 任务 "${task.name}" 已过期，立即执行`);
        executePushTask(task.id);
      }
    });

    console.log(`✓ 已恢复 ${rows.length} 个定时任务`);
    return rows.length;
  } catch (err) {
    console.error('加载任务失败:', err.message);
    return 0;
  }
}

async function cleanupOldTasks() {
  try {
    const [result] = await pool.query(
      `DELETE FROM flowhub_scheduled_tasks WHERE status IN ('completed', 'failed') AND completed_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );
    if (result.affectedRows > 0) {
      console.log(`✓ 已清理 ${result.affectedRows} 条历史任务记录`);
    }
    return result.affectedRows;
  } catch (err) {
    console.error('清理旧任务失败:', err.message);
    return 0;
  }
}

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /xlsx|xls|csv/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    if (ext) {
      cb(null, true);
    } else {
      cb(new Error('只支持 .xlsx, .xls, .csv 文件'));
    }
  }
});

// ==================== 飞书长连接 ====================

let wsClient = null;

async function initFeishuConnection() {
  try {
    console.log('✓ 飞书应用连接已初始化');
    feishuStatus.connected = true;
    feishuStatus.lastConnected = new Date();
    feishuStatus.reconnectAttempts = 0;
  } catch (err) {
    const isNetworkError = err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.response?.status >= 500;

    if (!isNetworkError) {
      console.log('✓ 飞书应用凭证有效（发送功能正常）');
      feishuStatus.connected = true;
      feishuStatus.lastConnected = new Date();
      feishuStatus.reconnectAttempts = 0;
    } else {
      console.error('✗ 飞书连接失败:', err.message);
      feishuStatus.connected = false;

      if (feishuStatus.reconnectAttempts < 5) {
        feishuStatus.reconnectAttempts++;
        console.log(`尝试重连 (${feishuStatus.reconnectAttempts}/5)...`);
        setTimeout(initFeishuConnection, 10000);
      }
    }
  }
}

// ==================== 消息发送 ====================

async function sendMessage(receiveId, receiveIdType, msgType, content) {
  try {
    const result = await client.im.message.create({
      params: {
        receive_id_type: receiveIdType
      },
      data: {
        receive_id: receiveId,
        msg_type: msgType,
        content: JSON.stringify(content)
      }
    });

    if (result.code === 0) {
      console.log(`✓ 消息发送成功: ${receiveId}`);
      return { success: true, messageId: result.data.message_id };
    } else {
      console.error('✗ 消息发送失败:', result.msg);
      return { success: false, error: result.msg };
    }
  } catch (err) {
    console.error('✗ 发送消息异常:', err.message);
    return { success: false, error: err.message };
  }
}

function buildFlowNotificationCard(employee, flowhub_flows) {
  const flowItems = flowhub_flows.map(f =>
    `•[${f.name}](${f.url})`
  ).join('\n\n');

  return {
    header: {
      title: {
        tag: 'plain_text',
        content: '📋 入职推送通知——流程清单'
      },
      template: 'blue'
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `您好 **${employee.name}** 👋\n\n欢迎加入追觅吹风机大家庭！为了帮助您快速融入团队并顺利开展工作，请您关注以下入职流程：`
        }
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: flowItems
        }
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '查看全部流程 →'
            },
            type: 'primary',
            url: 'https://your-company.com/flowhub_flows' // 这里需要替换为实际前端地址
          }
        ]
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `---\n💡以上，如有任何疑问或建议，请随时联系各系统负责人：[追觅个护BG IT找人指引](https://dreametech.feishu.cn/wiki/ZWv7wXexdiecl9k98pVcbnl0nnb)`
        }
      }
    ]
  };
}

// ==================== 定时任务执行 ====================

async function executePushTask(taskId) {
  const task = tasks.get(taskId);
  if (!task || task.status === 'completed' || task.status === 'failed') {
    console.log(`任务 ${taskId} 不存在或已结束`);
    return null;
  }

  console.log(`执行推送任务: ${task.name}`);

  const flowhub_employees = await getEmployeesFromDB();

  let targetEmployees = [];
  if (task.targetType === 'all') {
    targetEmployees = flowhub_employees;
  } else if (task.targetType === 'department' && task.targetDepartment) {
    targetEmployees = flowhub_employees.filter(e => e.department === task.targetDepartment);
  } else if (task.targetType === 'custom' && task.targetUsers) {
    targetEmployees = flowhub_employees.filter(e => task.targetUsers.includes(e.id));
  }

  if (targetEmployees.length === 0) {
    console.log('没有目标员工，跳过发送');
    task.status = 'failed';
    task.completedAt = new Date();
    task.result = { success: 0, total: 0, details: [] };
    await updateTaskStatus(taskId, 'failed', task.result, '没有目标员工');
    return task.result;
  }

  // 🟢 性能优化：提前取出所有的流程，防止在循环体内部引发高频的 N+1 查询
  const allFlows = await getFlowsFromDB();
  const results = [];

  // 🟢 并发限流优化：利用分块 (Chunking) 实现受控并发，既提升了群发速度，也避免触发飞书 QPS 限流
  const chunkSize = 10; // 每一批发送 10 人
  for (let i = 0; i < targetEmployees.length; i += chunkSize) {
    const chunk = targetEmployees.slice(i, i + chunkSize);

    // 发起这一批次的并发请求
    const chunkPromises = chunk.map(async (employee) => {
      // 传入已取出的 allFlows，全过程内存级极速匹配
      const employeeFlows = matchFlowsByPosition(employee.position, allFlows);
      console.log(`处理员工: ${employee.name}, 岗位: ${employee.position}, 匹配到 ${employeeFlows.length} 个流程`);

      if (employeeFlows.length === 0) {
        console.log(`员工 ${employee.name} (${employee.position || '未设置岗位'}) 没有匹配的流程`);
        return { employeeId: employee.id, employeeName: employee.name, email: employee.email, success: false, error: '无匹配流程' };
      }

      const card = buildFlowNotificationCard({ name: employee.name }, employeeFlows);
      const result = await sendMessage(employee.email, 'email', 'interactive', card);

      return {
        employeeId: employee.id,
        employeeName: employee.name,
        email: employee.email,
        success: result.success,
        error: result.error || null,
        messageId: result.messageId || null
      };
    });

    // 等待这一批次发送完毕，汇总结果
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);

    // 发送完该批次后休眠 300 毫秒 (大约30 QPS速率，对飞书非常安全且比串行快很多)
    if (i + chunkSize < targetEmployees.length) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const finalStatus = successCount > 0 ? 'completed' : 'failed';

  console.log(`任务 ${task.name} 执行结束: 状态 [${finalStatus}], 成功 ${successCount}/${results.length}`);

  task.status = finalStatus;
  task.completedAt = new Date();
  task.result = { success: successCount, total: results.length, details: results };

  await updateTaskStatus(taskId, finalStatus, task.result);

  // 单次任务：推送成功后删除已发送的员工并释放内存
  if (task.recurrence === 'once') {
    const successEmployeeIds = results
      .filter(r => r.success && r.employeeId)
      .map(r => r.employeeId);

    // 🟢 性能优化：合并为批量 DELETE
    if (successEmployeeIds.length > 0) {
      try {
        await pool.query('DELETE FROM flowhub_employees WHERE id IN (?)', [successEmployeeIds]);
        console.log(`单次任务：已批量删除 ${successEmployeeIds.length} 位已推送员工`);
      } catch (err) {
        console.error('批量删除推送成功的员工失败:', err);
      }
    }

    // 释放内存，防止 OOM
    tasks.delete(taskId);
  }

  // 如果是周期性任务，创建下一次执行
  if (task.recurrence !== 'once') {
    await scheduleNextRecurrence(task);
  }

  return task.result;
}

async function scheduleNextRecurrence(task) {
  const baseTime = new Date(task.scheduleTime);
  let nextDate;

  if (task.recurrence === 'daily') {
    nextDate = new Date(baseTime.getTime() + 24 * 60 * 60 * 1000);
  } else if (task.recurrence === 'weekly') {
    nextDate = new Date(baseTime.getTime() + 7 * 24 * 60 * 60 * 1000);
  } else if (task.recurrence === 'monthly') {
    nextDate = new Date(baseTime);
    nextDate.setMonth(nextDate.getMonth() + 1);
  }

  if (nextDate) {
    const newTask = {
      ...task,
      id: uuidv4(),
      scheduleTime: nextDate,
      status: 'pending',
      createdAt: new Date()
    };

    await saveTaskToDB(newTask);
    tasks.set(newTask.id, newTask);

    schedule.scheduleJob(newTask.id, nextDate, () => {
      executePushTask(newTask.id);
    });

    console.log(`已安排下次执行: ${nextDate.toLocaleString()}`);
  }
}

// ==================== API 路由 ====================

app.get('/api/flowhub/status', (req, res) => {
  res.json({
    success: true,
    data: {
      connected: feishuStatus.connected,
      lastConnected: feishuStatus.lastConnected,
      reconnectAttempts: feishuStatus.reconnectAttempts
    }
  });
});

// 从数据库查询统计数据，保证准确性
app.get('/api/flowhub/dashboard/stats', async (req, res) => {
  try {
    const [flowRows] = await pool.query('SELECT COUNT(*) as count FROM flowhub_flows');
    const [employeeRows] = await pool.query('SELECT COUNT(*) as count FROM flowhub_employees');
    const [taskTotalRows] = await pool.query('SELECT COUNT(*) as count FROM flowhub_scheduled_tasks');
    const [taskPendingRows] = await pool.query("SELECT COUNT(*) as count FROM flowhub_scheduled_tasks WHERE status = 'pending'");
    const [taskCompletedRows] = await pool.query("SELECT COUNT(*) as count FROM flowhub_scheduled_tasks WHERE status = 'completed'");

    res.json({
      success: true,
      data: {
        flowCount: flowRows[0].count,
        employeeCount: employeeRows[0].count,
        taskCount: taskTotalRows[0].count,
        pendingTaskCount: taskPendingRows[0].count,
        completedTaskCount: taskCompletedRows[0].count
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/flowhub/flowhub_employees', async (req, res) => {
  try {
    const flowhub_employees = await getEmployeesFromDB();
    const allFlows = await getFlowsFromDB(); // 🟢 一次性拉取全量，避免 N+1

    const flowhub_employeesWithFlows = flowhub_employees.map(emp => {
      // 传递 allFlows 纯内存比对
      const matchedFlows = matchFlowsByPosition(emp.position, allFlows);
      return {
        id: emp.id,
        name: emp.name,
        email: emp.email,
        hireDate: emp.hire_date,
        department: emp.department,
        position: emp.position,
        createdAt: emp.created_at,
        matchedFlows: matchedFlows.map(f => f.id)
      };
    });

    res.json({
      success: true,
      data: flowhub_employeesWithFlows
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 上传员工名单 (基于邮箱做覆盖去重，保证垃圾文件被清理)
app.post('/api/flowhub/flowhub_employees/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '请上传文件' });
  }

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    if (data.length < 2) throw new Error('文件内容为空或格式不正确');

    // 🟢 性能优化：只查询需要的两列（email 和 id），大大节约大数据量下的内存分配
    const [existingRows] = await pool.query('SELECT id, email FROM flowhub_employees WHERE email IS NOT NULL AND email != ""');
    const emailToIdMap = new Map(existingRows.map(e => [e.email, e.id]));

    const newEmployees = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;

      const name = String(row[0] || '').trim();
      const email = String(row[1] || '').trim();
      let hireDate = String(row[2] || '').trim();

      // 兼容解析 Excel 日期天数序列
      if (hireDate && !isNaN(hireDate)) {
        const days = parseFloat(hireDate);
        if (days > 20000) { // 大致是 1954 年之后的日期
          hireDate = new Date(Math.round((days - 25569) * 86400 * 1000)).toISOString().split('T')[0];
        }
      }

      const department = String(row[3] || '').trim();
      const position = String(row[4] || '').trim();

      if (name) {
        // 如果邮箱存在，重用原有ID进行更新，否则生成新ID
        const empId = emailToIdMap.get(email) || uuidv4();
        newEmployees.push({
          id: empId, name, email, hireDate, department, position
        });
      }
    }

    await saveEmployeesToDB(newEmployees);
    const flowhub_employees = await getEmployeesFromDB();

    res.json({
      success: true,
      message: `成功导入/更新 ${newEmployees.length} 条员工记录`,
      data: {
        total: flowhub_employees.length,
        added: newEmployees.length
      }
    });
  } catch (err) {
    console.error('解析文件失败:', err);
    res.status(500).json({ success: false, error: '解析文件失败: ' + err.message });
  } finally {
    // 确保无论成功还是报错，上传的临时文件都会被清理
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

app.delete('/api/flowhub/flowhub_employees/:id', async (req, res) => {
  const { id } = req.params;
  const employee = await getEmployeeById(id);
  if (!employee) {
    return res.status(404).json({ success: false, error: '员工不存在' });
  }
  await deleteEmployeeFromDB(id);
  res.json({ success: true, message: '员工已删除' });
});

// 获取员工匹配的流程
app.get('/api/flowhub/flowhub_employees/:id/flowhub_flows', async (req, res) => {
  const { id } = req.params;
  const employee = await getEmployeeById(id);

  if (!employee) {
    return res.status(404).json({ success: false, error: '员工不存在' });
  }

  // 🟢 使用优化后的同步函数逻辑
  const allFlows = await getFlowsFromDB();
  const matchedFlows = matchFlowsByPosition(employee.position, allFlows);

  res.json({ success: true, data: { employee, flowhub_flows: matchedFlows } });
});

app.get('/api/flowhub/flowhub_flows', async (req, res) => {
  const flowhub_flows = await getFlowsFromDB();
  res.json({ success: true, data: flowhub_flows });
});

app.get('/api/flowhub/departments', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT DISTINCT department FROM flowhub_employees WHERE department IS NOT NULL AND department != "" ORDER BY department'
    );
    res.json({ success: true, data: rows.map(r => r.department) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 上传流程清单 (提前查询一次基础ID并在内存累加，防止相同ID被不断覆盖)
app.post('/api/flowhub/flowhub_flows/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '请上传文件' });
  }

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    if (data.length < 2) throw new Error('文件内容为空或格式不正确');

    let nextNum = 1;
    try {
      const [rows] = await pool.query('SELECT id FROM flowhub_flows ORDER BY id DESC LIMIT 1');
      if (rows.length > 0) {
        nextNum = parseInt(rows[0].id.replace('P-', '')) + 1;
      }
    } catch (err) {
      nextNum = 1;
    }

    const newFlows = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;

      const name = String(row[0] || '').trim();
      const positions = String(row[1] || '').trim();
      const url = String(row[2] || '').trim();

      if (name) {
        const flowId = `P-${String(nextNum).padStart(3, '0')}`;
        nextNum++;

        newFlows.push({
          id: flowId,
          name,
          positions: positions || '',
          url: url || ''
        });
      }
    }

    await saveFlowsToDB(newFlows);
    const flowhub_flows = await getFlowsFromDB();

    res.json({
      success: true,
      message: `成功导入 ${newFlows.length} 条流程记录`,
      data: {
        total: flowhub_flows.length,
        added: newFlows.length
      }
    });
  } catch (err) {
    console.error('解析文件失败:', err);
    res.status(500).json({ success: false, error: '解析文件失败: ' + err.message });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

app.delete('/api/flowhub/flowhub_flows/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM flowhub_flows WHERE id = ?', [id]);
    res.json({ success: true, message: '流程已删除' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 辅助函数 ====================

function getTargetDisplay(targetType, targetDepartment, targetUsers) {
  if (targetType === 'all') return '全部员工';
  else if (targetType === 'department') return targetDepartment || '指定部门';
  else if (targetType === 'custom') {
    const count = Array.isArray(targetUsers) ? targetUsers.length : 0;
    return count > 0 ? `${count} 人` : '指定员工';
  }
  return '全部员工';
}

function getRecurrenceDisplay(recurrence) {
  const map = { 'once': '一次性', 'daily': '每天', 'weekly': '每周', 'monthly': '每月' };
  return map[recurrence] || recurrence;
}

app.get('/api/flowhub/tasks', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const offset = (page - 1) * pageSize;

  try {
    const [rows] = await pool.query(
      'SELECT * FROM flowhub_scheduled_tasks ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [pageSize, offset]
    );

    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM flowhub_scheduled_tasks');
    const total = countResult[0].total;

    const safeJsonParse = (str, defaultVal) => {
      if (!str) return defaultVal;
      try { return JSON.parse(str); } catch { return defaultVal; }
    };

    res.json({
      success: true,
      data: {
        list: rows.map(row => ({
          id: row.id,
          name: row.name,
          target_type: row.target_type,
          target_department: row.target_department,
          target_users: safeJsonParse(row.target_users, []),
          target_display: getTargetDisplay(row.target_type, row.target_department, safeJsonParse(row.target_users, [])),
          schedule_time: row.schedule_time,
          recurrence: row.recurrence,
          recurrence_display: getRecurrenceDisplay(row.recurrence),
          status: row.status,
          result: safeJsonParse(row.result, null),
          error_message: row.error_message,
          created_at: row.created_at,
          completed_at: row.completed_at
        })),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize)
        }
      }
    });
  } catch (err) {
    console.error('获取任务列表失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/flowhub/tasks', async (req, res) => {
  const { name, targetType, targetDepartment, targetUsers, scheduleTime, recurrence } = req.body;

  if (!name || !scheduleTime) {
    return res.status(400).json({ success: false, error: '缺少必要参数' });
  }

  const scheduledDate = new Date(scheduleTime);
  if (isNaN(scheduledDate.getTime())) {
    return res.status(400).json({ success: false, error: '无效的时间格式' });
  }

  const taskId = uuidv4();
  const task = {
    id: taskId,
    name,
    targetType: targetType || 'all',
    targetDepartment,
    targetUsers,
    scheduleTime: new Date(scheduleTime),
    recurrence: recurrence || 'once',
    status: 'pending',
    createdAt: new Date()
  };

  await saveTaskToDB(task);
  tasks.set(taskId, task);

  if (scheduledDate > new Date()) {
    schedule.scheduleJob(taskId, scheduledDate, () => {
      executePushTask(taskId);
    });
    console.log(`任务 "${name}" 已安排在 ${scheduledDate.toLocaleString()} 执行`);
  } else {
    console.log(`任务 "${name}" 已过期，立即执行`);
    executePushTask(taskId);
  }

  res.json({ success: true, data: task });
});

app.delete('/api/flowhub/tasks/:id', async (req, res) => {
  const { id } = req.params;

  const job = schedule.scheduledJobs[id];
  if (job) job.cancel();

  tasks.delete(id);

  const deleteResult = await deleteTaskFromDB(id);
  if (!deleteResult) {
    return res.status(500).json({ success: false, error: '删除任务失败' });
  }

  res.json({ success: true, message: '任务已删除' });
});

app.post('/api/flowhub/tasks/:id/trigger', async (req, res) => {
  const { id } = req.params;
  const task = tasks.get(id);

  if (!task) {
    return res.status(404).json({ success: false, error: '任务不存在' });
  }

  const result = await executePushTask(id);
  res.json({ success: true, message: '任务已执行完毕', data: result });
});

// ==================== 启动服务器 ====================

const PORT = config.port;

async function startServer() {
  await initDatabase();

  const flowList = await getFlowsFromDB();
  console.log(`✓ 已加载 ${flowList.length} 条流程记录`);

  console.log('  正在恢复定时任务...');
  await loadTasksFromDB();
  await cleanupOldTasks();

  app.listen(PORT, '127.0.0.1', () => {
    console.log('\n========================================');
    console.log('  FlowHub 飞书应用机器人服务已启动');
    console.log('========================================');
    console.log(`  服务地址: http://localhost:${PORT}`);
    console.log(`  数据库: MySQL (flowhub)`);
    console.log('');

    console.log('  正在连接飞书机器人...');
    initFeishuConnection();

    console.log('');
    console.log('  API 接口:');
    console.log(`    GET  /api/flowhub/status      - 获取连接状态`);
    console.log(`    GET  /api/flowhub/flowhub_employees  - 获取员工列表`);
    console.log(`    POST /api/flowhub/flowhub_employees/upload - 上传员工名单`);
    console.log(`    GET  /api/flowhub/flowhub_flows     - 获取流程列表`);
    console.log(`    POST /api/flowhub/flowhub_flows/upload - 上传流程清单`);
    console.log(`    GET  /api/flowhub/tasks     - 获取任务列表(分页)`);
    console.log(`    POST /api/flowhub/tasks      - 创建推送任务`);
    console.log(`    DELETE /api/flowhub/tasks/:id - 删除任务`);
    console.log(`    POST /api/flowhub/tasks/:id/trigger - 手动触发`);
    console.log('========================================\n');
  });
}

startServer();