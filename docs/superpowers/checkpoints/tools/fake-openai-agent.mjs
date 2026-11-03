// Controller-written fake OpenAI-compatible endpoint scripting an agent conversation by inspecting the transcript.
import http from "node:http"; import fs from "node:fs";
let calls = 0;
http.createServer((req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    if (req.url === "/calls") { res.end(String(calls)); return; }
    calls++;
    const j = JSON.parse(body); const mode = fs.readFileSync("/tmp/ctl_mode","utf8").trim();
    const toolMsgs = j.messages.filter(m => m.role === "tool");
    const names = (j.tools ?? []).map(t => t.function.name);
    fs.writeFileSync("/tmp/ctl_tools.json", JSON.stringify(names));
    const doReply = (msg, fr = "stop") => { res.writeHead(200, {"content-type":"application/json"}); res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: fr, message: { role: "assistant", ...msg } }] })); };
    const reply = (msg, fr) => { if (mode === "slow") setTimeout(() => doReply(msg, fr), 4000); else doReply(msg, fr); };
    const tc = (name, args, id) => ({ content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
    if (mode === "slow" && false) {}
    if (mode === "429") { res.writeHead(429, {"content-type":"application/json"}); res.end(JSON.stringify({error:{message:"rate limit — secret fake-test-key"}})); return; }
    if (mode === "endless") return reply(tc("pulse_board", { city: "delhi", business_type: "cafe" }, "e" + calls), "tool_calls");
    if (mode === "unknown") { if (toolMsgs.length === 0) return reply(tc("rm_rf_everything", { path: "/" }, "u1"), "tool_calls"); return reply({ content: "Recovered after the unknown tool: " + toolMsgs[0].content.slice(0,60) }); }
    if (toolMsgs.length === 0) return reply(tc("pulse_board", { city: "delhi", business_type: "cafe" }, "c1"), "tool_calls");
    if (toolMsgs.length === 1) { let id; try { id = JSON.parse(toolMsgs[0].content).ranked?.[0]?.tmdbId; } catch {} return reply(tc("release_brief", { title_or_tmdb_id: id ?? 1, city: "delhi", business_type: "cafe" }, "c2"), "tool_calls"); }
    const brief = toolMsgs[1].content;
    return reply({ content: `Theme the weekend around the top release. Evidence: pulse_board ranked data and release_brief sections (${brief.slice(0, 40).replace(/\n/g," ")}…). Fans over-index per the demographics call.` });
  });
}).listen(8798, () => console.log("fake agent on 8798"));
