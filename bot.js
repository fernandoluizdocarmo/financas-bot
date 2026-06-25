'use strict';

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const cron        = require('node-cron');
const QRCode      = require('qrcode');
const http        = require('http');
const fs          = require('fs');
const path        = require('path');
const { createClient } = require('@supabase/supabase-js');

// =============================================
//  CONFIGURAÇÕES — defina no arquivo .env
// =============================================
const TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL  = process.env.APP_URL  || 'https://app-financas-nine-pied.vercel.app/';
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;
const SELF_URL = process.env.SELF_URL || '';
const PORT     = process.env.PORT     || 3000;
const isVercel = process.env.VERCEL === '1';

// Configurações do Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Configurações do PIX
const PIX_KEY  = process.env.PIX_KEY;
const PIX_NAME = (process.env.PIX_NAME || 'Minhas Financas').toUpperCase();
const PIX_CITY = (process.env.PIX_CITY || 'SAO PAULO').toUpperCase();

// Definição dos Planos de Assinatura
const PLANS = {
  mensal: { name: 'Mensal', price: 2.00, label: 'mês', durationDays: 30 },
  anual: { name: 'Anual', price: 10.00, label: 'ano', durationDays: 365 },
  vitalicio: { name: 'Vitalício', price: 20.00, label: 'único', durationDays: null }
};

if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN não definido! Defina no .env ou nas variáveis de ambiente.');
  if (!isVercel) process.exit(1);
}

// =============================================
//  BANCO DE DADOS — SUPABASE
// =============================================
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('✅ Supabase configurado com sucesso!');
} else {
  console.warn('⚠️ SUPABASE_URL ou SUPABASE_KEY não definidos no .env! O bot precisa do Supabase para funcionar.');
}

const DB = {
  async isSubscriber(chatId) {
    if (!supabase) return false;
    try {
      const { data, error } = await supabase
        .from('bot_assinantes')
        .select('*')
        .eq('chat_id', String(chatId))
        .single();
        
      if (!data) return false;
      
      // Verifica se expirou (se não for vitalício)
      if (data.expires_at) {
        const expiry = new Date(data.expires_at);
        if (new Date() > expiry) {
          await this.removeSubscriber(chatId);
          return false;
        }
      }
      return true;
    } catch (e) {
      logErr(`Erro no isSubscriber: ${e.message}`);
      return false;
    }
  },
  
  async getSubscriber(chatId) {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('bot_assinantes')
      .select('*')
      .eq('chat_id', String(chatId))
      .single();
    if (error && error.code !== 'PGRST116') { // PGRST116 is code for no rows returned
      logErr(`Erro ao buscar assinante: ${error.message}`);
    }
    return data;
  },
  
  async addSubscriber(chatId, name, username, planKey) {
    if (!supabase) return;
    const plan = PLANS[planKey] || PLANS.mensal;
    let expiresAt = null;
    
    if (plan.durationDays) {
      const exp = new Date();
      exp.setDate(exp.getDate() + plan.durationDays);
      expiresAt = exp.toISOString();
    }

    const payload = {
      chat_id: String(chatId),
      name: name || 'Usuário',
      username: username || '',
      plan: plan.name,
      expires_at: expiresAt
    };

    const { error } = await supabase.from('bot_assinantes').upsert(payload);
    
    if (error) {
      logErr(`Erro de inserção no Supabase (addSubscriber): ${JSON.stringify(error)}`);
      throw new Error(`Erro Supabase: ${error.message}`);
    }
  },
  
  async removeSubscriber(chatId) {
    if (!supabase) return;
    const { error } = await supabase.from('bot_assinantes').delete().eq('chat_id', String(chatId));
    if (error) {
      logErr(`Erro ao remover assinante: ${error.message}`);
      throw new Error(`Erro Supabase: ${error.message}`);
    }
  },
  
  async allSubscribers() {
    if (!supabase) return [];
    const { data, error } = await supabase.from('bot_assinantes').select('*');
    if (error) {
      logErr(`Erro ao listar assinantes: ${error.message}`);
      return [];
    }
    return data || [];
  },

  async addPending(chatId, name, username, planKey) {
    if (!supabase) return;
    const { error } = await supabase.from('bot_pendentes').upsert({
      chat_id: String(chatId),
      name: name || 'Usuário',
      username: username || '',
      plan: planKey
    });
    if (error) {
      logErr(`Erro ao adicionar pendente: ${error.message}`);
      throw new Error(`Erro Supabase: ${error.message}`);
    }
  },
  
  async removePending(chatId) {
    if (!supabase) return;
    const { error } = await supabase.from('bot_pendentes').delete().eq('chat_id', String(chatId));
    if (error) {
      logErr(`Erro ao remover pendente: ${error.message}`);
      throw new Error(`Erro Supabase: ${error.message}`);
    }
  },
  
  async allPending() {
    if (!supabase) return [];
    const { data, error } = await supabase.from('bot_pendentes').select('*');
    if (error) {
      logErr(`Erro ao listar pendentes: ${error.message}`);
      return [];
    }
    return data || [];
  },
  
  async getPending(chatId) {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('bot_pendentes')
      .select('*')
      .eq('chat_id', String(chatId))
      .single();
    if (error && error.code !== 'PGRST116') {
      logErr(`Erro ao buscar pendente: ${error.message}`);
    }
    return data;
  }
};

// =============================================
//  GERADOR PIX — EMV / Pix Copia e Cola
// =============================================
function pixField(id, value) {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16(str) {
  let crc = 0xFFFF;
  for (const char of str) {
    crc ^= char.charCodeAt(0) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function generatePixPayload(amount) {
  if (!PIX_KEY) return null;

  const merchantInfo = pixField('26',
    pixField('00', 'br.gov.bcb.pix') +
    pixField('01', PIX_KEY)
  );
  const additionalData = pixField('62', pixField('05', 'FINANCASBOT'));
  const amountStr = amount > 0 ? pixField('54', amount.toFixed(2)) : '';

  const body =
    pixField('00', '01') +
    pixField('01', '11') +
    merchantInfo +
    pixField('52', '0000') +
    pixField('53', '986') +
    amountStr +
    pixField('58', 'BR') +
    pixField('59', PIX_NAME.substring(0, 25)) +
    pixField('60', PIX_CITY.substring(0, 15)) +
    additionalData +
    '6304';

  return body + crc16(body);
}

// Cache temporário dos códigos PIX por usuário (em memória)
const pixCodeCache = new Map();

// Cache temporário para controle de envio de comprovantes
const receiptStateCache = new Map();


async function sendPixPayment(chatId, planKey) {
  const plan = PLANS[planKey];
  const pixPayload = generatePixPayload(plan.price);

  if (!pixPayload) {
    return bot.sendMessage(chatId,
      `💳 *Assinar Minhas Finanças Premium — Plano ${plan.name}*\n\n` +
      `✅ Acesso completo ao app\n✅ Dicas diárias de finanças\n✅ Suporte prioritário\n\n` +
      `*Valor: R$ ${plan.price.toFixed(2).replace('.', ',')} / ${plan.label}*\n\n` +
      `Entre em contato com o suporte para efetuar o pagamento.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Já paguei', callback_data: `ja_paguei_${planKey}` }],
            [{ text: '⬅️ Voltar',    callback_data: 'assinar'    }],
          ],
        },
      }
    );
  }

  // Gera QR Code como buffer PNG
  const qrBuffer = await QRCode.toBuffer(pixPayload, {
    width: 300,
    margin: 2,
    color: { dark: '#1a1a2e', light: '#ffffff' },
  });

  pixCodeCache.set(`${chatId}_${planKey}`, pixPayload);

  await bot.sendPhoto(chatId, qrBuffer, {
    caption:
      `💳 *Plano ${plan.name} Selecionado!*\n\n` +
      `✅ Acesso completo ao app\n` +
      `✅ Dicas diárias de finanças\n` +
      `✅ Suporte prioritário\n\n` +
      `💰 *Valor: R$ ${plan.price.toFixed(2).replace('.', ',')} / ${plan.label}*\n\n` +
      `📲 Escaneie o QR Code acima com o app do seu banco\n` +
      `ou clique em *Copiar código PIX* abaixo 👇\n\n` +
      `_Após realizar o pagamento, toque em ✅ Já paguei_`,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 Copiar código PIX', callback_data: `copiar_pix_${planKey}` }],
        [{ text: '✅ Já paguei',         callback_data: `ja_paguei_${planKey}`  }],
        [{ text: '⬅️ Escolher outro plano', callback_data: 'assinar'     }],
      ],
    },
  });
}

// =============================================
//  BOT
// =============================================
const bot = new TelegramBot(TOKEN, { polling: !isVercel });

// ─────────────────────────────────────────
//  DICAS DE FINANÇAS
// ─────────────────────────────────────────
const tips = require('./tips');

function randomTip() {
  return tips[Math.floor(Math.random() * tips.length)];
}

function randomTipAndIndex(excludeIndex = null) {
  let index;
  if (tips.length > 1 && excludeIndex !== null && excludeIndex !== undefined) {
    const possibleIndices = [];
    for (let i = 0; i < tips.length; i++) {
      if (i !== Number(excludeIndex)) {
        possibleIndices.push(i);
      }
    }
    index = possibleIndices[Math.floor(Math.random() * possibleIndices.length)];
  } else {
    index = Math.floor(Math.random() * tips.length);
  }
  return { index, tip: tips[index] };
}

// ─────────────────────────────────────────
//  MENU PRINCIPAL
// ─────────────────────────────────────────
function mainMenu(name) {
  return {
    text: `👋 Olá, *${name}*! Bem-vindo ao *Minhas Finanças Bot*!\n\nEscolha uma opção:`,
    options: {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💳 Assinar / Escolher Plano',    callback_data: 'assinar'   }],
          [{ text: '💡 Receber Dica de Finanças',   callback_data: 'dica'      }],
          [{ text: '🔐 Verificar meu acesso',        callback_data: 'verificar' }],
          [{ text: '📲 Acessar o App',               callback_data: 'acessar_app' }],
        ],
      },
    },
  };
}

// ─────────────────────────────────────────
//  COMANDOS DE TEXTO
// ─────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const { id: chatId, first_name } = msg.chat;
  log(`/start — ${first_name} (${chatId})`);
  const menu = mainMenu(first_name);
  bot.sendMessage(chatId, menu.text, menu.options).catch(logErr);
});

bot.onText(/\/menu/, (msg) => {
  const menu = mainMenu(msg.chat.first_name || 'usuário');
  bot.sendMessage(msg.chat.id, menu.text, menu.options).catch(logErr);
});

bot.onText(/\/dica/, (msg) => {
  const { index, tip } = randomTipAndIndex();
  bot.sendMessage(msg.chat.id, tip, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Outra dica', callback_data: `dica_${index}` }],
        [{ text: '⬅️ Menu',       callback_data: 'voltar' }],
      ],
    },
  }).catch(logErr);
});

// ─────────────────────────────────────────
//  CALLBACKS DOS BOTÕES
// ─────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const { data } = query;

  try {
    // ── Ações do Administrador via Botões ────────────────────────────────────
    if (data.startsWith('admin_liberar_')) {
      if (String(query.from.id) !== String(ADMIN_ID)) return;
      const targetId = Number(data.split('_')[2]);
      const pending  = await DB.getPending(targetId);
      const planKey = pending?.plan || 'mensal';
      const plan = PLANS[planKey];

      await DB.addSubscriber(targetId, pending?.name || 'Usuário', pending?.username || '', planKey);
      await DB.removePending(targetId);
      receiptStateCache.delete(targetId); // limpa estado de comprovante pendente

      await bot.editMessageText(
        `✅ *Acesso premium liberado!*\n\n` +
        `👤 Nome: *${pending?.name || 'Usuário'}*\n` +
        `🆔 Chat ID: \`${targetId}\`\n` +
        `📦 Plano: *${plan.name}*\n\n` +
        `🟢 *Status:* Aprovado e ativo!`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown'
        }
      ).catch(() => {});

      const expText = plan.durationDays 
        ? `Sua assinatura é válida por ${plan.durationDays} dias.`
        : `Seu acesso é permanente e não expira!`;

      await bot.sendMessage(targetId,
        `✅ *Acesso Liberado com Sucesso!*\n\n` +
        `Olá! Seu acesso ao *Minhas Finanças Premium* foi confirmado e já está ativo. 🎉\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📦 Plano: *${plan.name}*\n` +
        `🟢 Status: *Ativo*\n` +
        `⏳ Validade: *${expText}*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Agora você tem acesso completo ao aplicativo! Clique no botão abaixo para começar a usar agora mesmo 👇`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🚀 Abrir Minhas Finanças', web_app: { url: APP_URL } }],
            ]
          },
        }
      ).catch(() => {});
      log(`Admin liberou acesso (via botão) para ${targetId} no plano ${plan.name}`);
      return bot.answerCallbackQuery(query.id).catch(() => {});
    }

    if (data.startsWith('admin_rejeitar_')) {
      if (String(query.from.id) !== String(ADMIN_ID)) return;
      const targetId = Number(data.split('_')[2]);
      const pending  = await DB.getPending(targetId);
      await DB.removePending(targetId);

      await bot.editMessageText(
        `❌ *Acesso premium rejeitado!*\n\n` +
        `👤 Nome: *${pending?.name || 'Usuário'}*\n` +
        `🆔 Chat ID: \`${targetId}\`\n\n` +
        `🔴 *Status:* Rejeitado.`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown'
        }
      ).catch(() => {});

      await bot.sendMessage(targetId,
        `⚠️ *Atenção: Confirmação de Pagamento*\n\n` +
        `Identificamos uma inconsistência na validação do seu comprovante de pagamento e, por esse motivo, a sua solicitação de acesso premium não pôde ser ativada no momento. ❌\n\n` +
        `🔍 *O que pode ter acontecido?*\n` +
        `• O arquivo enviado pode não ser um comprovante Pix válido.\n` +
        `• O valor transferido ou os dados do destinatário podem estar divergentes.\n` +
        `• O processamento bancário pode ter sofrido alguma oscilação.\n\n` +
        `👉 *Como resolver:*\n` +
        `1. Certifique-se de que realizou a transferência Pix para os dados corretos apresentados no menu de assinatura.\n` +
        `2. Envie o comprovante Pix completo e legível (em formato de imagem ou PDF) novamente através do menu do bot.\n` +
        `3. Se o problema de processamento persistir, entre em contato com o suporte ou realize uma nova tentativa.\n\n` +
        `Estamos à disposição para ajudar você a ativar seu acesso o quanto antes!`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
      log(`Admin rejeitou acesso (via botão) para ${targetId}`);
      return bot.answerCallbackQuery(query.id).catch(() => {});
    }

    // ── Menu de Escolha de Planos ───────────────────────────────────────────
    if (data === 'assinar') {
      const isSub = await DB.isSubscriber(chatId);
      if (isSub) {
        const sub = await DB.getSubscriber(chatId);
        const expText = sub.expires_at 
          ? `Expira em: *${new Date(sub.expires_at).toLocaleDateString('pt-BR')}*`
          : 'Acesso vitalício permanente!';

        await bot.sendMessage(chatId,
          `✅ Você *já tem acesso premium* ativo!\n\n` +
          `📦 Plano: *${sub.plan}*\n` +
          `⏳ ${expText}\n\n` +
          `Acesse o app agora:`,
          {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '📲 Abrir App', web_app: { url: APP_URL } }]] },
          }
        );
      } else {
        const previewPath = path.join(__dirname, 'preview.png');
        const captionText = `👑 *Escolha seu Plano Premium*\n\n` +
          `Selecione uma das opções abaixo para liberar acesso completo ao aplicativo:\n\n` +
          `🟢 *Mensal*: R$ 2,00 / mês\n` +
          `🔵 *Anual*: R$ 10,00 / ano\n` +
          `👑 *Vitalício*: R$ 20,00 (Pagamento único)\n\n` +
          `Escolha seu plano preferido:`;

        const options = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🟢 Mensal — R$ 2,00', callback_data: 'plan_mensal' }],
              [{ text: '🔵 Anual — R$ 10,00', callback_data: 'plan_anual' }],
              [{ text: '👑 Vitalício — R$ 20,00', callback_data: 'plan_vitalicio' }],
              [{ text: '⬅️ Voltar ao Menu', callback_data: 'voltar' }]
            ],
          },
        };

        if (fs.existsSync(previewPath)) {
          await bot.sendPhoto(chatId, previewPath, { caption: captionText, ...options });
        } else {
          await bot.sendMessage(chatId, captionText, options);
        }
      }
    }

    // ── Escolheu Plano específico ───────────────────────────────────────────
    if (data.startsWith('plan_')) {
      const planKey = data.split('_')[1];
      await sendPixPayment(chatId, planKey);
    }

    // ── Copiar código PIX para plano específico ──────────────────────────────
    if (data.startsWith('copiar_pix_')) {
      const planKey = data.split('_')[2];
      const plan = PLANS[planKey];
      const code = pixCodeCache.get(`${chatId}_${planKey}`) || generatePixPayload(plan.price);
      if (code) {
        await bot.sendMessage(chatId,
          `📋 *Código PIX Copia e Cola (${plan.name}):*\n\n\`${code}\`\n\n` +
          `_Abra o app do seu banco → PIX → Copia e Cola → cole o código acima._`,
          { parse_mode: 'Markdown' }
        );
      }
    }

    // ── Já paguei plano específico ───────────────────────────────────────────
    if (data.startsWith('ja_paguei_')) {
      const planKey = data.split('_')[2];
      const plan = PLANS[planKey];

      await bot.sendMessage(chatId,
        `❓ *Confirmar Envio da Solicitação*\n\n` +
        `Você confirma que realizou o pagamento Pix de *R$ ${plan.price.toFixed(2).replace('.', ',')}* para o plano *${plan.name}*?`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🟢 Sim, confirmo o pagamento', callback_data: `confirmar_envio_${planKey}` }],
              [{ text: '⬅️ Escolher outro plano', callback_data: 'assinar' }]
            ]
          }
        }
      );
    }

    // ── Confirmar envio da solicitação (Sem imagem) ─────────────────────────
    if (data.startsWith('confirmar_envio_')) {
      const planKey = data.split('_')[2];
      const plan = PLANS[planKey];

      try {
        // Registrar solicitação pendente no Supabase
        await DB.addPending(chatId, query.from.first_name, query.from.username || '', planKey);

        // Confirmar para o usuário
        await bot.sendMessage(chatId,
          `⏳ *Solicitação enviada com sucesso!*\n\n` +
          `Plano selecionado: *${plan.name}* (R$ ${plan.price.toFixed(2).replace('.', ',')})\n\n` +
          `O administrador foi notificado e liberará o seu acesso premium em breve após conferir o recebimento.`,
          { parse_mode: 'Markdown' }
        );

        // Encaminhar para o administrador
        if (ADMIN_ID) {
          const captionText = 
            `🔔 *Novo pagamento aguardando confirmação (Sem comprovante)!*\n\n` +
            `👤 Nome: *${query.from.first_name}*\n` +
            `🔗 Username: @${query.from.username || 'sem username'}\n` +
            `📦 Plano: *${plan.name}* (R$ ${plan.price.toFixed(2).replace('.', ',')})\n` +
            `🆔 Chat ID: \`${chatId}\`\n\n` +
            `O usuário confirmou que realizou o Pix. Escolha uma ação abaixo:`;

          await bot.sendMessage(ADMIN_ID, captionText, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🟢 Liberar Acesso', callback_data: `admin_liberar_${chatId}` },
                  { text: '🔴 Rejeitar Acesso', callback_data: `admin_rejeitar_${chatId}` }
                ]
              ]
            }
          });
          log(`Solicitação de Pix recebida de ${query.from.first_name} (${chatId}) e enviada ao admin.`);
        }
      } catch (err) {
        logErr(`Erro ao enviar solicitação de ${chatId}: ${err.message}`);
        await bot.sendMessage(chatId, `❌ *Erro ao processar solicitação.*\n\nHouve um problema de comunicação com o servidor. Por favor, tente novamente.`, { parse_mode: 'Markdown' });
      }
    }

    // ── Dica ─────────────────────────────────────────────────────────────────
    if (data === 'dica' || data.startsWith('dica_')) {
      const excludeIndex = data.startsWith('dica_') ? Number(data.split('_')[1]) : null;
      const { index, tip } = randomTipAndIndex(excludeIndex);

      await bot.sendMessage(chatId, tip, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Outra dica', callback_data: `dica_${index}` }],
            [{ text: '⬅️ Menu',       callback_data: 'voltar' }],
          ],
        },
      });
    }

    // ── Acessar o App ─────────────────────────────────────────────────────────
    if (data === 'acessar_app') {
      const isSub = await DB.isSubscriber(chatId);
      if (isSub) {
        await bot.sendMessage(chatId,
          `✅ Acesso liberado!\n\nClique no botão abaixo para abrir o Minhas Finanças:`,
          {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '📲 Abrir Aplicativo', web_app: { url: APP_URL } }]] },
          }
        );
      } else {
        await bot.sendMessage(chatId,
          `❌ *Acesso Negado*\n\nVocê precisa ter uma assinatura ativa para acessar o aplicativo.\n\nClique em *💳 Assinar / Escolher Plano* para liberar o seu acesso!`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '💳 Assinar / Escolher Plano', callback_data: 'assinar' }],
                [{ text: '⬅️ Voltar', callback_data: 'voltar' }],
              ],
            },
          }
        );
      }
    }

    // ── Verificar acesso ──────────────────────────────────────────────────────
    if (data === 'verificar') {
      const isSub = await DB.isSubscriber(chatId);
      if (isSub) {
        const sub = await DB.getSubscriber(chatId);
        const expText = sub.expires_at 
          ? `Expira em: *${new Date(sub.expires_at).toLocaleDateString('pt-BR')}*`
          : 'Acesso vitalício permanente!';

        await bot.sendMessage(chatId,
          `✅ *Acesso Premium ativo!*\n\n` +
          `📦 Plano: *${sub.plan}*\n` +
          `⏳ ${expText}\n\n` +
          `Clique abaixo para entrar no app:`,
          {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '📲 Abrir App', web_app: { url: APP_URL } }]] },
          }
        );
      } else {
        await bot.sendMessage(chatId,
          `❌ Você *não tem acesso premium* ainda.\n\nAssine para desbloquear o app completo!`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '💳 Escolher plano agora', callback_data: 'assinar' }],
                [{ text: '⬅️ Voltar',        callback_data: 'voltar'  }],
              ],
            },
          }
        );
      }
    }

    // ── Voltar ao menu ────────────────────────────────────────────────────────
    if (data === 'voltar') {
      const menu = mainMenu(query.from.first_name || 'usuário');
      await bot.sendMessage(chatId, menu.text, menu.options);
    }

  } catch (err) {
    logErr(`callback_query [${data}]: ${err.message}`);
  }

  bot.answerCallbackQuery(query.id).catch(() => {});
});

// ─────────────────────────────────────────
//  RECEBIMENTO DE COMPROVANTES (FOTOS/ARQUIVOS)
// ─────────────────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Ignorar mensagens de comandos
  if (msg.text && msg.text.startsWith('/')) return;

  // Verificar se o usuário está aguardando comprovante no cache
  let planKey = receiptStateCache.get(chatId);

  // Fallback: verificar se a mensagem é uma resposta direta ao prompt de envio
  if (!planKey && msg.reply_to_message && msg.reply_to_message.text) {
    const replyText = msg.reply_to_message.text;
    if (replyText.includes('Mensal')) planKey = 'mensal';
    else if (replyText.includes('Anual')) planKey = 'anual';
    else if (replyText.includes('Vitalício')) planKey = 'vitalicio';
  }

  // Se não estiver aguardando comprovante, ignorar
  if (!planKey) return;

  const plan = PLANS[planKey];
  if (!plan) return;

  const isPhoto = msg.photo && msg.photo.length > 0;
  const isDocument = !!msg.document;

  if (isPhoto || isDocument) {
    // Limpar o estado para evitar reenvios desnecessários
    receiptStateCache.delete(chatId);

    try {
      // Registrar solicitação pendente no Supabase
      await DB.addPending(chatId, msg.from.first_name, msg.from.username || '', planKey);

      // Confirmar recebimento para o usuário
      await bot.sendMessage(chatId,
        `⏳ *Comprovante recebido com sucesso!*\n\n` +
        `Plano selecionado: *${plan.name}* (R$ ${plan.price.toFixed(2).replace('.', ',')})\n\n` +
        `Seu acesso será liberado manualmente pelo administrador em breve após a confirmação do comprovante.\n\n` +
        `Se precisar de suporte rápido, entre em contato.`,
        { parse_mode: 'Markdown' }
      );

      // Encaminhar comprovante para o administrador com botões de decisão
      if (ADMIN_ID) {
        const captionText = 
          `🔔 *Novo pagamento aguardando confirmação!*\n\n` +
          `👤 Nome: *${msg.from.first_name}*\n` +
          `🔗 Username: @${msg.from.username || 'sem username'}\n` +
          `📦 Plano: *${plan.name}* (R$ ${plan.price.toFixed(2).replace('.', ',')})\n` +
          `🆔 Chat ID: \`${chatId}\`\n\n` +
          `Comprovante enviado acima ☝️\n\n` +
          `Escolha uma ação abaixo para gerenciar este acesso:`;

        const options = {
          caption: captionText,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🟢 Liberar Acesso', callback_data: `admin_liberar_${chatId}` },
                { text: '🔴 Rejeitar Acesso', callback_data: `admin_rejeitar_${chatId}` }
              ]
            ]
          }
        };

        if (isPhoto) {
          const fileId = msg.photo[msg.photo.length - 1].file_id;
          await bot.sendPhoto(ADMIN_ID, fileId, options);
        } else {
          const fileId = msg.document.file_id;
          await bot.sendDocument(ADMIN_ID, fileId, options);
        }
        log(`Comprovante recebido de ${msg.from.first_name} (${chatId}) e encaminhado ao admin.`);
      }
    } catch (err) {
      logErr(`Erro ao processar comprovante de ${chatId}: ${err.message}`);
      await bot.sendMessage(chatId, `❌ *Erro ao processar comprovante.*\n\nHouve um problema de comunicação com o servidor. Por favor, tente enviar novamente.`, { parse_mode: 'Markdown' });
    }
  } else {
    // Se o usuário responder apenas com texto comum, solicita o comprovante novamente
    await bot.sendMessage(chatId,
      `⚠️ *Por favor, envie o comprovante como imagem ou arquivo.*\n\n` +
      `Para que possamos validar seu pagamento, envie a foto ou arquivo do comprovante em resposta a esta mensagem. Se quiser cancelar, basta digitar /menu.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          force_reply: true,
          selective: true
        }
      }
    );
  }
});

// ─────────────────────────────────────────
//  COMANDOS DO ADMIN
// ─────────────────────────────────────────

// /liberar <chatId>
bot.onText(/\/liberar (\d+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(ADMIN_ID)) return;

  const targetId = Number(match[1]);
  const pending  = await DB.getPending(targetId);

  const planKey = pending?.plan || 'mensal';
  const plan = PLANS[planKey];

  await DB.addSubscriber(targetId, pending?.name || 'Usuário', pending?.username || '', planKey);
  await DB.removePending(targetId);
  receiptStateCache.delete(targetId); // limpa estado de comprovante pendente

  bot.sendMessage(msg.chat.id, `✅ Acesso liberado para \`${targetId}\` no plano *${plan.name}*.`, { parse_mode: 'Markdown' });
  
  const expText = plan.durationDays 
    ? `Sua assinatura é válida por ${plan.durationDays} dias.`
    : `Seu acesso é permanente e não expira!`;

  bot.sendMessage(targetId,
    `✅ *Acesso Liberado com Sucesso!*\n\n` +
    `Olá! Seu acesso ao *Minhas Finanças Premium* foi confirmado e já está ativo. 🎉\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 Plano: *${plan.name}*\n` +
    `🟢 Status: *Ativo*\n` +
    `⏳ Validade: *${expText}*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Agora você tem acesso completo ao aplicativo! Clique no botão abaixo para começar a usar agora mesmo 👇`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 Abrir Minhas Finanças', web_app: { url: APP_URL } }],
        ]
      },
    }
  );
  log(`Admin liberou acesso para ${targetId} no plano ${plan.name}`);
});

// /rejeitar <chatId>
bot.onText(/\/rejeitar (\d+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(ADMIN_ID)) return;

  const targetId = Number(match[1]);
  await DB.removePending(targetId);

  bot.sendMessage(msg.chat.id, `❌ Rejeitado \`${targetId}\`.`, { parse_mode: 'Markdown' });
  bot.sendMessage(targetId,
    `⚠️ *Atenção: Confirmação de Pagamento*\n\n` +
    `Identificamos uma inconsistência na validação do seu comprovante de pagamento e, por esse motivo, a sua solicitação de acesso premium não pôde ser ativada no momento. ❌\n\n` +
    `🔍 *O que pode ter acontecido?*\n` +
    `• O arquivo enviado pode não ser um comprovante Pix válido.\n` +
    `• O valor transferido ou os dados do destinatário podem estar divergentes.\n` +
    `• O processamento bancário pode ter sofrido alguma oscilação.\n\n` +
    `👉 *Como resolver:*\n` +
    `1. Certifique-se de que realizou a transferência Pix para os dados corretos apresentados no menu de assinatura.\n` +
    `2. Envie o comprovante Pix completo e legível (em formato de imagem ou PDF) novamente através do menu do bot.\n` +
    `3. Se o problema de processamento persistir, entre em contato com o suporte ou realize uma nova tentativa.\n\n` +
    `Estamos à disposição para ajudar você a ativar seu acesso o quanto antes!`,
    { parse_mode: 'Markdown' }
  );
});

// /assinantes
bot.onText(/\/assinantes/, async (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_ID)) return;

  const rows = await DB.allSubscribers();
  if (!rows.length) return bot.sendMessage(msg.chat.id, '📋 Nenhum assinante ainda.');

  const list = rows.map(r => {
    const exp = r.expires_at ? new Date(r.expires_at).toLocaleDateString('pt-BR') : 'Sem expiração';
    return `• *${r.name}* (@${r.username || '—'}) — \`${r.chat_id}\`\n  Plano: *${r.plan}* | Expira: _${exp}_`;
  }).join('\n\n');

  bot.sendMessage(msg.chat.id,
    `📋 *Assinantes ativos (${rows.length}):*\n\n${list}`,
    { parse_mode: 'Markdown' }
  );
});

// /pendentes
bot.onText(/\/pendentes/, async (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_ID)) return;

  const rows = await DB.allPending();
  if (!rows.length) return bot.sendMessage(msg.chat.id, '✅ Nenhum pagamento pendente.');

  const list = rows.map(r => {
    const plan = PLANS[r.plan] || PLANS.mensal;
    return `• *${r.name}* (@${r.username || '—'}) — \`${r.chat_id}\`\n  Plano solicitado: *${plan.name}* (R$ ${plan.price.toFixed(2).replace('.', ',')})\n  /liberar ${r.chat_id}  |  /rejeitar ${r.chat_id}`;
  }).join('\n\n');

  bot.sendMessage(msg.chat.id,
    `⏳ *Pagamentos pendentes (${rows.length}):*\n\n${list}`,
    { parse_mode: 'Markdown' }
  );
});

// /remover <chatId>
bot.onText(/\/remover (\d+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(ADMIN_ID)) return;

  const targetId = Number(match[1]);
  await DB.removeSubscriber(targetId);
  bot.sendMessage(msg.chat.id, `🗑️ Assinatura removida para \`${targetId}\`.`, { parse_mode: 'Markdown' });
});

// /stats
bot.onText(/\/stats/, async (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_ID)) return;

  const subs = await DB.allSubscribers();
  const pendings = await DB.allPending();
  const total = subs.length;
  const pending = pendings.length;

  const planoStats = subs.reduce((acc, s) => {
    acc[s.plan] = (acc[s.plan] || 0) + 1;
    return acc;
  }, {});

  bot.sendMessage(msg.chat.id,
    `📊 *Estatísticas do Bot*\n\n` +
    `👑 Assinantes ativos: *${total}*\n` +
    `  • Mensal: *${planoStats['Mensal'] || 0}*\n` +
    `  • Anual: *${planoStats['Anual'] || 0}*\n` +
    `  • Vitalício: *${planoStats['Vitalício'] || 0}*\n\n` +
    `⏳ Pagamentos pendentes: *${pending}*\n` +
    `⚡ Uptime: *${formatUptime(process.uptime())}*\n` +
    `💳 PIX configurado: *${PIX_KEY ? 'Sim ✅' : 'Não ❌'}*`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────
//  RELATÓRIO DIÁRIO DO ADMIN — 6h (Brasília)
// ─────────────────────────────────────────
if (!isVercel) {
  // ─────────────────────────────────────────
  //  RELATÓRIO DIÁRIO DO ADMIN — 6h (Brasília)
  // ─────────────────────────────────────────
  cron.schedule('0 6 * * *', async () => {
    if (!ADMIN_ID) return;
    try {
      const subs = await DB.allSubscribers();
      const pendings = await DB.allPending();
      const total = subs.length;
      const pending = pendings.length;

      const planoStats = subs.reduce((acc, s) => {
        acc[s.plan] = (acc[s.plan] || 0) + 1;
        return acc;
      }, {});

      const todayStr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

      // Calcula novos assinantes nas últimas 24 horas
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      const newToday = subs.filter(s => {
        if (!s.subscribed_at) return false;
        return new Date(s.subscribed_at) > oneDayAgo;
      }).length;

      await bot.sendMessage(ADMIN_ID,
        `📊 *Relatório Diário de Assinaturas (${todayStr})*\n\n` +
        `👑 *Assinantes Ativos:* *${total}*\n` +
        `  • Mensal: *${planoStats['Mensal'] || 0}*\n` +
        `  • Anual: *${planoStats['Anual'] || 0}*\n` +
        `  • Vitalício: *${planoStats['Vitalício'] || 0}*\n\n` +
        `✨ *Novos nas últimas 24h:* *${newToday}*\n` +
        `⏳ *Pagamentos pendentes:* *${pending}*\n\n` +
        `🟢 *Status do Sistema:* Operacional e 100% online!`,
        { parse_mode: 'Markdown' }
      );
      log(`📅 Relatório diário enviado ao administrador às 6h.`);
    } catch (err) {
      logErr(`Erro ao enviar relatório diário: ${err.message}`);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ─────────────────────────────────────────
  //  DICA DIÁRIA AUTOMÁTICA — 8h (Brasília)
  // ─────────────────────────────────────────
  cron.schedule('0 8 * * *', async () => {
    const tip  = randomTip();
    const rows = await DB.allSubscribers();
    log(`📅 Dica diária para ${rows.length} assinante(s)...`);
    rows.forEach(({ chat_id }) => {
      bot.sendMessage(chat_id, `🌅 *Dica do dia:*\n\n${tip}`, { parse_mode: 'Markdown' }).catch(() => {});
    });
  }, { timezone: 'America/Sao_Paulo' });
}

// ─────────────────────────────────────────
//  SERVIDOR HTTP — health check + keep-alive
// ─────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  let total = 0;
  let pending = 0;
  try {
    const subs = await DB.allSubscribers();
    const pends = await DB.allPending();
    total = subs.length;
    pending = pends.length;
  } catch(e) {}

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: formatUptime(process.uptime()),
      subscribers: total,
      pending,
      pix: !!PIX_KEY,
      supabase: !!supabase,
    }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <h2>🤖 Minhas Finanças Bot — Online!</h2>
      <p>✅ Assinantes: <b>${total}</b></p>
      <p>⏳ Pendentes: <b>${pending}</b></p>
      <p>⚡ Uptime: <b>${formatUptime(process.uptime())}</b></p>
      <p>💳 PIX: <b>${PIX_KEY ? 'Configurado ✅' : 'Não configurado'}</b></p>
      <p>☁️ Supabase: <b>${supabase ? 'Conectado ✅' : 'Não configurado'}</b></p>
    `);
  }
});

if (!isVercel) {
  server.listen(PORT, () => log(`🌐 Servidor HTTP na porta ${PORT}`));
}

// ─────────────────────────────────────────
//  KEEP-ALIVE — pinga a si mesmo a cada 10 min
// ─────────────────────────────────────────
if (SELF_URL && !isVercel) {
  setInterval(() => {
    try {
      const urlObj = new URL('/health', SELF_URL);
      http.get(urlObj.toString(), (res) => {
        log(`⚡ Keep-alive → HTTP ${res.statusCode}`);
      }).on('error', (e) => logErr(`Keep-alive: ${e.message}`));
    } catch (e) {
      logErr(`Keep-alive URL inválida: ${e.message}`);
    }
  }, 10 * 60 * 1000);

  log(`⚡ Keep-alive ativo — pingando ${SELF_URL} a cada 10 min`);
}

// ─────────────────────────────────────────
//  TRATAMENTO DE ERROS GLOBAIS
// ─────────────────────────────────────────
bot.on('polling_error', (err) => {
  logErr(`Polling [${err.code}]: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
  logErr(`UnhandledRejection: ${reason}`);
});

process.on('uncaughtException', (err) => {
  logErr(`UncaughtException: ${err.stack || err.message}`);
});

// ─────────────────────────────────────────
//  UTILITÁRIOS
// ─────────────────────────────────────────
function log(msg)    { console.log(`[${ts()}] ${msg}`); }
function logErr(msg) { console.error(`[${ts()}] ⚠️  ${msg}`); }
function ts()        { return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); }
function formatUptime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h}h ${m}m ${sec}s`;
}

log('🚀 Minhas Finanças Bot com Multi-Planos iniciado!');
if (!PIX_KEY) log('⚠️  PIX_KEY não configurada — defina no .env para ativar pagamento PIX');

module.exports = {
  bot,
  DB,
  PLANS,
  randomTip,
  ADMIN_ID,
  log,
  logErr
};
