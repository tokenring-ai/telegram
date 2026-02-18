# @tokenring-ai/telegram

A TokenRing plugin providing Telegram bot integration for AI-powered agent interactions through Telegram.

## Overview

This package provides a Telegram bot service that integrates with TokenRing agents, enabling natural language conversations through Telegram. Each Telegram user gets their own dedicated agent instance that maintains conversation history and context. The service handles message routing, event processing, and automatic agent management. It supports multiple bots and group-based configurations.

## Features

- **Multi-Bot Support**: Manage multiple Telegram bots simultaneously with named configurations
- **Group-Based Configuration**: Configure bots with specific groups for different agents
- **Per-User Agents**: Each Telegram user gets a dedicated agent with persistent chat history
- **Event-Driven Communication**: Handles agent events and sends responses back to Telegram
- **Direct Messaging with Replies**: Send messages to users and await responses via Telegram reply mechanism
- **Escalation Provider**: Implements EscalationProvider interface for agent-to-human escalation workflows
- **Authorization**: User whitelist for restricted access control per group
- **Automatic Agent Management**: Creates and manages agents for each user automatically
- **Error Handling**: Robust error handling with user-friendly error messages
- **Timeout Management**: Configurable agent timeout handling
- **Graceful Shutdown**: Proper cleanup of all user agents on shutdown
- **Plugin Integration**: Seamless integration with TokenRing plugin system
- **Message Buffering**: Efficient message buffering with automatic edit/update for long responses
- **Group Management**: Support for multiple groups per bot with different agent types

## Installation

```bash
bun install @tokenring-ai/telegram
# or
yarn add @tokenring-ai/telegram
# or
bun add @tokenring-ai/telegram
```

## Configuration

The service uses Zod schema validation for configuration. Here are the available options:

### Bot Configuration

Each bot must include:

- **`botToken`** (string): Telegram bot token obtained from [@BotFather](https://t.me/botfather)
- **`name`** (string): Unique name for this bot configuration

### Optional Bot Settings

- **`joinMessage`** (string): Message to send when bot starts up to all configured groups
- **`groups`** (object): Map of group configurations with:
  - **`groupId`** (number, must be negative): Telegram group/chat ID
  - **`allowedUsers`** (string[]): Array of Telegram user IDs allowed to interact (empty = all users allowed)
  - **`agentType`** (string): Agent type to use for this group

### Plugin Configuration Schema

```typescript
export const TelegramServiceConfigSchema = z.object({
  bots: z.record(z.string(), TelegramBotConfigSchema)
});

export const TelegramBotConfigSchema = z.object({
  name: z.string(),
  botToken: z.string().min(1, "Bot token is required"),
  joinMessage: z.string().optional(),
  groups: z.record(z.string(), z.object({
    groupId: z.number().max(0, "Group ID must be a negative number"),
    allowedUsers: z.array(z.string()).default([]),
    agentType: z.string(),
  }))
});

export const TelegramEscalationProviderConfigSchema = z.object({
  type: z.literal('telegram'),
  bot: z.string(),
  group: z.string(),
});
```

### Example Configuration

```typescript
{
  bots: {
    "primaryBot": {
      name: "Primary Bot",
      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      joinMessage: "Bot is online! Type /help for available commands.",
      groups: {
        "developers": {
          groupId: -1001234567890,
          allowedUsers: ["123456789", "987654321"],
          agentType: "developerAgent"
        },
        "managers": {
          groupId: -1009876543210,
          allowedUsers: [],
          agentType: "managerAgent"
        }
      }
    },
    "secondaryBot": {
      name: "Secondary Bot",
      botToken: "987654:XYZ-ABC5678jkl-Mno987Qrs456def22",
      groups: {
        "support": {
          groupId: -1005555555555,
          allowedUsers: [],
          agentType: "supportAgent"
        }
      }
    }
  }
}
```

### Plugin Installation

The recommended way to use the Telegram service is through the TokenRing plugin system:

```typescript
import TokenRingApp from '@tokenring-ai/app';
import telegramPlugin from '@tokenring-ai/telegram';

const app = new TokenRingApp({
  // Your app configuration
});

// Install the Telegram plugin
app.install(telegramPlugin);

// Configure via environment variables or app configuration
// TELEGRAM_BOTS_PRIMARYBOT_BOTTOKEN=your-bot-token
// TELEGRAM_BOTS_PRIMARYBOT_GROUPS_DEVELOPERS_GROUPID=-1001234567890
// TELEGRAM_BOTS_PRIMARYBOT_GROUPS_DEVELOPERS_ALLOWEDUSERS=123456789,987654321
// TELEGRAM_BOTS_PRIMARYBOT_GROUPS_DEVELOPERS_AGENTTYPE=teamLeader

await app.start();
```

### Escalation Provider Configuration

To use the Telegram escalation provider, configure both the Telegram plugin and escalation plugin:

```typescript
import TokenRingApp from '@tokenring-ai/app';
import telegramPlugin from '@tokenring-ai/telegram';
import escalationPlugin from '@tokenring-ai/escalation';

const app = new TokenRingApp({
  telegram: {
    bots: {
      "primaryBot": {
        name: "Primary Bot",
        botToken: process.env.TELEGRAM_BOT_TOKEN!,
        groups: {
          "admins": {
            groupId: -1001234567890,
            allowedUsers: [],
            agentType: "teamLeader"
          }
        }
      }
    }
  },
  escalation: {
    providers: {
      "telegramAdmins": {
        type: "telegram",
        bot: "primaryBot",
        group: "admins"
      }
    },
    groups: {
      "admins": ["123456789@telegram"]
    }
  }
});

app.install(escalationPlugin);
app.install(telegramPlugin);
```

## Direct Messaging and Escalation

The Telegram service supports direct messaging with reply-based responses, enabling synchronous communication between agents and users.

### Communication Channel API

```typescript
import {TelegramService} from '@tokenring-ai/telegram';

// Get the Telegram service from an agent
const telegramService = agent.requireServiceByType(TelegramService);

// Create a communication channel with a specific group
const bot = telegramService.getBot("primaryBot");
const channel = bot.createCommunicationChannelWithGroup("developers");

// Send a message
await channel.send('Please approve this deployment');

// Listen for a response
for await (const message of channel.receive()) {
  console.log('User responded:', message);
  break; // Process response and break out of loop
}
```

### How Reply Handling Works

1. Service sends message to user via Telegram
2. Message ID is stored with a reply handler
3. User replies to the message using Telegram's reply feature
4. Service detects the reply and invokes registered listeners with the response text
5. Confirmation message (✓ Response received) is sent to user

### Escalation Provider Integration

The Telegram service implements the `EscalationProvider` interface from `@tokenring-ai/escalation`, allowing agents to escalate decisions to human users:

```typescript
// In agent code
const escalationService = agent.requireServiceByType(EscalationService);

// Create a communication channel and send message
const channel = await escalationService.initiateContactWithUserOrGroup(
  'admins', // Group name
  'Approve production deployment?',
  agent
);

// Listen for response
for await (const message of channel.receive()) {
  if (message.toLowerCase().includes('yes')) {
    // Proceed with deployment
    console.log('Deployment approved');
  }
  await channel[Symbol.asyncDispose]();
  break;
}
```

### Reply Security

When a user replies to a bot-initiated message:
- Authorization checks are bypassed (bot initiated the conversation)
- Reply handlers are automatically cleaned up after response
- Only replies to tracked messages are processed

## API Reference

### Exports

- **`default`** - Plugin object for TokenRingApp installation
- **`TelegramService`** - The main service class for managing Telegram bots
- **`TelegramEscalationProvider`** - Escalation provider implementation
- **`TelegramServiceConfigSchema`** - Zod schema for configuration validation
- **`TelegramBotConfigSchema`** - Zod schema for bot configuration validation
- **`TelegramEscalationProviderConfigSchema`** - Zod schema for escalation provider configuration validation

### TelegramService Class

#### Constructor

```typescript
constructor(app: TokenRingApp, options: ParsedTelegramServiceConfig)
```

- **app**: TokenRingApp instance
- **options**: Validated configuration object with bots configuration

#### Methods

- **`run(signal: AbortSignal): Promise<void>`**: Starts the Telegram bots and begins polling for messages. Handles the complete service lifecycle including startup, message processing, and graceful shutdown.

#### Properties

- **`name`**: Service identifier ("TelegramService")
- **`description`**: Service description
- **`getAvailableBots()`**: Returns array of available bot names
- **`getBot(botName: string)`**: Returns the specified TelegramBot instance

### TelegramBot Class

#### Constructor

```typescript
constructor(app: TokenRingApp, botName: string, botConfig: ParsedTelegramBotConfig)
```

- **app**: TokenRingApp instance
- **botName**: Name of this bot configuration
- **botConfig**: Validated bot configuration

#### Methods

- **`start(): Promise<void>`**: Starts the Telegram bot and begins polling
- **`stop(): Promise<void>`**: Gracefully stops the bot and cleans up resources
- **`createCommunicationChannelWithGroup(groupName: string): CommunicationChannel`**: Creates a communication channel for a specific group
- **`createCommunicationChannelWithUser(userId: string): CommunicationChannel`**: Creates a communication channel for a specific user
- **`getBotUsername(): string | undefined`**: Returns the bot's username

### TelegramEscalationProvider Class

#### Constructor

```typescript
constructor(config: ParsedTelegramEscalationProviderConfig)
```

- **config**: Configuration with `bot` (bot name) and `group` (group name)

#### Methods

- **`createCommunicationChannelWithUser(groupName: string, agent: Agent): Promise<CommunicationChannel>`**: Creates a communication channel for escalation

## Service Lifecycle

1. **Initialization**: Service creates Telegram bot instances
2. **Message Handler Setup**: Configures message processing with authorization checks
3. **Reply Handler Setup**: Sets up reply detection for escalation messages
4. **Polling Start**: Begins Telegram API polling for each bot
5. **Startup Messages**: Sends "online" messages to configured groups if joinMessage is provided
6. **Message Processing**: Handles incoming messages with agent creation and event processing
7. **Graceful Shutdown**: Cleanup of all user agents and bot resources

## Message Processing Flow

### Regular Messages

1. **Authorization Check**: Verifies user is authorized for the group (if user whitelist is configured)
2. **Agent Management**: Gets or creates dedicated agent for the group
3. **State Wait**: Waits for agent to be idle before processing new input
4. **Input Handling**: Sends message to agent for processing
5. **Event Processing**: Subscribes to agent events:
   - `output.chat`: Sends chat responses to Telegram (with buffering)
   - `output.info`: Sends system messages with level formatting
   - `output.warning`: Sends system messages with level formatting
   - `output.error`: Sends system messages with level formatting
   - `input.handled`: Cleans up event subscription and handles timeouts
6. **Response Accumulation**: Accumulates chat content with intelligent buffering
7. **Timeout Handling**: Implements configurable timeout with user feedback

### Message Buffering

The service implements message buffering to efficiently handle long responses:

- **Maximum Message Length**: 4090 characters (safely under Telegram's 4096 limit)
- **Edit vs Send**: First message is sent, subsequent content edits the message
- **Split Long Messages**: If content exceeds limit, sends first chunk and schedules remainder
- **Rate Limiting**: 250ms delay between sends to avoid rate limiting

### Direct Messages (Escalation)

1. **Message Sent**: Bot sends message to user via `CommunicationChannel.send()`
2. **Handler Registered**: Message ID is tracked for reply detection
3. **User Replies**: User uses Telegram reply feature to respond
4. **Reply Processed**: Registered listeners are invoked with response text
5. **Confirmation Sent**: User receives "✓ Response received" confirmation
6. **Cleanup**: Handler removed from registry

## Getting Started

### 1. Create Telegram Bots

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Use `/newbot` command to create new bots
3. Follow the prompts to set up your bots
4. BotFather will provide you with bot tokens

### 2. Get Group IDs

1. Create Telegram groups for your agents
2. Add your bot to each group as an admin
3. Send a message to the group
4. Visit `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
5. Find the group ID in the response (negative number)

### 3. Set Up Configuration

```typescript
{
  bots: {
    "primaryBot": {
      name: "Primary Bot",
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      joinMessage: "Bot is online!",
      groups: {
        "developers": {
          groupId: -1001234567890,
          allowedUsers: ["123456789", "987654321"],
          agentType: "teamLeader"
        }
      }
    }
  }
}
```

## Event Handling

The service handles the following agent events:

- **`output.chat`**: Processes chat content and sends accumulated responses to Telegram
- **`output.info`**: Formats system messages with level indicators (INFO)
- **`output.warning`**: Formats system messages with level indicators (WARNING)
- **`output.error`**: Formats system messages with level indicators (ERROR)
- **`input.handled`**: Handles input completion, cleans up subscriptions, and manages timeouts

## Error Handling

### Bot-Level Errors

- **Polling Errors**: Logged to console with error details
- **Message Processing**: Wrapped in try-catch to prevent crashes
- **Bot Startup**: Validates configuration before initialization

### User-Level Errors

- **Authorization**: Sends "Sorry, you are not authorized to use this bot." for unauthorized users
- **Timeout**: Sends "Agent timed out after {time} seconds." when agents exceed max runtime
- **No Response**: Sends "No response received from agent." when no output is generated
- **Group Not Found**: Throws error when referencing non-existent group configuration

### Service-Level Errors

- **Configuration**: Validates bot token presence on construction
- **Shutdown**: Graceful cleanup with error handling for bot stop operations
- **Resource Management**: Proper cleanup of all user agents on service termination
- **Bot Not Found**: Throws error when referencing non-existent bot configuration

## Security Considerations

- **Bot Token Security**: Never commit bot tokens to version control
- **User Authorization**: Use `allowedUsers` to restrict bot access to specific users
- **Input Validation**: All user input is validated and sanitized
- **Error Information**: Error messages are user-friendly without exposing internal details
- **Resource Cleanup**: Proper cleanup prevents resource leaks
- **Group ID Validation**: Ensures group IDs are negative numbers as required by Telegram

## Performance Considerations

- **Multi-Bot Support**: Multiple bots run concurrently with independent polling
- **Per-Group Agents**: Each group gets their own agent instance for isolation
- **Event Subscription**: Proper cleanup of event subscriptions prevents memory leaks
- **Timeout Management**: Configurable timeouts prevent infinite waiting
- **Message Buffering**: Efficient buffering reduces API calls
- **Rate Limiting**: Built-in delays prevent Telegram API rate limiting
- **Graceful Shutdown**: Clean resource cleanup on service termination

## Troubleshooting

### Common Issues

1. **"Bot token is required" error**: Ensure you've provided a valid bot token in configuration
2. **"Group not found" error**: Verify group name matches configuration exactly
3. **"Bot not found" error**: Verify bot name matches configuration exactly
4. **"Not authorized" message**: Add your user ID to `allowedUsers` array or remove the restriction
5. **Bot not responding**: Check that the service is started and polling is enabled
6. **Timeout messages**: Adjust `maxRunTime` in agent configuration or increase timeout period

### Debug Information

Enable detailed logging to troubleshoot issues:

```typescript
import { setLogLevel } from '@tokenring-ai/utility';

setLogLevel('debug');
```

### Environment Variables

Ensure these environment variables are properly set:

- `TELEGRAM_BOTS_PRIMARYBOT_BOTTOKEN`: Bot token from @BotFather
- `TELEGRAM_BOTS_PRIMARYBOT_JOINMESSAGE`: Optional startup message
- `TELEGRAM_BOTS_PRIMARYBOT_GROUPS_DEVELOPERS_GROUPID`: Group ID (negative number)
- `TELEGRAM_BOTS_PRIMARYBOT_GROUPS_DEVELOPERS_ALLOWEDUSERS`: Comma-separated user IDs
- `TELEGRAM_BOTS_PRIMARYBOT_GROUPS_DEVELOPERS_AGENTTYPE`: Agent type name

## Integration with TokenRing

### Plugin System

The Telegram service integrates seamlessly with TokenRing's plugin system:

```typescript
app.install({
  name: '@tokenring-ai/telegram',
  version: '0.2.0',
  description: 'A TokenRing plugin providing Telegram integration.',
  install(app, config) {
    if (config.telegram) {
      app.addServices(new TelegramService(app, config.telegram));
      if (config.escalation) {
        app.waitForService(EscalationService, escalationService => {
          for (const [providerName, provider] of Object.entries(config.escalation!.providers)) {
            if (provider.type === 'telegram') {
              escalationService.registerProvider(providerName, new TelegramEscalationProvider(provider));
            }
          }
        })
      }
    }
  }
});
```

### Agent Integration

- **Agent Creation**: Creates agents using `agentType` from group configuration
- **Event Processing**: Subscribes to agent events for response handling
- **State Management**: Maintains persistent state across conversations
- **Resource Management**: Proper cleanup of agent resources

## Package Structure

```
pkg/telegram/
├── index.ts                 # Main exports
├── plugin.ts                # Plugin definition for TokenRing integration
├── TelegramService.ts       # Core service implementation
├── TelegramBot.ts           # Bot implementation with message handling
├── TelegramEscalationProvider.ts  # Escalation provider implementation
├── schema.ts                # Configuration schemas
├── test/                    # Test files
└── vitest.config.ts         # Vitest configuration
```

## Dependencies

### Production Dependencies

- `@tokenring-ai/app` (0.2.0) - Application framework
- `@tokenring-ai/chat` (0.2.0) - Chat service integration
- `@tokenring-ai/agent` (0.2.0) - Agent management
- `@tokenring-ai/utility` (0.2.0) - Utility functions
- `@tokenring-ai/escalation` (0.2.0) - Escalation provider interface
- `node-telegram-bot-api` (^0.67.0) - Telegram API binding

### Development Dependencies

- `@types/node-telegram-bot-api` (^0.64.13) - TypeScript definitions
- `vitest` (^4.0.18) - Testing framework
- `typescript` (^5.9.3) - TypeScript compiler

## Testing

The package includes comprehensive unit and integration tests:

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run tests with coverage
bun test --coverage
```

## License

MIT License - see [LICENSE](./LICENSE) file for details.