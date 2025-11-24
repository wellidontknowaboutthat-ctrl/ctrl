// Reserve Governance → Telegram Alerts (Render Worker)
// Upgraded with UK timestamps + voting start/end/executed alerts

import { ethers } from "ethers";
import fetch from "node-fetch";

// --- CONFIG (Render Environment Variables) --- //
const RPC_WSS = process.env.RPC_WSS;
const GOVERNANCE = "0xed9cd49bd29f43a6cb74f780ba3aef0fbf1a8a2a";
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// Convert Unix timestamp or now() into UK time
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

console.log("Connecting to Base RPC via WebSocket…");

const provider = new ethers.WebSocketProvider(RPC_WSS);

const ABI = [
  "event ProposalCreated(uint256 proposalId, address proposer, address target, bytes data, uint256 start, uint256 end, string description)",
  "event ProposalExecuted(uint256 proposalId)"
];

const gov = new ethers.Contract(GOVERNANCE, ABI, provider);

// Track proposals to avoid repeat alerts
const tracked = new Map();

// Send Telegram message
async function sendTelegram(text) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true
      })
    });
  } catch (e) {
    console.error("Telegram error:", e);
  }
}

// Poll blocks to detect voting start/end
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
          `✅ *Voting Started*  
*Proposal ID:* ${idStr}  
*Block:* ${t.startBlock}  
*Time:* ${ukTime()} (UK Time)

*Description:*  
${t.desc}`
        );
      }

      // Voting Ended
      if (!t.endedSent && block >= t.endBlock) {
        t.endedSent = true;
        tracked.set(idStr, t);

        await sendTelegram(
          `🛑 *Voting Ended*  
*Proposal ID:* ${idStr}  
*Block:* ${t.endBlock}  
*Time:* ${ukTime()} (UK Time)

*Description:*  
${t.desc}`
        );

        clearInterval(interval);
      }
    } catch (err) {
      console.error("Polling error:", err);
    }
  }, 30_000); // check every 30 seconds
}

// On Proposal Created
gov.on("ProposalCreated", async (id, proposer, target, data, start, end, desc) => {
  const msg = `🗳 *New Proposal Created*  
*Proposal ID:* ${id.toString()}  
*Proposer:* \`${proposer}\`  
*Target:* \`${target}\`  
*Start Block:* ${start.toString()}  
*End Block:* ${end.toString()}  
*Time Created:* ${ukTime()} (UK Time)

*Description:*  
${desc}`;

  console.log(`[SSR] ProposalCreated → ${id.toString()}`);
  await sendTelegram(msg);

  startVoteWatchers(id, start, end, desc);
});

// On Proposal Executed
gov.on("ProposalExecuted", async (id) => {
  console.log(`[SSR] ProposalExecuted → ${id.toString()}`);

  await sendTelegram(
    `🎉 *Proposal Executed*  
*Proposal ID:* ${id.toString()}  
*Time:* ${ukTime()} (UK Time)`
  );
});

console.log("Watcher running (with UK timestamps + voting start/end/executed alerts)...");
