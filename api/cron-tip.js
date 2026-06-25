'use strict';

require('dotenv').config();

const TelegramBot      = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const tips = require('../tips');

function randomTip() {
  return tips[Math.floor(Math.random() * tips.length)];
}

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
    // Busca assinantes direto do Supabase
    const { data: subs, error } = await supabase.from('bot_assinantes').select('chat_id');

    if (error) return res.status(500).send(`Erro ao buscar assinantes: ${error.message}`);

    const rows = subs || [];
    const tip  = randomTip();

    console.log(`[cron-tip] Enviando dica para ${rows.length} assinante(s)...`);

    await Promise.all(
      rows.map(({ chat_id }) =>
        bot.sendMessage(chat_id, `🌅 *Dica do dia:*\n\n${tip}`, { parse_mode: 'Markdown' }).catch(() => {})
      )
    );

    res.status(200).send(`Tips sent to ${rows.length} subscribers.`);
  } catch (err) {
    console.error(`[cron-tip] Erro: ${err.message}`);
    res.status(500).send(`Error: ${err.message}`);
  }
};
