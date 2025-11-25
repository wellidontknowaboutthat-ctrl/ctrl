// Reserve Governance → Telegram Alerts (Render Worker)
// Topic-enabled version (all alerts go to BASE DTF ALERTS topic)

// --------------------------------------------------------
// CONFIG (from Render Environment Variables)
// --------------------------------------------------------
import { ethers } from "ethers";
import fetch from "node-fetch";

const RPC_WSS = process.env.RPC_WSS;
const GOVERNANCE = "0xed9cd49bd29f43a6cb74f780ba3aef0fbf1a8a2a"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// Topic ID for "BASE DTF ALERTS"
const TOPIC_ID = 3710;  // <== ALWAYS SEND INTO THIS TOPIC

// --------------------------------------------------------
// UK Timestamp Utility
// --------------------------------------------------------
function ukTime(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

// --------------------------------------------------------
// Telegram Sender (Topic-Aware)
// --------------------------------------------------------
async function sendTelegram(text) {
  const payload = {
    chat_id: CHAT_ID,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    message_thread_id: TOPIC_ID
  };

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("Telegram Error:", err);
  }
}

// --------------------------------------------------------
// WebSocket Provider (with auto-reconnect protection)
// --------------------------------------------------------
let provider;

function startProvider() {
  console.log("Connecting to Base RPC via WebSocket…");

  provider = new ethers.WebSocketProvider(RPC_WSS);

  provider._websocket.on("close", () => {
    console.error("WebSocket closed → reconnecting in 3 seconds…");
    setTimeout(startProvider, 3000);
  });

  provider._websocket.on("error", (err) => {
    console.error("WebSocket error:", err);
    provider._websocket.close();
  });

  attachListeners();
}

startProvider();

// --------------------------------------------------------
// Governance Contract + Events
// --------------------------------------------------------
const ABI = [
  "event ProposalCreated(uint256 proposalId, address proposer, address target, bytes data, uint256 start, uint256 end, string description)",
  "event ProposalExecuted(uint256 proposalId)"
];

let gov;

function attachListeners() {
  gov = new ethers.Contract(GOVERNANCE, ABI, provider);

  // Track proposals for polling
  const tracked = new Map();

  function startVoteWatchers(proposalId, startBlock, endBlock, desc) {
    const idStr = proposalId.toString();

    if (!tracked.has(idStr)) {
      tracked.set(idStr, {
        startBlock: Number(startBlock),
        endBlock: Number(endBlock),
        startedSent: false,
        endedSent: false,
        desc
      });
    }

    const interval = setInterval(async () => {
      try {
        const block = await provider.getBlockNumber();
        const t = tracked.get(idStr);
        if (!t) return;

        // Voting Started
        if (!t.startedSent && block >= t.startBlock) {
          t.startedSent = true;
          tracked.set(idStr, t);

          await sendTelegram(
            `✅ *Voting Started*\n` +
            `*Proposal ID:* ${idStr}\n` +
            `*Block:* ${t.startBlock}\n` +
            `*Time:* ${ukTime()} (UK Time)\n\n` +
            `*Description:*\n${t.desc}`
          );
        }

        // Voting Ended
        if (!t.endedSent && block >= t.endBlock) {
          t.endedSent = true;
          tracked.set(idStr, t);

          await sendTelegram(
            `🛑 *Voting Ended*\n` +
            `*Proposal ID:* ${idStr}\n` +
            `*Block:* ${t.endBlock}\n` +
            `*Time:* ${ukTime()} (UK Time)\n\n` +
            `*Description:*\n${t.desc}`
          );

          clearInterval(interval);
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 30_000);
  }

  // --------------------------------------------------------
  // Event Listener: Proposal Created
  // --------------------------------------------------------
  gov.on("ProposalCreated", async (id, proposer, target, data, start, end, desc) => {
    console.log(`[SSR] ProposalCreated → ${id.toString()}`);

    await sendTelegram(
      `🗳 *New Proposal Created*\n` +
      `*Proposal ID:* ${id.toString()}\n` +
      `*Proposer:* \`${proposer}\`\n` +
      `*Target:* \`${target}\`\n` +
      `*Start Block:* ${start}\n` +
      `*End Block:* ${end}\n` +
      `*Time Created:* ${ukTime()} (UK Time)\n\n` +
      `*Description:*\n${desc}`
    );

    startVoteWatchers(id, start, end, desc);
  });

  // --------------------------------------------------------
  // Event Listener: Proposal Executed
  // --------------------------------------------------------
  gov.on("ProposalExecuted", async (id) => {
    console.log(`[SSR] ProposalExecuted → ${id.toString()}`);

    await sendTelegram(
      `🎉 *Proposal Executed*\n` +
      `*Proposal ID:* ${id.toString()}\n` +
      `*Time:* ${ukTime()} (UK Time)`
    );
  });
}

console.log("Watcher running (topic-aware + UK timestamps + full alerts)…");
