import type { Agent } from "@coala/core";
import {
  type GeneratedFile,
  type LanguageEmitter,
  blueprintJson,
  digitalTools,
  pascal,
} from "./types.js";

/**
 * Embedded runtime — C# / .NET 6+ (System.Text.Json). A faithful port of the
 * execution-verified Java runtime. NOTE: not run-tested in CI (no dotnet there).
 */
const CS_RUNTIME = `// CoALA agent runtime (embedded, generated) — .NET 6+, System.Text.Json.
using System.Globalization;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CoalaAgentApp;

using Obj = System.Collections.Generic.Dictionary<string, object?>;
using Arr = System.Collections.Generic.List<object?>;

public static class Json
{
    public static object? Parse(string s)
    {
        using var doc = JsonDocument.Parse(s);
        return Conv(doc.RootElement);
    }

    static object? Conv(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.Object => e.EnumerateObject().Aggregate(new Obj(), (m, p) => { m[p.Name] = Conv(p.Value); return m; }),
        JsonValueKind.Array => e.EnumerateArray().Select(Conv).ToList() is var l ? new Arr(l) : null,
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Number => e.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => null,
    };

    public static string Write(object? o)
    {
        var b = new StringBuilder();
        W(o, b);
        return b.ToString();
    }

    static void W(object? o, StringBuilder b)
    {
        switch (o)
        {
            case null: b.Append("null"); break;
            case string s: b.Append('"'); Esc(s, b); b.Append('"'); break;
            case bool bo: b.Append(bo ? "true" : "false"); break;
            case double d: b.Append(d == Math.Floor(d) && !double.IsInfinity(d) ? ((long)d).ToString() : d.ToString(CultureInfo.InvariantCulture)); break;
            case int i: b.Append(i); break;
            case Obj m:
                b.Append('{');
                var fm = true;
                foreach (var kv in m) { if (!fm) b.Append(','); fm = false; b.Append('"'); Esc(kv.Key, b); b.Append("\\":"); W(kv.Value, b); }
                b.Append('}');
                break;
            case System.Collections.IEnumerable en:
                b.Append('[');
                var fa = true;
                foreach (var e in en) { if (!fa) b.Append(','); fa = false; W(e, b); }
                b.Append(']');
                break;
            default: b.Append('"'); Esc(o.ToString() ?? "", b); b.Append('"'); break;
        }
    }

    static void Esc(string s, StringBuilder b)
    {
        foreach (var c in s)
            b.Append(c switch { '"' => "\\\\\\"", '\\\\' => "\\\\\\\\", '\\n' => "\\\\n", '\\t' => "\\\\t", '\\r' => "\\\\r", _ => c.ToString() });
    }
}

public class Store
{
    public Arr Records = new();
    public Store(Arr? seed = null) { if (seed != null) Records.AddRange(seed); }
    public void Add(Obj r) => Records.Add(r);

    static List<string> Tok(string s) => Regex.Matches(s.ToLowerInvariant(), "[a-z0-9]+").Select(m => m.Value).ToList();
    static double Imp(object? r) => r is Obj o && o.TryGetValue("importance", out var v) && v is double d ? d : 0;
    static int Score(object? r, HashSet<string> q) => Tok(Json.Write(r)).Count(t => q.Contains(t));

    public Arr Retrieve(string text, string method, int k)
    {
        if (method == "recency") return new Arr(Records.AsEnumerable().Reverse().Take(k));
        if (method == "importance") return new Arr(Records.OrderByDescending(Imp).Take(k));
        if (method == "relevance" || method == "embedding")
        {
            var q = new HashSet<string>(Tok(text));
            return new Arr(Records.Where(r => Score(r, q) > 0).OrderByDescending(r => Score(r, q)).Take(k));
        }
        return new Arr(Records.Take(k));
    }
}

public class Agent
{
    readonly Obj bp;
    readonly Dictionary<string, Func<Obj, Obj, object?>> tools;
    readonly Func<string, string, string>? completer;
    public Obj Working = new();
    public Dictionary<string, Store> Stores = new();
    static readonly HttpClient Http = new();

    public Agent(Obj bp, Dictionary<string, Func<Obj, Obj, object?>>? tools = null, Func<string, string, string>? completer = null)
    {
        this.bp = bp;
        this.tools = tools ?? new();
        this.completer = completer;
        foreach (var mo in (Arr)bp["memoryModules"]!)
        {
            var m = (Obj)mo!;
            var kind = (string)m["kind"]!;
            if (kind is "episodic" or "semantic" or "procedural")
            {
                var seed = new Arr();
                foreach (var ro in (Arr)(m.GetValueOrDefault("records") ?? new Arr()))
                    seed.Add(((Obj)ro!).GetValueOrDefault("data") ?? new Obj());
                Stores[(string)m["id"]!] = new Store(seed);
            }
        }
    }

    string Complete(string system, string user)
    {
        if (completer != null) return completer(system, user);
        var pc = (Obj)bp["providerConfig"]!;
        var provider = (string)pc["provider"]!;
        var model = (string)pc["model"]!;
        if (provider == "anthropic")
        {
            var key = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY") ?? throw new Exception("Set ANTHROPIC_API_KEY");
            var body = new Obj { ["model"] = model, ["max_tokens"] = 1024.0, ["system"] = system, ["messages"] = new Arr { new Obj { ["role"] = "user", ["content"] = user } } };
            var data = Post("https://api.anthropic.com/v1/messages", body, new() { ["x-api-key"] = key, ["anthropic-version"] = "2023-06-01" });
            var sb = new StringBuilder();
            foreach (var blk in (Arr)(data.GetValueOrDefault("content") ?? new Arr()))
                if ((string?)((Obj)blk!).GetValueOrDefault("type") == "text") sb.Append(((Obj)blk!)["text"]);
            return sb.ToString();
        }
        var bases = new Dictionary<string, string> { ["openai"] = "https://api.openai.com/v1", ["xai"] = "https://api.x.ai/v1", ["ollama"] = "http://localhost:11434/v1" };
        var baseUrl = Environment.GetEnvironmentVariable("LLM_BASE_URL") ?? bases.GetValueOrDefault(provider, "https://api.openai.com/v1");
        var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY") ?? Environment.GetEnvironmentVariable("LLM_API_KEY");
        var headers = new Dictionary<string, string>();
        if (apiKey != null) headers["authorization"] = "Bearer " + apiKey;
        var b2 = new Obj { ["model"] = model, ["messages"] = new Arr { new Obj { ["role"] = "system", ["content"] = system }, new Obj { ["role"] = "user", ["content"] = user } } };
        var d2 = Post(baseUrl + "/chat/completions", b2, headers);
        var choice = (Obj)((Arr)d2["choices"]!)[0]!;
        return (string)((Obj)choice["message"]!)["content"]!;
    }

    Obj Post(string url, Obj body, Dictionary<string, string> headers)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = new StringContent(Json.Write(body), Encoding.UTF8, "application/json") };
        foreach (var (k, v) in headers) req.Headers.TryAddWithoutValidation(k, v);
        var resp = Http.Send(req);
        var text = resp.Content.ReadAsStringAsync().Result;
        return (Obj)Json.Parse(text)!;
    }

    Obj Structured(string system, string user)
    {
        var instr = system + "\\n\\nRespond ONLY with JSON: {\\"thought\\":\\"...\\",\\"action\\":{\\"type\\":\\"grounding|learning|respond|finish\\"}}";
        for (var n = 0; n < 3; n++)
        {
            var text = Complete(instr, user);
            int a = text.IndexOf('{'), z = text.LastIndexOf('}');
            if (a >= 0 && z > a)
            {
                try
                {
                    var obj = (Obj)Json.Parse(text.Substring(a, z - a + 1))!;
                    if (obj.GetValueOrDefault("action") is Obj act && act.GetValueOrDefault("type") != null)
                    {
                        obj.TryAdd("thought", "");
                        return obj;
                    }
                }
                catch { }
            }
        }
        throw new Exception("LLM did not return valid action JSON");
    }

    Obj? Module(string id) => ((Arr)bp["memoryModules"]!).Select(m => (Obj)m!).FirstOrDefault(m => (string)m["id"]! == id);

    Arr Retrieve(string query)
    {
        var outp = new Arr();
        foreach (var ao in (Arr)bp["accessPolicy"]!)
        {
            var a = (Obj)ao!;
            var ret = (Obj)a["retrieval"]!;
            if (ret.GetValueOrDefault("enabled") as bool? != true) continue;
            var m = Module((string)a["memoryModuleId"]!);
            if (m == null || !Stores.ContainsKey((string)m["id"]!)) continue;
            var rc = (Obj)(m.GetValueOrDefault("retrievalConfig") ?? new Obj());
            var method = (string?)ret.GetValueOrDefault("method") ?? (string?)rc.GetValueOrDefault("method") ?? "relevance";
            var k = rc.GetValueOrDefault("k") is double kd ? (int)kd : 5;
            outp.Add(new Obj { ["moduleId"] = m["id"], ["moduleName"] = m["name"], ["method"] = method, ["records"] = Stores[(string)m["id"]!].Retrieve(query, method, k) });
        }
        return outp;
    }

    (Arr tools, Arr writable, bool dialogue) Targets()
    {
        var t = new Arr();
        var dialogue = false;
        foreach (var go in (Arr)bp["groundingInterfaces"]!)
        {
            var g = (Obj)go!;
            if ((string)g["type"]! == "digital")
                foreach (var dt in (Arr)(g.GetValueOrDefault("digitalTools") ?? new Arr())) t.Add(dt);
            if ((string)g["type"]! == "dialogue") dialogue = true;
        }
        var w = new Arr();
        foreach (var ao in (Arr)bp["accessPolicy"]!)
        {
            var a = (Obj)ao!;
            if (((Obj)a["learning"]!).GetValueOrDefault("add") as bool? == true)
            {
                var m = Module((string)a["memoryModuleId"]!);
                if (m != null) w.Add(m);
            }
        }
        return (t, w, dialogue);
    }

    (string, string) Prompt(Arr tools, Arr writable, bool dialogue)
    {
        var tl = tools.Count == 0 ? "  (none)" : string.Join("\\n", tools.Select(x => { var t = (Obj)x!; return "  - " + t["name"] + ": " + t.GetValueOrDefault("description"); }));
        var wl = writable.Count == 0 ? "  (none)" : string.Join("\\n", writable.Select(x => { var m = (Obj)x!; return "  - id=\\"" + m["id"] + "\\" (" + m["kind"] + ") " + m["name"]; }));
        var system = string.Join("\\n", new[]
        {
            "You are the decision procedure of a CoALA agent named \\"" + bp["name"] + "\\".",
            "Each cycle: reason over working memory, then choose ONE next action.",
            "Action types: grounding(tool,args) | learning(memoryModuleId,record) | respond(message) | finish(result).",
            "Available tools:", tl, "Writable memory modules:", wl,
            dialogue ? "This agent can talk to the user; use respond to answer." : "Use finish to end.",
            "Do not invent tools or module ids.",
        });
        var user = "Working memory:\\n" + Json.Write(Working) + "\\n\\nChoose the next action.";
        return (system, user);
    }

    object Learn(string? mid, Obj record)
    {
        if (mid == null) return "No memoryModuleId provided.";
        Obj? grant = ((Arr)bp["accessPolicy"]!).Select(a => (Obj)a!).FirstOrDefault(a => (string)a["memoryModuleId"]! == mid);
        if (grant == null || ((Obj)grant["learning"]!).GetValueOrDefault("add") as bool? != true)
            return "Module \\"" + mid + "\\" is not writable (no learning grant).";
        if (!Stores.ContainsKey(mid)) return "Module \\"" + mid + "\\" has no store.";
        Stores[mid].Add(record);
        return new Obj { ["moduleId"] = mid, ["moduleName"] = Module(mid)!["name"], ["record"] = record };
    }

    public Obj RunTurn(string message, int maxSteps = 6)
    {
        Working["input"] = message;
        var (tools, writable, dialogue) = Targets();
        var steps = new Arr();
        object? reply = null;
        for (var i = 1; i <= maxSteps; i++)
        {
            var retrieved = Retrieve(message);
            Working["retrieved"] = retrieved;
            var (system, user) = Prompt(tools, writable, dialogue);
            var proposal = Structured(system, user);
            var action = (Obj)proposal["action"]!;
            var t = (string)action["type"]!;
            var step = new Obj { ["step"] = (double)i, ["retrieved"] = retrieved, ["thought"] = proposal.GetValueOrDefault("thought"), ["action"] = action, ["terminal"] = false };
            if (t == "respond") { reply = action.GetValueOrDefault("message") ?? ""; step["terminal"] = true; }
            else if (t == "finish") { reply ??= action.GetValueOrDefault("result"); step["terminal"] = true; }
            else if (t == "grounding")
            {
                var fn = this.tools.GetValueOrDefault((string)action["tool"]!);
                object? obs = fn != null ? fn((Obj)(action.GetValueOrDefault("args") ?? new Obj()), Working)
                                         : new Obj { ["unhandled"] = true, ["tool"] = action.GetValueOrDefault("tool") };
                step["observation"] = obs;
                Working["lastObservation"] = obs;
            }
            else if (t == "learning")
            {
                var w = Learn((string?)action.GetValueOrDefault("memoryModuleId"), (Obj)(action.GetValueOrDefault("record") ?? new Obj()));
                if (w is string blocked) step["blocked"] = blocked; else step["memoryWrite"] = w;
            }
            steps.Add(step);
            if (step["terminal"] as bool? == true) break;
        }
        return new Obj { ["reply"] = reply, ["steps"] = steps };
    }

    public static Obj LoadBlueprint(string path) => (Obj)Json.Parse(File.ReadAllText(path))!;
}
`;

function toolsCs(agent: Agent): string {
  const tools = digitalTools(agent);
  const adds = tools
    .map(
      (t) => `        // ${(t.description || t.name).replace(/\n/g, " ")}
        m["${t.name}"] = (args, ctx) =>
        {
            // TODO: implement against your app and return an observation.
            throw new NotImplementedException("Implement the '${t.name}' tool");
        };`,
    )
    .join("\n");
  return `// Your agent's grounding tools (external actions). Implement each handler.
using Obj = System.Collections.Generic.Dictionary<string, object?>;

namespace CoalaAgentApp;

public static class Tools
{
    public static Dictionary<string, Func<Obj, Obj, object?>> Registry()
    {
        var m = new Dictionary<string, Func<Obj, Obj, object?>>();
${adds || "        // (no digital tools)"}
        return m;
    }
}
`;
}

const PROGRAM_CS = `using CoalaAgentApp;

var message = args.Length > 0 ? string.Join(" ", args) : "Hello";
var agent = new Agent(Agent.LoadBlueprint("blueprint.json"), Tools.Registry());
Console.WriteLine(Json.Write(agent.RunTurn(message)));
`;

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net6.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
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
  return `# ${agent.name} — CoALA agent (C# / .NET)

Self-contained, runnable CoALA agent. .NET 6+, System.Text.Json (no NuGet deps).

> Generated from the execution-verified Java runtime. Not run-tested in our CI
> (no .NET SDK there) — please run \`dotnet run\` to confirm in your environment.

## Run
\`\`\`bash
cp .env.example .env   # set your provider key in the environment
dotnet run -- "your message here"
\`\`\`

- \`CoalaAgent.cs\` — embedded runtime · \`blueprint.json\` — your agent · \`Tools.cs\` — **implement your tools**.
Swap the in-memory \`Store\` for your DB/vector store (same Add/Retrieve API).
`;
}

export const csharpEmitter: LanguageEmitter = {
  id: "csharp",
  label: "C# / .NET",
  verified: false,
  files(agent: Agent): GeneratedFile[] {
    return [
      { path: "CoalaAgent.cs", content: CS_RUNTIME, language: "csharp" },
      { path: "blueprint.json", content: blueprintJson(agent), language: "json" },
      { path: "Tools.cs", content: toolsCs(agent), language: "csharp" },
      { path: "Program.cs", content: PROGRAM_CS, language: "csharp" },
      { path: "coala-agent.csproj", content: CSPROJ, language: "xml" },
      { path: ".env.example", content: envExample(agent), language: "text" },
      { path: "README.md", content: readme(agent), language: "markdown" },
    ];
  },
};
