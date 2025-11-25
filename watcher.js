import { ethers } from "ethers";
import TelegramBot from "node-telegram-bot-api";

// ---------------- CONFIG -----------------

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;      // -1002852935546
const THREAD_ID = process.env.THREAD_ID;  // 3710
const RPC_WSS = process.env.RPC_WSS;

// Websocket provider (Alchemy) for LIVE events
// HTTP provider (public Base RPC) for HISTORICAL backfill
const HTTP_RPC = "https://mainnet.base.org";

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
    console.error("Telegram error:", err?.message || err);
  }
}

// ---------------- HISTORICAL BACKFILL (HTTP RPC) -----------------

async function backfill(govHttp, httpProvider) {
  console.log("Running historical backfill (HTTP RPC)…");

  // Start a bit before first known proposal block to be safe
  const START_BLOCK = 38600000;
  const CHUNK_SIZE = 50000;

  const latest = await httpProvider.getBlockNumber();
  console.log(`Backfill from block ${START_BLOCK} to ${latest} in chunks of ${CHUNK_SIZE}…`);

  const filter = govHttp.filters.ProposalCreated();
  const now = Math.floor(Date.now() / 1000);

  for (let from = START_BLOCK; from <= latest; from += CHUNK_SIZE) {
    const to = Math.min(from + CHUNK_SIZE - 1, latest);
    console.log(`Backfill chunk: ${from} → ${to}`);

    let logs = [];
    try {
      logs = await govHttp.queryFilter(filter, from, to);
    } catch (err) {
      console.error(`Backfill query error for [${from}, ${to}]:`, err?.message || err);
      continue;
    }

    for (const l of logs) {
      const { proposalId, voteStart, voteEnd, description } = l.args;
      const id = proposalId.toString();

      if (!sent.created.has(id)) {
        sent.created.add(id);
        await send(
          `📢 *Proposal Created (backfill)*\n🆔 ${id}\n📝 ${description}\n📅 Starts: ${ts(
            voteStart
          )}\n📅 Ends: ${ts(voteEnd)}`
        );
      }

      if (now >= voteStart && now < voteEnd && !sent.start.has(id)) {
        sent.start.add(id);
        await send(`🟢 *Voting Started (backfill)*\n🆔 ${id}\n⏰ ${ts(voteStart)}`);
      }

      if (now >= voteEnd && !sent.end.has(id)) {
        sent.end.add(id);
        await send(`🔴 *Voting Ended (backfill)*\n🆔 ${id}\n⏰ ${ts(voteEnd)}`);
      }
    }
  }

  console.log("Historical backfill complete.");
}

// ---------------- LIVE LISTENERS (WEBSOCKET) -----------------

function attachListeners(govWs) {
  govWs.on(
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

      const delayStart = voteStart * 1000 - Date.now();
      if (delayStart > 0) {
        setTimeout(async () => {
          if (!sent.start.has(id)) {
            sent.start.add(id);
            await send(`🟢 *Voting Started*\n🆔 ${id}\n⏰ ${ts(voteStart)}`);
          }
        }, delayStart);
      }

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

  govWs.on("ProposalExecuted", async (proposalId) => {
    const id = proposalId.toString();
    if (sent.executed.has(id)) return;

    sent.executed.add(id);
    await send(`⚙️ *Proposal Executed*\n🆔 ${id}`);
  });
}

// ---------------- MAIN -----------------

async function start() {
  console.log("Connecting WebSocket provider (Alchemy) for live events…");
  const wsProvider = new ethers.WebSocketProvider(RPC_WSS);
  const govWs = new ethers.Contract(GOVERNANCE, ABI, wsProvider);

  console.log("Connecting HTTP provider (public Base RPC) for backfill…");
  const httpProvider = new ethers.JsonRpcProvider(HTTP_RPC);
  const govHttp = new ethers.Contract(GOVERNANCE, ABI, httpProvider);

  await send("🟦 Bot started (historical backfill + live alerts)…");

  // 1) Backfill historical proposals via HTTP
  await backfill(govHttp, httpProvider);

  // 2) Attach live listeners via WebSocket
  attachListeners(govWs);

  console.log("Watcher running (backfill done, live listeners active)…");
}

start().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
