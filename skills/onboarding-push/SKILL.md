---
name: onboarding-push
description: 飞书入职流程推送管理技能。当用户需要通过对话式交互上传员工名单、流程清单，以及创建推送任务时触发此技能。
---

# Onboarding Push

提供对话式交互界面，帮助用户完成员工入职流程管理操作。

## When to Use This Skill

当用户发送以下类型的指令时触发此技能：
- "上传员工名单" / "导入员工"
- "上传流程清单" / "导入流程"
- "创建推送任务" / "创建定时推送"
- 查询员工列表、流程列表、任务状态

## 对话式工作流程

### 1. 上传员工名单

用户指令包含："上传员工"、"导入员工"、"添加员工"

处理流程：
1. 解析用户提供的文件路径或请求用户上传Excel文件
2. 调用 `POST /api/employees/upload` 上传文件
3. Excel格式要求：
   - 第1列：姓名（必填）
   - 第2列：邮箱
   - 第3列：入职日期
   - 第4列：部门
   - 第5列：岗位
4. 返回操作结果（成功导入数量、总数）

### 2. 上传流程清单

用户指令包含："上传流程"、"导入流程"、"添加流程"

处理流程：
1. 解析用户提供的文件路径或请求用户上传Excel文件
2. 调用 `POST /api/flows/upload` 上传文件
3. Excel格式要求：
   - 第1列：流程名称（必填）
   - 第2列：适配岗位（逗号分隔，如"研发,SAP,前端"）
   - 第3列：飞书文档链接URL
4. 返回操作结果

### 3. 创建推送任务

用户指令包含："创建推送"、"创建任务"、"定时推送"

处理流程：
1. 从对话中提取任务参数：
   - 任务名称（必填）
   - 目标类型：all（全部员工）/ department（指定部门）/ custom（指定员工）
   - 目标部门（当targetType为department时必填）
   - 目标员工ID列表（当targetType为custom时必填）
   - 发送时间（必填，支持自然语言如"明天上午9点"）
   - 重复策略：once（一次性）/ daily（每天）/ weekly（每周）/ monthly（每月）
2. 调用 `POST /api/tasks` 创建任务
3. 返回任务创建结果

### 4. 查询操作

用户指令包含："查看员工"、"查看流程"、"查看任务"、"查询状态"

处理流程：
- 员工列表：`GET /api/employees`
- 流程列表：`GET /api/flows`
- 任务列表：`GET /api/tasks`
- 飞书状态：`GET /api/status`

## 参数提取规则

从自然语言中提取时间参数：
- "今天下午3点" → 转换为具体日期时间
- "明天上午9点" → 转换为具体日期时间
- "每周五下午2点" → 转换为具体日期时间
- "2024-01-15 10:00" → 直接使用

从自然语言中提取目标参数：
- "全部员工" → targetType: 'all'
- "信息技术部" → targetType: 'department', targetDepartment: '信息技术部'
- "指定员工张三、李四" → targetType: 'custom', 需要先查询员工ID

## API 调用示例

### 上传员工
```javascript
const formData = new FormData();
formData.append('file', excelFile);
fetch('/api/employees/upload', {
  method: 'POST',
  body: formData
});
```

### 创建任务 (浏览器/Fetch)
```javascript
fetch('/api/tasks', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: '新员工入职流程推送',
    targetType: 'all',
    scheduleTime: '2024-01-15T09:00:00',
    recurrence: 'once'
  })
});
```

### 创建任务 (Node.js - 推荐)
```javascript
const http = require('http');

const data = JSON.stringify({
  name: "入职流程推送",
  targetType: "all",
  scheduleTime: "2026-04-02T10:45:00",
  recurrence: "once"
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/tasks',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => console.log(body));
});

req.on('error', (e) => console.error('Error:', e.message));
req.write(data);
req.end();
```

### 常见错误排查

| 错误 | 原因 | 解决方法 |
|------|------|----------|
| `Bad escaped character` | PowerShell双引号JSON转义混乱 | 使用Node.js方式调用API |
| `Cannot convert argument` | PowerShell参数格式问题 | 使用Node.js方式 |
| 编码问题 | 中文内容编码问题 | Node.js原生支持UTF-8 |

## References

- `references/api-endpoints.md` - API 接口详细文档
- `references/excel-templates.md` - Excel 模板格式说明
- `references/task-params.md` - 任务参数详细说明

## Assets

- `assets/employee-template.xlsx` - 员工导入模板
- `assets/flow-template.xlsx` - 流程导入模板
