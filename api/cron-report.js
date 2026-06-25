'use strict';

require('dotenv').config();

const TelegramBot        = require('node-telegram-bot-api');
const { createClient }   = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).send('Unauthorized');
  }

  const TOKEN        = process.env.TELEGRAM_BOT_TOKEN;
  const ADMIN_ID     = process.env.ADMIN_TELEGRAM_ID;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  if (!ADMIN_ID) return res.status(400).send('ADMIN_TELEGRAM_ID não configurado.');
  if (!TOKEN)    return res.status(400).send('TELEGRAM_BOT_TOKEN não configurado.');
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(400).send('Supabase não configurado.');

  const bot      = new TelegramBot(TOKEN);
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    // Busca assinantes direto do Supabase
    const { data: subs,     error: e1 } = await supabase.from('bot_assinantes').select('*');
    const { data: pendings, error: e2 } = await supabase.from('bot_pendentes').select('*');

    if (e1) return res.status(500).send(`Erro ao buscar assinantes: ${e1.message}`);
    if (e2) return res.status(500).send(`Erro ao buscar pendentes: ${e2.message}`);

    const total   = (subs || []).length;
    const pending = (pendings || []).length;

    const planoStats = (subs || []).reduce((acc, s) => {
      acc[s.plan] = (acc[s.plan] || 0) + 1;
      return acc;
    }, {});

    const todayStr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const newToday = (subs || []).filter(s => {
      if (!s.subscribed_at) return false;
      return new Date(s.subscribed_at) > oneDayAgo;
    }).length;

    const hora  = new Date().getUTCHours();
    const turno = hora < 15 ? '🌅 Manhã (6h)' : '🌆 Tarde (18h)';

    await bot.sendMessage(ADMIN_ID,
      `📊 *Relatório de Assinaturas — ${turno} (${todayStr})*\n\n` +
      `👑 *Assinantes Ativos:* *${total}*\n` +
      `  • Mensal: *${planoStats['Mensal'] || 0}*\n` +
      `  • Anual: *${planoStats['Anual'] || 0}*\n` +
      `  • Vitalício: *${planoStats['Vitalício'] || 0}*\n\n` +
      `✨ *Novos nas últimas 24h:* *${newToday}*\n` +
      `⏳ *Pagamentos pendentes:* *${pending}*\n\n` +
      `🟢 *Status do Sistema:* Operacional e 100% online!`,
      { parse_mode: 'Markdown' }
    );

    console.log(`[cron-report] Relatório enviado — ${turno} | Assinantes: ${total} | Pendentes: ${pending}`);
    res.status(200).send(`Report sent. Subscribers: ${total}, Pending: ${pending}`);
  } catch (err) {
    console.error(`[cron-report] Erro: ${err.message}`);
    res.status(500).send(`Error: ${err.message}`);
  }
};
