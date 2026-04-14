const http = require('http');

const args = process.argv.slice(2);
const type = args[0] || 'employees';

const paths = {
  employees: '/api/flowhub/flowhub_employees',
  flows: '/api/flowhub/flowhub_flows',
  tasks: '/api/flowhub/tasks',
  status: '/api/flowhub/status',
  departments: '/api/flowhub/departments'
};

if (!paths[type]) {
  console.error(`用法: node query.js [employees|flows|tasks|status|departments]`);
  console.error(`示例: node query.js employees`);
  process.exit(1);
}

const options = {
  hostname: '127.0.0.1',
  port: 3001,
  path: paths[type],
  method: 'GET'
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    try {
      const result = JSON.parse(body);
      if (result.success) {
        const data = result.data || result;
        if (Array.isArray(data)) {
          console.log(`共 ${data.length} 条记录:`);
          data.forEach((item, i) => {
            if (type === 'employees') {
              console.log(`  ${i + 1}. ${item.name} | ${item.email} | ${item.department} | ${item.position}`);
            } else if (type === 'flows') {
              console.log(`  ${i + 1}. ${item.name} | ${item.positions} | ${item.url}`);
            } else if (type === 'tasks') {
              console.log(`  ${i + 1}. ${item.name} | ${item.status} | ${item.schedule_time} | ${item.recurrence}`);
            } else {
              console.log(`  ${i + 1}.`, item);
            }
          });
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
      } else {
        console.log(body);
      }
    } catch (e) {
      console.log(body);
    }
  });
});

req.on('error', (e) => console.error('Error:', e.message));
req.end();