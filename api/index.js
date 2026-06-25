const { DB } = require('../bot.js');

module.exports = async (req, res) => {
  let total = 0;
  let pending = 0;
  let supabaseConnected = false;
  
  try {
    const subs = await DB.allSubscribers();
    const pends = await DB.allPending();
    total = subs.length;
    pending = pends.length;
    supabaseConnected = true;
  } catch (e) {
    console.error('Error fetching dashboard data:', e);
  }

  const hasPix = !!process.env.PIX_KEY;
  const hasToken = !!process.env.TELEGRAM_BOT_TOKEN;
  const hasAdmin = !!process.env.ADMIN_TELEGRAM_ID;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Minhas Finanças Bot — Status</title>
  <!-- Google Fonts: Inter & Outfit -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-color: #0b0f19;
      --card-bg: rgba(22, 30, 49, 0.7);
      --card-border: rgba(255, 255, 255, 0.08);
      --accent-color: #10b981;
      --accent-glow: rgba(16, 185, 129, 0.15);
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --blue-accent: #3b82f6;
      --blue-glow: rgba(59, 130, 246, 0.15);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Inter', sans-serif;
      background-color: var(--bg-color);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1rem;
      position: relative;
      overflow-x: hidden;
    }

    /* Ambient background glow elements */
    .glow-blob {
      position: absolute;
      width: 400px;
      height: 400px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.12) 0%, rgba(0, 0, 0, 0) 70%);
      filter: blur(40px);
      z-index: -1;
    }

    .blob-1 {
      top: -100px;
      left: -100px;
    }

    .blob-2 {
      bottom: -150px;
      right: -100px;
    }

    .container {
      width: 100%;
      max-width: 580px;
      z-index: 1;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 24px;
      padding: 2.5rem;
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
      position: relative;
      overflow: hidden;
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, var(--accent-color), var(--blue-accent));
    }

    .header {
      text-align: center;
      margin-bottom: 2rem;
    }

    .bot-icon {
      font-size: 3.5rem;
      margin-bottom: 1rem;
      display: inline-block;
      filter: drop-shadow(0 0 10px rgba(16, 185, 129, 0.3));
      animation: float 4s ease-in-out infinite;
    }

    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-8px); }
    }

    h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 1.8rem;
      font-weight: 700;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #ffffff 0%, #d1d5db 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.2);
      color: var(--accent-color);
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.875rem;
      font-weight: 500;
      gap: 6px;
      margin-top: 0.5rem;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      background-color: var(--accent-color);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--accent-color);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.8); }
    }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.25rem;
      margin-bottom: 2rem;
    }

    .stat-box {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 16px;
      padding: 1.25rem;
      text-align: center;
      transition: transform 0.2s ease, border-color 0.2s ease;
    }

    .stat-box:hover {
      transform: translateY(-2px);
      border-color: rgba(255, 255, 255, 0.08);
    }

    .stat-val {
      font-family: 'Outfit', sans-serif;
      font-size: 2.25rem;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 0.25rem;
    }

    .stat-lbl {
      font-size: 0.85rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .config-section {
      background: rgba(255, 255, 255, 0.01);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 16px;
      padding: 1.5rem;
      margin-bottom: 2.25rem;
    }

    .config-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: #ffffff;
      margin-bottom: 1rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding-bottom: 0.5rem;
    }

    .config-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
      font-size: 0.95rem;
    }

    .config-item:last-child {
      margin-bottom: 0;
    }

    .config-label {
      color: var(--text-muted);
    }

    .config-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 500;
    }

    .status-ok {
      color: #10b981;
    }

    .status-warn {
      color: #f59e0b;
    }

    .btn {
      display: block;
      width: 100%;
      text-align: center;
      background: linear-gradient(135deg, var(--blue-accent) 0%, #2563eb 100%);
      color: white;
      text-decoration: none;
      padding: 1rem;
      border-radius: 14px;
      font-weight: 600;
      font-size: 1rem;
      box-shadow: 0 4px 14px var(--blue-glow);
      transition: transform 0.2s, box-shadow 0.2s, filter 0.2s;
    }

    .btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px var(--blue-glow);
      filter: brightness(1.1);
    }

    .btn:active {
      transform: translateY(1px);
    }

    .footer {
      text-align: center;
      margin-top: 1.5rem;
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    .footer a {
      color: var(--blue-accent);
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="glow-blob blob-1"></div>
  <div class="glow-blob blob-2"></div>

  <div class="container">
    <div class="card">
      <div class="header">
        <div class="bot-icon">🤖</div>
        <h1>Minhas Finanças Bot</h1>
        <div class="status-badge">
          <div class="status-dot"></div>
          Online na Vercel
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-val">${total}</div>
          <div class="stat-lbl">Assinantes</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${pending}</div>
          <div class="stat-lbl">Pendentes</div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-title">Configurações do Sistema</div>
        
        <div class="config-item">
          <span class="config-label">Banco Supabase</span>
          <span class="config-status ${supabaseConnected ? 'status-ok' : 'status-warn'}">
            ${supabaseConnected ? 'Conectado ✅' : 'Não configurado ⚠️'}
          </span>
        </div>

        <div class="config-item">
          <span class="config-label">Integração PIX</span>
          <span class="config-status ${hasPix ? 'status-ok' : 'status-warn'}">
            ${hasPix ? 'Ativa ✅' : 'Pendente ⚠️'}
          </span>
        </div>

        <div class="config-item">
          <span class="config-label">Token Telegram</span>
          <span class="config-status ${hasToken ? 'status-ok' : 'status-warn'}">
            ${hasToken ? 'Válido ✅' : 'Ausente ❌'}
          </span>
        </div>

        <div class="config-item">
          <span class="config-label">Administrador ID</span>
          <span class="config-status ${hasAdmin ? 'status-ok' : 'status-warn'}">
            ${hasAdmin ? 'Definido ✅' : 'Pendente ⚠️'}
          </span>
        </div>
      </div>

      <a href="https://t.me/minhas_financas_bot" target="_blank" class="btn">
        💬 Abrir Bot no Telegram
      </a>
    </div>

    <div class="footer">
      Minhas Finanças Bot &copy; 2026. Desenvolvido para Vercel Serverless.
    </div>
  </div>
</body>
</html>
  `);
};
