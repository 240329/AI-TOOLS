const { v4: uuidv4 } = require('uuid');
const { query } = require('../services/database');

async function getEmployeesFromDB() {
  try {
    const [rows] = await query('SELECT * FROM flowhub_employees ORDER BY created_at DESC');
    return rows;
  } catch (err) {
    console.error('获取员工失败:', err.message);
    return [];
  }
}

async function getEmployeeById(id) {
  try {
    const [rows] = await query('SELECT * FROM flowhub_employees WHERE id = ?', [id]);
    return rows[0] || null;
  } catch (err) {
    console.error('获取员工失败:', err.message);
    return null;
  }
}

async function saveEmployeesToDB(flowhub_employees) {
  if (flowhub_employees.length === 0) return true;

  const chunkSize = 500;
  try {
    for (let i = 0; i < flowhub_employees.length; i += chunkSize) {
      const chunk = flowhub_employees.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const values = chunk.flatMap(emp => [
        emp.id, emp.name, emp.email, emp.hireDate, emp.department, emp.position
      ]);

      await query(
        `INSERT INTO flowhub_employees (id, name, email, hire_date, department, position) 
         VALUES ${placeholders} 
         ON DUPLICATE KEY UPDATE 
         name=VALUES(name), email=VALUES(email), hire_date=VALUES(hire_date), department=VALUES(department), position=VALUES(position)`,
        values
      );
    }
    return true;
  } catch (err) {
    console.error('保存员工失败:', err.message);
    return false;
  }
}

async function deleteEmployeeFromDB(id) {
  try {
    await query('DELETE FROM flowhub_employees WHERE id = ?', [id]);
    return true;
  } catch (err) {
    console.error('删除员工失败:', err.message);
    return false;
  }
}

async function getFlowsFromDB() {
  try {
    const [rows] = await query('SELECT * FROM flowhub_flows ORDER BY id');
    return rows;
  } catch (err) {
    console.error('获取流程失败:', err.message);
    return [];
  }
}

async function saveFlowsToDB(flowhub_flows) {
  if (flowhub_flows.length === 0) return true;

  const chunkSize = 500;
  try {
    for (let i = 0; i < flowhub_flows.length; i += chunkSize) {
      const chunk = flowhub_flows.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const values = chunk.flatMap(flow => [
        flow.id, flow.name, flow.positions || '', flow.url, flow.category || ''
      ]);

      await query(
        `INSERT INTO flowhub_flows (id, name, positions, url, category) 
         VALUES ${placeholders} 
         ON DUPLICATE KEY UPDATE 
         name=VALUES(name), positions=VALUES(positions), url=VALUES(url), category=VALUES(category)`,
        values
      );
    }
    return true;
  } catch (err) {
    console.error('保存流程失败:', err.message);
    return false;
  }
}

async function deleteFlowFromDB(id) {
  try {
    await query('DELETE FROM flowhub_flows WHERE id = ?', [id]);
    return true;
  } catch (err) {
    console.error('删除流程失败:', err.message);
    return false;
  }
}

function matchFlowsByPosition(position, allFlows) {
  if (!position) return [];
  const posLower = position.toLowerCase();

  return allFlows.filter(flow => {
    if (!flow.positions || flow.positions.trim() === '') return false;
    const keywords = flow.positions.split(',').map(k => k.trim().toLowerCase());

    const universalKeywords = ['所有', '全员', '通用', 'all', 'everyone'];
    const isUniversal = keywords.some(k => universalKeywords.includes(k));
    if (isUniversal) return true;

    return keywords.some(keyword => {
      if (!keyword) return false;
      return posLower.includes(keyword) || keyword.includes(posLower);
    });
  });
}

module.exports = {
  getEmployeesFromDB,
  getEmployeeById,
  saveEmployeesToDB,
  deleteEmployeeFromDB,
  getFlowsFromDB,
  saveFlowsToDB,
  deleteFlowFromDB,
  matchFlowsByPosition
};