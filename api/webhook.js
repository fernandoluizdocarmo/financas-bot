const { bot } = require('../bot.js');

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      const { body } = req;
      if (body && body.update_id) {
        bot.processUpdate(body);
        // Pequeno atraso para garantir que todas as requisições assíncronas do bot
        // para a API do Telegram sejam disparadas e concluídas antes da Vercel congelar a função.
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    } catch (e) {
      console.error('Error processing update:', e);
    }
    res.status(200).json({ ok: true });
  } else {
    res.status(405).send('Method Not Allowed');
  }
};
