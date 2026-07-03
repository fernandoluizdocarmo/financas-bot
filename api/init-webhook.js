/**
 * /api/init-webhook
 * Chamado automaticamente pelo cron do Vercel uma vez por dia (às 00:05 UTC).
 * Também pode ser chamado manualmente acessando a URL no navegador.
 *
 * Garante que o webhook do Telegram esteja sempre apontando para
 * a URL correta deste deploy, evitando reconfigurações manuais.
 */

const { bot } = require('../bot.js');

module.exports = async (req, res) => {
  try {
    // Descobre a URL deste deploy automaticamente
    const host =
      process.env.VERCEL_PROJECT_PRODUCTION_URL || // URL fixa de produção (Vercel injeta automaticamente)
      process.env.VERCEL_URL ||                    // URL do deploy atual
      req.headers['x-forwarded-host'] ||
      req.headers.host;

    if (!host) {
      return res.status(500).send('❌ Não foi possível determinar a URL do servidor.');
    }

    const webhookUrl = `https://${host}/api/webhook`;

    // Verifica o webhook atual antes de reconfigurar (evita chamadas desnecessárias)
    const current = await bot.getWebHookInfo();

    // Configura o menu button persistente padrão globalmente
    const APP_BUTTON_TYPE = process.env.APP_BUTTON_TYPE || 'webapp';
    const APP_URL = process.env.APP_URL || 'https://app-financas-nine-pied.vercel.app/';

    if (APP_BUTTON_TYPE === 'none' || APP_BUTTON_TYPE === 'link') {
      await bot.setChatMenuButton({
        menu_button: { type: 'default' }
      }).catch(e => console.error('Erro ao configurar menu_button default:', e));
      console.log('✅ Botão de menu global removido/restaurado para o padrão.');
    } else {
      await bot.setChatMenuButton({
        menu_button: {
          type: 'web_app',
          text: 'Abrir App',
          web_app: { url: APP_URL }
        }
      }).catch(e => console.error('Erro ao configurar menu_button web_app:', e));
      console.log('✅ Botão de menu global configurado para abrir WebApp.');
    }

    if (current.url === webhookUrl) {
      console.log(`✅ Webhook já está correto: ${webhookUrl}`);
      return res.status(200).json({
        ok: true,
        action: 'noop',
        message: 'Webhook já configurado e menu atualizado.',
        webhook: webhookUrl,
      });
    }

    // Webhook diferente ou ausente → reconfigura
    console.log(`🔄 Reconfigurando webhook: ${current.url || '(nenhum)'} → ${webhookUrl}`);
    const result = await bot.setWebHook(webhookUrl);

    console.log(`✅ Webhook registrado com sucesso: ${webhookUrl}`);

    return res.status(200).json({
      ok: true,
      action: 'updated',
      message: 'Webhook e menu atualizados com sucesso!',
      webhook: webhookUrl,
      telegramResponse: result,
    });

  } catch (e) {
    console.error('❌ Erro ao configurar webhook:', e);
    return res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
};
