const validateEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
};

const validateEmployeeData = (data) => {
  if (!data.name || typeof data.name !== 'string') return { valid: false, error: '姓名不能为空' };
  if (data.name.trim().length > 100) return { valid: false, error: '姓名不能超过100字符' };

  if (data.email && !validateEmail(data.email)) {
    return { valid: false, error: '邮箱格式不正确' };
  }

  if (data.department && data.department.length > 100) {
    return { valid: false, error: '部门不能超过100字符' };
  }

  if (data.position && data.position.length > 100) {
    return { valid: false, error: '岗位不能超过100字符' };
  }

  return { valid: true };
};

const validateFlowData = (data) => {
  if (!data.name || typeof data.name !== 'string') return { valid: false, error: '流程名称不能为空' };
  if (data.name.trim().length > 100) return { valid: false, error: '流程名称不能超过100字符' };

  if (data.url && !/^https?:\/\//.test(data.url)) {
    return { valid: false, error: '链接格式不正确' };
  }

  return { valid: true };
};

const validateTaskData = (data) => {
  if (!data.name || typeof data.name !== 'string') return { valid: false, error: '任务名称不能为空' };
  if (data.name.trim().length > 100) return { valid: false, error: '任务名称不能超过100字符' };

  if (!data.scheduleTime) return { valid: false, error: '推送时间不能为空' };

  const validRecurrence = ['once', 'daily', 'weekly', 'monthly'];
  if (data.recurrence && !validRecurrence.includes(data.recurrence)) {
    return { valid: false, error: '重复周期值无效' };
  }

  return { valid: true };
};

module.exports = {
  validateEmail,
  validateEmployeeData,
  validateFlowData,
  validateTaskData
};