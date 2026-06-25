'use strict';

require('dotenv').config();

const TelegramBot      = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).send('Unauthorized');
  }

  const TOKEN        = process.env.TELEGRAM_BOT_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  if (!TOKEN)    return res.status(400).send('TELEGRAM_BOT_TOKEN não configurado.');
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(400).send('Supabase não configurado.');

  const bot      = new TelegramBot(TOKEN);
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    // Busca todos os assinantes ativos do banco
    const { data: subs, error } = await supabase.from('bot_assinantes').select('*');

    if (error) return res.status(500).send(`Erro ao buscar assinantes: ${error.message}`);

    const rows = subs || [];
    let sentCount = 0;

    const today = new Date();
    const todayMidnight = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    console.log(`[cron-reminders] Verificando vencimentos para ${rows.length} assinante(s)...`);

    for (const sub of rows) {
      if (!sub.expires_at) continue; // Pula vitalício ou permanente sem expiração

      const expiry = new Date(sub.expires_at);
      const expiryMidnight = new Date(Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate()));

      const diffTime = expiryMidnight - todayMidnight;
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      // Se faltar exatamente 5 dias
      if (diffDays === 5) {
        try {
          await bot.sendMessage(
            sub.chat_id,
            `⚠️ *Atenção! Sua assinatura está próxima de expirar!*\n\n` +
            `Olá, *${sub.name || 'Usuário'}*! Restam apenas *5 dias* para o vencimento do seu plano Premium do *Minhas Finanças*.\n\n` +
            `Renove agora mesmo para continuar controlando suas finanças sem nenhuma interrupção! 👇`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '💳 Renovar Plano', callback_data: 'escolher_plano_renovar' }]
                ]
              }
            }
          );
          sentCount++;
          console.log(`[cron-reminders] Lembrete enviado para ${sub.name} (${sub.chat_id})`);
        } catch (msgErr) {
          console.error(`[cron-reminders] Erro ao enviar para ${sub.chat_id}: ${msgErr.message}`);
        }
      }
    }

    res.status(200).send(`Lembretes enviados. Total de mensagens enviadas: ${sentCount}`);
  } catch (err) {
    console.error(`[cron-reminders] Erro: ${err.message}`);
    res.status(500).send(`Error: ${err.message}`);
  }
};
