import type { Agent } from "@coala/core";
import {
  type GeneratedFile,
  type LanguageEmitter,
  blueprintJson,
  digitalTools,
  snake,
} from "./types.js";

/** Embedded runtime — Ruby stdlib only (net/http, json). Compatible with Ruby 2.6+. */
const RUBY_RUNTIME = `# CoALA agent runtime (embedded, generated) — Ruby stdlib only.
require "json"
require "set"
require "net/http"
require "uri"

module Coala
  LONG_TERM = %w[episodic semantic procedural].freeze

  def self.tok(s)
    s.to_s.downcase.scan(/[a-z0-9]+/)
  end

  class Store
    attr_reader :records

    def initialize(seed = [])
      @records = seed.dup
    end

    def add(r)
      @records << r
    end

    def retrieve(text, method, k)
      case method
      when "recency"
        @records.last(k).reverse
      when "importance"
        @records.sort_by { |r| -(r["importance"] || 0).to_f }.first(k)
      when "relevance", "embedding"
        q = Coala.tok(text).to_set
        scored = @records.map { |r| [Coala.tok(r.to_json).count { |t| q.include?(t) }, r] }
        scored.select { |s, _| s > 0 }.sort_by { |s, _| -s }.first(k).map { |_, r| r }
      else
        @records.first(k)
      end
    end
  end

  class Agent
    attr_reader :stores, :working

    def initialize(bp, tools = {}, completer = nil)
      @bp = bp
      @tools = tools
      @completer = completer
      @working = {}
      @stores = {}
      bp["memoryModules"].each do |m|
        next unless LONG_TERM.include?(m["kind"])
        seed = (m["records"] || []).map { |r| r["data"] || {} }
        @stores[m["id"]] = Store.new(seed)
      end
    end

    def complete(system, user)
      return @completer.call(system, user) if @completer
      pc = @bp["providerConfig"]
      if pc["provider"] == "anthropic"
        key = ENV["ANTHROPIC_API_KEY"] or raise "Set ANTHROPIC_API_KEY"
        data = http("https://api.anthropic.com/v1/messages",
          { "model" => pc["model"], "max_tokens" => 1024, "system" => system,
            "messages" => [{ "role" => "user", "content" => user }] },
          { "x-api-key" => key, "anthropic-version" => "2023-06-01" })
        (data["content"] || []).select { |b| b["type"] == "text" }.map { |b| b["text"] }.join
      else
        bases = { "openai" => "https://api.openai.com/v1", "xai" => "https://api.x.ai/v1",
                  "ollama" => "http://localhost:11434/v1" }
        base = ENV["LLM_BASE_URL"] || bases[pc["provider"]] || "https://api.openai.com/v1"
        key = ENV["OPENAI_API_KEY"] || ENV["LLM_API_KEY"]
        h = {}
        h["authorization"] = "Bearer #{key}" if key
        data = http("#{base}/chat/completions",
          { "model" => pc["model"], "messages" => [{ "role" => "system", "content" => system },
                                                   { "role" => "user", "content" => user }] }, h)
        data["choices"][0]["message"]["content"]
      end
    end

    def http(url, body, headers)
      uri = URI(url)
      req = Net::HTTP::Post.new(uri)
      req["content-type"] = "application/json"
      headers.each { |k, v| req[k] = v }
      req.body = body.to_json
      res = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") { |c| c.request(req) }
      JSON.parse(res.body)
    end

    def structured(system, user)
      instr = system + "\\n\\nRespond ONLY with JSON: " + '{"thought":"...","action":{"type":"grounding|learning|respond|finish","tool":"...","args":{},"memoryModuleId":"...","record":{},"message":"...","result":"..."}}'
      3.times do
        text = complete(instr, user)
        m = text[/\\{.*\\}/m]
        begin
          obj = JSON.parse(m || text)
          return ({ "thought" => "" }.merge(obj)) if obj.is_a?(Hash) && obj.dig("action", "type")
        rescue StandardError
          nil
        end
      end
      raise "LLM did not return valid action JSON"
    end

    def module_by(id)
      @bp["memoryModules"].find { |m| m["id"] == id }
    end

    def retrieve(query)
      out = []
      @bp["accessPolicy"].each do |a|
        next unless a["retrieval"]["enabled"]
        m = module_by(a["memoryModuleId"])
        next unless m && @stores[m["id"]]
        rc = m["retrievalConfig"] || {}
        method = a["retrieval"]["method"] || rc["method"] || "relevance"
        k = rc["k"] || 5
        out << { "moduleId" => m["id"], "moduleName" => m["name"], "method" => method,
                 "records" => @stores[m["id"]].retrieve(query, method, k) }
      end
      out
    end

    def targets
      tools = @bp["groundingInterfaces"].select { |g| g["type"] == "digital" }.flat_map { |g| g["digitalTools"] || [] }
      writable = @bp["accessPolicy"].select { |a| a["learning"]["add"] }.map { |a| module_by(a["memoryModuleId"]) }.compact
      dialogue = @bp["groundingInterfaces"].any? { |g| g["type"] == "dialogue" }
      [tools, writable, dialogue]
    end

    def prompt(tools, writable, dialogue)
      tl = tools.empty? ? "  (none)" : tools.map { |t| "  - #{t['name']}: #{t['description']}" }.join("\\n")
      wl = writable.empty? ? "  (none)" : writable.map { |m| "  - id=\\"#{m['id']}\\" (#{m['kind']}) #{m['name']}" }.join("\\n")
      system = [
        "You are the decision procedure of a CoALA agent named \\"#{@bp['name']}\\".",
        "Each cycle: reason over working memory, then choose ONE next action.",
        "Action types: grounding(tool,args) | learning(memoryModuleId,record) | respond(message) | finish(result).",
        "Available tools:", tl, "Writable memory modules:", wl,
        dialogue ? "This agent can talk to the user; use respond to answer." : "Use finish to end.",
        "Do not invent tools or module ids."
      ].join("\\n")
      user = "Working memory:\\n#{JSON.pretty_generate(@working)}\\n\\nChoose the next action."
      [system, user]
    end

    def learn(mid, record)
      return "No memoryModuleId provided." unless mid
      grant = @bp["accessPolicy"].find { |a| a["memoryModuleId"] == mid }
      return "Module \\"#{mid}\\" is not writable (no learning grant)." unless grant && grant["learning"]["add"]
      return "Module \\"#{mid}\\" has no store." unless @stores[mid]
      @stores[mid].add(record)
      { "moduleId" => mid, "moduleName" => module_by(mid)["name"], "record" => record }
    end

    def run_turn(message, max_steps = 6)
      @working["input"] = message
      tools, writable, dialogue = targets
      steps = []
      reply = nil
      (1..max_steps).each do |i|
        retrieved = retrieve(message)
        @working["retrieved"] = retrieved
        system, user = prompt(tools, writable, dialogue)
        proposal = structured(system, user)
        action = proposal["action"]
        t = action["type"]
        step = { "step" => i, "retrieved" => retrieved, "thought" => proposal["thought"], "action" => action, "terminal" => false }
        case t
        when "respond"
          reply = action["message"] || ""
          step["terminal"] = true
        when "finish"
          reply ||= action["result"]
          step["terminal"] = true
        when "grounding"
          fn = @tools[action["tool"]]
          obs = fn ? fn.call(action["args"] || {}, @working) : { "unhandled" => true, "tool" => action["tool"] }
          step["observation"] = obs
          @working["lastObservation"] = obs
        when "learning"
          w = learn(action["memoryModuleId"], action["record"] || {})
          w.is_a?(String) ? step["blocked"] = w : step["memoryWrite"] = w
        end
        steps << step
        break if step["terminal"]
      end
      { "reply" => reply, "steps" => steps }
    end
  end

  def self.load_agent(tools: {}, completer: nil, path: nil)
    path ||= File.join(__dir__, "blueprint.json")
    Agent.new(JSON.parse(File.read(path)), tools, completer)
  end
end
`;

function toolsRb(agent: Agent): string {
  const tools = digitalTools(agent);
  const fns = tools
    .map(
      (t) => `  # ${(t.description || t.name).replace(/\n/g, " ")}
  ${snake(t.name)} = lambda do |args, ctx|
    # TODO: implement against your app and return an observation.
    raise NotImplementedError, "Implement the '${t.name}' tool"
  end`,
    )
    .join("\n\n");
  const registry = tools.map((t) => `    "${t.name}" => ${snake(t.name)},`).join("\n");
  return `# Your agent's grounding tools (external actions). Implement each lambda.
module Tools
${fns || "  # (no digital tools)"}

  def self.registry
    {
${registry}
    }
  end
end
`;
}

const RUN_RB = `# CLI: ruby run.rb "your message"
require_relative "agent"
require_relative "tools"

message = ARGV.join(" ")
message = "Hello" if message.empty?
agent = Coala.load_agent(tools: Tools.registry)
puts JSON.pretty_generate(agent.run_turn(message))
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
  return `# ${agent.name} — CoALA agent (Ruby)

Self-contained, runnable CoALA agent. Ruby stdlib only (works in Rails/Sinatra apps too).

## Run
\`\`\`bash
cp .env.example .env && export $(cat .env | xargs)
ruby run.rb "your message here"
\`\`\`

- \`agent.rb\` — embedded runtime · \`blueprint.json\` — your agent · \`tools.rb\` — **implement your tools**.
Swap the in-memory \`Store\` for your DB/vector store (same add/retrieve API).
`;
}

export const rubyEmitter: LanguageEmitter = {
  id: "ruby",
  label: "Ruby",
  verified: true,
  files(agent: Agent): GeneratedFile[] {
    return [
      { path: "agent.rb", content: RUBY_RUNTIME, language: "ruby" },
      { path: "blueprint.json", content: blueprintJson(agent), language: "json" },
      { path: "tools.rb", content: toolsRb(agent), language: "ruby" },
      { path: "run.rb", content: RUN_RB, language: "ruby" },
      { path: ".env.example", content: envExample(agent), language: "text" },
      { path: "README.md", content: readme(agent), language: "markdown" },
    ];
  },
};
