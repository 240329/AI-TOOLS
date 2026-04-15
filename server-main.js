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

app.listen(PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log('  🎯 MI HUB 主入口已启动');
    console.log('========================================');
    console.log(`  地址: http://${getIPAddress()}:${PORT}`);
    console.log('');
    console.log('  子应用入口:');
    console.log(`    http://${getIPAddress()}:3001 - FlowHub`);
    console.log(`    http://${getIPAddress()}:3002 - V-GEN`);
    console.log(`    http://${getIPAddress()}:3003 - Resume AI`);
    console.log(`    http://${getIPAddress()}:3004 - Visionary`);
    console.log('========================================\n');
});