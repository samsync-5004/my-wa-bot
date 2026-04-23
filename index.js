const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { Groq } = require("groq-sdk");
const fs = require("fs");

const groq = new Groq({ apiKey: "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" });

// Load or create memory file
const MEMORY_FILE = "memory.json";
let memory = {};

if (fs.existsSync(MEMORY_FILE)) {
  memory = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
}

function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

function getHistory(contactId) {
  if (!memory[contactId]) {
    memory[contactId] = { history: [], tasks: [] };
  }
  return memory[contactId];
}

const SYSTEM_PROMPT = `You are Aria, a personal AI assistant on WhatsApp belonging to Dan, a Nigerian guy in Lagos.

You are chatting with Dan's contacts on his behalf.

LANGUAGE RULES:
- If the person messages in Pidgin, reply in Pidgin
- If the person messages in English, reply in English
- If they mix both, mix both
- Keep it natural, short and conversational

UNDERSTANDING MESSAGES:
- People make typos, add extra letters (e.g. "hellooooo", "yeahhh", "ohhh okay"), abbreviate words — understand them naturally
- Short messages like "xup", "wassup", "how far" are greetings — respond casually
- Emojis alone — respond with an emoji only
- If a message is completely unclear or random, do NOT respond
- Ignore spam, links, and promotional messages silently

TONE:
- Friendly, warm, short and real
- Never robotic or overly formal
- Never use "bro", "guy", "man", "sis" — you don't know who you're talking to
- Never call anyone "Dan"

TASK MANAGEMENT:
- If someone wants to remember something, save it as a task
- If asked "show tasks", list pending tasks
- If a task is done, mark it complete`;

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  },
  webVersion: "2.2412.54",
  webVersionCache: {
    type: "remote",
    remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html"
  }
});

client.on("qr", (qr) => {
  console.log("📱 Scan QR:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ Aria is online and ready for Dan!");
});

client.on("disconnected", (reason) => {
  console.log("❌ Disconnected:", reason);
});

client.on("message", async (msg) => {
  if (msg.from === "status@broadcast") return;
  if (msg.from.includes("@g.us")) return;
  if (msg.fromMe) return;
  if (msg.type === "ptt" || msg.type === "audio") return;
  if (!msg.body || msg.body.trim() === "") return;
  if (msg.body.includes("http://") || msg.body.includes("https://")) return;

  const contactId = msg.from;
  const userMessage = msg.body;
  const contact = getHistory(contactId);

  console.log(`Contact [${contactId}]:`, userMessage);

  contact.history.push({ role: "user", content: userMessage });

  if (contact.history.length > 20) {
    contact.history.splice(0, 2);
  }

  saveMemory();

  try {
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `${SYSTEM_PROMPT}\n\nCurrent tasks for this contact: ${JSON.stringify(contact.tasks)}`
        },
        ...contact.history
      ]
    });

    const reply = response.choices[0].message.content;

    contact.history.push({ role: "assistant", content: reply });
    saveMemory();

    await msg.reply(reply);
    console.log("Aria:", reply);

  } catch (err) {
    console.error("Error:", err.message);
  }
});

client.initialize();