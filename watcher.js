import { ethers } from "ethers";
import TelegramBot from "node-telegram-bot-api";

// ---------------- CONFIG -----------------

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;      
const THREAD_ID = process.env.THREAD_ID;  
const RPC_WSS = process.env.RPC_WSS;

const GOVERNANCE = "0x90d1f8317911617d0a6683927149b6493b881fba";

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

function ts(unix) {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    timeZone: "Europe/London",
  });
}

async function send(msg) {
  try {
    await bot.sendMessage(CHAT_ID, msg, {
      message_thread_id: THREAD_ID,
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("Telegram error:", err);
  }
}

// ---------------- SAFE CATCH-UP (LAST 8 BLOCKS) -----------------

async function catchUp(gov, provider) {
  console.log("Running catch-up...");

  const latest = await provider.getBlockNumber();
  const from = Math.max(latest - 8, 0);

  console.log(`Querying logs from block ${from} to ${latest}`);

  let logs = [];
  try {
    logs = await gov.queryFilter(gov.filters.ProposalCreated(), from, latest);
  } catch (err) {
    console.error("Catch-up error:", err.message);
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  for (const l of logs) {
    const { proposalId, voteStart, voteEnd, description } = l.args;
    const id = proposalId.toString();

    // CREATED
    if (!sent.created.has(id)) {
      sent.created.add(id);
      await send(
        `📢 *Proposal Created*\n🆔 ${id}\n📝 ${description}\n📅 Starts: ${ts(
          voteStart
        )}\n📅 Ends: ${ts(voteEnd)}`
      );
    }

    // STARTED
    if (now >= voteStart && now < voteEnd && !sent.start.has(id)) {
      sent.start.add(id);
      await send(`🟢 *Voting Started*\n🆔 ${id}\n⏰ ${ts(voteStart)}`);
    }

    // ENDED
    if (now >= voteEnd && !sent.end.has(id)) {
      sent.end.add(id);
      await send(`🔴 *Voting Ended*\n🆔 ${id}\n⏰ ${ts(voteEnd)}`);
    }
  }

  console.log("Catch-up complete.");
}

// ---------------- LIVE LISTENERS -----------------

function attachListeners(gov) {
  gov.on(
    "ProposalCreated",
    async (
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
        `📢 *New Proposal Created*\n🆔 ${id}\n📝 ${description}\n📅 Starts: ${ts(
          voteStart
        )}\n📅 Ends: ${ts(voteEnd)}`
      );

      // schedule voting start
      const delayStart = voteStart * 1000 - Date.now();
      if (delayStart > 0) {
        setTimeout(async () => {
          if (!sent.start.has(id)) {
            sent.start.add(id);
            await send(`🟢 *Voting Started*\n🆔 ${id}\n⏰ ${ts(voteStart)}`);
          }
        }, delayStart);
      }

      // schedule voting end
      const delayEnd = voteEnd * 1000 - Date.now();
      if (delayEnd > 0) {
        setTimeout(async () => {
          if (!sent.end.has(id)) {
            sent.end.add(id);
            await send(`🔴 *Voting Ended*\n🆔 ${id}\n⏰ ${ts(voteEnd)}`);
          }
        }, delayEnd);
      }
    }
  );

  gov.on("ProposalExecuted", async (proposalId) => {
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

  await send("🟦 Bot started (topic enabled + safe catch-up)…");

  await catchUp(gov, provider);
  attachListeners(gov);

  console.log("Watcher running...");
}

start().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
