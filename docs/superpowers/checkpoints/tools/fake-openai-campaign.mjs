// Controller-written fake OpenAI-compatible chat endpoint (v2: truncation + provider-400 modes).
import http from "node:http"; import fs from "node:fs";
let hits = 0, draftN = 0;
http.createServer((req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    if (req.url === "/hits") { res.end(String(draftN)); return; }
    draftN++;
    const j = JSON.parse(body); fs.writeFileSync("/tmp/ctl_maxtok", String(j.max_tokens));
    const prompt = j.messages.map(m => m.content).join("\n");
    const ids = [...new Set(prompt.match(/\b(?:demo|heat|venue|tag|artist|brand|hook):[A-Za-z0-9_.:\-]+/g) ?? [])];
    const mode = fs.readFileSync("/tmp/ctl_mode","utf8").trim();
    fs.appendFileSync("/tmp/ctl_prompts.log", `mode=${mode} lastUser=${j.messages.at(-1).content.slice(0,160).replace(/\n/g," ")}\n`);
    const good = JSON.stringify({ ideas: ["special","social","event"].map((k,i) => ({ kind: k, title: `${k} idea`, timing: "Release day", clauses: [{ text: `Fans over-index (${k})`, evidence: ids.slice(i, i+1) }, { text: "Post at 7pm", evidence: [] }] })) });
    const ok = (content, fr="stop") => { res.writeHead(200, {"content-type":"application/json"}); res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: fr, message: { role: "assistant", content } }] })); };
    const jv = () => { res.writeHead(400, {"content-type":"application/json"}); res.end(JSON.stringify({error:{message:"Failed to generate JSON", code:"json_validate_failed", failed_generation:"{"}})); };
    if (mode === "length") return ok(good, "length");              // truncated BUT parseable: must not be accepted
    if (mode === "jv") return jv();                               // provider 400 every time
    if (mode === "jv_then_good") return draftN % 2 === 1 ? jv() : ok(good);
    return ok(good);
  });
}).listen(8798, () => console.log("fake groq v2 on 8798"));
