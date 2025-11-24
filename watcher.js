// Reserve Governance → Telegram Alerts (Render Worker)
// Upgraded: voting start, voting end, proposal executed

import { ethers } from "ethers";
import fetch from "node-fetch";

// --- CONFIG (Render Environment Variables) --- //
const RPC_WSS = process.env.RPC_WSS;
const GOVERNANCE = "0xed9cd49bd29f43a6cb74f780ba3aef0fbf1a8a2a"; // Gov module
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
// -------------------------------------------- //

const provider = new ethers.WebSocketProvider(RPC_WSS);

// Events we listen to.
// ProposalCreated already confirmed working on your gov.
// ProposalExecuted is standard OZ Governor; if Reserve emits it, you'll get alerts.
const ABI = [
  "event ProposalCreated(uint256 proposalId, address proposer, address target, bytes data, uint256 start, uint256 end, string description)",
  "event ProposalExecuted(uint256 proposalId)"
];

const gov = new ethers.Contract(GOVERNANCE, ABI, provider);

// In-memory tracking to avoid duplicate alerts
const tracked = new Map(); 
// proposalId -> { startBlock, endBlock, startedSent, endedSent }

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

  // Poll blocks every 30s to detect start/end
  const interval = setInterval(async () => {
    try {
      const currentBlock = await provider.getBlockNumber();
      const t = tracked.get(idStr);
      if (!t) return;

      // Voting started
      if (!t.startedSent && currentBlock >= t.startBlock) {
        t.startedSent = true;
        tracked.set(idStr, t);

        await sendTelegram(
          `✅ *Voting Started*\n\n*Proposal ID:* ${idStr}\n*Start block:* ${t.startBlock}\n\n*Description:*\n${t.desc}`
        );
      }

      // Voting ended
      if (!t.endedSent && currentBlock >= t.endBlock) {
        t.endedSent = true;
        tracked.set(idStr, t);

        await sendTelegram(
          `🛑 *Voting Ended*\n\n*Proposal ID:* ${idStr}\n*End block:* ${t.endBlock}\n\n*Description:*\n${t.desc}`
        );

        // stop polling for this proposal once ended
        clearInterval(interval);
      }
    } catch (err) {
      console.error("Polling error:", err);
    }
  }, 30_000);
}

// --- LISTENERS --- //

// New proposal created → send alert + schedule vote start/end alerts
gov.on("ProposalCreated", async (id, proposer, target, data, start, end, desc) => {
  const msg = `🗳 *New Proposal Created in SSR DTF*

*Proposal ID:* ${id.toString()}
*Proposer:* \`${proposer}\`
*Target:* \`${target}\`
*Start block:* ${start.toString()}
*End block:* ${end.toString()}

*Description:*
${desc}`;

  console.log(`[SSR] ProposalCreated → ${id.toString()}`);
  await sendTelegram(msg);

  // schedule voting start / end alerts
  startVoteWatchers(id, start, end, desc);
});

// Proposal executed (if contract emits OZ standard event)
gov.on("ProposalExecuted", async (id) => {
  console.log(`[SSR] ProposalExecuted → ${id.toString()}`);
  await sendTelegram(
    `🎉 *Proposal Executed*\n\n*Proposal ID:* ${id.toString()}`
  );
});

console.log("Watcher running (proposal create/start/end/execute alerts enabled)...");
