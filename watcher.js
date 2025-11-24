import { ethers } from "ethers";
import fetch from "node-fetch";

// CONFIG — use Render environment variables
const RPC_WSS = process.env.RPC_WSS;
const GOVERNANCE = "0xed9cd49bd29f43a6cb74f780ba3aef0fbf1a8a2a";
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const provider = new ethers.WebSocketProvider(RPC_WSS);

const ABI = [
  "event ProposalCreated(uint256 proposalId, address proposer, address target, bytes data, uint256 start, uint256 end, string description)"
];

const gov = new ethers.Contract(GOVERNANCE, ABI, provider);

async function sendTelegram(text) {
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
}

gov.on("ProposalCreated", async (id, proposer, target, data, start, end, desc) => {
  const msg = `🗳 *New Proposal Created*

*ID:* ${id.toString()}
*Proposer:* \`${proposer}\`
*Target:* \`${target}\`
*Start:* ${start.toString()}
*End:* ${end.toString()}

*Description:*
${desc}`;

  console.log("Detected:", id.toString());
  await sendTelegram(msg);
});

console.log("Watcher running…");

