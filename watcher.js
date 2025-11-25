import { ethers } from "ethers";
import TelegramBot from "node-telegram-bot-api";

// ---------------- CONFIG -----------------

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID; // -1002852935546
const THREAD_ID = process.env.THREAD_ID; // 3710
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

function ts(t) {
  return new Date(t * 1000).toLocaleString("en-GB", { timeZone: "Europe/London" });
}

async function send(msg) {
  try {
    await bot.sendMessage(CHAT_ID, msg, {
      message_thread_id: THREAD_ID
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

  let logs;
  try {
    logs = await gov.queryFilter(gov.filters.ProposalCreated(), from, latest);
  } catch (err) {
    console.error("Catch-up error (ignored):", err.message);
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  for (const l of logs) {
    const { proposalId, voteStart, voteEnd, description } = l.args;
    const id = proposalId.toString();

    if (!sent.created.has(id)) {
      sent.created.add(id);
      await send(
        `📢 *Proposal Created*\n🆔 ${id}\n📝 ${description}\n📅 Starts: ${ts(voteStart)}\n📅 Ends: ${ts(voteEnd)}`
      );
    }

    if (now >= voteStart && now < voteEnd && !sent.start.has(id)) {
      sent.start.add(id);
      await send(`🟢 *Voting Started*\n🆔 ${id}\n⏰ ${ts(voteStart)}`);
    }

    if (now >= voteEnd && !sent.end.has(id)) {
