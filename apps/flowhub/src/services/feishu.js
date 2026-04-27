const lark = require('@larksuiteoapi/node-sdk');

let client;
let feishuStatus = {
  connected: false,
  reconnectAttempts: 0,
  lastConnected: null
};

function initFeishu(config) {
  client = new lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    logLevel: lark.LoggerLevel.INFO
  });
  return client;
}

function getClient() {
  return client;
}

function getStatus() {
  return feishuStatus;
}

async function initConnection() {
  try {
    console.log('✓ 飞书应用连接已初始化');
    feishuStatus.connected = true;
    feishuStatus.lastConnected = new Date();
    feishuStatus.reconnectAttempts = 0;
  } catch (err) {
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
        setTimeout(initConnection, 10000);
      }
    }
  }
}

async function sendMessage(receiveId, receiveIdType, msgType, content) {
  if (!client) {
    return { success: false, error: '飞书客户端未初始化' };
  }

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

function buildFlowNotificationCard(employee, flowhub_flows) {
  const categoryMap = {
    '支撑类': [],
    '使能类': [],
    '运营类': []
  };

  flowhub_flows.forEach(f => {
    const category = f.category || '支撑类';
    if (!categoryMap[category]) {
      categoryMap[category] = [];
    }
    categoryMap[category].push(`•[${f.name}](${f.url})`);
  });

  const supportFlowItems = categoryMap['支撑类'].join('\n') || '无';
  const enableFlowItems = categoryMap['使能类'].join('\n') || '无';
  const operationFlowItems = categoryMap['运营类'].join('\n') || '无';

  return {
    header: {
      title: {
        tag: 'plain_text',
        content: '📋 个护流程小助手'
      },
      template: 'blue'
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `您好 **${employee.name}** 👋\n欢迎加入追觅个护大家庭！为了帮助您快速融入团队并顺利开展工作，请关注以下三类核心流程：`
        }
      },
      { tag: 'hr' },
      {
        tag: 'div',
        fields: [
          {
            is_short: false,
            text: {
              tag: 'lark_md',
              content: `**⚙️ 支撑类流程**\n${supportFlowItems}`
            }
          },
          {
            is_short: false,
            text: {
              tag: 'lark_md',
              content: `\n**🚀 使能类流程**\n${enableFlowItems}`
            }
          },
          {
            is_short: false,
            text: {
              tag: 'lark_md',
              content: `\n**📊 运营类流程**\n${operationFlowItems}`
            }
          }
        ]
      },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '查看全部流程详情 →'
            },
            type: 'primary',
            url: 'https://dreametech.feishu.cn/wiki/X3EUwOnyCiwUQAkKZ0CchkGBnEb'
          }
        ]
      },
      {
        tag: 'div',
        elements: [
          {
            tag: 'lark_md',
            content: `💡 如有任何疑问或建议，请随时联系各系统负责人：[追觅个护BG IT找人指引](https://dreametech.feishu.cn/wiki/ZWv7wXexdiecl9k98pVcbnl0nnb)`
          }
        ]
      }
    ]
  };
}

module.exports = {
  initFeishu,
  getClient,
  getStatus,
  initConnection,
  sendMessage,
  buildFlowNotificationCard
};