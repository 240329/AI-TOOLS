const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const config = require('./config');
const { initDatabase, getPool, query } = require('./src/services/database');
const { initFeishu, getStatus, initConnection, sendMessage, buildFlowNotificationCard } = require('./src/services/feishu');
const { validateEmployeeData, validateFlowData, validateTaskData } = require('./src/utils/validators');
const {
  getEmployeesFromDB,
  getEmployeeById,
  saveEmployeesToDB,
  deleteEmployeeFromDB,
  getFlowsFromDB,
  saveFlowsToDB,
  deleteFlowFromDB,
  matchFlowsByPosition
} = require('./src/models/data');
const {
  tasks,
  saveTaskToDB,
  updateTaskStatus,
  deleteTaskFromDB,
  loadTasksFromDB,
  cleanupOldTasks,
  getTask,
  cancelTask,
  executePushTask
} = require('./src/models/task');

const app = express();

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, error: '请求过于频繁，请稍后再试' }
});
app.use('/api/', apiLimiter);

app.use(cors());
app.use(bodyParser.json());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static('uploads'));

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
    const allowedTypes = /xlsx|xls|csv/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    if (ext) cb(null, true);
    else cb(new Error('只支持 .xlsx, .xls, .csv 文件'));
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      uptime: Math.floor(process.uptime()),
      database: 'disconnected',
      error: err.message
    });
  }
});

app.get('/api/flowhub/status', (req, res) => {
  const status = getStatus();
  res.json({
    success: true,
    data: {
      connected: status.connected,
      lastConnected: status.lastConnected,
      reconnectAttempts: status.reconnectAttempts
    }
  });
});

app.get('/api/flowhub/dashboard/stats', async (req, res) => {
  try {
    const [flowRows] = await query('SELECT COUNT(*) as count FROM flowhub_flows');
    const [employeeRows] = await query('SELECT COUNT(*) as count FROM flowhub_employees');
    const [taskTotalRows] = await query('SELECT COUNT(*) as count FROM flowhub_scheduled_tasks');
    const [taskPendingRows] = await query("SELECT COUNT(*) as count FROM flowhub_scheduled_tasks WHERE status = 'pending'");
    const [taskCompletedRows] = await query("SELECT COUNT(*) as count FROM flowhub_scheduled_tasks WHERE status = 'completed'");

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
    const allFlows = await getFlowsFromDB();

    const flowhub_employeesWithFlows = flowhub_employees.map(emp => {
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

    res.json({ success: true, data: flowhub_employeesWithFlows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/flowhub/flowhub_employees/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '请上传文件' });
  }

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    if (data.length < 2) throw new Error('文件内容为空或格式不正确');

    const [existingRows] = await query('SELECT id, email FROM flowhub_employees WHERE email IS NOT NULL AND email != ""');
    const emailToIdMap = new Map(existingRows.map(e => [e.email, e.id]));

    const newEmployees = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;

      const name = String(row[0] || '').trim();
      const email = String(row[1] || '').trim();
      let hireDate = String(row[2] || '').trim();

      if (hireDate && !isNaN(hireDate)) {
        const days = parseFloat(hireDate);
        if (days > 20000) {
          hireDate = new Date(Math.round((days - 25569) * 86400 * 1000)).toISOString().split('T')[0];
        }
      }

      const department = String(row[3] || '').trim();
      const position = String(row[4] || '').trim();

      if (name) {
        const validation = validateEmployeeData({ name, email, department, position });
        if (!validation.valid) {
          console.warn(`跳过无效员工数据 [${name}]: ${validation.error}`);
          continue;
        }

        const empId = emailToIdMap.get(email) || uuidv4();
        newEmployees.push({
          id: empId,
          name: name.trim(),
          email: email.trim(),
          hireDate,
          department: department.trim(),
          position: position.trim()
        });
      }
    }

    await saveEmployeesToDB(newEmployees);
    const flowhub_employees = await getEmployeesFromDB();

    res.json({
      success: true,
      message: `成功导入/更新 ${newEmployees.length} 条员工记录`,
      data: { total: flowhub_employees.length, added: newEmployees.length }
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

app.delete('/api/flowhub/flowhub_employees/:id', async (req, res) => {
  const { id } = req.params;
  const employee = await getEmployeeById(id);
  if (!employee) {
    return res.status(404).json({ success: false, error: '员工不存在' });
  }
  await deleteEmployeeFromDB(id);
  res.json({ success: true, message: '员工已删除' });
});

app.get('/api/flowhub/flowhub_employees/:id/flowhub_flows', async (req, res) => {
  const { id } = req.params;
  const employee = await getEmployeeById(id);
  if (!employee) {
    return res.status(404).json({ success: false, error: '员工不存在' });
  }

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
    const [rows] = await query(
      'SELECT DISTINCT department FROM flowhub_employees WHERE department IS NOT NULL AND department != "" ORDER BY department'
    );
    res.json({ success: true, data: rows.map(r => r.department) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
      const [rows] = await query('SELECT id FROM flowhub_flows ORDER BY id DESC LIMIT 1');
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
      const category = String(row[3] || '').trim();

      if (name) {
        const validation = validateFlowData({ name, url });
        if (!validation.valid) {
          console.warn(`跳过无效流程数据 [${name}]: ${validation.error}`);
          continue;
        }

        const flowId = `P-${String(nextNum).padStart(3, '0')}`;
        nextNum++;

        newFlows.push({
          id: flowId,
          name: name.trim(),
          positions: positions.trim(),
          url: url.trim(),
          category: category.trim()
        });
      }
    }

    await saveFlowsToDB(newFlows);
    const flowhub_flows = await getFlowsFromDB();

    res.json({
      success: true,
      message: `成功导入 ${newFlows.length} 条流程记录`,
      data: { total: flowhub_flows.length, added: newFlows.length }
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
    await deleteFlowFromDB(id);
    res.json({ success: true, message: '流程已删除' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
  const map = { 'once': '一次性', 'daily': '每天', 'weekly': '每���', 'monthly': '每月' };
  return map[recurrence] || recurrence;
}

app.get('/api/flowhub/tasks', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const offset = (page - 1) * pageSize;

  try {
    const [rows] = await query(
      'SELECT * FROM flowhub_scheduled_tasks ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [pageSize, offset]
    );

    const [countResult] = await query('SELECT COUNT(*) as total FROM flowhub_scheduled_tasks');
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

  const validation = validateTaskData({ name, scheduleTime, recurrence });
  if (!validation.valid) {
    return res.status(400).json({ success: false, error: validation.error });
  }

  const scheduledDate = new Date(scheduleTime);
  if (isNaN(scheduledDate.getTime())) {
    return res.status(400).json({ success: false, error: '无效的时间格式' });
  }

  // if (scheduledDate < new Date() && recurrence === 'once') {
  //   return res.status(400).json({ success: false, error: '不能创建过去的定时任务' });
  // }

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
    const schedule = require('node-schedule');
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

  cancelTask(id);
  const deleteResult = await deleteTaskFromDB(id);
  if (!deleteResult) {
    return res.status(500).json({ success: false, error: '删除任务失败' });
  }

  res.json({ success: true, message: '任务已删除' });
});

app.post('/api/flowhub/tasks/:id/trigger', async (req, res) => {
  const { id } = req.params;
  const task = getTask(id);

  if (!task) {
    return res.status(404).json({ success: false, error: '任务不存在' });
  }

  const result = await executePushTask(id);
  res.json({ success: true, message: '任务已执行完毕', data: result });
});

const PORT = config.port;

async function startServer() {
  await initDatabase(config);
  initFeishu(config);

  const flowList = await getFlowsFromDB();
  console.log(`✓ 已加载 ${flowList.length} 条流程记录`);

  console.log('  正在恢复定时任务...');
  await loadTasksFromDB();
  await cleanupOldTasks();

  app.listen(PORT, '0.0.0.0', () => {
    console.log('\n========================================');
    console.log('  FlowHub 飞书应用机器人服务已启动');
    console.log('========================================');
    console.log(`  服务地址: http://localhost:${PORT}`);
    console.log(`  数据库: MySQL (flowhub)`);
    console.log('');

    console.log('  正在连接飞书机器人...');
    initConnection();

    console.log('');
    console.log('  API 接口:');
    console.log(`    GET  /health                      - 健康检查`);
    console.log(`    GET  /api/flowhub/status          - 获取连接状态`);
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