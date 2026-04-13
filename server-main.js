const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static(__dirname));
app.use('/apps', express.static(path.join(__dirname, 'apps')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
    console.log('========================================');
    console.log('  🎯 MI HUB 主入口已启动');
    console.log('========================================');
    console.log(`  地址: http://localhost:${PORT}`);
    console.log('');
    console.log('  子应用入口:');
    console.log('    http://localhost:3001 - FlowHub');
    console.log('    http://localhost:3002 - V-GEN');
    console.log('    http://localhost:3003 - Resume AI');
    console.log('    http://localhost:3004 - Visionary');
    console.log('========================================\n');
});