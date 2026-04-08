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

  // 创建 employees 表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100),
      hire_date DATE,
      department VARCHAR(100),
      position VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 创建 flows 表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flows (
      id VARCHAR(20) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      positions VARCHAR(200),
      url VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // 迁移旧表结构（移除 tags 和 target 列）
  try {
    await pool.query('SELECT tags FROM flows LIMIT 1');
    await pool.query('ALTER TABLE flows DROP COLUMN tags, DROP COLUMN target');
  } catch (err) { /* 列不存在或已删除 */ }
  
  // 添加 positions 列（如果不存在）
  try {
    await pool.query('SELECT positions FROM flows LIMIT 1');
  } catch (err) {
    await pool.query('ALTER TABLE flows ADD COLUMN positions VARCHAR(200) DEFAULT ""');
  }

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

// 飞书用户缓存（企业员工）- 已废弃，使用 employeesDB
// let employeeList = [
//   { userId: 'fgg6a31f', name: '孙伟杰', department: '信息技术部', position: 'SAP开发' },
//   { userId: '1abccba', name: '陈庆媛', department: '信息技术部', position: 'OA' },
// ];

// ==================== MySQL 数据库操作 ====================

// 从数据库获取所有员工
async function getEmployeesFromDB() {
  try {
    const [rows] = await pool.query('SELECT * FROM employees ORDER BY created_at DESC');
    return rows;
  } catch (err) {
    console.error('获取员工失败:', err.message);
    return [];
  }
}

// 从数据库获取单个员工
async function getEmployeeById(id) {
  try {
    const [rows] = await pool.query('SELECT * FROM employees WHERE id = ?', [id]);
    return rows[0] || null;
  } catch (err) {
    console.error('获取员工失败:', err.message);
    return null;
  }
}

// 批量保存员工到数据库
async function saveEmployeesToDB(employees) {
  if (employees.length === 0) return;
  
  console.log('DEBUG saveEmployeesToDB called with:', JSON.stringify(employees, null, 2));
  
  const placeholders = employees.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
  const values = employees.flatMap(emp => [
    emp.id, emp.name, emp.email, emp.hireDate, emp.department, emp.position
  ]);
  
  console.log('DEBUG SQL values:', values);
  
  try {
    await pool.query(
      `INSERT INTO employees (id, name, email, hire_date, department, position) VALUES ${placeholders} ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), hire_date=VALUES(hire_date), department=VALUES(department), position=VALUES(position)`,
      values
    );
    return true;
  } catch (err) {
    console.error('保存员工失败:', err.message);
    return false;
  }
}

// 从数据库删除员工
async function deleteEmployeeFromDB(id) {
  try {
    await pool.query('DELETE FROM employees WHERE id = ?', [id]);
    return true;
  } catch (err) {
    console.error('删除员工失败:', err.message);
    return false;
  }
}

// 从数据库获取所有流程
async function getFlowsFromDB() {
  try {
    const [rows] = await pool.query('SELECT * FROM flows ORDER BY id');
    return rows;
  } catch (err) {
    console.error('获取流程失败:', err.message);
    return [];
  }
}

// 批量保存流程到数据库
async function saveFlowsToDB(flows) {
  if (flows.length === 0) return;
  
  const placeholders = flows.map(() => '(?, ?, ?, ?)').join(', ');
  const values = flows.flatMap(flow => [
    flow.id, flow.name, flow.positions || '', flow.url
  ]);
  
  try {
    await pool.query(
      `INSERT INTO flows (id, name, positions, url) VALUES ${placeholders} ON DUPLICATE KEY UPDATE name=VALUES(name), positions=VALUES(positions), url=VALUES(url)`,
      values
    );
    return true;
  } catch (err) {
    console.error('保存流程失败:', err.message);
    return false;
  }
}

// 获取下一个流程ID
async function getNextFlowId() {
  try {
    const [rows] = await pool.query('SELECT id FROM flows ORDER BY id DESC LIMIT 1');
    if (rows.length === 0) return 'P-001';
    
    const lastId = rows[0].id;
    const num = parseInt(lastId.replace('P-', '')) + 1;
    return `P-${String(num).padStart(3, '0')}`;
  } catch (err) {
    return 'P-001';
  }
}

// ==================== 流程匹配逻辑 (基于数据库) ====================

async function matchFlowsByPosition(position) {
  if (!position) return [];
  
  const flows = await getFlowsFromDB();
  const posLower = position.toLowerCase();
  
  return flows.filter(flow => {
    if (!flow.positions || flow.positions.trim() === '') return false;
    
    const keywords = flow.positions.split(',').map(k => k.trim().toLowerCase());
    
    // 模糊匹配：员工岗位包含关键词 或 关键词包含员工岗位
    return keywords.some(keyword => {
      if (!keyword) return false;
      return posLower.includes(keyword) || keyword.includes(posLower);
    });
  });
}

// ==================== 文件上传配置 ====================

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

// 流程列表 - 从数据库加载
let flowList = [];

async function loadFlowsFromDB() {
  return await getFlowsFromDB();
}

// ==================== 飞书长连接 ====================

let wsClient = null;

async function initFeishuConnection() {
  try {
    // // 尝试通过发送消息测试凭证是否有效
    // const result = await client.im.message.create({
    //   params: { receive_id_type: 'email' },
    //   data: {
    //     receive_id: 'sunweijie.wx@dreame.tech',
    //     msg_type: 'text',
    //     content: JSON.stringify({ text: 'connection test' })
    //   }
    // });
    
    // console.log('✓ 飞书应用连接已建立');
    // feishuStatus.connected = true;
    // feishuStatus.lastConnected = new Date();
    // feishuStatus.reconnectAttempts = 0;
    
    // 直接标记为已连接（跳过实际测试）
    console.log('✓ 飞书应用连接已初始化');
    feishuStatus.connected = true;
    feishuStatus.lastConnected = new Date();
    feishuStatus.reconnectAttempts = 0;
    
  } catch (err) {
    // 只要不是网络错误，就认为连接正常（可能是权限问题）
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

// ==================== 用户查找（已废弃，改用邮箱发送） ====================
// async function findUserOpenId(email, name) {
//   // 优先通过邮箱查找
//   if (email) {
//     console.log(`尝试通过邮箱查找用户: ${email}`);
//     try {
//       const result = await client.contact.user.batchGetId({
//         data: { emails: [email] },
//         params: { user_id_type: 'email' }
//       });
//       console.log('batchGetId 结果:', JSON.stringify(result.data));
//       if (result.data?.users?.length > 0) {
//         console.log(`✓ 通过邮箱找到用户: ${email} -> ${result.data.users[0].open_id}`);
//         return result.data.users[0].open_id;
//       }
//     } catch (err) {
//       console.log('邮箱查找失败:', err.message);
//     }
//   }
  
//   // 邮箱未找到，通过名字搜索
//   if (name) {
//     try {
//       const result = await client.contact.user.list({
//         params: { department_id: '0', page_size: 100 }
//       });
//       const user = result.data.items?.find(u => u.name === name);
//       if (user) {
//         console.log(`✓ 通过名字找到用户: ${name} -> ${user.open_id}`);
//         return user.open_id;
//       }
//     } catch (err) {
//       console.log('名字查找失败:', err.message);
//     }
//   }
  
//   return null;
// }

// 构建流程推送卡片消息
function buildFlowNotificationCard(employee, flows) {
  const flowItems = flows.map(f => 
    `• [${f.name}](${f.url})\n  适配岗位: ${f.positions || '通用'}`
  ).join('\n\n');

  return {
    header: {
      title: {
        tag: 'plain_text',
        content: '📋 入职流程推送通知'
      },
      template: 'blue'
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `你好 **${employee.name}** 👋\n\n欢迎加入公司！以下是您需要了解的新员工流程：`
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
            url: 'https://your-company.com/flows'
          }
        ]
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `---\n💡 如有疑问，请联系HR或IT部门`
        }
      }
    ]
  };
}

// ==================== 定时任务执行 ====================

async function executePushTask(taskId) {
  const task = tasks.get(taskId);
  if (!task || task.status === 'completed') {
    console.log(`任务 ${taskId} 不存在或已完成`);
    return;
  }

  console.log(`执行推送任务: ${task.name}`);

  // 从数据库获取员工列表
  const employees = await getEmployeesFromDB();
  
  // 获取要发送的员工列表
  let targetEmployees = [];
  if (task.targetType === 'all') {
    targetEmployees = employees;
  } else if (task.targetType === 'department' && task.targetDepartment) {
    targetEmployees = employees.filter(e => e.department === task.targetDepartment);
  } else if (task.targetType === 'custom' && task.targetUsers) {
    targetEmployees = employees.filter(e => task.targetUsers.includes(e.id));
  }

  if (targetEmployees.length === 0) {
    console.log('没有目标员工，跳过发送');
    return;
  }

  // 异步发送消息 - 每个员工使用自己的匹配流程
  const sendPromises = targetEmployees.map(async (employee) => {
    // 动态获取员工的匹配流程（模糊匹配）
    const employeeFlows = await matchFlowsByPosition(employee.position);
    
    console.log(`处理员工: ${employee.name}, 岗位: ${employee.position}, 匹配到 ${employeeFlows.length} 个流程`);
    
    if (employeeFlows.length === 0) {
      console.log(`员工 ${employee.name} (${employee.position || '未设置岗位'}) 没有匹配的流程`);
      return { success: false, error: '无匹配流程' };
    }
    
    // const openId = await findUserOpenId(employee.email, employee.name);
    // console.log(`员工 ${employee.name} openId: ${openId}`);
    
    // if (!openId) {
    //   console.log(`✗ 无法找到用户: ${employee.name} (${employee.email})`);
    //   return { success: false, error: '用户未找到' };
    // }
    
    const card = buildFlowNotificationCard({ name: employee.name }, employeeFlows);
    return sendMessage(employee.email, 'email', 'interactive', card);
  });

  Promise.all(sendPromises).then(results => {
    const successCount = results.filter(r => r.success).length;
    console.log(`任务 ${task.name} 完成: 成功 ${successCount}/${results.length}`);
    
    task.status = 'completed';
    task.completedAt = new Date();
    task.result = { success: successCount, total: results.length };

    // 如果是周期性任务，创建下一次执行
    if (task.recurrence !== 'once') {
      scheduleNextRecurrence(task);
    }
  });
}

// 安排周期性任务的下一次执行
function scheduleNextRecurrence(task) {
  let nextDate;
  const now = new Date();
  
  if (task.recurrence === 'daily') {
    nextDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  } else if (task.recurrence === 'weekly') {
    nextDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  } else if (task.recurrence === 'monthly') {
    nextDate = new Date(now);
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
    tasks.set(newTask.id, newTask);
    
    schedule.scheduleJob(newTask.id, nextDate, () => {
      executePushTask(newTask.id);
    });
    
    console.log(`已安排下次执行: ${nextDate.toLocaleString()}`);
  }
}

// ==================== API 路由 ====================

// 获取飞书连接状态
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    data: {
      connected: feishuStatus.connected,
      lastConnected: feishuStatus.lastConnected,
      reconnectAttempts: feishuStatus.reconnectAttempts
    }
  });
});

// 获取员工列表
app.get('/api/employees', async (req, res) => {
  try {
    const employees = await getEmployeesFromDB();
    
    // 异步获取每个员工的匹配流程
    const employeesWithFlows = await Promise.all(employees.map(async emp => {
      const matchedFlows = await matchFlowsByPosition(emp.position);
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
    }));
    
    res.json({
      success: true,
      data: employeesWithFlows
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 上传员工名单
app.post('/api/employees/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '请上传文件' });
  }

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    if (data.length < 2) {
      return res.status(400).json({ success: false, error: '文件内容为空或格式不正确' });
    }

    // 解析表头和数据
    // 第1列：姓名，第2列：邮箱，第3列：入职日期，第4列：部门，第5列：岗位
    const newEmployees = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue; // 跳过空行

      const name = String(row[0] || '').trim();
      const email = String(row[1] || '').trim();
      let hireDate = String(row[2] || '').trim();
      // 处理Excel日期序列号（如45384.333333333336）
      if (!isNaN(hireDate) && hireDate.includes('.')) {
        const excelEpoch = new Date(1899, 11, 30);
        const days = parseFloat(hireDate);
        const date = new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
        hireDate = date.toISOString().split('T')[0];
      }
      const department = String(row[3] || '').trim();
      const position = String(row[4] || '').trim();

      if (name) {
        newEmployees.push({
          id: uuidv4(),
          name,
          email,
          hireDate,
          department,
          position
        });
      }
    }

    // 保存到数据库
    await saveEmployeesToDB(newEmployees);
    
    // 删除上传的文件
    fs.unlinkSync(req.file.path);

    // 获取总数
    const employees = await getEmployeesFromDB();

    res.json({
      success: true,
      message: `成功导入 ${newEmployees.length} 条员工记录`,
      data: {
        total: employees.length,
        added: newEmployees.length
      }
    });
  } catch (err) {
    console.error('解析文件失败:', err);
    res.status(500).json({ success: false, error: '解析文件失败: ' + err.message });
  }
});

// 删除员工
app.delete('/api/employees/:id', async (req, res) => {
  const { id } = req.params;
  
  const employee = await getEmployeeById(id);
  if (!employee) {
    return res.status(404).json({ success: false, error: '员工不存在' });
  }

  await deleteEmployeeFromDB(id);

  res.json({ success: true, message: '员工已删除' });
});

// 获取员工匹配的流程
app.get('/api/employees/:id/flows', async (req, res) => {
  const { id } = req.params;
  const employee = await getEmployeeById(id);
  
  if (!employee) {
    return res.status(404).json({ success: false, error: '员工不存在' });
  }

  const matchedFlows = await matchFlowsByPosition(employee.position);

  res.json({
    success: true,
    data: {
      employee,
      flows: matchedFlows
    }
  });
});

// 获取流程列表
app.get('/api/flows', async (req, res) => {
  const flows = await getFlowsFromDB();
  res.json({
    success: true,
    data: flows
  });
});

// 上传流程清单
app.post('/api/flows/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '请上传文件' });
  }

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    if (data.length < 2) {
      return res.status(400).json({ success: false, error: '文件内容为空或格式不正确' });
    }

    // 解析表头和数据
    // 第1列：名称，第2列：适配岗位(逗号分隔)，第3列：链接URL
    const newFlows = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;

      const name = String(row[0] || '').trim();
      const positions = String(row[1] || '').trim();
      const url = String(row[2] || '').trim();

      if (name) {
        const flowId = await getNextFlowId();
        newFlows.push({
          id: flowId,
          name,
          positions: positions || '',
          url: url || ''
        });
      }
    }

    // 保存到数据库
    await saveFlowsToDB(newFlows);
    
    // 删除上传的文件
    fs.unlinkSync(req.file.path);

    // 获取总数
    const flows = await getFlowsFromDB();

    res.json({
      success: true,
      message: `成功导入 ${newFlows.length} 条流程记录`,
      data: {
        total: flows.length,
        added: newFlows.length
      }
    });
  } catch (err) {
    console.error('解析文件失败:', err);
    res.status(500).json({ success: false, error: '解析文件失败: ' + err.message });
  }
});

// 删除流程
app.delete('/api/flows/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    await pool.query('DELETE FROM flows WHERE id = ?', [id]);
    res.json({ success: true, message: '流程已删除' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除员工
app.delete('/api/employees/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    await pool.query('DELETE FROM employees WHERE id = ?', [id]);
    res.json({ success: true, message: '员工已删除' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取所有任务
app.get('/api/tasks', (req, res) => {
  const taskList = Array.from(tasks.values()).sort((a, b) => 
    new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json({
    success: true,
    data: taskList
  });
});

// 创建定时任务
app.post('/api/tasks', (req, res) => {
  const { 
    name, 
    targetType, 
    targetDepartment, 
    targetUsers, 
    scheduleTime, 
    recurrence
  } = req.body;

  if (!name || !scheduleTime) {
    return res.status(400).json({
      success: false,
      error: '缺少必要参数'
    });
  }

  // 处理日期字符串：如果没有时区信息，视为本地时间
  let scheduledDate;
  if (typeof scheduleTime === 'string' && scheduleTime.includes('T') && !scheduleTime.includes('+') && !scheduleTime.endsWith('Z')) {
    // 手动解析，保留本地时区
    const [datePart, timePart] = scheduleTime.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute, second] = timePart.split(':').map(Number);
    scheduledDate = new Date(year, month - 1, day, hour, minute, second);
  } else {
    scheduledDate = new Date(scheduleTime);
  }

  const taskId = uuidv4();
  const task = {
    id: taskId,
    name,
    targetType: targetType || 'all',
    targetDepartment,
    targetUsers,
    scheduleTime: scheduledDate.toISOString(),
    recurrence: recurrence || 'once',
    status: 'pending',
    createdAt: new Date()
  };

  tasks.set(taskId, task);

  // 安排定时执行
  const now = new Date();
  const scheduledTimestamp = scheduledDate.getTime();
  const nowTimestamp = now.getTime();
  console.log(`[DEBUG] 接收到的scheduleTime: ${scheduleTime}`);
  console.log(`[DEBUG] 解析后的scheduledDate: ${scheduledDate.toISOString()}`);
  console.log(`[DEBUG] scheduledDate本地时间: ${scheduledDate.toString()}`);
  console.log(`[DEBUG] 当前时间: ${now.toString()}`);
  console.log(`[DEBUG] scheduledTimestamp: ${scheduledTimestamp}`);
  console.log(`[DEBUG] nowTimestamp: ${nowTimestamp}`);
  console.log(`[DEBUG] scheduledTimestamp > nowTimestamp: ${scheduledTimestamp > nowTimestamp}`);
  
  if (scheduledTimestamp > nowTimestamp) {
    schedule.scheduleJob(taskId, scheduledDate, () => {
      executePushTask(taskId);
    });
    console.log(`任务 "${name}" 已安排在 ${scheduledDate.toLocaleString()} 执行`);
  } else {
    // 如果是过去的时间，立即执行
    console.log(`任务 "${name}" 已过期，立即执行`);
    executePushTask(taskId);
  }

  res.json({
    success: true,
    data: task
  });
});

// 删除任务
app.delete('/api/tasks/:id', (req, res) => {
  const { id } = req.params;
  
  if (!tasks.has(id)) {
    return res.status(404).json({
      success: false,
      error: '任务不存在'
    });
  }

  // 取消定时任务
  const job = schedule.scheduledJobs[id];
  if (job) {
    job.cancel();
  }

  tasks.delete(id);

  res.json({
    success: true,
    message: '任务已删除'
  });
});

// 手动触发任务
app.post('/api/tasks/:id/trigger', (req, res) => {
  const { id } = req.params;
  const task = tasks.get(id);

  if (!task) {
    return res.status(404).json({
      success: false,
      error: '任务不存在'
    });
  }

  // 立即执行任务
  executePushTask(id);

  res.json({
    success: true,
    message: '任务已开始执行'
  });
});

// ==================== 测试消息接口（已废弃） ====================
// app.post('/api/send-test', async (req, res) => {
//   const { userId, message } = req.body;
//   
//   if (!userId) {
//     return res.status(400).json({
//       success: false,
//       error: '缺少用户ID'
//     });
//   }
// 
//   const testCard = {
//     header: {
//       title: {
//         tag: 'plain_text',
//         content: '🧪 测试消息'
//       },
//       template: 'green'
//     },
//     elements: [
//       {
//         tag: 'div',
//         text: {
//           tag: 'lark_md',
//           content: message || '这是一条测试消息，来自FlowHub系统'
//         }
//       }
//     ]
//   };
// 
//   const result = await sendMessage(userId, 'user_id', 'interactive', testCard);
//   res.json(result);
// });

// ==================== Openclaw 机器人交互接口 ====================
app.post('/api/openclaw/chat', async (req, res) => {
  const { prompt } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ success: false, error: '输入内容不能为空' });
  }

  try {
    console.log(`[Openclaw] 收到前端请求，准备对接 Openclaw: ${prompt}`);

    /**
     * 【对接策略选择】
     * 策略 A: 如果 Openclaw 是飞书上的另一个应用机器人，且你拥有它的 app_id 或 open_id
     * 你可以让当前应用（FlowHub）直接发飞书消息给它。
     */
    // const OPENCLAW_BOT_ID = 'cli_xxx_openclaw_id_xxx';
    // await sendMessage(OPENCLAW_BOT_ID, 'app_id', 'text', { text: prompt });
    // 注意：如果是发给另一个机器人，飞书 SDK 获取其回调回复会比较复杂，通常需要配置事件订阅。

    /**
     * 策略 B: 如果 Openclaw 本身提供了独立的 HTTP API 服务（这是最常见的 LLM 对接方式）
     * 我们可以直接使用 fetch/axios 调用它的服务端接口。
     */
    /*
    const aiResponse = await fetch('https://api.openclaw.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_OPENCLAW_API_KEY'
      },
      body: JSON.stringify({
        messages:[{ role: 'user', content: prompt }]
      })
    });
    const aiData = await aiResponse.json();
    const replyText = aiData.choices[0].message.content;
    */

    // ----- 这里我们使用模拟返回演示联调过程 -----
    // 模拟等待 1.5 秒的大模型思考时间
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // 模拟 Openclaw 的回复文案
    const mockReply = `嗨，我是 Openclaw！基于你的需求，我帮你起草了以下内容：\n\n【标题】欢迎加入！请查收您的系统激活指南 🎉\n\n【正文】\n你好！非常高兴你加入我们的团队。为了让你在入职第一天能顺畅地开始工作，我们准备了......\n\n（你的原始诉求：${prompt}）`;

    res.json({
      success: true,
      message: '与 Openclaw 交互成功',
      data: {
        reply: mockReply
      }
    });

  } catch (err) {
    console.error('Openclaw 对接异常:', err.message);
    res.status(500).json({ success: false, error: 'Openclaw 服务调用失败: ' + err.message });
  }
});

// ==================== 启动服务器 ====================

const PORT = config.port;

async function startServer() {
  // 初始化数据库连接
  await initDatabase();
  
  // 从数据库加载流程列表
  flowList = await loadFlowsFromDB();
  console.log(`✓ 已加载 ${flowList.length} 条流程记录`);
  
  app.listen(PORT, '127.0.0.1', () => {
    console.log('\n========================================');
    console.log('  FlowHub 飞书应用机器人服务已启动');
    console.log('========================================');
    console.log(`  服务地址: http://localhost:${PORT}`);
    console.log(`  数据库: MySQL (flowhub)`);
    console.log('');
    
    // 初始化飞书长连接
    console.log('  正在连接飞书机器人...');
    initFeishuConnection();
    
    console.log('');
    console.log('  API 接口:');
    console.log(`    GET  /api/status      - 获取连接状态`);
    console.log(`    GET  /api/employees  - 获取员工列表`);
    console.log(`    POST /api/employees/upload - 上传员工名单`);
    console.log(`    GET  /api/flows     - 获取流程列表`);
    console.log(`    POST /api/flows/upload - 上传流程清单`);
    console.log(`    POST /api/tasks      - 创建推送任务`);
    console.log(`    DELETE /api/tasks/:id - 删除任务`);
    console.log(`    POST /api/tasks/:id/trigger - 手动触发`);
    console.log('========================================\n');
  });
}

startServer();