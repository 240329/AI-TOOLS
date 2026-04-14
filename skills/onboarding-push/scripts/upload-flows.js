const XLSX = require('xlsx');
const fs = require('fs');
const http = require('http');

const args = process.argv.slice(2);
const dataStartIdx = args.indexOf('--data');
if (dataStartIdx === -1) {
  console.error('用法: node upload-flows.js --data "流程名称|适配岗位|飞书文档链接" ...');
  console.error('示例: node upload-flows.js --data "合同申请|SAP,OA|https://dreametech.feishu.cn/wiki/xxx"');
  process.exit(1);
}

const rows = args.slice(dataStartIdx + 1).filter(a => !a.startsWith('--'));
const flows = rows.map(row => {
  const parts = row.split('|');
  return parts;
});

const data = [['流程名称', '适配岗位', '飞书文档链接'], ...flows];

const ws = XLSX.utils.aoa_to_sheet(data);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '流程');
XLSX.writeFile(wb, 'flows.xlsx');

const boundary = '----FormBoundary' + Date.now();
const fileData = fs.readFileSync('flows.xlsx');

const header = `--${boundary}\r\n` +
  `Content-Disposition: form-data; name="file"; filename="flows.xlsx"\r\n` +
  `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`;

const body = Buffer.concat([
  Buffer.from(header),
  fileData,
  Buffer.from(`\r\n--${boundary}--`)
]);

const options = {
  hostname: '127.0.0.1',
  port: 3001,
  path: '/api/flowhub/flowhub_flows/upload',
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
    console.log('Response:', JSON.stringify(result, null, 2));
    console.log(result.message);
    if (result.data) {
      console.log(`新增: ${result.data.added}, 总数: ${result.data.total}`);
      if (result.data.parsed) {
        console.log('解析结果:');
        result.data.parsed.forEach(f => console.log(`  - ${f.id}: ${f.name} | ${f.positions} | ${f.url}`));
      }
    }
    fs.unlinkSync('flows.xlsx');
  });
});

req.on('error', (e) => console.error('Error:', e.message));
req.write(body);
req.end();