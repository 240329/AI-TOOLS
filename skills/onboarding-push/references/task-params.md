# Task Parameters

创建推送任务的参数详细说明。

## 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| name | string | 是 | 任务名称，建议简洁明了 |
| targetType | string | 否 | 目标类型：`all` / `department` / `custom`，默认 `all` |
| targetDepartment | string | 否 | 目标部门，当 targetType 为 `department` 时必填 |
| targetUsers | string[] | 否 | 目标员工ID数组，当 targetType 为 `custom` 时必填 |
| scheduleTime | string | 是 | 发送时间，ISO 8601 格式 |
| recurrence | string | 否 | 重复策略：`once` / `daily` / `weekly` / `monthly`，默认 `once` |

## targetType 说明

### all（全部员工）
推送给数据库中所有员工。

示例：
```json
{
  "name": "全员通知",
  "targetType": "all",
  "scheduleTime": "2024-01-15T09:00:00",
  "recurrence": "once"
}
```

### department（指定部门）
推送给指定部门的员工。

示例：
```json
{
  "name": "IT部门入职流程推送",
  "targetType": "department",
  "targetDepartment": "信息技术部",
  "scheduleTime": "2024-01-15T09:00:00",
  "recurrence": "once"
}
```

### custom（指定员工）
推送给选定的员工，需要先查询员工ID。

示例：
```json
{
  "name": "特定员工推送",
  "targetType": "custom",
  "targetUsers": ["uuid1", "uuid2"],
  "scheduleTime": "2024-01-15T09:00:00",
  "recurrence": "once"
}
```

## recurrence 说明

### once（一次性）
任务执行一次后自动结束。

### daily（每天）
每天执行一次，适用于持续性通知。

### weekly（每周）
每周执行一次，适用于周报类通知。

### monthly（每月）
每月执行一次，适用于月度提醒。

## 时间格式

支持的格式：
- ISO 8601: `2024-01-15T09:00:00`
- 带时区: `2024-01-15T09:00:00+08:00`

从自然语言转换：
- "今天下午3点" → `2024-01-15T15:00:00`
- "明天上午9点" → `2024-01-16T09:00:00`
- "下周一上午10点" → 根据当前日期计算

## 任务状态

| 状态 | 说明 |
|------|------|
| pending | 待执行 |
| running | 执行中 |
| completed | 已完成 |
| cancelled | 已取消 |

## 执行结果

任务执行完成后，结果会保存在任务对象中：
```json
{
  "id": "uuid",
  "name": "任务名称",
  "status": "completed",
  "result": {
    "success": 45,
    "total": 50
  },
  "completedAt": "2024-01-15T09:01:00.000Z"
}
```

`result.success` 表示成功发送的消息数量，`result.total` 表示总目标人数。
