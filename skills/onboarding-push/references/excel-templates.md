# Excel Templates

员工和流程导入的 Excel 模板格式说明。

## 员工导入模板

### 文件要求
- 格式: `.xlsx` 或 `.xls` 或 `.csv`
- 编码: UTF-8
- 首行必须为表头

### 列格式

| 列号 | 列名 | 必填 | 说明 | 示例 |
|------|------|------|------|------|
| A | 姓名 | 是 | 员工姓名 | 张三 |
| B | 邮箱 | 否 | 飞书邮箱 | zhangsan@company.com |
| C | 入职日期 | 否 | 格式YYYY-MM-DD | 2024-01-15 |
| D | 部门 | 否 | 部门名称 | 信息技术部 |
| E | 岗位 | 否 | 岗位名称 | SAP开发 |

### 示例数据

| 姓名 | 邮箱 | 入职日期 | 部门 | 岗位 |
|------|------|----------|------|------|
| 张三 | zhangsan@dreame.com | 2024-01-15 | 信息技术部 | SAP开发 |
| 李四 | lisi@dreame.com | 2024-02-01 | 产品中心 | 产品经理 |
| 王五 | wangwu@dreame.com | 2024-02-10 | 研发中心 | 前端开发 |

### 注意事项
- 姓名列必填，其他列可选
- 邮箱用于飞书消息推送，建议填写
- 岗位用于匹配入职流程，必须准确填写

---

## 流程导入模板

### 文件要求
- 格式: `.xlsx` 或 `.xls` 或 `.csv`
- 编码: UTF-8
- 首行必须为表头

### 列格式

| 列号 | 列名 | 必填 | 说明 | 示例 |
|------|------|------|------|------|
| A | 流程名称 | 是 | 流程文档标题 | 新员工入职指引 |
| B | 适配岗位 | 是 | 适用岗位关键词，逗号分隔 | 新员工,IT |
| C | 飞书链接 | 是 | 飞书文档URL | https://feishu.cn/wiki/xxx |

### 示例数据

| 流程名称 | 适配岗位 | 飞书链接 |
|----------|----------|----------|
| 新员工入职指引 | 新员工 | https://test.feishu.cn/wiki/It8JwkPRBiUKC8keviycSo9on6g |
| 研发中心权限开通规范 | 研发,SAP,测试,前端,后端 | https://test.feishu.cn/wiki/NzKtweCuoitS2lkhRkXcDURTnCd |
| 企业文化建设指南 | 全体员工 | https://test.feishu.cn/wiki/LPyAwqfoJiotDdkejtMcKKkNnfg |
| 考勤与办公设备领用 | 新员工 | https://test.feishu.cn/wiki/LPyAwqfoJiotDdkejtMcKKkNnfg |
| 系统账号激活流程 | 新员工,IT | https://test.feishu.cn/wiki/LPyAwqfoJiotDdkejtMcKKkNnfg |

### 岗位匹配规则
- 多个岗位用逗号分隔
- 系统使用模糊匹配：员工岗位包含关键词或关键词包含员工岗位
- 建议使用常见岗位名称：研发、SAP、测试、前端、后端、产品、运营、设计、HR、财务等

---

## 下载模板

可以使用 `assets/employee-template.xlsx` 和 `assets/flow-template.xlsx` 作为导入模板。
