# MI HUB - AI Tools 多应用管理平台

追觅科技个护 BG 内部 AI 工具平台，统一入口管理多个独立子应用。

## 应用一览

| 应用 | 端口 | 说明 |
|------|------|------|
| MI HUB 主入口 | 3000 | 导航中枢（`server-main.js`），卡片式跳转子应用 |
| FlowHub | 3001 | 个护 BG 流程小助手：HR 入职流程管理 + 飞书定时推送 |
| V-GEN Studio | 3002 | AI 视频/图片生成（对接 PAI 平台 API，含图像编辑） |
| Resume AI | 3003 | 简历管理：上传解析、候选人分析、分类 |
| Visionary | 3004 | 创意视觉：文案/海报生成、项目与素材管理 |

## 技术栈

Node.js >= 16、Express 4、MySQL（单库 `flowhub`，各应用独立 `flowhub_*` 表）、
@larksuiteoapi/node-sdk（飞书）、node-schedule（定时任务）、multer + xlsx（上传解析）、
express-rate-limit（限流）、winston（日志，FlowHub 用）

## 快速开始

```bash
npm install        # 安装依赖
npm start          # 主入口 :3000
npm run flowhub    # FlowHub :3001
npm run vgen       # V-GEN :3002
npm run resume     # Resume AI :3003
npm run visionary  # Visionary :3004
npm run start:all  # 同时启动全部 5 个服务
```

**前置要求：**

1. MySQL 服务运行，且存在 `flowhub` 数据库（各应用启动时自动建表，无需手工建表）
2. 每个子应用目录下有独立 `config.js`（含数据库连接、飞书 appId/appSecret、PAI API Key 等），参考各自代码中 `config` 对象的字段结构创建
3. 根目录 `.env` 可按需存放环境变量（各应用不强制依赖）

## 局域网访问

所有服务已监听 `0.0.0.0`，同局域网同事直接访问：

```
http://<你的局域网IP>:3001   # FlowHub
http://<你的局域网IP>:3000   # 主入口导航
```

- 启动日志会打印本机局域网 IP
- 需确保 Windows 防火墙放行 Node.js 入站（或对应端口）
- 当前前端 API 全部为同源相对路径，无跨域问题
- 启动时若提示优雅关闭提示为正常（server-main.js 退出钩子）

## 架构概览

```
AI TOOLS/
├── server-main.js          # 主入口: 静态导航页 + 子应用静态代理
├── index.html              # 导航落地页（工具卡片）
├── shared/config.js        # 共享配置
├── apps/
│   ├── flowhub/            # 模块化分层: server + src/{models,services,utils}
│   │   └── src/
│   │       ├── models/     # data.js(员工/流程CRUD+岗位匹配), task.js(调度执行)
│   │       ├── services/   # database.js(MySQL+建表迁移), feishu.js(飞书+卡片)
│   │       └── utils/      # validators.js, logger.js(winston)
│   ├── vgen/               # server.js + lib/pai-api.js(PAI封装)
│   ├── resume-ai/          # 单体 server.js
│   └── visionary/          # 单体 server.js
```

详细分析见 `.planning/codebase/`。

## FlowHub 业务模型

- **员工库**：Excel 导入（按 email upsert 保持 ID 稳定），字段：姓名/邮箱/入职日期/部门/岗位
- **流程库**：Excel 导入，`P-XXX` 自动编号，字段：名称/适配岗位关键词(逗号分隔)/云文档链接/分类(支撑类/使能类/运营类)
- **推送任务**：按全部/部门/指定员工过滤，一次性或每天/每周/每月循环；执行时按岗位模糊匹配流程，组装飞书卡片以邮箱为 receive_id 发送
- 一次性任务推送成功后员工自动从名单删除；循环任务自动以新 ID 排下次
- 服务重启自动恢复 pending 任务（过期立即执行），30 天自动清理历史记录

## 安全注意

- `config.js`、`.env` 含敏感凭证，**严禁提交到 git**
- 各应用 API 当前无鉴权，仅适合可信内网使用
- 见 `.planning/codebase/CONCERNS.md` 了解已知风险

## 提交规范

```
<type>: <description>
type: feat / fix / update / docs / style
```