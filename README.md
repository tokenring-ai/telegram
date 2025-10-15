# Telegram Service

Integrates Telegram with TokenRing agents, enabling bot interactions. Each Telegram user gets their own persistent agent instance that maintains conversation history.

## Prerequisites

- Telegram bot token from [@BotFather](https://t.me/botfather)
- **Bot Token (`botToken`)**: Token provided by BotFather
- **Chat ID (`chatId`)** (Optional): Chat for startup announcements
- **Authorized User IDs (`authorizedUserIds`)** (Optional): Array of user IDs allowed to use the bot
- **Default Agent Type (`defaultAgentType`)** (Optional): Agent type to create for users (defaults to "teamLeader")

## Setup

1. **Create Telegram Bot** via [@BotFather](https://t.me/botfather)
2. **Get Bot Token** from BotFather
3. **Get Chat ID** (optional): Send a message to your bot, then visit `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`

## Configuration

```typescript
import TelegramBotService from '@tokenring-ai/telegram/TelegramBotService';
import { AgentTeam } from '@tokenring-ai/agent';

const telegramService = new TelegramBotService({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  chatId: process.env.TELEGRAM_CHAT_ID, // Optional
  authorizedUserIds: ['123456789', '987654321'], // Optional
  defaultAgentType: 'teamLeader' // Optional
});

const agentTeam = new AgentTeam(config);
await agentTeam.addServices(telegramService);
await telegramService.start(agentTeam);
```

## Features

- **Per-User Agents**: Each Telegram user gets a dedicated agent with persistent chat history
- **Direct Messages**: Private conversations with the bot
- **Authorization**: Optional user whitelist
- **Slash Commands**: Forward to agent's command system (e.g., `/help`, `/reset`)

## Usage

- **Message**: Send any message to the bot
- **Commands**: `/help`, `/reset`, etc.

## Notes

- Each user's agent maintains independent conversation state
- Agents are cleaned up when service stops
- If `authorizedUserIds` is empty, all users can interact (set list to restrict access)
