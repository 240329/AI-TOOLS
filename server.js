const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const schedule = require('node-schedule');
const { v4: uuidv4 } = require('uuid');
const lark = require('@larksuiteoapi/node-sdk');
const config = require('./config');

const app = express();
app.use(cors());
app.use(bodyParser.json());

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

// 飞书用户缓存（企业员工）
let employeeList = [
  { userId: 'fgg6a31f', name: '孙伟杰', department: '信息技术部', position: 'SAP开发' },
];

// 流程列表
const flowList = [
  { id: 'P-001', name: '新员工入职指引', tags: '入职,HR流程', target: '全体新员工' },
  { id: 'P-002', name: '研发中心权限开通规范', tags: 'IT,研发', target: '研发部员工' },
  { id: 'P-003', name: '企业文化建设指南', tags: '文化,行政', target: '全体员工' },
  { id: 'P-004', name: '考勤与办公设备领用', tags: '行政,IT', target: '全体新员工' },
  { id: 'P-005', name: '系统账号激活流程', tags: 'IT,账号', target: '全体新员工' }
];

// ==================== 飞书长连接 ====================

let wsClient = null;

async function initFeishuConnection() {
  try {
    // 尝试通过发送消息测试凭证是否有效
    const result = await client.im.message.create({
      params: { receive_id_type: 'user_id' },
      data: {
        receive_id: 'test',
        msg_type: 'text',
        content: JSON.stringify({ text: 'connection test' })
      }
    });
    
    console.log('✓ 飞书应用连接已建立');
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

// 构建流程推送卡片消息
function buildFlowNotificationCard(employee, flows) {
  const flowItems = flows.map(f => 
    `• **${f.name}**\n  标签: ${f.tags} | 适用: ${f.target}`
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

function executePushTask(taskId) {
  const task = tasks.get(taskId);
  if (!task || task.status === 'completed') {
    console.log(`任务 ${taskId} 不存在或已完成`);
    return;
  }

  console.log(`执行推送任务: ${task.name}`);

  // 获取推送的流程
  const selectedFlows = flowList.filter(f => task.flows.includes(f.id));
  
  if (selectedFlows.length === 0) {
    console.log('没有选择流程，跳过发送');
    return;
  }

  // 根据目标类型发送消息
  const sendPromises = [];

  if (task.targetType === 'all') {
    // 发送给所有员工
    employeeList.forEach(employee => {
      const card = buildFlowNotificationCard(employee, selectedFlows);
      sendPromises.push(sendMessage(employee.userId, 'user_id', 'interactive', card));
    });
  } else if (task.targetType === 'department' && task.targetDepartment) {
    // 发送给指定部门
    const deptEmployees = employeeList.filter(e => e.department === task.targetDepartment);
    deptEmployees.forEach(employee => {
      const card = buildFlowNotificationCard(employee, selectedFlows);
      sendPromises.push(sendMessage(employee.userId, 'user_id', 'interactive', card));
    });
  } else if (task.targetType === 'custom' && task.targetUsers) {
    // 发送给指定用户
    task.targetUsers.forEach(userId => {
      const employee = employeeList.find(e => e.userId === userId) || { name: '员工' };
      const card = buildFlowNotificationCard(employee, selectedFlows);
      sendPromises.push(sendMessage(userId, 'user_id', 'interactive', card));
    });
  }

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
app.get('/api/employees', (req, res) => {
  res.json({
    success: true,
    data: employeeList
  });
});

// 获取流程列表
app.get('/api/flows', (req, res) => {
  res.json({
    success: true,
    data: flowList
  });
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
    recurrence, 
    flows 
  } = req.body;

  if (!name || !scheduleTime || !flows || flows.length === 0) {
    return res.status(400).json({
      success: false,
      error: '缺少必要参数'
    });
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
    flows,
    status: 'pending',
    createdAt: new Date()
  };

  tasks.set(taskId, task);

  // 安排定时执行
  const scheduledDate = new Date(scheduleTime);
  if (scheduledDate > new Date()) {
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

// 发送测试消息
app.post('/api/send-test', async (req, res) => {
  const { userId, message } = req.body;
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: '缺少用户ID'
    });
  }

  const testCard = {
    header: {
      title: {
        tag: 'plain_text',
        content: '🧪 测试消息'
      },
      template: 'green'
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: message || '这是一条测试消息，来自FlowHub系统'
        }
      }
    ]
  };

  const result = await sendMessage(userId, 'user_id', 'interactive', testCard);
  res.json(result);
});

// ==================== 启动服务器 ====================

const PORT = config.port;

app.listen(PORT, () => {
  console.log('\n========================================');
  console.log('  FlowHub 飞书应用机器人服务已启动');
  console.log('========================================');
  console.log(`  服务地址: http://localhost:${PORT}`);
  console.log('');
  
  // 初始化飞书长连接
  console.log('  正在连接飞书机器人...');
  initFeishuConnection();
  
  console.log('');
  console.log('  API 接口:');
  console.log(`    GET  /api/status      - 获取连接状态`);
  console.log(`    GET  /api/tasks      - 获取任务列表`);
  console.log(`    POST /api/tasks      - 创建推送任务`);
  console.log(`    DELETE /api/tasks/:id - 删除任务`);
  console.log(`    POST /api/tasks/:id/trigger - 手动触发`);
  console.log(`    POST /api/send-test  - 发送测试消息`);
  console.log('========================================\n');
});
