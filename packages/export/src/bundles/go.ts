import type { Agent } from "@coala/core";
import {
  type GeneratedFile,
  type LanguageEmitter,
  blueprintJson,
  digitalTools,
  pascal,
} from "./types.js";

/** Embedded runtime — Go stdlib only (net/http, encoding/json). */
const GO_RUNTIME = `package main

// CoALA agent runtime (embedded, generated) — Go stdlib only.

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
)

type JSON = map[string]interface{}
type Tool func(args JSON, ctx JSON) interface{}

var tokRe = regexp.MustCompile("[a-z0-9]+")

func tok(s string) []string { return tokRe.FindAllString(strings.ToLower(s), -1) }
func str(v interface{}) string { s, _ := v.(string); return s }
func obj(v interface{}) JSON { m, _ := v.(JSON); if m == nil { if mm, ok := v.(map[string]interface{}); ok { return mm } }; return m }
func arr(v interface{}) []JSON {
	out := []JSON{}
	if a, ok := v.([]interface{}); ok {
		for _, e := range a {
			if m, ok := e.(map[string]interface{}); ok {
				out = append(out, m)
			}
		}
	}
	return out
}
func boolOf(v interface{}) bool { b, _ := v.(bool); return b }
func extractJSON(s string) string {
	i := strings.Index(s, "{")
	j := strings.LastIndex(s, "}")
	if i >= 0 && j > i {
		return s[i : j+1]
	}
	return s
}

type Store struct{ Records []JSON }

func (s *Store) Add(r JSON) { s.Records = append(s.Records, r) }
func (s *Store) Retrieve(text, method string, k int) []JSON {
	switch method {
	case "recency":
		out := []JSON{}
		for i := len(s.Records) - 1; i >= 0 && len(out) < k; i-- {
			out = append(out, s.Records[i])
		}
		return out
	case "importance":
		rs := append([]JSON{}, s.Records...)
		imp := func(r JSON) float64 { v, _ := r["importance"].(float64); return v }
		sort.SliceStable(rs, func(i, j int) bool { return imp(rs[j]) < imp(rs[i]) })
		return head(rs, k)
	case "relevance", "embedding":
		q := map[string]bool{}
		for _, t := range tok(text) {
			q[t] = true
		}
		type sc struct {
			s int
			r JSON
		}
		scored := []sc{}
		for _, r := range s.Records {
			b, _ := json.Marshal(r)
			c := 0
			for _, t := range tok(string(b)) {
				if q[t] {
					c++
				}
			}
			if c > 0 {
				scored = append(scored, sc{c, r})
			}
		}
		sort.SliceStable(scored, func(i, j int) bool { return scored[i].s > scored[j].s })
		out := []JSON{}
		for i, x := range scored {
			if i >= k {
				break
			}
			out = append(out, x.r)
		}
		return out
	}
	return head(s.Records, k)
}
func head(rs []JSON, k int) []JSON {
	if k > len(rs) {
		k = len(rs)
	}
	return rs[:k]
}

type Agent struct {
	BP        JSON
	Tools     map[string]Tool
	Completer func(system, user string) string
	Working   JSON
	Stores    map[string]*Store
}

func NewAgent(bp JSON, tools map[string]Tool, completer func(string, string) string) *Agent {
	a := &Agent{BP: bp, Tools: tools, Completer: completer, Working: JSON{}, Stores: map[string]*Store{}}
	for _, m := range arr(bp["memoryModules"]) {
		kind := str(m["kind"])
		if kind == "episodic" || kind == "semantic" || kind == "procedural" {
			st := &Store{Records: []JSON{}}
			for _, r := range arr(m["records"]) {
				st.Add(obj(r["data"]))
			}
			a.Stores[str(m["id"])] = st
		}
	}
	return a
}

func (a *Agent) complete(system, user string) string {
	if a.Completer != nil {
		return a.Completer(system, user)
	}
	pc := obj(a.BP["providerConfig"])
	provider, model := str(pc["provider"]), str(pc["model"])
	if provider == "anthropic" {
		key := os.Getenv("ANTHROPIC_API_KEY")
		if key == "" {
			panic("Set ANTHROPIC_API_KEY")
		}
		body := JSON{"model": model, "max_tokens": 1024, "system": system, "messages": []JSON{{"role": "user", "content": user}}}
		data := a.http("https://api.anthropic.com/v1/messages", body, map[string]string{"x-api-key": key, "anthropic-version": "2023-06-01"})
		out := ""
		for _, b := range arr(data["content"]) {
			if str(b["type"]) == "text" {
				out += str(b["text"])
			}
		}
		return out
	}
	bases := map[string]string{"openai": "https://api.openai.com/v1", "xai": "https://api.x.ai/v1", "ollama": "http://localhost:11434/v1"}
	base := os.Getenv("LLM_BASE_URL")
	if base == "" {
		if base = bases[provider]; base == "" {
			base = "https://api.openai.com/v1"
		}
	}
	key := os.Getenv("OPENAI_API_KEY")
	if key == "" {
		key = os.Getenv("LLM_API_KEY")
	}
	h := map[string]string{}
	if key != "" {
		h["authorization"] = "Bearer " + key
	}
	body := JSON{"model": model, "messages": []JSON{{"role": "system", "content": system}, {"role": "user", "content": user}}}
	data := a.http(base+"/chat/completions", body, h)
	ch := arr(data["choices"])
	if len(ch) == 0 {
		return ""
	}
	return str(obj(ch[0]["message"])["content"])
}

func (a *Agent) http(url string, body JSON, headers map[string]string) JSON {
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", url, bytes.NewReader(b))
	req.Header.Set("content-type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(resp.Body)
	var out JSON
	json.Unmarshal(rb, &out)
	return out
}

func (a *Agent) structured(system, user string) JSON {
	instr := system + "\\n\\nRespond ONLY with JSON: " + "{\\"thought\\":\\"...\\",\\"action\\":{\\"type\\":\\"grounding|learning|respond|finish\\",\\"tool\\":\\"...\\",\\"args\\":{},\\"memoryModuleId\\":\\"...\\",\\"record\\":{},\\"message\\":\\"...\\",\\"result\\":\\"...\\"}}"
	for n := 0; n < 3; n++ {
		text := a.complete(instr, user)
		var obj2 JSON
		if json.Unmarshal([]byte(extractJSON(text)), &obj2) == nil {
			if act := obj(obj2["action"]); act != nil && str(act["type"]) != "" {
				if _, ok := obj2["thought"]; !ok {
					obj2["thought"] = ""
				}
				return obj2
			}
		}
	}
	panic("LLM did not return valid action JSON")
}

func (a *Agent) module(id string) JSON {
	for _, m := range arr(a.BP["memoryModules"]) {
		if str(m["id"]) == id {
			return m
		}
	}
	return nil
}

func (a *Agent) retrieve(query string) []JSON {
	out := []JSON{}
	for _, ap := range arr(a.BP["accessPolicy"]) {
		ret := obj(ap["retrieval"])
		if !boolOf(ret["enabled"]) {
			continue
		}
		m := a.module(str(ap["memoryModuleId"]))
		if m == nil {
			continue
		}
		st := a.Stores[str(m["id"])]
		if st == nil {
			continue
		}
		rc := obj(m["retrievalConfig"])
		method := str(ret["method"])
		if method == "" && rc != nil {
			method = str(rc["method"])
		}
		if method == "" {
			method = "relevance"
		}
		k := 5
		if rc != nil {
			if kf, ok := rc["k"].(float64); ok {
				k = int(kf)
			}
		}
		out = append(out, JSON{"moduleId": str(m["id"]), "moduleName": str(m["name"]), "method": method, "records": st.Retrieve(query, method, k)})
	}
	return out
}

func (a *Agent) prompt(retrieved []JSON) (string, string) {
	tools, writable, dialogue := []JSON{}, []JSON{}, false
	for _, g := range arr(a.BP["groundingInterfaces"]) {
		if str(g["type"]) == "digital" {
			tools = append(tools, arr(g["digitalTools"])...)
		}
		if str(g["type"]) == "dialogue" {
			dialogue = true
		}
	}
	for _, ap := range arr(a.BP["accessPolicy"]) {
		if boolOf(obj(ap["learning"])["add"]) {
			if m := a.module(str(ap["memoryModuleId"])); m != nil {
				writable = append(writable, m)
			}
		}
	}
	tl := "  (none)"
	if len(tools) > 0 {
		lines := []string{}
		for _, t := range tools {
			lines = append(lines, "  - "+str(t["name"])+": "+str(t["description"]))
		}
		tl = strings.Join(lines, "\\n")
	}
	wl := "  (none)"
	if len(writable) > 0 {
		lines := []string{}
		for _, m := range writable {
			lines = append(lines, "  - id=\\""+str(m["id"])+"\\" ("+str(m["kind"])+") "+str(m["name"]))
		}
		wl = strings.Join(lines, "\\n")
	}
	dlg := "Use finish to end."
	if dialogue {
		dlg = "This agent can talk to the user; use respond to answer."
	}
	system := strings.Join([]string{
		"You are the decision procedure of a CoALA agent named \\"" + str(a.BP["name"]) + "\\".",
		"Each cycle: reason over working memory, then choose ONE next action.",
		"Action types: grounding(tool,args) | learning(memoryModuleId,record) | respond(message) | finish(result).",
		"Available tools:", tl, "Writable memory modules:", wl, dlg,
		"Do not invent tools or module ids.",
	}, "\\n")
	wb, _ := json.MarshalIndent(a.Working, "", "  ")
	return system, "Working memory:\\n" + string(wb) + "\\n\\nChoose the next action."
}

func (a *Agent) learn(mid string, record JSON) (JSON, string) {
	if mid == "" {
		return nil, "No memoryModuleId provided."
	}
	var grant JSON
	for _, ap := range arr(a.BP["accessPolicy"]) {
		if str(ap["memoryModuleId"]) == mid {
			grant = ap
		}
	}
	if grant == nil || !boolOf(obj(grant["learning"])["add"]) {
		return nil, "Module \\"" + mid + "\\" is not writable (no learning grant)."
	}
	st := a.Stores[mid]
	if st == nil {
		return nil, "Module \\"" + mid + "\\" has no store."
	}
	st.Add(record)
	return JSON{"moduleId": mid, "moduleName": str(a.module(mid)["name"]), "record": record}, ""
}

func (a *Agent) RunTurn(message string, maxSteps int) JSON {
	a.Working["input"] = message
	steps := []JSON{}
	var reply interface{}
	for i := 1; i <= maxSteps; i++ {
		retrieved := a.retrieve(message)
		a.Working["retrieved"] = retrieved
		system, user := a.prompt(retrieved)
		proposal := a.structured(system, user)
		action := obj(proposal["action"])
		t := str(action["type"])
		step := JSON{"step": i, "retrieved": retrieved, "thought": str(proposal["thought"]), "action": action, "terminal": false}
		switch t {
		case "respond":
			reply = str(action["message"])
			step["terminal"] = true
		case "finish":
			if reply == nil {
				reply = action["result"]
			}
			step["terminal"] = true
		case "grounding":
			fn := a.Tools[str(action["tool"])]
			var obs interface{}
			if fn != nil {
				obs = fn(obj(action["args"]), a.Working)
			} else {
				obs = JSON{"unhandled": true, "tool": str(action["tool"])}
			}
			step["observation"] = obs
			a.Working["lastObservation"] = obs
		case "learning":
			w, blocked := a.learn(str(action["memoryModuleId"]), obj(action["record"]))
			if blocked != "" {
				step["blocked"] = blocked
			} else {
				step["memoryWrite"] = w
			}
		}
		steps = append(steps, step)
		if step["terminal"] == true {
			break
		}
	}
	return JSON{"reply": reply, "steps": steps}
}

func LoadBlueprint(path string) JSON {
	b, _ := os.ReadFile(path)
	var bp JSON
	json.Unmarshal(b, &bp)
	return bp
}
`;

function toolsGo(agent: Agent): string {
  const tools = digitalTools(agent);
  const fns = tools
    .map(
      (t) => `// ${(t.description || t.name).replace(/\n/g, " ")}
func tool${pascal(t.name)}(args JSON, ctx JSON) interface{} {
	// TODO: implement against your app and return an observation.
	panic("Implement the '${t.name}' tool")
}`,
    )
    .join("\n\n");
  const registry = tools.map((t) => `\t\t"${t.name}": tool${pascal(t.name)},`).join("\n");
  return `package main

// Your agent's grounding tools (external actions). Implement each stub.

${fns || "// (no digital tools)"}

func Tools() map[string]Tool {
	return map[string]Tool{
${registry}
	}
}
`;
}

const MAIN_GO = `package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

func main() {
	msg := strings.Join(os.Args[1:], " ")
	if msg == "" {
		msg = "Hello"
	}
	agent := NewAgent(LoadBlueprint("blueprint.json"), Tools(), nil)
	out, _ := json.MarshalIndent(agent.RunTurn(msg, 6), "", "  ")
	fmt.Println(string(out))
}
`;

function envExample(agent: Agent): string {
  const p = agent.providerConfig.provider;
  const k: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY=",
    openai: "OPENAI_API_KEY=",
    xai: "OPENAI_API_KEY=\nLLM_BASE_URL=https://api.x.ai/v1",
    ollama: "LLM_BASE_URL=http://localhost:11434/v1",
    local: "LLM_BASE_URL=\nLLM_API_KEY=",
    google: "OPENAI_API_KEY=   # Gemini not bundled",
  };
  return `# Provider key for ${p}.\n${k[p] ?? "OPENAI_API_KEY="}\n`;
}

function readme(agent: Agent): string {
  return `# ${agent.name} — CoALA agent (Go)

Self-contained, runnable CoALA agent. Go stdlib only.

## Run
\`\`\`bash
cp .env.example .env && export $(cat .env | xargs)
go run . "your message here"
\`\`\`

- \`agent.go\` — embedded runtime · \`blueprint.json\` — your agent · \`tools.go\` — **implement your tools**.
Swap the in-memory \`Store\` for your DB/vector store (same Add/Retrieve API).
`;
}

export const goEmitter: LanguageEmitter = {
  id: "go",
  label: "Go",
  verified: true,
  files(agent: Agent): GeneratedFile[] {
    return [
      { path: "agent.go", content: GO_RUNTIME, language: "go" },
      { path: "blueprint.json", content: blueprintJson(agent), language: "json" },
      { path: "tools.go", content: toolsGo(agent), language: "go" },
      { path: "main.go", content: MAIN_GO, language: "go" },
      { path: "go.mod", content: "module coalaagent\n\ngo 1.21\n", language: "text" },
      { path: ".env.example", content: envExample(agent), language: "text" },
      { path: "README.md", content: readme(agent), language: "markdown" },
    ];
  },
};
