# API Endpoints

FlowHub 系统后端 API 接口文档。

## 基础信息

- 基础URL: `http://localhost:3001`
- 数据格式: JSON

## 员工管理

### 获取员工列表
```
GET /api/flowhub/flowhub_employees
```

响应:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "张三",
      "email": "zhangsan@company.com",
      "hireDate": "2024-01-15",
      "department": "信息技术部",
      "position": "SAP开发",
      "matchedFlows": ["P-001", "P-002"]
    }
  ]
}
```

### 上传员工名单
```
POST /api/flowhub/flowhub_employees/upload
Content-Type: multipart/form-data
```

参数:
- `file`: Excel文件 (.xlsx, .xls, .csv)

Excel格式:
| A列 | B列 | C列 | D列 | E列 |
|-----|-----|-----|-----|-----|
| 姓名 | 邮箱 | 入职日期 | 部门 | 岗位 |

响应:
```json
{
  "success": true,
  "message": "成功导入 10 条员工记录",
  "data": {
    "total": 50,
    "added": 10
  }
}
```

### 删除员工
```
DELETE /api/flowhub/flowhub_employees/:id
```

### 获取员工匹配的流程
```
GET /api/flowhub/flowhub_employees/:id/flowhub_flows
```

## 流程管理

### 获取流程列表
```
GET /api/flowhub/flowhub_flows
```

响应:
```json
{
  "success": true,
  "data": [
    {
      "id": "P-001",
      "name": "新员工入职指引",
      "positions": "新员工",
      "url": "https://feishu.cn/wiki/xxx"
    }
  ]
}
```

### 上传流程清单
```
POST /api/flowhub/flowhub_flows/upload
Content-Type: multipart/form-data
```

参数:
- `file`: Excel文件 (.xlsx, .xls, .csv)

Excel格式:
| A列 | B列 | C列 |
|-----|-----|-----|
| 流程名称 | 适配岗位(逗号分隔) | 飞书文档链接 |

响应:
```json
{
  "success": true,
  "message": "成功导入 5 条流程记录",
  "data": {
    "total": 10,
    "added": 5
  }
}
```

### 删除流程
```
DELETE /api/flowhub/flowhub_flows/:id
```

## 仪表盘

### 获取统计数据
```
GET /api/flowhub/dashboard/stats
```

响应:
```json
{
  "success": true,
  "data": {
    "flowCount": 10,
    "employeeCount": 50,
    "taskCount": 5,
    "pendingTaskCount": 2,
    "completedTaskCount": 3
  }
}
```

### 获取部门列表
```
GET /api/flowhub/departments
```

响应:
```json
{
  "success": true,
  "data": ["信息技术部", "产品中心", "研发中心"]
}
```

## 任务管理

### 获取任务列表
```
GET /api/flowhub/tasks
```

响应:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "新员工入职流程推送",
      "targetType": "all",
      "scheduleTime": "2024-01-15T09:00:00.000Z",
      "recurrence": "once",
      "status": "pending",
      "createdAt": "2024-01-10T10:00:00.000Z"
    }
  ]
}
```

### 创建推送任务
```
POST /api/flowhub/tasks
Content-Type: application/json
```

请求体:
```json
{
  "name": "任务名称",
  "targetType": "all | department | custom",
  "targetDepartment": "部门名称（可选）",
  "targetUsers": ["员工ID数组（可选）"],
  "scheduleTime": "2024-01-15T09:00:00",
  "recurrence": "once | daily | weekly | monthly"
}
```

响应:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "任务名称",
    "targetType": "all",
    "scheduleTime": "2024-01-15T09:00:00.000Z",
    "recurrence": "once",
    "status": "pending",
    "createdAt": "2024-01-10T10:00:00.000Z"
  }
}
```

### 删除任务
```
DELETE /api/flowhub/tasks/:id
```

### 手动触发任务
```
POST /api/flowhub/tasks/:id/trigger
```

## 系统状态

### 获取飞书连接状态
```
GET /api/flowhub/status
```

响应:
```json
{
  "success": true,
  "data": {
    "connected": true,
    "lastConnected": "2024-01-10T10:00:00.000Z",
    "reconnectAttempts": 0
  }
}
```