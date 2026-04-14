const http = require('http');

const args = process.argv.slice(2);

let name, scheduleTime, targetType = 'all', targetDepartment, targetUsers, recurrence = 'once', trigger = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name' && args[i + 1]) name = args[i + 1];
  if (args[i] === '--scheduleTime' && args[i + 1]) scheduleTime = args[i + 1];
  if (args[i] === '--targetType' && args[i + 1]) targetType = args[i + 1];
  if (args[i] === '--targetDepartment' && args[i + 1]) targetDepartment = args[i + 1];
  if (args[i] === '--targetUsers' && args[i + 1]) targetUsers = args[i + 1].split(',');
  if (args[i] === '--recurrence' && args[i + 1]) recurrence = args[i + 1];
  if (args[i] === '--trigger') trigger = true;
}

if (!name || !scheduleTime) {
  console.error('用法: node create-push-task.js --name "任务名" --scheduleTime "2026/04/14 10:50" [--targetType all] [--recurrence once] [--trigger]');
  console.error('示例: node create-push-task.js --name "test" --scheduleTime "2026/04/14 10:50"');
  process.exit(1);
}

const isoTime = new Date(scheduleTime).toISOString();

const taskData = {
  name,
  targetType,
  scheduleTime: isoTime,
  recurrence
};

if (targetType === 'department' && targetDepartment) {
  taskData.targetDepartment = targetDepartment;
}

if (targetType === 'custom' && targetUsers) {
  taskData.targetUsers = targetUsers;
}

const data = JSON.stringify(taskData);

const options = {
  hostname: '127.0.0.1',
  port: 3001,
  path: '/api/flowhub/tasks',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  let responseBody = '';
  res.on('data', (chunk) => responseBody += chunk);
  res.on('end', () => {
    try {
      const result = JSON.parse(responseBody);
      console.log(result.message || JSON.stringify(result));
      if (trigger && result.data && result.data.id) {
        console.log('立即触发任务...');
        const triggerReq = http.request({
          hostname: '127.0.0.1',
          port: 3001,
          path: `/api/flowhub/tasks/${result.data.id}/trigger`,
          method: 'POST'
        }, (triggerRes) => {
          let triggerBody = '';
          triggerRes.on('data', (chunk) => triggerBody += chunk);
          triggerRes.on('end', () => {
            try {
              const triggerResult = JSON.parse(triggerBody);
              console.log('触发结果:', triggerResult.message || triggerResult);
            } catch (e) {
              console.log(triggerBody);
            }
          });
        });
        triggerReq.on('error', (e) => console.error('Error:', e.message));
        triggerReq.end();
      }
    } catch (e) {
      console.log(responseBody);
    }
  });
});

req.on('error', (e) => console.error('Error:', e.message));
req.write(data);
req.end();