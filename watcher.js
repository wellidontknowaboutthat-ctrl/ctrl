import { ethers } from "ethers";
import TelegramBot from "node-telegram-bot-api";

// ---------------- CONFIG -----------------

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const THREAD_ID = process.env.THREAD_ID || null;
const RPC_WSS = process.env.RPC_WSS;

const GOVERNANCE = "0x90d1f8317911617d0a6683927149b6493b881fba";

// ABI (unchanged)
const ABI = [
  "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)",
  "event ProposalExecuted(uint256 proposalId)"
];

// ---------------- HELPERS -----------------

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

const sent = {
  created: new Set(),
  start: new Set(),
  end: new Set(),
  executed: new Set(),
};

function ts(t) {
  return new Date(t * 1000).toLocaleString("en-GB", { timeZone: "Europe/London" });
}

async function send(msg) {
  try {
    if (THREAD_ID) {
      await bot.sendMessage(CHAT_ID, msg, { message_thread_id: THREAD_ID });
    } else {
      await bot.sendMessage(CHAT_ID, msg);
    }
  } catch (err) {
    console.error("Telegram error:", err);
  }
}

// ---------------- CATCH-UP (SAFE RANGE) -----------------

async function catchUp(gov, provider) {
  console.log("Running catch-up...");

  const currentBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(currentBlock - 200000, 0); // last ~6 days on Base
  const toBlock = "latest";

  console.log(`Querying logs from block ${fromBlock} to latest`);

  const filter = gov.filters.ProposalCreated();

  let logs;

  try {
    logs = await gov.queryFilter(filter, fromBlock, toBlock);
  } catch (e) {
    console.error("Catch-up query error:", e);
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  for (const l of logs) {
    const { proposalId, voteStart, voteEnd, description } = l.args;
    const id = proposalId.toString();

    // created
    if (!sent.created.has(id)) {
      sent.created.add(id);
      await send(
        `📢 *Proposal Created*\n🆔 ${id}\n📝 ${description}\n📅 Starts: ${ts(voteStart)}\n📅 Ends: ${ts(voteEnd)}`
      );
    }

    // voting started
    if (now >= voteStart && now < voteEnd && !sent.start.has(id)) {
      sent.start.add(id);
      await send(`🟢 *Voting Started*\n🆔 ${id}\n⏰ ${ts(voteStart)}`);
    }

    // voting ended
    if (now >= voteEnd && !sent.end.has(id)) {
      sent.end.add(id);
      await send(`🔴 *Voting Ended*\n🆔 ${id}\n⏰ ${ts(voteEnd)}`);
    }
  }

  console.log("Catch-up done.");
}

// ---------------- LIVE WATCHERS -----------------

function attachListeners(gov) {
  gov.on(
    "ProposalCreated",
    async (proposalId, proposer, targets, values, signatures, calldatas, voteStart, voteEnd, description) => {
      const id = proposalId.toString();
      if (sent.created.has(id)) return;

      sent.created.add(id);

      await send(
        `📢 *New Proposal Created*\n🆔 ${id}\n📝 ${description}\n📅 Starts: ${ts(voteStart)}\n📅 Ends: ${ts(voteEnd)}`
      );

      setTimeout(async () => {
        if (!sent.start.has(id)) {
          sent.start.add(id);
          await send(`🟢 *Voting Started*\n🆔 ${id}\n⏰ ${ts(voteStart)}`);
        }
      }, voteStart * 1000 - Date.now());

      setTimeout(async () => {
        if (!sent.end.has(id)) {
          sent.end.add(id);
          await send(`🔴 *Voting Ended*\n🆔 ${id}\n⏰ ${ts(voteEnd)}`);
        }
      }, voteEnd * 1000 - Date.now());
    }
  );

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

  const provider = new ethers.WebSocketProvider(RPC_WSS);
  const gov = new ethers.Contract(GOVERNANCE, ABI, provider);

  await send("🟦 Bot started (catch-up enabled)…");

  await catchUp(gov, provider);
  attachListeners(gov);

  console.log("Watcher running...");
}

start().catch(err => {
  console.error("Fatal bot error:", err);
  process.exit(1);
});
