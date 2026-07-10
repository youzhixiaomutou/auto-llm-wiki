import * as obsidian from "obsidian";
import { ChatController, ChatMessage, ChatState, ChatView } from "../src/chatView";
import { __setLanguage } from "./obsidianMock";

const notices = (obsidian.Notice as unknown as { messages: string[] }).messages;

type MockButton = {
  onclick?: () => void | Promise<void>;
  disabled?: boolean;
  text?: string;
  classes?: string[];
};

type MockContent = {
  texts: string[];
  buttons: MockButton[];
  fields: Array<{ value: string; disabled: boolean; trigger(event: string, arg: unknown): void }>;
};

function baseController(overrides: Partial<ChatController> = {}): ChatController {
  return {
    answerChat: async () => "",
    saveChatAnswer: async () => undefined,
    hasApiKey: () => true,
    setStatus: () => undefined,
    loadChatState: () => ({ conversations: [], activeId: null }),
    saveChatState: () => undefined,
    ...overrides
  };
}

async function openView(controller: ChatController): Promise<{ view: ChatView; content: MockContent }> {
  const view = new ChatView({} as never, controller);
  await view.onOpen();
  return { view, content: (view as unknown as { contentEl: MockContent }).contentEl };
}

// The layout is not order-stable (header, empty-state chips, and per-message action buttons all
// share one flat button list in the mock), so select buttons by their role class instead of index.
function findButton(content: MockContent, cls: string): MockButton {
  const button = content.buttons.find((candidate) => candidate.classes?.includes(cls));
  if (!button) throw new Error(`no button with class ${cls}`);
  return button;
}

async function clickButton(content: MockContent, cls: string): Promise<void> {
  await findButton(content, cls).onclick!();
}

function buttonsByClass(content: MockContent, cls: string): MockButton[] {
  return content.buttons.filter((candidate) => candidate.classes?.includes(cls));
}

function findButtonByText(content: MockContent, text: string): MockButton {
  const button = content.buttons.find((candidate) => candidate.text === text);
  if (!button) throw new Error(`no button with text ${text}`);
  return button;
}

type MockModalContent = {
  buttons: Array<{ onclick?: () => void | Promise<void> }>;
  textInputs: Array<{ onchange?: (value: string) => void | Promise<void> }>;
};

function latestModalContent(): MockModalContent {
  const instances = (obsidian.Modal as unknown as { instances: Array<{ contentEl: MockModalContent }> }).instances;
  return instances[instances.length - 1].contentEl;
}

const SEND = "contextos-chat-send";

beforeEach(() => {
  __setLanguage("en");
  notices.length = 0;
  (obsidian.Modal as unknown as { instances: unknown[] }).instances.length = 0;
});

test("sends a question, renders the reply, and passes the history to the controller", async () => {
  let received: ChatMessage[] | undefined;
  const { content } = await openView(baseController({
    answerChat: async (messages) => { received = messages; return "The answer cites wiki/a.md"; }
  }));

  content.fields[0].value = "What is A?";
  await clickButton(content, SEND);

  expect(received?.[received.length - 1]).toEqual({ role: "user", content: "What is A?" });
  expect(content.texts).toContain("What is A?");
  expect(content.texts).toContain("The answer cites wiki/a.md");
  expect(content.fields[0].disabled).toBe(false); // re-enabled after reply
});

test("empty input is a no-op (no controller call)", async () => {
  const answerChat = jest.fn(async () => "x");
  const { content } = await openView(baseController({ answerChat }));

  content.fields[0].value = "   ";
  await clickButton(content, SEND);

  expect(answerChat).not.toHaveBeenCalled();
});

test("missing API key surfaces a notice and does not call the model", async () => {
  const answerChat = jest.fn(async () => "x");
  const { content } = await openView(baseController({ answerChat, hasApiKey: () => false }));

  content.fields[0].value = "hi";
  await clickButton(content, SEND);

  expect(answerChat).not.toHaveBeenCalled();
  expect(notices).toContain("Set your OpenAI API key in ContextOS settings.");
});

test("an error is surfaced and the input is re-enabled", async () => {
  const { content } = await openView(baseController({
    answerChat: async () => { throw new Error("boom"); }
  }));

  content.fields[0].value = "hi";
  await clickButton(content, SEND);

  expect(content.texts).toContain("boom");
  expect(notices).toContain("boom");
  expect(content.fields[0].disabled).toBe(false);
});

test("Enter (without shift) sends the message", async () => {
  const answerChat = jest.fn(async () => "reply");
  const { content } = await openView(baseController({ answerChat }));

  content.fields[0].value = "via enter";
  content.fields[0].trigger("keydown", { key: "Enter", shiftKey: false, preventDefault: () => undefined });
  await Promise.resolve();
  await Promise.resolve();

  expect(answerChat).toHaveBeenCalled();
});

test("Save to wiki asks the controller to file the preceding question and this reply", async () => {
  const saveChatAnswer = jest.fn(async () => undefined);
  const { content } = await openView(baseController({
    answerChat: async () => "the reply",
    saveChatAnswer
  }));

  content.fields[0].value = "the question";
  await clickButton(content, SEND); // renders a Save button on the reply
  await clickButton(content, "contextos-chat-save");

  expect(saveChatAnswer).toHaveBeenCalledWith("the question", "the reply");
});

test("a suggestion chip sends that prompt", async () => {
  const answerChat = jest.fn(async (_messages: ChatMessage[]) => "reply");
  const { content } = await openView(baseController({ answerChat }));

  await clickButton(content, "contextos-chat-suggestion"); // first chip

  expect(answerChat).toHaveBeenCalledTimes(1);
  const messages = answerChat.mock.calls[0][0];
  expect(messages[messages.length - 1].content).toBe("Summarize what my wiki covers");
});

test("New chat clears the history so the next turn starts fresh", async () => {
  const answerChat = jest.fn(async (_messages: ChatMessage[]) => "reply");
  const { content } = await openView(baseController({ answerChat }));

  content.fields[0].value = "first";
  await clickButton(content, SEND);

  await clickButton(content, "contextos-chat-newchat");

  content.fields[0].value = "second";
  await clickButton(content, SEND);

  const lastMessages = answerChat.mock.calls[answerChat.mock.calls.length - 1][0];
  expect(lastMessages).toEqual([{ role: "user", content: "second" }]);
});

test("a failed turn is rolled out of history so the next send is not a double user turn", async () => {
  const answerChat = jest.fn(async (_messages: ChatMessage[]) => "ok");
  answerChat.mockImplementationOnce(async () => { throw new Error("boom"); });
  const { content } = await openView(baseController({ answerChat }));

  content.fields[0].value = "Q1";
  await clickButton(content, SEND); // fails; Q1 must not linger in history

  content.fields[0].value = "Q2";
  await clickButton(content, SEND);

  const lastMessages = answerChat.mock.calls[answerChat.mock.calls.length - 1][0];
  expect(lastMessages).toEqual([{ role: "user", content: "Q2" }]);
});

test("a reply that lands after the view is closed is dropped", async () => {
  let resolveReply!: (value: string) => void;
  const answerChat = jest.fn(() => new Promise<string>((resolve) => { resolveReply = resolve; }));
  const { view, content } = await openView(baseController({ answerChat }));

  content.fields[0].value = "hi";
  const sendPromise = findButton(content, SEND).onclick!(); // awaits the pending reply
  await view.onClose(); // leaf closed mid-request
  resolveReply("late reply");
  await sendPromise;

  expect(content.texts).not.toContain("late reply");
});

test("Copy writes the reply to the clipboard", async () => {
  jest.useFakeTimers();
  const writeText = jest.fn(async () => undefined);
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText } }, configurable: true });
  try {
    const { content } = await openView(baseController({ answerChat: async () => "the reply" }));
    content.fields[0].value = "q";
    await clickButton(content, SEND);
    await clickButton(content, "contextos-chat-copy");

    expect(writeText).toHaveBeenCalledWith("the reply");
    jest.runOnlyPendingTimers();
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
    jest.useRealTimers();
  }
});

test("conversations coexist: switching back keeps each conversation's history", async () => {
  const answerChat = jest.fn(async (messages: ChatMessage[]) => `reply:${messages[messages.length - 1].content}`);
  const { content } = await openView(baseController({ answerChat }));

  content.fields[0].value = "first question";
  await clickButton(content, SEND);

  await clickButton(content, "contextos-chat-newchat"); // start a second conversation
  content.fields[0].value = "second question";
  await clickButton(content, SEND);

  await clickButton(content, "contextos-chat-history-toggle"); // open the history panel
  await findButtonByText(content, "first question").onclick!(); // switch back to conversation 1

  content.fields[0].value = "follow up";
  await clickButton(content, SEND);

  const lastMessages = answerChat.mock.calls[answerChat.mock.calls.length - 1][0];
  expect(lastMessages.map((message) => message.content)).toEqual([
    "first question",
    "reply:first question",
    "follow up"
  ]);
});

test("New chat is usable while the previous conversation is still awaiting a reply", async () => {
  let resolveFirst!: (value: string) => void;
  const answerChat = jest.fn();
  answerChat
    .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveFirst = resolve; })) // conv1 hangs
    .mockImplementationOnce(async () => "second reply"); // conv2
  const saveChatState = jest.fn();
  const { content } = await openView(baseController({ answerChat, saveChatState }));

  content.fields[0].value = "first question";
  const firstSend = findButton(content, SEND).onclick!(); // conv1 pending, not resolved yet
  expect(content.fields[0].disabled).toBe(true); // composer disabled while the active conv awaits

  await clickButton(content, "contextos-chat-newchat"); // must not be blocked
  expect(content.fields[0].disabled).toBe(false); // the new conversation is immediately usable

  content.fields[0].value = "second question";
  await clickButton(content, SEND); // send in conv2 while conv1 is still pending
  expect(answerChat).toHaveBeenCalledTimes(2);

  resolveFirst("first reply"); // conv1's reply finally lands
  await firstSend;

  const lastState = saveChatState.mock.calls[saveChatState.mock.calls.length - 1][0] as ChatState;
  const conv1 = lastState.conversations.find((c) => c.messages.some((m) => m.content === "first question"))!;
  expect(conv1.messages.map((m) => m.content)).toEqual(["first question", "first reply"]);
});

test("switching conversations clears an unsent draft", async () => {
  const state: ChatState = {
    conversations: [
      { id: "c1", title: "One", messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }], createdAt: 1, updatedAt: 2 },
      { id: "c2", title: "Two", messages: [{ role: "user", content: "c" }, { role: "assistant", content: "d" }], createdAt: 1, updatedAt: 1 }
    ],
    activeId: "c1"
  };
  const { content } = await openView(baseController({ loadChatState: () => state }));

  content.fields[0].value = "draft meant for c1";
  await clickButton(content, "contextos-chat-history-toggle");
  await findButtonByText(content, "Two").onclick!(); // switch to c2

  expect(content.fields[0].value).toBe("");
});

test("a background turn's failure still surfaces a notice", async () => {
  let rejectFirst!: (error: Error) => void;
  const answerChat = jest.fn();
  answerChat
    .mockImplementationOnce(() => new Promise<string>((_resolve, reject) => { rejectFirst = reject; }))
    .mockImplementationOnce(async () => "second reply");
  const { content } = await openView(baseController({ answerChat }));

  content.fields[0].value = "first";
  const firstSend = findButton(content, SEND).onclick!(); // conv1 pending
  await clickButton(content, "contextos-chat-newchat"); // switch away to a new conversation

  rejectFirst(new Error("network boom"));
  await firstSend;

  expect(notices).toContain("network boom"); // not silently dropped despite being off-screen
});

test("state is persisted through the controller as messages are added", async () => {
  const saveChatState = jest.fn();
  const { content } = await openView(baseController({ answerChat: async () => "ok", saveChatState }));

  content.fields[0].value = "hello";
  await clickButton(content, SEND);

  expect(saveChatState).toHaveBeenCalled();
  const lastState = saveChatState.mock.calls[saveChatState.mock.calls.length - 1][0] as ChatState;
  expect(lastState.conversations).toHaveLength(1);
  expect(lastState.conversations[0].messages.map((message) => message.content)).toEqual(["hello", "ok"]);
});

test("existing conversations load from the controller and render", async () => {
  const state: ChatState = {
    conversations: [
      {
        id: "c1",
        title: "Prior chat",
        messages: [{ role: "user", content: "old q" }, { role: "assistant", content: "old a" }],
        createdAt: 1,
        updatedAt: 2
      }
    ],
    activeId: "c1"
  };
  const { content } = await openView(baseController({ loadChatState: () => state }));

  expect(content.texts).toContain("old q");
  expect(content.texts).toContain("old a");
});

test("deleting a conversation asks for confirmation, then removes it", async () => {
  const saveChatState = jest.fn();
  const state: ChatState = {
    conversations: [
      { id: "c1", title: "Keep me", messages: [{ role: "user", content: "k" }], createdAt: 1, updatedAt: 2 },
      { id: "c2", title: "Trash me", messages: [{ role: "user", content: "t" }], createdAt: 1, updatedAt: 1 }
    ],
    activeId: "c1"
  };
  const { content } = await openView(baseController({ loadChatState: () => state, saveChatState }));

  await clickButton(content, "contextos-chat-history-toggle"); // open history
  buttonsByClass(content, "contextos-chat-history-delete")[0].onclick!(); // opens a confirm modal for c1

  expect(saveChatState).not.toHaveBeenCalled(); // nothing deleted until confirmed
  await latestModalContent().buttons[0].onclick!(); // confirm delete

  const lastState = saveChatState.mock.calls[saveChatState.mock.calls.length - 1][0] as ChatState;
  expect(lastState.conversations).toHaveLength(1);
  expect(lastState.conversations[0].id).toBe("c2");
});

test("cancelling the delete confirmation keeps the conversation", async () => {
  const saveChatState = jest.fn();
  const state: ChatState = {
    conversations: [{ id: "c1", title: "Keep me", messages: [{ role: "user", content: "k" }], createdAt: 1, updatedAt: 1 }],
    activeId: "c1"
  };
  const { content } = await openView(baseController({ loadChatState: () => state, saveChatState }));

  await clickButton(content, "contextos-chat-history-toggle");
  buttonsByClass(content, "contextos-chat-history-delete")[0].onclick!();
  await latestModalContent().buttons[1].onclick!(); // cancel

  expect(saveChatState).not.toHaveBeenCalled();
});

test("renaming a conversation updates its title", async () => {
  const saveChatState = jest.fn();
  const state: ChatState = {
    conversations: [{ id: "c1", title: "Old", messages: [{ role: "user", content: "x" }], createdAt: 1, updatedAt: 1 }],
    activeId: "c1"
  };
  const { content } = await openView(baseController({ loadChatState: () => state, saveChatState }));

  await clickButton(content, "contextos-chat-history-toggle");
  buttonsByClass(content, "contextos-chat-history-rename")[0].onclick!(); // opens the rename modal

  const modal = latestModalContent();
  modal.textInputs[0].onchange!("New Title");
  await modal.buttons[0].onclick!(); // submit

  const lastState = saveChatState.mock.calls[saveChatState.mock.calls.length - 1][0] as ChatState;
  expect(lastState.conversations[0].title).toBe("New Title");
});
