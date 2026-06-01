import type { Agent } from "@coala/core";
import {
  type GeneratedFile,
  type LanguageEmitter,
  blueprintJson,
  digitalTools,
  snake,
} from "./types.js";

/** Embedded runtime — PHP 8, no external deps (uses streams for HTTP). */
const PHP_RUNTIME = `<?php
// CoALA agent runtime (embedded, generated) — PHP 8, no external deps.

class Store {
    public array $records;
    function __construct(array $seed = []) { $this->records = array_values($seed); }
    function add($r): void { $this->records[] = $r; }
    static function tok(string $s): array { preg_match_all('/[a-z0-9]+/', strtolower($s), $m); return $m[0]; }
    function retrieve(string $text, string $method, int $k): array {
        if ($method === "recency") return array_reverse(array_slice($this->records, -$k));
        if ($method === "importance") {
            $rs = $this->records;
            usort($rs, fn($a, $b) => floatval($b["importance"] ?? 0) <=> floatval($a["importance"] ?? 0));
            return array_slice($rs, 0, $k);
        }
        if ($method === "relevance" || $method === "embedding") {
            $q = array_flip(self::tok($text));
            $scored = [];
            foreach ($this->records as $r) {
                $s = 0;
                foreach (self::tok(json_encode($r)) as $t) if (isset($q[$t])) $s++;
                if ($s) $scored[] = [$s, $r];
            }
            usort($scored, fn($a, $b) => $b[0] <=> $a[0]);
            return array_map(fn($x) => $x[1], array_slice($scored, 0, $k));
        }
        return array_slice($this->records, 0, $k);
    }
}

class CoalaAgent {
    public array $bp; public array $tools; public $completer; public array $working = []; public array $stores = [];
    function __construct(array $bp, array $tools = [], $completer = null) {
        $this->bp = $bp; $this->tools = $tools; $this->completer = $completer;
        foreach ($bp["memoryModules"] as $m)
            if (in_array($m["kind"], ["episodic", "semantic", "procedural"]))
                $this->stores[$m["id"]] = new Store(array_map(fn($r) => $r["data"] ?? [], $m["records"] ?? []));
    }

    function complete(string $system, string $user): string {
        if ($this->completer) return ($this->completer)($system, $user);
        $pc = $this->bp["providerConfig"];
        if ($pc["provider"] === "anthropic") {
            $key = getenv("ANTHROPIC_API_KEY"); if (!$key) throw new Exception("Set ANTHROPIC_API_KEY");
            $data = $this->http("https://api.anthropic.com/v1/messages",
                ["model" => $pc["model"], "max_tokens" => 1024, "system" => $system, "messages" => [["role" => "user", "content" => $user]]],
                ["content-type: application/json", "x-api-key: $key", "anthropic-version: 2023-06-01"]);
            $out = ""; foreach ($data["content"] ?? [] as $b) if (($b["type"] ?? "") === "text") $out .= $b["text"]; return $out;
        }
        $bases = ["openai" => "https://api.openai.com/v1", "xai" => "https://api.x.ai/v1", "ollama" => "http://localhost:11434/v1"];
        $base = getenv("LLM_BASE_URL") ?: ($bases[$pc["provider"]] ?? "https://api.openai.com/v1");
        $key = getenv("OPENAI_API_KEY") ?: (getenv("LLM_API_KEY") ?: "");
        $h = ["content-type: application/json"]; if ($key) $h[] = "authorization: Bearer $key";
        $data = $this->http("$base/chat/completions",
            ["model" => $pc["model"], "messages" => [["role" => "system", "content" => $system], ["role" => "user", "content" => $user]]], $h);
        return $data["choices"][0]["message"]["content"];
    }

    function http(string $url, array $body, array $headers): array {
        $ctx = stream_context_create(["http" => ["method" => "POST", "header" => implode("\\r\\n", $headers), "content" => json_encode($body), "ignore_errors" => true]]);
        return json_decode(file_get_contents($url, false, $ctx), true) ?? [];
    }

    function structured(string $system, string $user, int $attempts = 3): array {
        $instr = $system . "\\n\\nRespond ONLY with JSON: " . '{"thought":"...","action":{"type":"grounding|learning|respond|finish","tool":"...","args":{},"memoryModuleId":"...","record":{},"message":"...","result":"..."}}';
        for ($n = 0; $n < $attempts; $n++) {
            $text = $this->complete($instr, $user);
            preg_match('/\\{.*\\}/s', $text, $mm);
            $obj = json_decode($mm[0] ?? $text, true);
            if (is_array($obj) && isset($obj["action"]["type"])) { $obj["thought"] = $obj["thought"] ?? ""; return $obj; }
        }
        throw new Exception("LLM did not return valid action JSON");
    }

    function module(string $id): ?array { foreach ($this->bp["memoryModules"] as $m) if ($m["id"] === $id) return $m; return null; }

    function retrieve(string $q): array {
        $out = [];
        foreach ($this->bp["accessPolicy"] as $a) {
            if (!$a["retrieval"]["enabled"]) continue;
            $m = $this->module($a["memoryModuleId"]); if (!$m || !isset($this->stores[$m["id"]])) continue;
            $rc = $m["retrievalConfig"] ?? [];
            $method = $a["retrieval"]["method"] ?? ($rc["method"] ?? "relevance"); $k = $rc["k"] ?? 5;
            $out[] = ["moduleId" => $m["id"], "moduleName" => $m["name"], "method" => $method, "records" => $this->stores[$m["id"]]->retrieve($q, $method, $k)];
        }
        return $out;
    }

    function targets(): array {
        $tools = []; foreach ($this->bp["groundingInterfaces"] as $g) if ($g["type"] === "digital") foreach ($g["digitalTools"] ?? [] as $t) $tools[] = $t;
        $writable = []; foreach ($this->bp["accessPolicy"] as $a) if ($a["learning"]["add"]) { $m = $this->module($a["memoryModuleId"]); if ($m) $writable[] = $m; }
        $dialogue = false; foreach ($this->bp["groundingInterfaces"] as $g) if ($g["type"] === "dialogue") $dialogue = true;
        return [$tools, $writable, $dialogue];
    }

    function prompt(array $tools, array $writable, bool $dialogue): array {
        $tl = $tools ? implode("\\n", array_map(fn($t) => "  - " . $t["name"] . ": " . ($t["description"] ?? ""), $tools)) : "  (none)";
        $wl = $writable ? implode("\\n", array_map(fn($m) => '  - id="' . $m["id"] . '" (' . $m["kind"] . ") " . $m["name"], $writable)) : "  (none)";
        $system = implode("\\n", [
            'You are the decision procedure of a CoALA agent named "' . $this->bp["name"] . '".',
            "Goals: " . (implode("; ", $this->bp["goals"] ?? []) ?: "(none)") . ".",
            "Each cycle: reason over working memory, then choose ONE next action.",
            "Action types: grounding(tool,args) | learning(memoryModuleId,record) | respond(message) | finish(result).",
            "Available tools:", $tl, "Writable memory modules:", $wl,
            $dialogue ? "This agent can talk to the user; use respond to answer." : "Use finish to end.",
            "Do not invent tools or module ids.",
        ]);
        $user = "Working memory:\\n" . json_encode($this->working, JSON_PRETTY_PRINT) . "\\n\\nChoose the next action.";
        return [$system, $user];
    }

    function learn(?string $mid, array $record) {
        if (!$mid) return "No memoryModuleId provided.";
        $grant = null; foreach ($this->bp["accessPolicy"] as $a) if ($a["memoryModuleId"] === $mid) $grant = $a;
        if (!$grant || !$grant["learning"]["add"]) return 'Module "' . $mid . '" is not writable (no learning grant).';
        if (!isset($this->stores[$mid])) return 'Module "' . $mid . '" has no store.';
        $this->stores[$mid]->add($record);
        return ["moduleId" => $mid, "moduleName" => $this->module($mid)["name"], "record" => $record];
    }

    function runTurn(string $message, int $maxSteps = 6): array {
        $this->working["input"] = $message;
        [$tools, $writable, $dialogue] = $this->targets();
        $steps = []; $reply = null;
        for ($i = 1; $i <= $maxSteps; $i++) {
            $retrieved = $this->retrieve($message);
            $this->working["retrieved"] = $retrieved;
            [$system, $user] = $this->prompt($tools, $writable, $dialogue);
            $proposal = $this->structured($system, $user);
            $action = $proposal["action"]; $t = $action["type"] ?? "";
            $step = ["step" => $i, "retrieved" => $retrieved, "thought" => $proposal["thought"] ?? "", "action" => $action, "terminal" => false];
            if ($t === "respond") { $reply = $action["message"] ?? ""; $step["terminal"] = true; }
            elseif ($t === "finish") { $reply = $reply ?? ($action["result"] ?? null); $step["terminal"] = true; }
            elseif ($t === "grounding") {
                $fn = $this->tools[$action["tool"] ?? ""] ?? null;
                $obs = $fn ? $fn($action["args"] ?? [], $this->working) : ["unhandled" => true, "tool" => $action["tool"] ?? null];
                $step["observation"] = $obs; $this->working["lastObservation"] = $obs;
            } elseif ($t === "learning") {
                $w = $this->learn($action["memoryModuleId"] ?? null, $action["record"] ?? []);
                if (is_string($w)) $step["blocked"] = $w; else $step["memoryWrite"] = $w;
            }
            $steps[] = $step;
            if ($step["terminal"]) break;
        }
        return ["reply" => $reply, "steps" => $steps];
    }
}

function load_agent(array $tools = [], $completer = null, ?string $path = null): CoalaAgent {
    $path = $path ?? __DIR__ . "/blueprint.json";
    return new CoalaAgent(json_decode(file_get_contents($path), true), $tools, $completer);
}
`;

function toolsPhp(agent: Agent): string {
  const tools = digitalTools(agent);
  const fns = tools
    .map(
      (t) => `function ${snake(t.name)}($args, $ctx) {
    // ${(t.description || t.name).replace(/\n/g, " ")}
    // TODO: implement against your app and return an observation.
    throw new Exception("Implement the '${t.name}' tool");
}`,
    )
    .join("\n\n");
  const registry = tools.map((t) => `    "${t.name}" => '${snake(t.name)}',`).join("\n");
  return `<?php
// Your agent's grounding tools (external actions). Implement each stub.

${fns || "// (no digital tools)"}

function tools(): array {
    return [
${registry}
    ];
}
`;
}

const RUN_PHP = `<?php
// CLI: php run.php "your message"
require __DIR__ . "/agent.php";
require __DIR__ . "/tools.php";
$message = implode(" ", array_slice($argv, 1)) ?: "Hello";
$agent = load_agent(tools());
echo json_encode($agent->runTurn($message), JSON_PRETTY_PRINT), "\\n";
`;

const SERVE_PHP = `<?php
// Built-in server glue:  php -S localhost:8000 serve.php   (POST /chat {"message":"..."})
require __DIR__ . "/agent.php";
require __DIR__ . "/tools.php";
$body = json_decode(file_get_contents("php://input"), true) ?? [];
header("Content-Type: application/json");
$agent = load_agent(tools());
echo json_encode($agent->runTurn($body["message"] ?? ""));
`;

function envExample(agent: Agent): string {
  const p = agent.providerConfig.provider;
  const k: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY=",
    openai: "OPENAI_API_KEY=",
    xai: "OPENAI_API_KEY=\nLLM_BASE_URL=https://api.x.ai/v1",
    google: "OPENAI_API_KEY=   # Gemini not bundled",
    ollama: "LLM_BASE_URL=http://localhost:11434/v1",
    local: "LLM_BASE_URL=\nLLM_API_KEY=",
  };
  return `# Provider key for ${p}.\n${k[p] ?? "OPENAI_API_KEY="}\n`;
}

function readme(agent: Agent): string {
  return `# ${agent.name} — CoALA agent (PHP)

Self-contained, runnable CoALA agent. PHP 8, no Composer deps.

## Layout
- \`agent.php\` — embedded CoALA runtime.
- \`blueprint.json\` — memory modules, schemas, seed records, access policy, decision procedure.
- \`tools.php\` — **implement your grounding tools here**.
- \`run.php\` — CLI.  \`serve.php\` — built-in-server glue (works as a Laravel/Symfony controller too).

## Run
\`\`\`bash
cp .env.example .env && export $(cat .env | xargs)   # provider key
php run.php "your message here"
# or: php -S localhost:8000 serve.php   →  POST /chat
\`\`\`

Swap the in-memory \`Store\` in \`agent.php\` for your DB/vector store (same add/retrieve API).
`;
}

export const phpEmitter: LanguageEmitter = {
  id: "php",
  label: "PHP",
  verified: true,
  files(agent: Agent): GeneratedFile[] {
    return [
      { path: "agent.php", content: PHP_RUNTIME, language: "php" },
      { path: "blueprint.json", content: blueprintJson(agent), language: "json" },
      { path: "tools.php", content: toolsPhp(agent), language: "php" },
      { path: "run.php", content: RUN_PHP, language: "php" },
      { path: "serve.php", content: SERVE_PHP, language: "php" },
      { path: ".env.example", content: envExample(agent), language: "text" },
      { path: "README.md", content: readme(agent), language: "markdown" },
    ];
  },
};
