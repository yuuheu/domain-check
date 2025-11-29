// ==================== 配置区域 ====================
// 默认配置变量
let sitename = "续期管家"; //变量名SITENAME，自定义站点名称，默认为"续期管家"
let domains = ""; //KV空间创建SECRET_KV后，新增一组kv对，填入域名信息json格式，必须设置的变量
let tgid = ""; //变量名TGID，填入TG机器人ID，不需要提醒则不填
let tgtoken = ""; //变量名TGTOKEN，填入TG的TOKEN，不需要提醒则不填
let wxPushToken = ""; //变量名WX_PUSH_TOKEN，填入微信推送TOKEN，不需要提醒则不填
let days = 7; //变量名DAYS，提前几天发送提醒，默认为7天，必须为大于0的整数

// 背景图片API配置
const bgImageAPIs = {
  bing: 'https://bing.img.run/1920x1080.php',
  unsplash: 'https://source.unsplash.com/random/1920x1080',
  picsum: 'https://picsum.photos/1920/1080',
  bingFallback: 'https://api.dujin.org/bing/1920.php'
};

// 推送API配置
const pushAPIs = {
  wx: 'https://push.corex.ggff.net/wxsend'
};

// ==================== 推送功能区域 ====================
/**
 * 发送Telegram消息
 * @param {string} message - 消息内容
 * @param {string} tgid - Telegram聊天ID
 * @param {string} tgtoken - Telegram Bot Token
 */
async function sendtgMessage(message, tgid, tgtoken) {
  if (!tgid || !tgtoken) return;
  const url = `https://api.telegram.org/bot${tgtoken}/sendMessage`;
  const params = {
    chat_id: tgid,
    text: message,
  };
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch (error) {
    console.error('Telegram 消息推送失败:', error);
  }
}

/**
 * 发送微信推送消息
 * @param {string} title - 消息标题
 * @param {string} content - 消息内容
 * @param {string} token - 微信推送Token
 */
async function sendWxMessage(title, content, token) {
  if (!token) return;
  try {
    await fetch(pushAPIs.wx, {
      method: 'POST',
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: title,
        content: content
      }),
    });
  } catch (error) {
    console.error('微信推送失败:', error);
  }
}

/**
 * 统一推送接口，同时发送TG和微信推送
 * @param {string} title - 消息标题
 * @param {string} message - 消息内容（TG格式，带Markdown）
 * @param {string} plainMessage - 纯文本消息（微信推送用）
 * @param {object} config - 推送配置 {tgid, tgtoken, wxPushToken}
 */
async function sendNotifications(title, message, plainMessage, config) {
  const { tgid, tgtoken, wxPushToken } = config;
  
  // 并行发送推送，提高效率
  await Promise.all([
    sendtgMessage(message, tgid, tgtoken),
    sendWxMessage(title, plainMessage || message, wxPushToken)
  ]);
}

// ==================== 定时任务区域 ====================
/**
 * 定时检查域名到期时间并发送消息
 * @param {object} event - 定时事件
 * @param {object} env - 环境变量
 */
async function handleScheduled(event, env) {
  // 从环境变量获取配置
  tgid = env.TGID || tgid;
  tgtoken = env.TGTOKEN || tgtoken;
  wxPushToken = env.WX_PUSH_TOKEN || wxPushToken;
  days = Number(env.DAYS || days);

  // 获取域名列表
  try {
    const domainsKV = await env.SECRET_KV.get('domains');
    domains = domainsKV ? JSON.parse(domainsKV) : [];
    if (!Array.isArray(domains)) throw new Error('JSON 数据格式不正确');
  } catch (error) {
    const errorMsg = "从Cloudflare KV中获取的 JSON 数据格式不正确";
    await sendNotifications("域名监控错误", errorMsg, errorMsg, {
      tgid, tgtoken, wxPushToken
    });
    return;
  }

  try {
    const today = new Date().toISOString().split('T')[0]; // 当前日期字符串
    const escapeMD = (str) => str.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');

    for (const domain of domains) {
      const expirationDate = new Date(domain.expirationDate);
      const daysRemaining = Math.ceil((expirationDate - new Date()) / (1000 * 60 * 60 * 24));

      if (daysRemaining > 0 && daysRemaining <= days) {
        // 生成TG格式消息（带Markdown转义）
        const tgMessage = `
        【域名过期提醒】
        
        ⚠️ 域名:  ${escapeMD(domain.domain)}
        ⏰ 剩余时间:  ${daysRemaining}天（到期时间：${domain.expirationDate}）
        🏷️ 注册服务商:  ${escapeMD(domain.system)}
        🔗 注册地址:  ${domain.systemURL}
        ☑  续期面板：https://domain.yhpp.pp.ua/
          `;
        
        // 生成纯文本消息（用于微信推送）
        const plainMessage = `【域名过期提醒】

⚠️ 域名: ${domain.domain}
⏰ 剩余时间: ${daysRemaining}天（到期时间：${domain.expirationDate}）
🏷️ 注册服务商: ${domain.system}
🔗 注册地址: ${domain.systemURL}
☑ 续期面板：https://domain.yhpp.pp.ua/`;

        const lastSentDate = await env.DOMAINS_TG_KV.get(domain.domain);
        
        if (lastSentDate !== today) {
          // 使用统一推送接口发送通知
          await sendNotifications(
            "域名过期提醒",
            tgMessage,
            plainMessage,
            { tgid, tgtoken, wxPushToken }
          );
          await env.DOMAINS_TG_KV.put(domain.domain, today);
        }
      }
    }

    console.log("域名检查完成");
  } catch (error) {
    console.error("域名检查错误:", error);
  }
}

// ==================== KV存储操作区域 ====================
/**
 * 保存域名信息到KV
 * @param {object} env - 环境变量
 * @param {object} domainInfo - 域名信息对象
 */
async function saveDomainToKV(env, domainInfo) {
  const domainsKV = env.SECRET_KV;
  const domains = await domainsKV.get('domains') || '[]';
  const domainsArray = JSON.parse(domains);

  domainsArray.push(domainInfo);
  await domainsKV.put('domains', JSON.stringify(domainsArray));
}

/**
 * 从KV删除域名信息
 * @param {object} env - 环境变量
 * @param {string} domainName - 要删除的域名
 */
async function deleteDomainFromKV(env, domainName) {
  const domainsKV = env.SECRET_KV;
  const domains = await domainsKV.get('domains') || '[]';
  const domainsArray = JSON.parse(domains);

  const updatedDomainsArray = domainsArray.filter(domain => domain.domain !== domainName);
  await domainsKV.put('domains', JSON.stringify(updatedDomainsArray));
}

/**
 * 编辑KV中的域名信息
 * @param {object} env - 环境变量
 * @param {object} updatedDomainInfo - 更新后的域名信息对象
 */
async function editDomainInKV(env, updatedDomainInfo) {
  const domainsKV = env.SECRET_KV;
  const domains = await domainsKV.get('domains') || '[]';
  const domainsArray = JSON.parse(domains);

  const index = domainsArray.findIndex(domain => domain.domain === updatedDomainInfo.domain);
  if (index !== -1) {
    domainsArray[index] = updatedDomainInfo;
    await domainsKV.put('domains', JSON.stringify(domainsArray));
  } else {
    throw new Error('Domain not found');
  }
}

// ==================== 页面生成区域 ====================
/**
 * 生成密码验证页面
 * @returns {string} HTML页面内容
 */
async function generatePasswordPage() {
  const siteIcon = 'https://pan.811520.xyz/icon/domain.png';
  const bgimgURL = 'https://www.dmoe.cc/random.php'; // 使用必应每日图片
  
  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>域名监控系统</title>
      <link rel="icon" href="${siteIcon}" type="image/png">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          margin: 0;
          padding: 0;
          background-image: url('${bgimgURL}');
          color: #333;
          display: flex;
          flex-direction: column;
          min-height: 100vh;
        }
        .password-container {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          flex-direction: column;
        }
        .password-input {
          background-color: rgba(255, 255, 255, 0.7);
          border: none;
          border-radius: 10px;
          padding: 10px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          margin-bottom: 10px;
        }
        .login-title {
          color: white;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
          margin-bottom: 20px;
        }
        .login-button {
          background-color: #3498db;
          color: white;
          border: none;
          border-radius: 5px;
          padding: 10px 20px;
          cursor: pointer;
          margin-top: 10px;
          font-weight: bold;
        }
        .login-button:hover {
          background-color: #2980b9;
        }
      </style>
    </head>
    <body>
      <div class="password-container">
        <h2 class="login-title">YUUHEの 续小秘</h2>
        <input type="password" id="password-input" class="password-input" placeholder="请输入密码">
        <button id="login-button" class="login-button">登录</button>
      </div>
      <script>
        document.getElementById('login-button').addEventListener('click', verifyPassword);
        document.getElementById('password-input').addEventListener('keypress', function(event) {
          if (event.key === 'Enter') {
            verifyPassword();
          }
        });
        
        async function verifyPassword() {
          const password = document.getElementById('password-input').value;
          
          try {
            const response = await fetch('/verify-password', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password })
            });
            
            const result = await response.json();
            
            if (result.success) {
              // 密码正确，使用服务器返回的令牌重定向到域名列表页面
              window.location.href = '/domains?token=' + encodeURIComponent(result.token);
            } else {
              alert('密码错误');
            }
          } catch (error) {
            alert('验证失败，请重试');
            console.error('验证失败:', error);
          }
        }
      </script>
    </body>
    </html>
  `;
}

/**
 * 生成域名列表页面
 * @param {Array} domains - 域名数组
 * @param {string} SITENAME - 站点名称
 * @returns {string} HTML页面内容
 */
async function generateDomainListPage(domains, SITENAME) {
  const siteIcon = 'https://pan.811520.xyz/icon/domain.png';
  const bgimgURL = bgImageAPIs.bing; // 使用必应每日图片
  const rows = await Promise.all(domains.map(async info => {
    const registrationDate = new Date(info.registrationDate);
    const expirationDate = new Date(info.expirationDate);
    const today = new Date();
    const totalDays = (expirationDate - registrationDate) / (1000 * 60 * 60 * 24);
    const daysElapsed = (today - registrationDate) / (1000 * 60 * 60 * 24);
    const progressPercentage = Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100));
    const daysRemaining = Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));
    const isExpired = today > expirationDate;
    const statusColor = isExpired ? '#e74c3c' : '#2ecc71';
    const statusText = isExpired ? '已过期' : '正常';

    // 获取优先级样式
    const priority = info.priority || 'medium';
    const priorityClass = `priority-${priority}`;
    const priorityText = {
      high: '域名',
      medium: 'VPS',
      low: '其他'
    }[priority];

    return `
      <tr class="domain-row" data-domain="${info.domain}" data-priority="${priority}">
        <td><span class="status-dot" style="background-color: ${statusColor};" title="${statusText}"></span></td>
        <td>
          ${info.domain}
          <span class="priority-tag ${priorityClass}">${priorityText}</span>
        </td>
        <td><a href="${info.systemURL}" target="_blank">${info.system}</a></td>
        <td>${info.registrationDate}</td>
        <td>${info.expirationDate}</td>
        <td>${isExpired ? '已过期' : daysRemaining + ' 天'}</td>
        <td>
          <div class="progress-bar">
            <div class="progress" style="width: ${progressPercentage}%;"></div>
          </div>
        </td>
        <td>
          <button onclick="editDomain('${info.domain}', '${info.registrationDate}', '${info.expirationDate}', '${info.system}', '${info.systemURL}', '${priority}')" class="edit-btn">编辑</button>
          <button onclick="deleteDomain('${info.domain}')" class="delete-btn">删除</button>
        </td>
      </tr>
    `;
  }));

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${SITENAME}</title>
      <link rel="icon" href="${siteIcon}" type="image/png">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          margin: 0;
          padding: 0;
          background-image: url('${bgimgURL}');
          color: #333;
          display: flex;
          flex-direction: column;
          min-height: 100vh;
        }
        .container {
          flex: 1;
          width: 95%;
          max-width: 1200px;
          margin: 20px auto;
          background-color: rgba(255, 255, 255, 0.7);
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
          border-radius: 5px;
          overflow: hidden;
        }
        h1 {
          background-color: #3498db;
          color: #fff;
          padding: 20px;
          margin: 0;
        }
        .table-container {
          width: 100%;
          overflow-x: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          white-space: nowrap;
          table-layout: auto;
        }
        th, td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid #ddd;
          white-space: nowrap;
        }
        th {
          background-color: rgba(242, 242, 242, 0.7);
          font-weight: bold;
        }
        .status-dot {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background-color: #2ecc71;
        }
        .progress-bar {
          width: 100%;
          min-width: 100px;
          background-color: #e0e0e0;
          border-radius: 4px;
          overflow: hidden;
        }
        .progress {
          height: 20px;
          background-color: #3498db;
        }
        .footer {
          text-align: center;
          padding: 0;
          background-color: #3498db;
          font-size: 0.9rem;
          color: #fff;
          margin-top: auto;
        }
        .footer a {
          color: white;
          text-decoration: none;
          margin-left: 10px;
          transition: color 0.3s ease;
        }
        .footer a:hover {
          color: #f1c40f;
        }
        #add-domain-form {
          padding: 15px;
          background-color: rgba(255, 255, 255, 0.5);
          margin-bottom: 15px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        #add-domain-form input {
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
          flex: 1;
        }
        #add-domain-form button {
          padding: 8px 15px;
          background-color: #3498db;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        #add-domain-form button:hover {
          background-color: #2980b9;
        }
         .edit-btn, .delete-btn {
          padding: 5px 10px;
          margin: 0 5px;
          border: none;
          border-radius: 3px;
          cursor: pointer;
        }
        .edit-btn {
          background-color: #f39c12;
          color: white;
        }
        .edit-btn:hover {
          background-color: #e67e22;
        }
        .delete-btn {
          background-color: #e74c3c;
          color: white;
        }
        .delete-btn:hover {
          background-color: #c0392b;
        }
        
        /* 模态框样式 */
        .modal {
          display: none;
          position: fixed;
          z-index: 1000;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
        }
        .modal-content {
          background-color: white;
          margin: 10% auto;
          padding: 20px;
          border-radius: 5px;
          width: 80%;
          max-width: 500px;
          box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #eee;
          padding-bottom: 10px;
          margin-bottom: 15px;
        }
        .modal-header h3 {
          margin: 0;
        }
        .close-modal {
          font-size: 24px;
          font-weight: bold;
          cursor: pointer;
        }
        .modal-form {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        .modal-form input {
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }
        .modal-form button {
          padding: 10px;
          background-color: #3498db;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          margin-top: 10px;
        }
        .modal-form button:hover {
          background-color: #2980b9;
        }
        
        /* 修改表头样式 */
        th.sortable {
          position: relative;
          padding-right: 20px;
          cursor: pointer;
          user-select: none;
        }
        
        th.sortable::after {
          content: '↕';
          position: absolute;
          right: 5px;
          color: #999;
          font-size: 12px;
        }
        
        th.sortable.asc::after {
          content: '↑';
          color: #3498db;
        }
        
        th.sortable.desc::after {
          content: '↓';
          color: #3498db;
        }
        
        /* 优先级按钮样式 */
        .priority-btn {
          padding: 5px 10px;
          margin: 0 5px;
          border: none;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
          background-color: #3498db;
          color: white;
        }
        
        .priority-btn:hover {
          background-color: #2980b9;
        }
        
        /* 优先级选择弹窗样式 */
        .priority-modal {
          display: none;
          position: fixed;
          z-index: 1000;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
        }
        
        .priority-modal-content {
          background-color: white;
          margin: 15% auto;
          padding: 20px;
          border-radius: 5px;
          width: 300px;
          text-align: center;
        }
        
        .priority-options {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin: 20px 0;
        }
        
        .priority-option {
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.3s;
        }
        
        .priority-option:hover {
          background-color: #f0f0f0;
        }
        
        .priority-option.selected {
          background-color: #3498db;
          color: white;
          border-color: #3498db;
        }
        
        /* 优先级标签样式 */
        .priority-tag {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 3px;
          font-size: 12px;
          margin-left: 8px;
          color: white;
        }
        
        .priority-high {
          background-color: #e74c3c;
        }
        
        .priority-medium {
          background-color: #f39c12;
        }
        
        .priority-low {
          background-color: #95a5a6;
        }
        
        /* 优先级筛选按钮样式 */
        .priority-filter {
          margin: 10px 0;
          display: flex;
          gap: 10px;
        }
        
        .priority-filter button {
          padding: 5px 15px;
          border: none;
          border-radius: 3px;
          cursor: pointer;
          color: white;
          font-size: 14px;
        }
        
        .priority-filter button.active {
          opacity: 1;
        }
        
        .priority-filter button:not(.active) {
          opacity: 0.6;
        }
        
        .filter-high {
          background-color: #e74c3c;
        }
        
        .filter-medium {
          background-color: #f39c12;
        }
        
        .filter-low {
          background-color: #95a5a6;
        }
        
        .filter-all {
          background-color: #3498db;
        }
        
        /* 添加优先级选择框样式 */
        select {
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
          background-color: white;
          cursor: pointer;
        }
        
        select:focus {
          outline: none;
          border-color: #3498db;
        }
        
        /* 修改表单布局 */
        #add-domain-form {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 10px;
          padding: 15px;
          background-color: rgba(255, 255, 255, 0.5);
          margin-bottom: 15px;
        }
        
        .modal-form {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>${SITENAME}</h1>
        <form id="add-domain-form">
          <input type="text" id="domain" placeholder="域名" required>
          <input type="date" id="registrationDate" placeholder="注册日期" required>
          <input type="date" id="expirationDate" placeholder="过期日期" required>
          <input type="text" id="system" placeholder="注册商" required>
          <input type="url" id="systemURL" placeholder="注册商 URL" required>
          <select id="priority" required>
            <option value="high">域名</option>
            <option value="medium">VPS</option>
            <option value="low">其他</option>
          </select>
          <button type="submit">添加域名</button>
        </form>
        
        <!-- 添加优先级筛选按钮 -->
        <div class="priority-filter">
          <button class="filter-all active" onclick="filterByPriority('all')">全部</button>
          <button class="filter-high" onclick="filterByPriority('high')">域名</button>
          <button class="filter-medium" onclick="filterByPriority('medium')">VPS</button>
          <button class="filter-low" onclick="filterByPriority('low')">其他</button>
        </div>
        
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>状态</th>
                <th class="sortable" data-sort="domain">域名</th>
                <th class="sortable" data-sort="system">域名注册商</th>
                <th class="sortable" data-sort="registrationDate">注册时间</th>
                <th class="sortable" data-sort="expirationDate">过期时间</th>
                <th class="sortable" data-sort="daysRemaining">剩余天数</th>
                <th class="sortable" data-sort="priority">优先级</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${rows.join('')}
            </tbody>
          </table>
        </div>
      </div>

      
      <!-- 编辑域名的模态框 -->
      <div id="edit-modal" class="modal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>编辑域名信息</h3>
            <span class="close-modal">&times;</span>
          </div>
          <form id="edit-domain-form" class="modal-form">
            <input type="hidden" id="edit-domain-original">
            <input type="text" id="edit-domain" placeholder="域名" required>
            <input type="date" id="edit-registrationDate" placeholder="注册日期" required>
            <input type="date" id="edit-expirationDate" placeholder="过期日期" required>
            <input type="text" id="edit-system" placeholder="注册商" required>
            <input type="url" id="edit-systemURL" placeholder="注册商 URL" required>
            <select id="edit-priority" required>
              <option value="high">域名</option>
              <option value="medium">VPS</option>
              <option value="low">其他</option>
            </select>
            <button type="submit">保存修改</button>
          </form>
        </div>
      </div>
      
      <!-- 添加优先级修改弹窗 -->
      <div id="priority-modal" class="priority-modal">
        <div class="priority-modal-content">
          <h3>修改优先级</h3>
          <div class="priority-options">
            <div class="priority-option" data-priority="high">域名</div>
            <div class="priority-option" data-priority="medium">VPS</div>
            <div class="priority-option" data-priority="low">其他</div>
          </div>
          <button onclick="savePriority()" class="priority-btn">保存</button>
          <button onclick="closePriorityModal()" style="margin-left: 10px; background-color: #95a5a6;">取消</button>
        </div>
      </div>
      
      <div class="footer">
        <p>
          Copyright © 2025 Yutian81&nbsp;&nbsp;&nbsp;|
          <a href="https://github.com/yutian81/domain-check" target="_blank">GitHub Repository</a>&nbsp;&nbsp;&nbsp;|
          <a href="https://blog.811520.xyz/" target="_blank">青云志博客</a>
        </p>
      </div>
      <script>
        // 删除域名功能
        async function deleteDomain(domain) {
          if (confirm('确认删除该域名信息?')) {
            try {
              const response = await fetch('/delete-domain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain })
              });
              
              if (response.ok) {
                alert('域名信息已删除');
                window.location.reload();
              } else {
                alert('删除失败，请重试');
              }
            } catch (error) {
              alert('删除请求失败: ' + error.message);
            }
          }
        }
        
        // 编辑域名功能
        const editModal = document.getElementById('edit-modal');
        const closeModalBtn = document.querySelector('.close-modal');
        const editForm = document.getElementById('edit-domain-form');
        
        // 关闭模态框
        closeModalBtn.addEventListener('click', function() {
          editModal.style.display = 'none';
        });
        
        // 点击模态框外部关闭
        window.addEventListener('click', function(event) {
          if (event.target === editModal) {
            editModal.style.display = 'none';
          }
        });
        
        // 打开编辑模态框并填充数据
        function editDomain(domain, registrationDate, expirationDate, system, systemURL, priority) {
          document.getElementById('edit-domain-original').value = domain;
          document.getElementById('edit-domain').value = domain;
          document.getElementById('edit-registrationDate').value = registrationDate;
          document.getElementById('edit-expirationDate').value = expirationDate;
          document.getElementById('edit-system').value = system;
          document.getElementById('edit-systemURL').value = systemURL;
          document.getElementById('edit-priority').value = priority;
          
          editModal.style.display = 'block';
        }
        
        // 处理编辑表单提交
        editForm.addEventListener('submit', async function(event) {
          event.preventDefault();
          
          const originalDomain = document.getElementById('edit-domain-original').value;
          const domainInfo = {
            domain: document.getElementById('edit-domain').value,
            registrationDate: document.getElementById('edit-registrationDate').value,
            expirationDate: document.getElementById('edit-expirationDate').value,
            system: document.getElementById('edit-system').value,
            systemURL: document.getElementById('edit-systemURL').value,
            originalDomain: originalDomain,
            priority: document.getElementById('edit-priority').value
          };
          
          try {
            const response = await fetch('/edit-domain', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(domainInfo)
            });
            
            if (response.ok) {
              alert('域名信息已更新');
              editModal.style.display = 'none';
              window.location.reload();
            } else {
              const errorData = await response.json();
              alert('更新失败: ' + (errorData.message || '未知错误'));
            }
          } catch (error) {
            alert('更新请求失败: ' + error.message);
          }
        });
        
        // 处理添加域名表单提交
        const form = document.getElementById('add-domain-form');
        form.addEventListener('submit', async function(event) {
          event.preventDefault();
          const domainInfo = {
            domain: document.getElementById('domain').value,
            registrationDate: document.getElementById('registrationDate').value,
            expirationDate: document.getElementById('expirationDate').value,
            system: document.getElementById('system').value,
            systemURL: document.getElementById('systemURL').value,
            priority: document.getElementById('priority').value
          };
          
          try {
            const response = await fetch('/add-domain', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(domainInfo)
            });
            
            if (response.ok) {
              alert('域名信息已保存');
              window.location.reload();
            } else {
              alert('保存失败，请重试');
            }
          } catch (error) {
            alert('保存请求失败: ' + error.message);
          }
        });

        // 添加优先级修改相关功能
        let currentDomain = null;
        let currentPriority = null;
        
        function changePriority(domain, priority) {
          currentDomain = domain;
          currentPriority = priority;
          
          // 显示弹窗
          const modal = document.getElementById('priority-modal');
          modal.style.display = 'block';
          
          // 设置当前选中的优先级
          document.querySelectorAll('.priority-option').forEach(option => {
            option.classList.remove('selected');
            if (option.dataset.priority === priority) {
              option.classList.add('selected');
            }
          });
        }
        
        function closePriorityModal() {
          document.getElementById('priority-modal').style.display = 'none';
        }
        
        // 为优先级选项添加点击事件
        document.querySelectorAll('.priority-option').forEach(option => {
          option.addEventListener('click', () => {
            document.querySelectorAll('.priority-option').forEach(opt => {
              opt.classList.remove('selected');
            });
            option.classList.add('selected');
            currentPriority = option.dataset.priority;
          });
        });
        
        async function savePriority() {
          if (!currentDomain || !currentPriority) return;
          
          try {
            const response = await fetch('/edit-domain', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                domain: currentDomain,
                originalDomain: currentDomain,
                priority: currentPriority
              })
            });
            
            if (response.ok) {
              // 更新当前行的优先级标签
              const row = document.querySelector('tr[data-domain="' + currentDomain + '"]');
              if (row) {
                row.dataset.priority = currentPriority;
                const priorityTag = row.querySelector('.priority-tag');
                if (priorityTag) {
                  priorityTag.className = 'priority-tag priority-' + currentPriority;
                  priorityTag.textContent = {
                    high: '域名',
                    medium: 'VPS',
                    low: '其他'
                  }[currentPriority];
                }
              }
              alert('优先级已更新');
              window.location.reload();
            } else {
              alert('更新失败，请重试');
            }
          } catch (error) {
            alert('更新请求失败: ' + error.message);
          }
          
          closePriorityModal();
        }
        
        // 点击弹窗外部关闭
        window.addEventListener('click', function(event) {
          const modal = document.getElementById('priority-modal');
          if (event.target === modal) {
            closePriorityModal();
          }
        });

        // 添加优先级筛选功能
        function filterByPriority(priority) {
          // 更新按钮状态
          document.querySelectorAll('.priority-filter button').forEach(btn => {
            btn.classList.remove('active');
          });
          document.querySelector('.filter-' + priority).classList.add('active');
          
          // 筛选表格行
          const rows = document.querySelectorAll('.domain-row');
          rows.forEach(row => {
            if (priority === 'all' || row.dataset.priority === priority) {
              row.style.display = '';
            } else {
              row.style.display = 'none';
            }
          });
        }

        // 添加排序功能
        let currentSort = {
          column: 'priority', // 默认按优先级排序
          direction: 'asc'
        };
        
        // 初始化排序
        document.addEventListener('DOMContentLoaded', function() {
          // 为所有可排序的表头添加点击事件
          document.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
              const column = th.dataset.sort;
              sortTable(column);
            });
          });
          
          // 默认按优先级排序
          sortTable('priority');
        });
        
        function sortTable(column) {
          const tbody = document.querySelector('tbody');
          const rows = Array.from(tbody.querySelectorAll('tr'));
          
          // 更新排序状态
          if (currentSort.column === column) {
            currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
          } else {
            currentSort.column = column;
            currentSort.direction = 'asc';
          }
          
          // 更新表头样式
          document.querySelectorAll('th.sortable').forEach(th => {
            th.classList.remove('asc', 'desc');
            if (th.dataset.sort === column) {
              th.classList.add(currentSort.direction);
            }
          });
          
          // 排序行
          rows.sort((a, b) => {
            let aValue, bValue;
            
            switch(column) {
              case 'domain':
                aValue = a.cells[1].textContent.trim();
                bValue = b.cells[1].textContent.trim();
                break;
              case 'system':
                aValue = a.cells[2].textContent.trim();
                bValue = b.cells[2].textContent.trim();
                break;
              case 'registrationDate':
                aValue = new Date(a.cells[3].textContent);
                bValue = new Date(b.cells[3].textContent);
                break;
              case 'expirationDate':
                aValue = new Date(a.cells[4].textContent);
                bValue = new Date(b.cells[4].textContent);
                break;
              case 'daysRemaining':
                aValue = parseInt(a.cells[5].textContent) || 0;
                bValue = parseInt(b.cells[5].textContent) || 0;
                break;
              case 'priority':
                // 定义优先级顺序
                const priorityOrder = {
                  '域名': 0,
                  'VPS': 1,
                  '其他': 2
                };
                // 获取优先级文本
                const getPriorityText = (cell) => {
                  const text = cell.textContent.trim();
                  return text.includes('域名') ? '域名' : 
                         text.includes('VPS') ? 'VPS' : '其他';
                };
                aValue = priorityOrder[getPriorityText(a.cells[1])] || 2;
                bValue = priorityOrder[getPriorityText(b.cells[1])] || 2;
                break;
              default:
                return 0;
            }
            
            if (currentSort.direction === 'asc') {
              return aValue > bValue ? 1 : -1;
            } else {
              return aValue < bValue ? 1 : -1;
            }
          });
          
          // 重新插入排序后的行
          rows.forEach(row => tbody.appendChild(row));
        }
      </script>
    </body>
    </html>
  `;
}

// ==================== 主程序入口 ====================
export default {
  /**
   * 处理HTTP请求
   * @param {Request} request - 请求对象
   * @param {object} env - 环境变量
   * @returns {Response} 响应对象
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 处理密码验证请求
    if (request.method === 'POST' && url.pathname === '/verify-password') {
      try {
        const { password } = await request.json();
        const storedPassword = await env.SECRET_KV.get('password');
        
        if (password === storedPassword) {
          // 生成一个简单的会话令牌（在生产环境中应使用更安全的方法）
          const token = btoa(Date.now() + ':' + Math.random());
          
          // 存储令牌（有效期10分钟）
          await env.SECRET_KV.put('auth_token:' + token, 'valid', { expirationTtl: 600 });
          
          return new Response(JSON.stringify({ 
            success: true, 
            token: token 
          }), { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } else {
          return new Response(JSON.stringify({ 
            success: false, 
            message: '密码错误' 
          }), { 
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (error) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: '验证失败' 
        }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // 处理其他 POST 请求
    if (request.method === 'POST') {
      const requestBody = await request.json();
      if (url.pathname.endsWith('/add-domain')) {
        await saveDomainToKV(env, requestBody);
        return new Response('域名信息已保存', { status: 200 });
      } else if (url.pathname.endsWith('/delete-domain')) {
        await deleteDomainFromKV(env, requestBody.domain);
        return new Response('域名信息已删除', { status: 200 });
      } else if (url.pathname.endsWith('/edit-domain')) {
        try {
          // 如果域名发生变化，需要先删除旧域名再添加新域名
          if (requestBody.originalDomain && requestBody.originalDomain !== requestBody.domain) {
            await deleteDomainFromKV(env, requestBody.originalDomain);
            
            // 创建新的域名对象（不包含originalDomain字段）
            const newDomainInfo = {
              domain: requestBody.domain,
              registrationDate: requestBody.registrationDate,
              expirationDate: requestBody.expirationDate,
              system: requestBody.system,
              systemURL: requestBody.systemURL,
              priority: requestBody.priority
            };
            
            await saveDomainToKV(env, newDomainInfo);
          } else {
            // 域名没变，直接更新
            const domainInfo = {
              domain: requestBody.domain,
              registrationDate: requestBody.registrationDate,
              expirationDate: requestBody.expirationDate,
              system: requestBody.system,
              systemURL: requestBody.systemURL,
              priority: requestBody.priority
            };
            
            await editDomainInKV(env, domainInfo);
          }
          
          return new Response(JSON.stringify({ success: true }), { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          return new Response(JSON.stringify({ 
            success: false, 
            message: error.message || '更新域名信息失败'
          }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    }

    // 提取并设置环境变量
    sitename = env.SITENAME || sitename;
    tgid = env.TGID || tgid;
    tgtoken = env.TGTOKEN || tgtoken;
    wxPushToken = env.WX_PUSH_TOKEN || wxPushToken;
    days = Number(env.DAYS || days);

    // 检查 SECRET_KV 是否定义
    if (!env.SECRET_KV || typeof env.SECRET_KV.get !== 'function') {
      return new Response("SECRET_KV 命名空间未定义或绑定", { status: 500 });
    }
    
    // 检查是否是域名列表页面请求
    if (url.pathname === '/domains') {
      // 验证令牌参数
      const token = url.searchParams.get('token');
      if (!token) {
        return new Response("未授权访问", { status: 401 });
      }
      
      // 验证令牌是否有效
      const isValidToken = await env.SECRET_KV.get('auth_token:' + token);
      if (!isValidToken) {
        return new Response("会话已过期或无效，请重新登录", { status: 401 });
      }
      
      // 从Cloudflare KV中获取最新的 domains 数据
      try {
        const domainsKV = await env.SECRET_KV.get('domains');
        domains = domainsKV ? JSON.parse(domainsKV) : [];
        if (!Array.isArray(domains)) throw new Error('JSON 数据格式不正确');
      } catch (error) {
        return new Response("从Cloudflare KV中获取的 JSON 数据格式不正确", { status: 500 });
      }
      
      // 返回域名列表页面
      const htmlContent = await generateDomainListPage(domains, sitename);
      return new Response(htmlContent, {
        headers: { 'Content-Type': 'text/html' },
      });
    } else {
      // 返回密码验证页面
      const htmlContent = await generatePasswordPage();
      return new Response(htmlContent, {
        headers: { 'Content-Type': 'text/html' },
      });
    }
  },

  /**
   * 定时任务，监控域名到期并发送消息
   * @param {ScheduledEvent} event - 定时事件
   * @param {object} env - 环境变量
   * @param {ExecutionContext} ctx - 执行上下文
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(event, env));
  }

};
