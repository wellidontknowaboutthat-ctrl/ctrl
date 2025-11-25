import { ethers } from "ethers";
import TelegramBot from "node-telegram-bot-api";

// ---------------- CONFIG -----------------

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;             // group or channel
const THREAD_ID = process.env.THREAD_ID || null; // topic thread ID (optional)
const RPC_WSS = process.env.RPC_WSS;

// governance contract
const GOVERNANCE = "0x90d1f8317911617d0a6683927149b6493b881fba";

// ABI for ProposalCreated + ProposalExecuted
const ABI = [
  "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)",
  "event ProposalExecuted(uint256 proposalId)"
];

// ------------------------------------------

const bot = new TelegramBot(BOT_TOKEN, { polling: false });
let provider;

// Track alerts to prevent duplicates
const sent = {
  created: new Set(),
  start: new Set(),
  end: new Set(),
  executed: new Set(),
};

// Convert UNIX timestamp → UK time string
function ts(t) {
  return new Date(t * 1000).toLocaleString("en-GB", { timeZone: "Europe/London" });
}

// Unified send function (topic-aware)
async function send(message) {
  try {
    if (THREAD_ID) {
      await bot.sendMessage(CHAT_ID, message, { message_thread_id: THREAD_ID });
    } else {
      await bot.sendMessage(CHAT_ID, message);
    }
  } catch (e) {
    console.error("Telegram error:", e);
  }
}

// ---------------- CATCH-UP LOGIC -----------------

async function catchUp(gov) {
  console.log("Running catch-up...");

  // get all past ProposalCreated events
  const filter = gov.filters.ProposalCreated();
  const logs = await gov.queryFilter(filter, 0, "latest");

  for (const log of logs) {
    const {
      proposalId,
      voteStart,
      voteEnd,
      description
    } = log.args;

    const id = proposalId.toString();
    const now = Math.floor(Date.now() / 1000);

    // ◼︎ ALERT 1 — Proposal Created (always catch up)
    if (!sent.created.has(id)) {
      sent.created.add(id);
      await send(
        `📢 *Proposal Created*\n\n🆔 ${id}\n📝 ${description}\n\n` +
        `🗓 Starts: *${ts(voteStart)}*\n🗓 Ends: *${ts(voteEnd)}*`
      );
    }

    // ◼︎ ALERT 2 — Voting Started (if start < now)
    if (now >= voteStart && now < voteEnd && !sent.start.has(id)) {
      sent.start.add(id);
      await send(`🟢 *Voting Started*\n🆔 ${id}\n⏰ ${ts(voteStart)}`);
    }

    // ◼︎ ALERT 3 — Voting Ended (if end < now)
    if (now >= voteEnd && !sent.end.has(id)) {
      sent.end.add(id);
      await send(`🔴 *Voting Ended*\n🆔 ${id}\n⏰ ${ts(voteEnd)}`);
    }
  }

  console.log("Catch-up complete.");
}

// ---------------- LIVE LISTENERS -----------------

function attachListeners(gov) {

  gov.on("ProposalCreated", async (
    proposalId,
    proposer,
    targets,
    values,
    signatures,
    calldatas,
    voteStart,
    voteEnd,
    description
  ) => {
    const id = proposalId.toString();

    if (sent.created.has(id)) return;
    sent.created.add(id);

    await send(
      `📢 *New Proposal Created*\n\n🆔 ${id}\n📝 ${description}\n\n` +
      `🗓 Starts: *${ts(voteStart)}*\n🗓 Ends: *${ts(voteEnd)}*`
    );

    // schedule start alert
    setTimeout(async () => {
      if (!sent.start.has(id)) {
        sent.start.add(id);
        await send(`🟢 *Voting Started*\n🆔 ${id}\n⏰ ${ts(voteStart)}`);
      }
    }, (voteStart * 1000) - Date.now());

    // schedule end alert
    setTimeout(async () => {
      if (!sent.end.has(id)) {
        sent.end.add(id);
        await send(`🔴 *Voting Ended*\n🆔 ${id}\n⏰ ${ts(voteEnd)}`);
      }
    }, (voteEnd * 1000) - Date.now());
  });

  gov.on("ProposalExecuted", async proposalId => {
    const id = proposalId.toString();
    if (sent.executed.has(id)) return;
    sent.executed.add(id);

    await send(`⚙️ *Proposal Executed*\n🆔 ${id}`);
  });
}

// ---------------- MAIN -----------------

async function start() {
  console.log("Connecting to Base RPC via WebSocket…");

  provider = new ethers.WebSocketProvider(RPC_WSS);
  const gov = new ethers.Contract(GOVERNANCE, ABI, provider);

  await send("🟦 Bot started (with catch-up, UK time, topic-aware)…");

  await catchUp(gov);
  attachListeners(gov);

  console.log("Watcher running...");
}

start().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
