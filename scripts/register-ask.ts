import { askCommand } from "../src/services/ask.ts";
const {DISCORD_APPLICATION_ID: app,DISCORD_GUILD_ID: guild,DISCORD_BOT_TOKEN: token} = process.env;
if (!app || !guild || !/^\d+$/.test(app) || !/^\d+$/.test(guild) || !token) throw new Error("Set DISCORD_APPLICATION_ID, DISCORD_GUILD_ID and DISCORD_BOT_TOKEN.");
// POST upserts the command by name without replacing any other commands.
const response = await fetch("https://discord.com/api/v10/applications/"+app+"/guilds/"+guild+"/commands",{
  method:"POST",headers:{Authorization:"Bot "+token,"Content-Type":"application/json"},
  body:JSON.stringify(askCommand),signal:AbortSignal.timeout(15000),redirect:"error"
});
if (!response.ok) throw new Error("Discord command registration failed (HTTP "+response.status+").");
console.log("Registered /ask in the configured guild.");
