// Reserve Governance Watcher (Topic + UK Timestamps + Reconnect + Full Alerts)
// Compatible with ETHERS v6.x

import { ethers } from "ethers";
import fetch from "node-fetch";

// ------------------------------
// CONFIG (from Render ENV)
// ------------------------------
const RPC_WSS = process.env.RPC_WSS;
const GOVERNANCE = "0xed9cd49bd29f43a6cb74f780ba3aef0fbf1a8a2a";
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// Topic ID where all messages should be sent
// This is your "BASE DTF ALERTS" topic
const TOPIC_ID = 3710;

// ------------------------------
// UK TIMESTAMP UTILITY
// ------------------------------
function ukTime(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

// ------------------------------
// TELEGRAM SEND (TOPIC AWARE)
// ------------------------------
async function sendTelegram(text) {
  const payload = {
    chat_id: CHAT_ID,
    message_thread_id: TOPIC_ID,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  };

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("Telegram Error:", err);
  }
}

// ------------------------------
// WS PROVIDER (ETHERS v6 SAFE)
// ------------------------------
let provider;

function startProvider() {
  console.log("Connecting to Base RPC via WebSocket…");

  provider = new ethers.WebSocketProvider(RPC_WSS);
  const ws = provider.websocket;

  ws.addEventListener("close", () => {
    console.error("WebSocket closed — reconnecting in 3 seconds…");
    setTimeout(startProvider, 3000);
  });

  ws.addEventListener("error", (err) => {
    console.error("WebSocket error:", err);
    try { ws.close(); } catch {}
  });

  attachListeners();
}

startProvider();

// ------------------------------
// GOVERNANCE CONTRACT + EVENTS
// ------------------------------
const ABI = [
  "event ProposalCreated(uint256 proposalId, address proposer, address target, bytes data, uint256 start, uint256 end, string description)",
  "event ProposalExecuted(uint256 proposalId)",
];

let gov;

function attachListeners() {
  gov = new ethers.Contract(GOVERNANCE, ABI, provider);

  const tracked = new Map();

  // ------------------------------
  // VOTING START / END POLLING
  // ------------------------------
  function startVoteWatchers(proposalId, startBlock, endBlock, desc) {
    const idStr = proposalId.toString();

    if (!tracked.has(idStr)) {
      tracked.set(idStr, {
        startBlock: Number(startBlock),
        endBlock: Number(endBlock),
        startedSent: false,
        endedSent: false,
        desc,
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
            `*Start Block:* ${t.startBlock}\n` +
            `*Time:* ${ukTime()} (UK)\n\n` +
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
            `*End Block:* ${t.endBlock}\n` +
            `*Time:* ${ukTime()} (UK)\n\n` +
            `*Description:*\n${t.desc}`
          );

          clearInterval(interval);
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 30_000);
  }

  // ------------------------------
  // EVENT: Proposal Created
  // ------------------------------
  gov.on(
    "ProposalCreated",
    async (id, proposer, target, data, start, end, desc) => {
      console.log(`[SSR] ProposalCreated → ${id.toString()}`);

      await sendTelegram(
        `🗳 *New Proposal Created*\n` +
        `*Proposal ID:* ${id.toString()}\n` +
        `*Proposer:* \`${proposer}\`\n` +
        `*Target:* \`${target}\`\n` +
        `*Start Block:* ${start}\n` +
        `*End Block:* ${end}\n` +
        `*Time:* ${ukTime()} (UK)\n\n` +
        `*Description:*\n${desc}`
      );

      startVoteWatchers(id, start, end, desc);
    }
  );

  // ------------------------------
  // EVENT: Proposal Executed
  // ------------------------------
  gov.on("ProposalExecuted", async (id) => {
    console.log(`[SSR] ProposalExecuted → ${id.toString()}`);

    await sendTelegram(
      `🎉 *Proposal Executed*\n` +
      `*Proposal ID:* ${id.toString()}\n` +
      `*Time:* ${ukTime()} (UK)`
    );
  });
}

console.log("Watcher running (topic-aware + UK timestamps + full alerts)…");
