const { bot } = require('../bot.js');

module.exports = async (req, res) => {
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const webhookUrl = `https://${host}/api/webhook`;
    const result = await bot.setWebHook(webhookUrl);
    res.status(200).send(`✅ Webhook configurado com sucesso para: ${webhookUrl}\nResultado: ${JSON.stringify(result)}`);
  } catch (e) {
    res.status(500).send(`❌ Erro ao configurar webhook: ${e.message}`);
  }
};
