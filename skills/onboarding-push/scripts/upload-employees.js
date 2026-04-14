const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const http = require('http');

const args = process.argv.slice(2);
const dataStartIdx = args.indexOf('--data');
if (dataStartIdx === -1) {
  console.error('用法: node upload-employees.js --data "姓名|邮箱|入职日期|部门|岗位" ...');
  console.error('示例: node upload-employees.js --data "张三|zhangsan@dreame.tech|2026/04/01|研发|前端" --data "李四|lisi@dreame.tech|2026/04/02|测试|测试"');
  process.exit(1);
}

const rows = args.slice(dataStartIdx + 1).filter(a => !a.startsWith('--'));
const employees = rows.map(row => {
  const [name, email, hireDate, department, position] = row.split('|');
  return [name, email, hireDate, department, position];
});

const data = [['姓名', '邮箱', '入职日期', '部门', '岗位'], ...employees];

const ws = XLSX.utils.aoa_to_sheet(data);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '员工');
XLSX.writeFile(wb, 'employees.xlsx');

const boundary = '----FormBoundary' + Date.now();
const fileData = fs.readFileSync('employees.xlsx');

const header = `--${boundary}\r\n` +
  `Content-Disposition: form-data; name="file"; filename="employees.xlsx"\r\n` +
  `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`;

const body = Buffer.concat([
  Buffer.from(header),
  fileData,
  Buffer.from(`\r\n--${boundary}--`)
]);

const options = {
  hostname: '127.0.0.1',
  port: 3001,
  path: '/api/flowhub/flowhub_employees/upload',
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': Buffer.byteLength(body)
  }
};

const req = http.request(options, (res) => {
  let responseBody = '';
  res.on('data', (chunk) => responseBody += chunk);
  res.on('end', () => {
    const result = JSON.parse(responseBody);
    console.log(result.message);
    if (result.data) {
      console.log(`成功: ${result.data.added || result.data.total}, 总数: ${result.data.total}`);
    }
    fs.unlinkSync('employees.xlsx');
  });
});

req.on('error', (e) => console.error('Error:', e.message));
req.write(body);
req.end();