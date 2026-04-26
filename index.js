const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// ============ DATA MANAGEMENT ============
const MEMORY_FILE = "memory.json";
const WHITELIST_FILE = "whitelist.json";
const USERS_FILE = "users.json";
const GROUPS_FILE = "groups.json";

let memory = fs.existsSync(MEMORY_FILE) ? JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8")) : {};
let whitelist = fs.existsSync(WHITELIST_FILE) ? JSON.parse(fs.readFileSync(WHITELIST_FILE, "utf8")) : [];
let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE, "utf8")) : {};
let groups = fs.existsSync(GROUPS_FILE) ? JSON.parse(fs.readFileSync(GROUPS_FILE, "utf8")) : [];

function saveMemory() { fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2)); }
function saveWhitelist() { fs.writeFileSync(WHITELIST_FILE, JSON.stringify(whitelist, null, 2)); }
function saveUsers() { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }
function saveGroups() { fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2)); }

const MY_NUMBER = "31843592208432@lid";

// ============ USER MANAGEMENT ============
function getUser(userId, groupId) {
  const key = `${groupId}_${userId}`;
  if (!users[key]) {
    users[key] = {
      id: userId, groupId, name: null, xp: 0, level: 1,
      streak: 0, lastCheckin: null, badges: [],
      roastsGiven: 0, roastsSurvived: 0, triviasWon: 0,
      duelsWon: 0, giftsGiven: 0, rapsUsed: 0,
      predictionsUsed: 0, secretFound: false, confessions: 0,
      registeredAt: new Date().toISOString()
    };
    saveUsers();
  }
  return users[key];
}

function addXP(userId, groupId, amount) {
  const user = getUser(userId, groupId);
  user.xp += amount;
  const oldLevel = user.level;
  if (user.xp >= 2000) user.level = 5;
  else if (user.xp >= 1000) user.level = 4;
  else if (user.xp >= 500) user.level = 3;
  else if (user.xp >= 200) user.level = 2;
  else user.level = 1;
  saveUsers();
  return { leveledUp: user.level > oldLevel, newLevel: user.level, xp: user.xp };
}

function getLevelName(level) {
  const names = { 1: "Rookie", 2: "Rising", 3: "Hustler", 4: "OG", 5: "Legend" };
  return names[level] || "Rookie";
}

function checkAndAwardBadge(user, badge, emoji) {
  if (!user.badges.find(b => b.badge === badge)) {
    user.badges.push({ badge, emoji, earnedAt: new Date().toISOString() });
    saveUsers();
    return true;
  }
  return false;
}

function getRequiredLevel(command) {
  const level2 = [".trivia", ".riddle", ".roast", ".compliment", ".wouldyourather", ".8ball", ".ship", ".mood", ".dare", ".truth"];
  const level3 = [".weather", ".news", ".calculate", ".define", ".translate", ".story", ".rap", ".emoji"];
  const level4 = [".duel", ".roastbattle", ".gift", ".rank", ".leaderboard", ".streak", ".badges", ".challenge", ".confess", ".prediction", ".nickname"];
  const level5 = [".advice", ".debate", ".poem", ".therapy", ".verdict", ".expose", ".announce", ".legendary", ".roastback"];
  const cmd = command.split(" ")[0].toLowerCase();
  if (level2.includes(cmd)) return 2;
  if (level3.includes(cmd)) return 3;
  if (level4.includes(cmd)) return 4;
  if (level5.includes(cmd)) return 5;
  return 1;
}

async function askAria(prompt) {
  try {
    const result = await geminiModel.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error("Gemini error:", err.message);
    return "Hmm, I couldn't process that right now. Try again! 😅";
  }
}

const DM_SYSTEM_PROMPT = `You are Aria, a personal AI assistant on WhatsApp belonging to Sam, a Nigerian guy in Lagos.
You are chatting with Sam's contacts on his behalf.
LANGUAGE RULES:
- If the person messages in Pidgin, reply in Pidgin
- If the person messages in English, reply in English
- If they mix both, mix both
- Keep it natural, short and conversational
TONE:
- Friendly, warm, short and real
- Never robotic or overly formal
- Never use "bro", "guy", "man", "sis"
- Never call anyone "Sam"`;

// ============ WHATSAPP CLIENT ============
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
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
  console.log("✅ Aria is online and ready for Sam!");
});

client.on("disconnected", (reason) => {
  console.log("❌ Disconnected:", reason);
});

// ============ MAIN MESSAGE HANDLER ============
client.on("message", async (msg) => {
  // Debug log
  console.log(`[${msg.from}] ${msg.fromMe ? "ME" : "THEM"}: ${msg.body}`);

  // Filters
  if (msg.from === "status@broadcast") return;
  if (msg.from.includes("@newsletter")) return;
  if (msg.from.includes("@broadcast")) return;
  if (msg.isStatus) return;
  if (msg.fromMe) return;
  if (!msg.body || msg.body.trim() === "") return;
  if (msg.type === "ptt" || msg.type === "audio") return;

  const isGroup = msg.from.includes("@g.us");
  const contactId = msg.from;
  const userMessage = msg.body.trim();
  const senderId = msg.author || msg.from;

  // ============ GROUP HANDLER ============
  if (isGroup) {
    const args = userMessage.split(" ");
    const command = args[0].toLowerCase();
    const rest = args.slice(1).join(" ");

    // .activate
    if (command === ".activate") {
      if (!groups.includes(contactId)) {
        groups.push(contactId);
        saveGroups();
        console.log("Group activated:", contactId);
        await msg.reply(`✅ *Aria is now active in this group!*\n\nType *.register* to create your profile and start earning XP! 🔥\nType *.help* to see all commands.`);
      } else {
        await msg.reply("Aria is already active in this group! 😊\nType *.help* to see commands.");
      }
      return;
    }

    // .deactivate
    if (command === ".deactivate") {
      groups = groups.filter(g => g !== contactId);
      saveGroups();
      await msg.reply("⛔ Aria has been deactivated in this group.");
      return;
    }

    // ignore if group not activated
    if (!groups.includes(contactId)) return;

    // ignore non-commands
    if (!userMessage.startsWith(".")) return;

    const user = users[`${contactId}_${senderId}`];

    if (!user && command !== ".register" && command !== ".help") {
      await msg.reply("You haven't registered yet! Type *.register* to get started 🚀");
      return;
    }

    if (user) {
      const required = getRequiredLevel(command);
      if (user.level < required) {
        await msg.reply(`⛔ This command requires *Level ${required} (${getLevelName(required)})*\nYou are Level ${user.level} (${getLevelName(user.level)})\nKeep earning XP to unlock it! 💪`);
        return;
      }
    }

    // .help
    if (command === ".help") {
      const lvl = user ? user.level : 1;
      let helpText = `🤖 *Aria Bot Commands*\n\n`;
      helpText += `*Level 1 — Rookie* ✅\n.register .checkin .level .profile\n.joke .fact .ask .hello .vibe .quote\n\n`;
      helpText += lvl >= 2 ? `*Level 2 — Rising* ✅\n.trivia .riddle .roast .compliment\n.wouldyourather .8ball .ship .mood .dare .truth\n\n` : `*Level 2 — Rising* 🔒 (200 XP)\n\n`;
      helpText += lvl >= 3 ? `*Level 3 — Hustler* ✅\n.weather .news .calculate .define\n.translate .story .rap .emoji\n\n` : `*Level 3 — Hustler* 🔒 (500 XP)\n\n`;
      helpText += lvl >= 4 ? `*Level 4 — OG* ✅\n.duel .roastbattle .gift .rank\n.leaderboard .streak .badges .challenge\n.confess .prediction .nickname\n\n` : `*Level 4 — OG* 🔒 (1000 XP)\n\n`;
      helpText += lvl >= 5 ? `*Level 5 — Legend* ✅\n.advice .debate .poem .therapy\n.verdict .expose .announce .legendary .roastback\n\n` : `*Level 5 — Legend* 🔒 (2000 XP)\n\n`;
      helpText += `💡 Earn XP by using commands and doing *.checkin* daily!`;
      await msg.reply(helpText);
      return;
    }

    // .register
    if (command === ".register") {
      if (user) { await msg.reply(`You're already registered! Use *.profile* to see your stats 😊`); return; }
      const contact = await msg.getContact();
      const name = contact.pushname || senderId.replace("@c.us", "").replace("@lid", "");
      const newUser = getUser(senderId, contactId);
      newUser.name = name;
      newUser.xp = 10;
      saveUsers();
      await msg.reply(`🎉 Welcome to Aria Bot, *${name}*!\n\n+10 XP for registering!\n\n🏆 Level: 1 (Rookie)\n⚡ XP: 10\n\nType *.help* to see commands\nType *.checkin* daily to earn XP! 🔥`);
      return;
    }

    // .checkin
    if (command === ".checkin") {
      const today = new Date().toDateString();
      if (user.lastCheckin === today) { await msg.reply(`Already checked in today! Come back tomorrow 😊\n🔥 Streak: ${user.streak} days`); return; }
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      user.streak = user.lastCheckin === yesterday ? user.streak + 1 : 1;
      user.lastCheckin = today;
      const xpEarned = 20 + (user.streak * 2);
      const result = addXP(senderId, contactId, xpEarned);
      const hour = new Date().getHours();
      let newBadge = "";
      if (hour < 7 && checkAndAwardBadge(user, "Early Bird", "🌅")) newBadge = "\n🌅 *Badge Earned: Early Bird!*";
      if (hour >= 0 && hour < 4 && checkAndAwardBadge(user, "Night Owl", "🦉")) newBadge += "\n🦉 *Badge Earned: Night Owl!*";
      if (user.streak >= 7 && checkAndAwardBadge(user, "On Fire", "🔥")) newBadge += "\n🔥 *Badge Earned: On Fire!*";
      if (user.streak >= 30 && checkAndAwardBadge(user, "Ice Cold", "❄️")) newBadge += "\n❄️ *Badge Earned: Ice Cold!*";
      saveUsers();
      let reply = `✅ *Check-in successful!*\n\n⚡ +${xpEarned} XP\n🔥 Streak: ${user.streak} days\n📊 Total XP: ${user.xp}${newBadge}`;
      if (result.leveledUp) reply += `\n\n🎊 *LEVEL UP! You are now Level ${result.newLevel} (${getLevelName(result.newLevel)})!*`;
      await msg.reply(reply);
      return;
    }

    // .level
    if (command === ".level") {
      const nextXP = [0, 200, 500, 1000, 2000];
      const needed = user.level < 5 ? nextXP[user.level] - user.xp : 0;
      await msg.reply(`📊 *${user.name}'s Level*\n\n🏆 Level: ${user.level} (${getLevelName(user.level)})\n⚡ XP: ${user.xp}\n${user.level < 5 ? `📈 Need ${needed} more XP to level up` : "👑 MAX LEVEL REACHED!"}`);
      return;
    }

    // .profile
    if (command === ".profile") {
      const badgeList = user.badges.map(b => `${b.emoji} ${b.badge}`).join(", ") || "None yet";
      await msg.reply(`👤 *${user.name}'s Profile*\n\n🏆 Level: ${user.level} (${getLevelName(user.level)})\n⚡ XP: ${user.xp}\n🔥 Streak: ${user.streak} days\n🎖️ Badges: ${badgeList}\n😂 Roasts Given: ${user.roastsGiven}\n🧠 Trivia Wins: ${user.triviasWon}\n⚔️ Duel Wins: ${user.duelsWon}`);
      return;
    }

    // .joke
    if (command === ".joke") {
      const joke = await askAria("Tell me one short funny joke. Just the joke, nothing else.");
      addXP(senderId, contactId, 5);
      await msg.reply(`😂 ${joke}\n\n_(+5 XP)_`);
      return;
    }

    // .fact
    if (command === ".fact") {
      const fact = await askAria("Tell me one interesting random fact. Just the fact, nothing else.");
      addXP(senderId, contactId, 5);
      await msg.reply(`🧠 ${fact}\n\n_(+5 XP)_`);
      return;
    }

    // .quote
    if (command === ".quote") {
      const quote = await askAria("Give me one short motivational quote with the author. Just the quote and author.");
      addXP(senderId, contactId, 5);
      await msg.reply(`💭 ${quote}\n\n_(+5 XP)_`);
      return;
    }

    // .hello
    if (command === ".hello") {
      const greeting = await askAria(`Greet someone named ${user.name} in a fun warm Nigerian way. Short and punchy.`);
      addXP(senderId, contactId, 3);
      await msg.reply(`${greeting}\n\n_(+3 XP)_`);
      return;
    }

    // .vibe
    if (command === ".vibe") {
      const vibes = ["😎 Smooth Criminal", "🔥 On Fire Today", "💤 Low Battery Mode", "👑 Main Character Energy", "🌊 Going with the Flow", "⚡ Fully Charged", "🎯 Locked In"];
      const vibe = vibes[Math.floor(Math.random() * vibes.length)];
      addXP(senderId, contactId, 3);
      await msg.reply(`✨ *${user.name}'s vibe today:*\n${vibe}\n\n_(+3 XP)_`);
      return;
    }

    // .ask
    if (command === ".ask") {
      if (!rest) { await msg.reply("Ask me something! e.g. *.ask what is the meaning of life*"); return; }
      const answer = await askAria(`Answer this question shortly and conversationally: ${rest}`);
      addXP(senderId, contactId, 5);
      await msg.reply(`🤖 ${answer}\n\n_(+5 XP)_`);
      return;
    }

    // .trivia
    if (command === ".trivia") {
      const trivia = await askAria(`Give me a trivia question with 4 options and the correct answer. Format EXACTLY like this:
Question: [question here]
A) [option]
B) [option]
C) [option]
D) [option]
Answer: [just the letter A B C or D]`);
      const lines = trivia.split("\n");
      const answerLine = lines.find(l => l.toLowerCase().startsWith("answer:"));
      const answer = answerLine ? answerLine.split(":")[1].trim().toUpperCase() : "A";
      if (!memory.trivia) memory.trivia = {};
      memory.trivia[contactId] = { answer, timestamp: Date.now() };
      saveMemory();
      addXP(senderId, contactId, 5);
      const question = lines.filter(l => !l.toLowerCase().startsWith("answer:")).join("\n");
      await msg.reply(`🧠 *TRIVIA TIME!*\n\n${question}\n\nReply A, B, C or D!\n_(+20 XP if correct!)_`);
      return;
    }

    // Check trivia answer
    if (["a", "b", "c", "d"].includes(userMessage.toLowerCase()) && memory.trivia?.[contactId]) {
      const trivia = memory.trivia[contactId];
      if (Date.now() - trivia.timestamp < 60000) {
        if (userMessage.toUpperCase() === trivia.answer) {
          const result = addXP(senderId, contactId, 20);
          user.triviasWon += 1;
          if (user.triviasWon >= 10) checkAndAwardBadge(user, "Big Brain", "🧠");
          saveUsers();
          delete memory.trivia[contactId];
          saveMemory();
          let reply = `✅ *CORRECT!* Well done ${user.name}!\n\n+20 XP! 🎉`;
          if (result.leveledUp) reply += `\n\n🎊 *LEVEL UP! Level ${result.newLevel} (${getLevelName(result.newLevel)})!*`;
          await msg.reply(reply);
        } else {
          await msg.reply(`❌ Wrong! Correct answer was *${trivia.answer}*. Better luck next time!`);
          delete memory.trivia[contactId];
          saveMemory();
        }
      }
      return;
    }

    // .riddle
    if (command === ".riddle") {
      const riddle = await askAria(`Give me a riddle and its answer. Format EXACTLY like:
Riddle: [riddle here]
Answer: [answer here]`);
      const lines = riddle.split("\n");
      const answerLine = lines.find(l => l.toLowerCase().startsWith("answer:"));
      const answer = answerLine ? answerLine.split(":")[1].trim().toLowerCase() : "";
      if (!memory.riddles) memory.riddles = {};
      memory.riddles[contactId] = { answer, timestamp: Date.now() };
      saveMemory();
      addXP(senderId, contactId, 5);
      const riddleOnly = lines.filter(l => !l.toLowerCase().startsWith("answer:")).join("\n");
      await msg.reply(`🔮 *RIDDLE TIME!*\n\n${riddleOnly}\n\nFirst to answer correctly wins *15 XP!*`);
      return;
    }

    // .roast
    if (command === ".roast") {
      const intensity = rest.includes("hard") ? "very savage and spicy" : rest.includes("soft") ? "mild and gentle" : "funny and playful";
      const target = rest.replace(/hard|soft/g, "").replace(/@\d+/g, "").trim() || "someone in the group";
      const roast = await askAria(`Roast someone called "${target}" in a ${intensity} Nigerian way. Funny and creative, not genuinely mean. Under 3 sentences.`);
      user.roastsGiven += 1;
      if (user.roastsGiven >= 10) checkAndAwardBadge(user, "Roast King", "😂");
      addXP(senderId, contactId, 10);
      saveUsers();
      await msg.reply(`🔥 *ROASTED!*\n\n${roast}\n\n_(+10 XP to ${user.name})_`);
      return;
    }

    // .roastbattle
    if (command === ".roastbattle") {
      const target = rest.replace("@", "").trim() || "opponent";
      const roast1 = await askAria(`Give a savage funny roast from ${user.name} to ${target} in Nigerian style. Under 2 sentences.`);
      const roast2 = await askAria(`Give a savage funny comeback from ${target} back to ${user.name} in Nigerian style. Under 2 sentences.`);
      addXP(senderId, contactId, 15);
      checkAndAwardBadge(user, "Savage", "💀");
      saveUsers();
      await msg.reply(`⚔️ *ROAST BATTLE!*\n\n🔴 ${user.name}:\n${roast1}\n\n🔵 ${target}:\n${roast2}\n\nVote 🔴 or 🔵!\n_(+15 XP to ${user.name})_`);
      return;
    }

    // .roastback
    if (command === ".roastback") {
      user.roastsSurvived += 1;
      if (user.roastsSurvived >= 5) checkAndAwardBadge(user, "Untouchable", "🛡️");
      const comeback = await askAria(`Give a savage funny comeback for someone who just got roasted in a WhatsApp group. Nigerian style. Under 2 sentences.`);
      addXP(senderId, contactId, 10);
      saveUsers();
      await msg.reply(`🛡️ *CLAP BACK!*\n\n${comeback}\n\n_(+10 XP)_`);
      return;
    }

    // .compliment
    if (command === ".compliment") {
      const target = rest.replace("@", "").trim() || "this person";
      const compliment = await askAria(`Give a genuine heartfelt compliment to someone called "${target}" in a warm Nigerian way. Short.`);
      addXP(senderId, contactId, 5);
      await msg.reply(`💝 ${compliment}\n\n_(+5 XP)_`);
      return;
    }

    // .wouldyourather
    if (command === ".wouldyourather") {
      const wyr = await askAria(`Give me a fun "Would you rather" question with two options. Just the question.`);
      addXP(senderId, contactId, 5);
      await msg.reply(`🤔 *Would You Rather?*\n\n${wyr}\n\n_(+5 XP)_`);
      return;
    }

    // .8ball
    if (command === ".8ball") {
      if (!rest) { await msg.reply("Ask the magic 8 ball! e.g. *.8ball will I be rich?*"); return; }
      const answers = ["🎱 It is certain", "🎱 Without a doubt", "🎱 Yes definitely", "🎱 Most likely", "🎱 Reply hazy try again", "🎱 Ask again later", "🎱 Cannot predict now", "🎱 Don't count on it", "🎱 My sources say no", "🎱 Very doubtful"];
      addXP(senderId, contactId, 3);
      await msg.reply(`🎱 *Magic 8 Ball*\n\nQ: ${rest}\n\n${answers[Math.floor(Math.random() * answers.length)]}\n\n_(+3 XP)_`);
      return;
    }

    // .ship
    if (command === ".ship") {
      const people = rest.replace(/@/g, "").trim() || "these two";
      const percentage = Math.floor(Math.random() * 101);
      const comment = await askAria(`One funny line about ${percentage}% compatibility between two people. Short.`);
      addXP(senderId, contactId, 5);
      await msg.reply(`💘 *Compatibility Check*\n\n${people}\n\n❤️ ${percentage}% Match!\n${comment}\n\n_(+5 XP)_`);
      return;
    }

    // .mood
    if (command === ".mood") {
      const moods = ["😊 Happy and positive", "😤 Slightly irritated", "🥱 Tired and unbothered", "🔥 Energetic and ready", "😂 In a silly mood", "🤔 Deep in thought", "😴 Running on low battery"];
      addXP(senderId, contactId, 3);
      await msg.reply(`🔮 *${user.name}'s vibe:*\n${moods[Math.floor(Math.random() * moods.length)]}\n\n_(+3 XP)_`);
      return;
    }

    // .dare
    if (command === ".dare") {
      const dare = await askAria(`Give a fun dare for a WhatsApp group. Short, funny and appropriate.`);
      addXP(senderId, contactId, 5);
      await msg.reply(`😈 *DARE for ${user.name}:*\n\n${dare}\n\n_(+5 XP)_`);
      return;
    }

    // .truth
    if (command === ".truth") {
      const truth = await askAria(`Give a fun truth question for a WhatsApp group. Interesting but not too personal.`);
      addXP(senderId, contactId, 5);
      await msg.reply(`🫦 *TRUTH for ${user.name}:*\n\n${truth}\n\n_(+5 XP)_`);
      return;
    }

    // .weather
    if (command === ".weather") {
      const city = rest || "Lagos";
      const weather = await askAria(`Fake but realistic weather report for ${city} today. Temperature, condition, funny tip. Short.`);
      addXP(senderId, contactId, 5);
      await msg.reply(`🌤️ *Weather for ${city}*\n\n${weather}\n\n_(+5 XP)_`);
      return;
    }

    // .news
    if (command === ".news") {
      const news = await askAria(`Give 3 funny fake news headlines in Nigerian style. Number them 1, 2, 3.`);
      addXP(senderId, contactId, 5);
      await msg.reply(`📰 *Today's Headlines:*\n\n${news}\n\n_(+5 XP)_`);
      return;
    }

    // .calculate
    if (command === ".calculate") {
      if (!rest) { await msg.reply("e.g. *.calculate 25 * 4*"); return; }
      try {
        const result = eval(rest.replace(/[^0-9+\-*/.() ]/g, ""));
        addXP(senderId, contactId, 3);
        await msg.reply(`🧮 *${rest} = ${result}*\n\n_(+3 XP)_`);
      } catch { await msg.reply("❌ Couldn't calculate that. Try *.calculate 10 * 5*"); }
      return;
    }

    // .define
    if (command === ".define") {
      if (!rest) { await msg.reply("e.g. *.define serendipity*"); return; }
      const definition = await askAria(`Define "${rest}" in simple English. Short.`);
      addXP(senderId, contactId, 5);
      await msg.reply(`📖 *${rest}*\n\n${definition}\n\n_(+5 XP)_`);
      return;
    }

    // .translate
    if (command === ".translate") {
      if (!rest) { await msg.reply("e.g. *.translate Bonjour comment allez vous*"); return; }
      const translation = await askAria(`Translate to English: "${rest}". Give translation and original language.`);
      addXP(senderId, contactId, 5);
      await msg.reply(`🌍 *Translation:*\n\n${translation}\n\n_(+5 XP)_`);
      return;
    }

    // .story
    if (command === ".story") {
      const topic = rest || "a Nigerian student who became a millionaire";
      const story = await askAria(`Short funny story (4-5 sentences) about: ${topic}.`);
      addXP(senderId, contactId, 10);
      await msg.reply(`📖 *Story Time!*\n\n${story}\n\n_(+10 XP)_`);
      return;
    }

    // .rap
    if (command === ".rap") {
      const topic = rest || "hustle and grind";
      const rap = await askAria(`4-line rap verse about "${topic}" in Nigerian street style. Make it rhyme.`);
      user.rapsUsed += 1;
      if (user.rapsUsed >= 10) checkAndAwardBadge(user, "Rapper", "🎤");
      addXP(senderId, contactId, 10);
      saveUsers();
      await msg.reply(`🎤 *Aria spits:*\n\n${rap}\n\n_(+10 XP)_`);
      return;
    }

    // .emoji
    if (command === ".emoji") {
      if (!rest) { await msg.reply("e.g. *.emoji party*"); return; }
      const emojis = await askAria(`Describe "${rest}" using only emojis. Max 8 emojis, no words.`);
      addXP(senderId, contactId, 3);
      await msg.reply(`✨ *${rest}:* ${emojis}\n\n_(+3 XP)_`);
      return;
    }

    // .gift
    if (command === ".gift") {
      const parts = rest.split(" ");
      const targetName = parts[0].replace("@", "");
      const amount = parseInt(parts[1]) || 10;
      if (user.xp < amount) { await msg.reply(`❌ Not enough XP! You have ${user.xp} XP.`); return; }
      user.xp -= amount;
      user.giftsGiven += 1;
      if (user.giftsGiven >= 5) checkAndAwardBadge(user, "Generous", "💰");
      saveUsers();
      await msg.reply(`🎁 *${user.name}* gifted *${amount} XP* to *${targetName}*! 💝\n_(${user.name} now has ${user.xp} XP)_`);
      return;
    }

    // .rank
    if (command === ".rank") {
      const groupUsers = Object.values(users).filter(u => u.groupId === contactId).sort((a, b) => b.xp - a.xp);
      const rank = groupUsers.findIndex(u => u.id === senderId) + 1;
      await msg.reply(`🏅 *${user.name}'s Rank:* #${rank} of ${groupUsers.length}\n⚡ XP: ${user.xp}\n🏆 Level: ${user.level} (${getLevelName(user.level)})`);
      return;
    }

    // .leaderboard
    if (command === ".leaderboard") {
      const groupUsers = Object.values(users).filter(u => u.groupId === contactId).sort((a, b) => b.xp - a.xp).slice(0, 10);
      const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
      let board = `🏆 *Group Leaderboard*\n\n`;
      groupUsers.forEach((u, i) => { board += `${medals[i]} ${u.name} — ${u.xp} XP (Lvl ${u.level})\n`; });
      if (groupUsers.length === 0) board += "No players yet! Type *.register* to join!";
      await msg.reply(board);
      return;
    }

    // .streak
    if (command === ".streak") {
      await msg.reply(`🔥 *${user.name}'s Streak:* ${user.streak} days\n\nCheck in daily to keep it going!`);
      return;
    }

    // .badges
    if (command === ".badges") {
      const badgeList = user.badges.length > 0 ? user.badges.map(b => `${b.emoji} ${b.badge}`).join("\n") : "No badges yet! Keep playing 🎯";
      await msg.reply(`🎖️ *${user.name}'s Badges:*\n\n${badgeList}`);
      return;
    }

    // .challenge
    if (command === ".challenge") {
      const challenge = await askAria(`Fun daily challenge for a WhatsApp group member. Creative and doable.`);
      addXP(senderId, contactId, 5);
      await msg.reply(`🎯 *Daily Challenge for ${user.name}:*\n\n${challenge}\n\nComplete it for bonus XP! 💪\n_(+5 XP)_`);
      return;
    }

    // .confess
    if (command === ".confess") {
      const confession = rest || "I pressed this button with no confession 😂";
      user.confessions += 1;
      addXP(senderId, contactId, 10);
      saveUsers();
      await msg.reply(`🤫 *Anonymous Confession:*\n\n"${confession}"\n\n_(Identity protected 🔒 | +10 XP)_`);
      return;
    }

    // .prediction
    if (command === ".prediction") {
      const prediction = await askAria(`Funny fake fortune telling prediction. Dramatic and Nigerian. Short.`);
      user.predictionsUsed += 1;
      if (user.predictionsUsed >= 10) checkAndAwardBadge(user, "Oracle", "🔮");
      addXP(senderId, contactId, 5);
      saveUsers();
      await msg.reply(`🔮 *Aria sees your future ${user.name}...*\n\n${prediction}\n\n_(+5 XP)_`);
      return;
    }

    // .nickname
    if (command === ".nickname") {
      const parts = rest.split(" ");
      const target = parts[0].replace("@", "");
      const nickname = parts.slice(1).join(" ");
      if (!nickname) { await msg.reply("Usage: *.nickname @person nickname*"); return; }
      addXP(senderId, contactId, 5);
      await msg.reply(`😂 From now on, *${target}* shall be known as *"${nickname}"*!\n\nAll in favour say 🙋\n_(+5 XP to ${user.name})_`);
      return;
    }

    // .advice
    if (command === ".advice") {
      const situation = rest || "life in general";
      const advice = await askAria(`Deep genuine life advice about: ${situation}. Under 4 sentences.`);
      addXP(senderId, contactId, 10);
      await msg.reply(`💡 *Aria's Advice:*\n\n${advice}\n\n_(+10 XP)_`);
      return;
    }

    // .debate
    if (command === ".debate") {
      const topic = rest || "whether jollof rice or fried rice is better";
      const debate = await askAria(`Take a strong funny side on this debate: "${topic}". Passionate and funny. Under 4 sentences.`);
      addXP(senderId, contactId, 10);
      await msg.reply(`⚖️ *Aria's Debate:*\n\n${debate}\n\n_(+10 XP)_`);
      return;
    }

    // .poem
    if (command === ".poem") {
      const target = rest.replace("@", "").trim() || user.name;
      const poem = await askAria(`Short funny 4-line rhyming poem about someone called "${target}". Playful.`);
      addXP(senderId, contactId, 10);
      await msg.reply(`📜 *A Poem for ${target}:*\n\n${poem}\n\n_(+10 XP by ${user.name})_`);
      return;
    }

    // .therapy
    if (command === ".therapy") {
      const therapy = await askAria(`Funny fake therapy session response for a WhatsApp group member. Dramatic, funny and Nigerian. Under 4 sentences.`);
      addXP(senderId, contactId, 10);
      await msg.reply(`🛋️ *Dr. Aria's Therapy:*\n\n${therapy}\n\nThat'll be ₦50,000 please 😂\n_(+10 XP)_`);
      return;
    }

    // .verdict
    if (command === ".verdict") {
      const target = rest.replace("@", "").trim() || "this person";
      const verdict = await askAria(`Funny dramatic verdict on someone called "${target}" as a Nigerian judge. Under 3 sentences.`);
      addXP(senderId, contactId, 10);
      await msg.reply(`⚖️ *Aria's Verdict on ${target}:*\n\n${verdict}\n\n_(+10 XP)_`);
      return;
    }

    // .expose
    if (command === ".expose") {
      const target = rest.replace("@", "").trim() || "this person";
      const expose = await askAria(`Make up 2-3 funny harmless fake "secrets" about someone called "${target}". Clearly fictional and funny.`);
      addXP(senderId, contactId, 10);
      await msg.reply(`👀 *EXPOSED: ${target}*\n\n${expose}\n\n_(Aria knows everything 👀 | +10 XP)_`);
      return;
    }

    // .announce
    if (command === ".announce") {
      if (!rest) { await msg.reply("e.g. *.announce Meeting at 5pm*"); return; }
      addXP(senderId, contactId, 5);
      await msg.reply(`📢 *OFFICIAL ANNOUNCEMENT*\n\n${rest}\n\n_— by ${user.name} via Aria Bot_\n_(+5 XP)_`);
      return;
    }

    // .legendary
    if (command === ".legendary") {
      const legendary = await askAria(`Say something legendary and epic to a Level 5 WhatsApp bot user in Nigerian style.`);
      checkAndAwardBadge(user, "Legend", "👑");
      addXP(senderId, contactId, 50);
      saveUsers();
      await msg.reply(`👑 *LEGENDARY MODE*\n\n${legendary}\n\n_(+50 XP | 👑 Legend Badge!)_`);
      return;
    }

    // .secret
    if (command === ".secret") {
      if (!user.secretFound) {
        user.secretFound = true;
        checkAndAwardBadge(user, "Explorer", "🎯");
        addXP(senderId, contactId, 30);
        saveUsers();
        await msg.reply(`🎯 *YOU FOUND A SECRET COMMAND!*\n\n+30 XP and 🎯 Explorer Badge!\n\nThere are more secrets... keep exploring 👀`);
      } else {
        await msg.reply(`You found this one already 😄 Keep looking...`);
      }
      return;
    }

    return;
  }

  // ============ DM HANDLER ============
  if (!isGroup) {
    if (msg.body.includes("http://") || msg.body.includes("https://")) return;
    if (memory.botActive === false) return;

    // .start
    if (userMessage.toLowerCase() === ".start") {
      if (!whitelist.includes(contactId)) {
        whitelist.push(contactId);
        saveWhitelist();
        await msg.reply(`👋 *Hey! I'm Aria, Sam's personal AI assistant.*\n\nI'm now active for you! Just chat with me normally 😊`);
      } else {
        await msg.reply(`You're already connected! Just chat with me 😊`);
      }
      return;
    }

    if (!whitelist.includes(contactId)) {
      await msg.reply(`👋 *Hi! I'm Aria, Sam's assistant.*\n\nType *.start* to activate me! 😊`);
      return;
    }

    if (!memory.dmHistory) memory.dmHistory = {};
    if (!memory.dmHistory[contactId]) memory.dmHistory[contactId] = [];

    memory.dmHistory[contactId].push({ role: "user", content: userMessage });
    if (memory.dmHistory[contactId].length > 20) memory.dmHistory[contactId].splice(0, 2);

  try {
      const history = memory.dmHistory[contactId].map(m =>
        `${m.role === "user" ? "User" : "Aria"}: ${m.content}`
      ).join("\n");
      const fullPrompt = `${DM_SYSTEM_PROMPT}\n\nConversation:\n${history}\n\nAria:`;
      const result = await geminiModel.generateContent(fullPrompt);
      const reply = result.response.text().trim();
      memory.dmHistory[contactId].push({ role: "assistant", content: reply });
      saveMemory();
      await msg.reply(reply);
    } catch (err) {
      console.error("DM Error:", err.message);
    }
  }
});

// ============ SAM'S CONTROL PANEL ============
client.on("message_create", async (msg) => {
  if (!msg.fromMe) return;
  const contactId = msg.to;
  const userMessage = msg.body.trim();
  if (contactId !== MY_NUMBER) return;

  if (userMessage.toLowerCase() === ".menu") {
    await client.sendMessage(MY_NUMBER, `👋 *Welcome Sam! Control Panel:*

🟢 *.on* — Turn Aria on
🔴 *.off* — Turn Aria off
📊 *.status* — Check bot status
📖 *.readme* — Full usage guide

👥 *Groups:*
📋 *.groups* — List active groups
🗑️ *.removegroup GROUPID* — Remove group
_(To add: go to group and type .activate)_

👤 *Contacts:*
➕ *.add NUMBER* — Manually add contact
➖ *.remove NUMBER* — Remove contact
📋 *.list* — Show contacts

📢 *.broadcast MESSAGE* — Send to all groups
📈 *.stats* — Bot statistics`);
    return;
  }

  if (userMessage.toLowerCase() === ".readme") {
    await client.sendMessage(MY_NUMBER, `📖 *ARIA BOT GUIDE*

━━━━━━━━━━━━━━━
📱 *PERSONAL DMs*
- Someone messages you
- They see prompt to type *.start*
- Once they type *.start* Aria chats with them

━━━━━━━━━━━━━━━
👥 *GROUPS*
- Go to any group
- Type *.activate*
- Aria is live immediately!
- Members type *.register* to join
- Type *.deactivate* to turn off

━━━━━━━━━━━━━━━
🏆 *LEVELS*
Level 1 — Rookie (0 XP)
Level 2 — Rising (200 XP)
Level 3 — Hustler (500 XP)
Level 4 — OG (1000 XP)
Level 5 — Legend (2000 XP)

━━━━━━━━━━━━━━━
💡 *TIPS*
- *.checkin* daily for XP + streaks
- Win trivia for +20 XP
- Type *.secret* for hidden rewards
- More hidden commands exist!`);
    return;
  }

  if (userMessage.toLowerCase() === ".status") {
    const isActive = memory.botActive !== false ? "🟢 ON" : "🔴 OFF";
    await client.sendMessage(MY_NUMBER, `📊 *Status:*\nAria: ${isActive}\n👤 Contacts: ${whitelist.length}\n👥 Groups: ${groups.length}\n🎮 Players: ${Object.keys(users).length}`);
    return;
  }

  if (userMessage.toLowerCase() === ".stats") {
    const totalXP = Object.values(users).reduce((sum, u) => sum + u.xp, 0);
    const topPlayer = Object.values(users).sort((a, b) => b.xp - a.xp)[0];
    await client.sendMessage(MY_NUMBER, `📈 *Aria Stats:*\n\n🎮 Players: ${Object.keys(users).length}\n👤 Contacts: ${whitelist.length}\n👥 Groups: ${groups.length}\n⚡ Total XP: ${totalXP}\n👑 Top: ${topPlayer ? `${topPlayer.name} (${topPlayer.xp} XP)` : "None yet"}`);
    return;
  }

  if (userMessage.toLowerCase() === ".groups") {
    const list = groups.length > 0 ? groups.join("\n") : "No active groups\n\nGo to a group and type .activate!";
    await client.sendMessage(MY_NUMBER, `👥 *Active Groups:*\n\n${list}`);
    return;
  }

  if (userMessage.toLowerCase().startsWith(".removegroup ")) {
    const groupId = userMessage.split(" ")[1].trim();
    groups = groups.filter(g => g !== groupId);
    saveGroups();
    await client.sendMessage(MY_NUMBER, `✅ Group removed`);
    return;
  }

  if (userMessage.toLowerCase().startsWith(".broadcast ")) {
    const message = userMessage.replace(".broadcast ", "");
    let sent = 0;
    for (const groupId of groups) {
      try { await client.sendMessage(groupId, `📢 *Message from Aria:*\n\n${message}`); sent++; }
      catch (e) { console.error("Broadcast error:", e.message); }
    }
    await client.sendMessage(MY_NUMBER, `✅ Sent to ${sent} groups`);
    return;
  }

  if (userMessage.toLowerCase().startsWith(".add ")) {
    const number = userMessage.split(" ")[1].trim() + "@c.us";
    if (!whitelist.includes(number)) { whitelist.push(number); saveWhitelist(); await client.sendMessage(MY_NUMBER, `✅ Added ${number}`); }
    else await client.sendMessage(MY_NUMBER, `⚠️ Already in whitelist`);
    return;
  }

  if (userMessage.toLowerCase().startsWith(".remove ")) {
    const number = userMessage.split(" ")[1].trim() + "@c.us";
    whitelist = whitelist.filter(n => n !== number);
    saveWhitelist();
    await client.sendMessage(MY_NUMBER, `✅ Removed`);
    return;
  }

  if (userMessage.toLowerCase() === ".list") {
    const list = whitelist.length > 0 ? whitelist.join("\n") : "No contacts yet";
    await client.sendMessage(MY_NUMBER, `📋 *Contacts:*\n\n${list}`);
    return;
  }

  if (userMessage.toLowerCase() === ".off") {
    memory.botActive = false; saveMemory();
    await client.sendMessage(MY_NUMBER, "⛔ Aria is OFF");
    return;
  }

  if (userMessage.toLowerCase() === ".on") {
    memory.botActive = true; saveMemory();
    await client.sendMessage(MY_NUMBER, "✅ Aria is ON");
    return;
  }
});

client.initialize();