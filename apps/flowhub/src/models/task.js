const { v4: uuidv4 } = require('uuid');
const schedule = require('node-schedule');
const { query } = require('../services/database');
const { sendMessage, buildFlowNotificationCard } = require('../services/feishu');
const { getEmployeesFromDB, getFlowsFromDB, matchFlowsByPosition } = require('./data');

const tasks = new Map();

async function saveTaskToDB(task) {
  try {
    await query(
      `INSERT INTO flowhub_scheduled_tasks (id, name, target_type, target_department, target_users, schedule_time, recurrence, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), status=VALUES(status), schedule_time=VALUES(schedule_time)`,
      [task.id, task.name, task.targetType || 'all', task.targetDepartment || null,
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
    await query(
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
    await query('DELETE FROM flowhub_scheduled_tasks WHERE id = ?', [taskId]);
    return true;
  } catch (err) {
    console.error('删除任务失败:', err.message);
    return false;
  }
}

async function loadTasksFromDB() {
  try {
    const [rows] = await query("SELECT * FROM flowhub_scheduled_tasks WHERE status = 'pending'");

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
    const [result] = await query(
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

function getTask(id) {
  return tasks.get(id);
}

function cancelTask(id) {
  const job = schedule.scheduledJobs[id];
  if (job) job.cancel();
  tasks.delete(id);
}

async function executePushTask(taskId) {
  const task = tasks.get(taskId);
  if (!task || task.status === 'completed' || task.status === 'failed') {
    console.log(`任务 ${taskId} 不存在或已结束`);
    return null;
  }

  console.log(`执行推送任务: ${task.name}`);

  try {
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
      await updateTaskStatus(taskId, 'failed', task.result, '没有匹配的目标员工，发送已跳过');
      return task.result;
    }

    const allFlows = await getFlowsFromDB();
    const results = [];

    const chunkSize = 10;
    for (let i = 0; i < targetEmployees.length; i += chunkSize) {
      const chunk = targetEmployees.slice(i, i + chunkSize);

      const chunkPromises = chunk.map(async (employee) => {
        const employeeFlows = matchFlowsByPosition(employee.position, allFlows);

        if (employeeFlows.length === 0) {
          return { employeeId: employee.id, employeeName: employee.name, email: employee.email, success: false, error: '未匹配到任何流程' };
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

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);

      if (i + chunkSize < targetEmployees.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    const successCount = results.filter(r => r.success).length;
    const finalStatus = successCount > 0 ? 'completed' : 'failed';

    console.log(`任务 ${task.name} 执行结束: 状态[${finalStatus}], 成功 ${successCount}/${results.length}`);

    task.status = finalStatus;
    task.completedAt = new Date();
    task.result = { success: successCount, total: results.length, details: results };

    let errorMessage = null;
    if (finalStatus === 'failed') {
      const failedDetail = results.find(r => !r.success && r.error);
      errorMessage = failedDetail ? failedDetail.error : '全部推送失败，请检查配置或网络';
    }

    await updateTaskStatus(taskId, finalStatus, task.result, errorMessage);

    if (task.recurrence === 'once') {
      const successEmployeeIds = results
        .filter(r => r.success && r.employeeId)
        .map(r => r.employeeId);

      console.log(`[DEBUG] ========== 删除调试开始 ==========`);
      console.log(`[DEBUG] 推送成功员工数: ${successEmployeeIds.length}`);
      console.log(`[DEBUG] 成功员工ID列表: ${JSON.stringify(successEmployeeIds)}`);

      if (successEmployeeIds.length > 0) {
        try {
          const [beforeCount] = await query('SELECT COUNT(*) as cnt FROM flowhub_employees');
          console.log(`[DEBUG] 删除前员工总数: ${beforeCount[0].cnt}`);

          const uniqueIds = [...new Set(successEmployeeIds)];
          console.log(`[DEBUG] 去重后ID数量: ${uniqueIds.length}`);
          console.log(`[DEBUG] IN子句参数预览: ${uniqueIds.slice(0, 5).join(', ')}...`);

          const placeholders = uniqueIds.map(() => '?').join(', ');
          const deleteSql = `DELETE FROM flowhub_employees WHERE id IN (${placeholders})`;
          console.log(`[DEBUG] 执行SQL: DELETE FROM flowhub_employees WHERE id IN (${uniqueIds.length}个参数)`);
          await query(deleteSql, uniqueIds);

          const [afterCount] = await query('SELECT COUNT(*) as cnt FROM flowhub_employees');
          console.log(`[DEBUG] 删除后员工总数: ${afterCount[0].cnt}`);
          console.log(`[DEBUG] 预期删除数: ${beforeCount[0].cnt - afterCount[0].cnt}`);
          console.log(`单次任务：已批量删除 ${successEmployeeIds.length} 位已推送员工`);
        } catch (err) {
          console.error(`[DEBUG] ========== 删除失败 ==========`);
          console.error(`[DEBUG] 错误信息: ${err.message}`);
          console.error(`[DEBUG] 错误码: ${err.code}`);
          console.error(`[DEBUG] SQL状态: ${err.sqlState}`);
          console.error(`[DEBUG] 错误对象: ${JSON.stringify(err)}`);
          console.error('批量删除推送成功的员工失败:', err);
        }
      } else {
        console.log(`[DEBUG] 没有成功推送的员工，无需删除`);
      }
      console.log(`[DEBUG] ========== 删除调试结束 ==========`);
      tasks.delete(taskId);
    }

    if (task.recurrence !== 'once') {
      await scheduleNextRecurrence(task);
    }

    return task.result;

  } catch (err) {
    console.error(`任务 ${task.name} 执行异常:`, err);
    task.status = 'failed';
    task.completedAt = new Date();
    const errMsg = err.message || '内部执行异常';
    await updateTaskStatus(taskId, 'failed', null, errMsg);
    return null;
  }
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

module.exports = {
  tasks,
  saveTaskToDB,
  updateTaskStatus,
  deleteTaskFromDB,
  loadTasksFromDB,
  cleanupOldTasks,
  getTask,
  cancelTask,
  executePushTask,
  scheduleNextRecurrence
};