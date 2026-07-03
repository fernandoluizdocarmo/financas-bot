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

      // Verifica dias restantes para vencimento
      let msgText = '';
      let sendMsg = false;

      if (diffDays === 5) {
        msgText = `⚠️ *Atenção! Sua assinatura está próxima de expirar!*\n\n` +
                  `Olá, *${sub.name || 'Usuário'}*! Restam apenas *5 dias* para o vencimento do seu plano Premium do *Minhas Finanças*.\n\n` +
                  `Renove agora mesmo para continuar controlando suas finanças sem nenhuma interrupção! 👇`;
        sendMsg = true;
      } else if (diffDays === 4) {
        msgText = `⚠️ *Atenção! Sua assinatura está próxima de expirar!*\n\n` +
                  `Olá, *${sub.name || 'Usuário'}*! Restam apenas *4 dias* para o vencimento do seu plano Premium do *Minhas Finanças*.\n\n` +
                  `Renove agora mesmo para continuar controlando suas finanças sem nenhuma interrupção! 👇`;
        sendMsg = true;
      } else if (diffDays === 3) {
        msgText = `⚠️ *Sua assinatura vence em 3 dias!*\n\n` +
                  `Olá, *${sub.name || 'Usuário'}*! Restam apenas *3 dias* para o vencimento do seu plano Premium do *Minhas Finanças*.\n\n` +
                  `Renove sua assinatura para não perder o acesso às estatísticas e relatórios! 👇`;
        sendMsg = true;
      } else if (diffDays === 2) {
        msgText = `⚠️ *Sua assinatura vence em 2 dias!*\n\n` +
                  `Olá, *${sub.name || 'Usuário'}*! Restam apenas *2 dias* para o vencimento do seu plano Premium do *Minhas Finanças*.\n\n` +
                  `Renove sua assinatura para não perder o acesso às estatísticas e relatórios! 👇`;
        sendMsg = true;
      } else if (diffDays === 1) {
        msgText = `⚠️ *Sua assinatura vence amanhã!*\n\n` +
                  `Olá, *${sub.name || 'Usuário'}*! Resta apenas *1 dia* para o vencimento do seu plano Premium do *Minhas Finanças*.\n\n` +
                  `Renove sua assinatura para não perder o acesso às estatísticas e relatórios! 👇`;
        sendMsg = true;
      } else if (diffDays === 0) {
        msgText = `🚨 *Sua assinatura expira hoje!*\n\n` +
                  `Olá, *${sub.name || 'Usuário'}*! Seu acesso Premium do *Minhas Finanças* expira hoje.\n\n` +
                  `Evite o bloqueio do seu painel e continue sua jornada financeira clicando abaixo: 👇`;
        sendMsg = true;
      } else if (diffDays === -1) {
        msgText = `❌ *Acesso Premium Expirado!*\n\n` +
                  `Olá, *${sub.name || 'Usuário'}*! Sua assinatura do *Minhas Finanças* expirou ontem e seu acesso foi suspenso.\n\n` +
                  `⚠️ *Importante:* Seus dados de cadastro serão preservados por *30 dias*. Se você renovar nesse período, recuperará o acesso normalmente. Após *30 dias*, seus dados serão excluídos definitivamente do sistema.\n\n` +
                  `Renove agora mesmo para recuperar seu acesso instantaneamente: 👇`;
        sendMsg = true;
      }

      if (sendMsg) {
        try {
          await bot.sendMessage(
            sub.chat_id,
            msgText,
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
          console.log(`[cron-reminders] Lembrete (${diffDays} dias) enviado para ${sub.name} (${sub.chat_id})`);
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
