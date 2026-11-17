import { beforeEach, describe, expect, it, mock } from "bun:test";
import type TokenRingApp from "@tokenring-ai/app";
import type { IncomingMessage } from "@tokenring-ai/bot";
import ConversationStream from "@tokenring-ai/bot/ConversationStream";
import type TelegramService from "../TelegramService.ts";

type Handler = (ctx: { message?: unknown; update: Record<string, unknown> }) => void;

/** Stands in for node-telegram-bot-api's Bot: records handlers and API calls, polls until stopped. */
class FakeBot {
  static instances: FakeBot[] = [];
  /** Results for successive startPolling calls; `"run"` polls until stop(). */
  static pollPlan: Array<"run" | Error> = [];

  botInfo = { id: 1, is_bot: true, first_name: "Helper", username: "helper_bot" };
  handlers = new Map<string, Handler>();
  pollCalls = 0;
  private abort: (() => void) | undefined;
  api = {
    sendMessage: mock(async (_params: Record<string, unknown>) => ({ message_id: 100 + this.api.sendMessage.mock.calls.length })),
    editMessageText: mock(async (_params: Record<string, unknown>) => ({})),
    getFile: mock(async () => ({})),
  };

  constructor(readonly token: string) {
    FakeBot.instances.push(this);
  }

  catch(): void {}

  init(): Promise<void> {
    return Promise.resolve();
  }

  on(event: string, handler: Handler): void {
    this.handlers.set(event, handler);
  }

  startPolling(): Promise<void> {
    const outcome = FakeBot.pollPlan[this.pollCalls++] ?? "run";
    if (outcome instanceof Error) return Promise.reject(outcome);
    return new Promise(resolve => {
      this.abort = resolve;
    });
  }

  stop(): void {
    this.abort?.();
    this.abort = undefined;
  }
}

void mock.module("node-telegram-bot-api", () => ({ Bot: FakeBot }));

const { default: TelegramMessagingProvider } = await import("../TelegramMessagingProvider.ts");

function mockApp() {
  return { serviceOutput: mock(), serviceError: mock() };
}

async function startProvider(pollRestart = { initialDelayMs: 1, maxDelayMs: 4, healthyRunMs: 60_000 }) {
  const app = mockApp();
  const provider = new TelegramMessagingProvider(app as unknown as TokenRingApp, { name: "TelegramService" } as unknown as TelegramService, "telegram", {
    botToken: "token",
    maxPhotoPixels: 1_000_000,
    maxFileSize: 20_971_520,
    maxDocumentSize: 10_485_760,
  });
  (provider as unknown as { pollRestart: unknown }).pollRestart = pollRestart;
  await provider.start();
  const bot = FakeBot.instances.at(-1)!;
  const received: IncomingMessage[] = [];
  provider.onMessage(message => {
    received.push(message);
  });
  return { app, provider, bot, received };
}

let messageId = 0;

function telegramMessage(overrides: Record<string, unknown> = {}) {
  return {
    message_id: ++messageId,
    date: 0,
    chat: { id: -1001, type: "supergroup", title: "Team" },
    from: { id: 55, is_bot: false, first_name: "Alice", username: "alice" },
    text: "@helper_bot hello",
    ...overrides,
  };
}

async function deliver(bot: FakeBot, message: Record<string, unknown>) {
  bot.handlers.get("message")!({ message, update: { message } });
  await new Promise(resolve => setTimeout(resolve, 0));
}

function waitFor(condition: () => boolean, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise<void>((resolve, reject) => {
    const check = () => {
      if (condition()) resolve();
      else if (Date.now() > deadline) reject(new Error("timed out"));
      else setTimeout(check, 1);
    };
    check();
  });
}

describe("TelegramMessagingProvider", () => {
  beforeEach(() => {
    FakeBot.instances = [];
    FakeBot.pollPlan = [];
  });

  it("ignores messages from bots, its own included", async () => {
    const { provider, bot, received } = await startProvider();
    await deliver(bot, telegramMessage({ from: { id: 1, is_bot: true, first_name: "Helper", username: "helper_bot" } }));
    await deliver(bot, telegramMessage({ from: { id: 7, is_bot: true, first_name: "Other" } }));
    await deliver(bot, telegramMessage());
    expect(received.map(message => message.userId)).toEqual(["55"]);
    await provider.stop();
  });

  it("strips its mention, and answers a group message under the message itself", async () => {
    const { provider, bot, received } = await startProvider();
    const question = telegramMessage({
      reply_to_message: { message_id: 3, date: 0, chat: { id: -1001, type: "supergroup" }, from: { id: 77, is_bot: false, first_name: "Bob" } },
    });
    await deliver(bot, question);

    expect(received[0]).toEqual(
      expect.objectContaining({
        conversationId: "-1001",
        text: "hello",
        messageId: String(question.message_id),
        replyTarget: String(question.message_id),
        addressed: true,
        direct: false,
      }),
    );
    await provider.stop();
  });

  it("reports the parent of a reply to the bot, and still answers under the reply itself", async () => {
    const { provider, bot, received } = await startProvider();
    await deliver(
      bot,
      telegramMessage({
        text: "sure",
        reply_to_message: { message_id: 42, date: 0, chat: { id: -1001, type: "supergroup" }, from: { id: 1, is_bot: true, first_name: "Helper" } },
      }),
    );
    expect(received[0]).toEqual(expect.objectContaining({ replyToMessageId: "42", replyTarget: String(received[0]!.messageId), addressed: true }));
    await provider.stop();
  });

  it("treats a private chat as direct", async () => {
    const { provider, bot, received } = await startProvider();
    await deliver(bot, telegramMessage({ chat: { id: 55, type: "private" }, text: "hi" }));
    expect(received[0]).toEqual(expect.objectContaining({ conversationId: "55", direct: true, addressed: true, replyToMessageId: undefined }));
    await provider.stop();
  });

  it("splits a long response into messages Telegram accepts", async () => {
    const { provider, bot } = await startProvider();
    const stream = new ConversationStream(provider, "-1001", error => {
      throw error;
    });
    stream.append("word ".repeat(2000));
    stream.markComplete();
    await stream.flush();

    const sent = bot.api.sendMessage.mock.calls.map(call => String(call[0].text));
    expect(sent.length).toBeGreaterThan(1);
    for (const text of sent) expect(text.length).toBeLessThanOrEqual(4096);
    expect(sent.join("").replace(/\s+/g, "")).toBe("word".repeat(2000));
    await provider.stop();
  });

  it("resends as plain text when Telegram cannot parse the Markdown", async () => {
    const { provider, bot } = await startProvider();
    bot.api.sendMessage.mockRejectedValueOnce(new Error("Bad Request: can't parse entities: unclosed bold"));
    bot.api.sendMessage.mockResolvedValueOnce({ message_id: 9 });

    expect(await provider.sendMessage("-1001:5", "*oops", { replyToMessageId: "4" })).toBe("9");
    const [first, second] = bot.api.sendMessage.mock.calls.map(call => call[0]);
    expect(first).toEqual(expect.objectContaining({ chat_id: "-1001", message_thread_id: 5, parse_mode: "Markdown" }));
    expect(second).toEqual(
      expect.objectContaining({
        chat_id: "-1001",
        message_thread_id: 5,
        text: "*oops",
        reply_parameters: { message_id: 4, allow_sending_without_reply: true },
      }),
    );
    expect(second).not.toHaveProperty("parse_mode");
    await provider.stop();
  });

  it("does not hide other send errors behind the Markdown fallback", async () => {
    const { provider, bot } = await startProvider();
    bot.api.sendMessage.mockRejectedValueOnce(new Error("Forbidden: bot was blocked by the user"));
    await expect(provider.sendMessage("55", "hi")).rejects.toThrow(/blocked/);
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    await provider.stop();
  });

  it("restarts a poller that died, reporting it and marking the account unhealthy until it recovers", async () => {
    FakeBot.pollPlan = [new Error("409: Conflict: terminated by other getUpdates request"), new Error("409 again"), "run"];
    const { app, provider, bot } = await startProvider();

    await waitFor(() => bot.pollCalls === 3);
    expect(app.serviceError).toHaveBeenCalledTimes(2);
    expect(String(app.serviceError.mock.calls[0]?.[1])).toContain("restarting");
    expect(provider.healthy).toBe(false);

    await deliver(bot, telegramMessage());
    expect(provider.healthy).toBe(true);
    await provider.stop();
  });

  it("stop() ends a restart backoff instead of waiting it out", async () => {
    FakeBot.pollPlan = [new Error("fatal")];
    const { app, provider, bot } = await startProvider({ initialDelayMs: 60_000, maxDelayMs: 60_000, healthyRunMs: 60_000 });
    await waitFor(() => app.serviceError.mock.calls.length === 1);

    const started = Date.now();
    await provider.stop();
    expect(Date.now() - started).toBeLessThan(1000);
    const calls = bot.pollCalls;
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(bot.pollCalls).toBe(calls);
  });
});
