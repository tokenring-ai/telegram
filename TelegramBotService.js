import TelegramBot from 'tgfancy';
import ChatService from "@token-ring/chat/ChatService";
import { runCommand } from "@token-ring/chat/runCommand";
import runChat from "@token-ring/ai-client/runChat";

import { Service } from "@token-ring/registry";
/**
 * TelegramBotService bridges Telegram chat to the chat engine.
 * Uses node-telegram-bot-api for more robust Telegram API integration.
 */
export default class TelegramBotService extends Service {
 name = "TelegramBotService";
 description = "Provides TelegramBot functionality";
 static constructorProperties = {
  botToken: {
   type: "string",
   required: true,
   description: "Telegram bot token provided by BotFather"
  },
  chatId: {
   type: "string",
   required: false,
   description: "Telegram chat ID to send messages to"
  }
 };

 constructor({ botToken, chatId }) {
  super();
  if (!botToken) {
   throw new Error("TelegramBotService requires a botToken.");
  }
  this.botToken = botToken;
  this.chatId = chatId;

  // Initialize the bot. Polling is set to false here because we will explicitly
  // start it in the `start` method after all handlers are set up.
  this.bot = new TelegramBot(this.botToken, { polling: false });
 }

 /**
  * Start polling Telegram for messages and handle them.
  * @param {TokenRingRegistry} registry - The package registry
  */
 async start(registry) {
  this.running = true;
  const chatService = registry.getFirstServiceByType(ChatService);

  // Create a custom logger for Telegram
  const logger = new class {
   sendQueue = [];
   lastMessageType = null;

   section(sectionName, ...msgs) {
    if (this.lastMessageType !== sectionName) {
     if (this.lastMessageType) {
      this.sendQueue[this.sendQueue.length - 1] += `\`\`\``;
     }
     this.sendQueue.push(`\n*${sectionName}*\n\`\`\``);
     this.lastMessageType = sectionName;
    }
    this.sendQueue[this.sendQueue.length - 1] += `${msgs.join(' ')}`;
   }
   systemLine(...msgs) {
    this.section("System", " ", ...msgs, "\n");
   }

   errorLine(...msgs) {
    this.section("Error", " ", ...msgs, "\n");
   }

   warningLine(...msgs) {
    this.section("Warning", " ", ...msgs, "\n");
   }

   write(...msgs) {
    this.section("AI", ...msgs);
   }

   getAndClearQueue() {
    if (this.lastMessageType) {
     this.sendQueue[this.sendQueue.length - 1] += `\`\`\``;
     this.lastMessageType = null;
    }
    return this.sendQueue.splice(0);
   }

   empty() {
    return this.sendQueue.length === 0;
   }
  }

  // Add logger to chat context
  chatService.addLogger(logger);

  // Subscribe to job queue _events
  chatService.subscribeToEvents('jobQueued', (jobInfo) => {
   logger.systemLine(`Job [${jobInfo.name}] queued. Queue length: ${jobInfo.queueLength}`);
  });

  chatService.subscribeToEvents('jobStarted', (jobInfo) => {
   logger.systemLine(`Job [${jobInfo.name}] started`);
  });

  chatService.subscribeToEvents('jobCompleted', (jobInfo) => {
   logger.systemLine(`Job [${jobInfo.name}] completed successfully`);
  });

  chatService.subscribeToEvents('jobFailed', (jobInfo) => {
   logger.errorLine(`Job [${jobInfo.name}] failed:`, jobInfo.error instanceof Error ? jobInfo.error.message : String(jobInfo.error));
  });

  // Set up message handler
  this.bot.on('message', async (msg) => {
   try {
    const chatId = msg.chat.id;
    this.chatId = chatId.toString(); // Update last sender's chat ID
    const text = msg.text || '';

    // Command handling
    const commandMatch = text.match(/^\/(\w+)\s*(.*)?$/);
    if (commandMatch) {
     try {
      // Use job queue for command execution
      await chatService.submitJob(
       `telegram/command/${commandMatch[1]}`,
       runCommand,
       [commandMatch[1], commandMatch[2], registry]
      );
     } catch (err) {
      logger.errorLine("Command execution error:", err instanceof Error ? err.message : String(err));
     }
    } else if (text.trim()) {
     // Normal chat input - use job queue
     try {
      await chatService.submitJob(
       'telegram/chat',
       runChat,
       [{
        input: [{ role: "user", content: text }],
        instructions: chatService.getInstructions(),
        model: chatService.getModel()
       }, registry]
      );

      // This will run after the chat job completes
      await chatService.submitJob(
       'telegram/chatComplete',
       async () => {
        chatService.systemLine("[Chat Complete]");
       },
       []
      );
     } catch (err) {
      logger.errorLine("Chat Error:", err instanceof Error ? err.message : String(err));
     }
    }
   } catch (error) {
    console.error('Error processing message:', error);
   }
  });

  // Set up error handler
  this.bot.on('polling_error', (error) => {
   console.error('Polling error:', error);
  });

  // Start polling
  this.bot.startPolling({
   restart: true,
   params: {
    timeout: 30
   }
  });

  // Set up periodic message sending
  const sendTimer = setInterval(async () => {
   if (!logger.empty() && this.chatId) {
    const text = logger.getAndClearQueue().join("").replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,'');

    try {
     await this.bot.sendMessage(this.chatId, text, {
      parse_mode: 'Markdown'
     });
    } catch (error) {
     console.error('Error sending message:', error);
    }
   }
  }, 1000);

  return () => {
   this.stop();
   clearInterval(sendTimer);
  };
 }

 /**
  * Stop the Telegram bot
  */
 stop() {
  this.running = false;
  try {
   this.bot.stopPolling();
  } catch (error) {
   console.error('Error stopping polling:', error);
  }
 }

 /**
  * Get the bot token
  */
 getBotToken() {
  return this.botToken;
 }

 /**
  * Get the current chat ID
  */
 getChatId() {
  return this.chatId;
 }

 /**
  * Reports the status of the service.
  * @param {TokenRingRegistry} registry - The package registry
  * @returns {Object} Status information.
  */
 async status(registry) {
  return {
   active: true,
   service: "TelegramBotService"
  };
 }}