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

function getIPAddress() {
    const interfaces = require('os').networkInterfaces();
    for (let devName in interfaces) {
        let iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            let alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return 'localhost';
}