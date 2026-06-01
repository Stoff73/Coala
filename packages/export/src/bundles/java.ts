import type { Agent } from "@coala/core";
import {
  type GeneratedFile,
  type LanguageEmitter,
  blueprintJson,
  digitalTools,
  pascal,
} from "./types.js";

/** Embedded runtime — Java 11+, zero deps (includes a minimal JSON parser/serializer). */
const JAVA_RUNTIME = `// CoALA agent runtime (embedded, generated) — Java 11+, zero deps.
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;
import java.util.function.BiFunction;

@SuppressWarnings("unchecked")
class Json {
  private final String s; private int i;
  private Json(String s) { this.s = s; }
  static Object parse(String s) { return new Json(s).value(); }

  private Object value() {
    ws();
    char c = s.charAt(i);
    if (c == '{') return obj();
    if (c == '[') return arr();
    if (c == '"') return str();
    if (c == 't') { i += 4; return Boolean.TRUE; }
    if (c == 'f') { i += 5; return Boolean.FALSE; }
    if (c == 'n') { i += 4; return null; }
    return num();
  }
  private Map<String,Object> obj() {
    Map<String,Object> m = new LinkedHashMap<>(); i++; ws();
    if (s.charAt(i) == '}') { i++; return m; }
    while (true) {
      ws(); String k = str(); ws(); i++; // colon
      m.put(k, value()); ws();
      if (s.charAt(i) == ',') { i++; continue; }
      i++; break;
    }
    return m;
  }
  private List<Object> arr() {
    List<Object> a = new ArrayList<>(); i++; ws();
    if (s.charAt(i) == ']') { i++; return a; }
    while (true) {
      a.add(value()); ws();
      if (s.charAt(i) == ',') { i++; continue; }
      i++; break;
    }
    return a;
  }
  private String str() {
    StringBuilder b = new StringBuilder(); i++;
    while (s.charAt(i) != '"') {
      char c = s.charAt(i++);
      if (c == '\\\\') {
        char e = s.charAt(i++);
        switch (e) {
          case 'n': b.append('\\n'); break;
          case 't': b.append('\\t'); break;
          case 'r': b.append('\\r'); break;
          case 'b': b.append('\\b'); break;
          case 'f': b.append('\\f'); break;
          case '/': b.append('/'); break;
          case '"': b.append('"'); break;
          case '\\\\': b.append('\\\\'); break;
          case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
          default: b.append(e);
        }
      } else b.append(c);
    }
    i++;
    return b.toString();
  }
  private Object num() {
    int start = i;
    while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
    return Double.parseDouble(s.substring(start, i));
  }
  private void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }

  static String write(Object o) { StringBuilder b = new StringBuilder(); w(o, b); return b.toString(); }
  private static void w(Object o, StringBuilder b) {
    if (o == null) { b.append("null"); }
    else if (o instanceof String) { b.append('"'); esc((String) o, b); b.append('"'); }
    else if (o instanceof Map) {
      b.append('{'); boolean first = true;
      for (Map.Entry<String,Object> e : ((Map<String,Object>) o).entrySet()) {
        if (!first) b.append(','); first = false;
        b.append('"'); esc(e.getKey(), b); b.append("\\":"); w(e.getValue(), b);
      }
      b.append('}');
    } else if (o instanceof List) {
      b.append('['); boolean first = true;
      for (Object e : (List<Object>) o) { if (!first) b.append(','); first = false; w(e, b); }
      b.append(']');
    } else if (o instanceof Double) {
      double d = (Double) o;
      if (d == Math.floor(d) && !Double.isInfinite(d)) b.append((long) d); else b.append(d);
    } else b.append(o.toString());
  }
  private static void esc(String s, StringBuilder b) {
    for (char c : s.toCharArray()) {
      switch (c) {
        case '"': b.append("\\\\\\""); break;
        case '\\\\': b.append("\\\\\\\\"); break;
        case '\\n': b.append("\\\\n"); break;
        case '\\t': b.append("\\\\t"); break;
        case '\\r': b.append("\\\\r"); break;
        default: b.append(c);
      }
    }
  }
}

@SuppressWarnings("unchecked")
class Store {
  List<Map<String,Object>> records = new ArrayList<>();
  Store(List<Map<String,Object>> seed) { if (seed != null) records.addAll(seed); }
  void add(Map<String,Object> r) { records.add(r); }
  static List<String> tok(String s) {
    List<String> out = new ArrayList<>();
    java.util.regex.Matcher m = java.util.regex.Pattern.compile("[a-z0-9]+").matcher(s.toLowerCase());
    while (m.find()) out.add(m.group());
    return out;
  }
  List<Map<String,Object>> retrieve(String text, String method, int k) {
    List<Map<String,Object>> rs = new ArrayList<>(records);
    if (method.equals("recency")) {
      Collections.reverse(rs);
      return rs.subList(0, Math.min(k, rs.size()));
    }
    if (method.equals("importance")) {
      rs.sort((a, b) -> Double.compare(imp(b), imp(a)));
      return rs.subList(0, Math.min(k, rs.size()));
    }
    if (method.equals("relevance") || method.equals("embedding")) {
      Set<String> q = new HashSet<>(tok(text));
      rs.sort((a, b) -> Integer.compare(score(b, q), score(a, q)));
      List<Map<String,Object>> out = new ArrayList<>();
      for (Map<String,Object> r : rs) { if (out.size() >= k) break; if (score(r, q) > 0) out.add(r); }
      return out;
    }
    return rs.subList(0, Math.min(k, rs.size()));
  }
  private double imp(Map<String,Object> r) { Object v = r.get("importance"); return v instanceof Double ? (Double) v : 0; }
  private int score(Map<String,Object> r, Set<String> q) {
    int c = 0; for (String t : tok(Json.write(r))) if (q.contains(t)) c++; return c;
  }
}

@SuppressWarnings("unchecked")
public class CoalaAgent {
  Map<String,Object> bp;
  Map<String, BiFunction<Map<String,Object>, Map<String,Object>, Object>> tools;
  BiFunction<String,String,String> completer;
  Map<String,Object> working = new LinkedHashMap<>();
  Map<String,Store> stores = new HashMap<>();

  public CoalaAgent(Map<String,Object> bp,
      Map<String, BiFunction<Map<String,Object>, Map<String,Object>, Object>> tools,
      BiFunction<String,String,String> completer) {
    this.bp = bp; this.tools = tools == null ? new HashMap<>() : tools; this.completer = completer;
    for (Object mo : (List<Object>) bp.get("memoryModules")) {
      Map<String,Object> m = (Map<String,Object>) mo;
      String kind = (String) m.get("kind");
      if (kind.equals("episodic") || kind.equals("semantic") || kind.equals("procedural")) {
        List<Map<String,Object>> seed = new ArrayList<>();
        for (Object ro : (List<Object>) m.getOrDefault("records", new ArrayList<>())) {
          Object d = ((Map<String,Object>) ro).get("data");
          seed.add(d instanceof Map ? (Map<String,Object>) d : new LinkedHashMap<>());
        }
        stores.put((String) m.get("id"), new Store(seed));
      }
    }
  }

  String complete(String system, String user) throws Exception {
    if (completer != null) return completer.apply(system, user);
    Map<String,Object> pc = (Map<String,Object>) bp.get("providerConfig");
    String provider = (String) pc.get("provider"), model = (String) pc.get("model");
    if (provider.equals("anthropic")) {
      String key = System.getenv("ANTHROPIC_API_KEY");
      if (key == null) throw new RuntimeException("Set ANTHROPIC_API_KEY");
      Map<String,Object> body = new LinkedHashMap<>();
      body.put("model", model); body.put("max_tokens", 1024.0); body.put("system", system);
      body.put("messages", List.of(msg("user", user)));
      Map<String,String> h = new HashMap<>();
      h.put("x-api-key", key); h.put("anthropic-version", "2023-06-01");
      Map<String,Object> data = http("https://api.anthropic.com/v1/messages", body, h);
      StringBuilder out = new StringBuilder();
      for (Object b : (List<Object>) data.getOrDefault("content", new ArrayList<>())) {
        Map<String,Object> blk = (Map<String,Object>) b;
        if ("text".equals(blk.get("type"))) out.append(blk.get("text"));
      }
      return out.toString();
    }
    Map<String,String> bases = Map.of("openai", "https://api.openai.com/v1", "xai", "https://api.x.ai/v1", "ollama", "http://localhost:11434/v1");
    String base = System.getenv("LLM_BASE_URL");
    if (base == null) base = bases.getOrDefault(provider, "https://api.openai.com/v1");
    String key = System.getenv("OPENAI_API_KEY");
    if (key == null) key = System.getenv("LLM_API_KEY");
    Map<String,String> h = new HashMap<>();
    if (key != null) h.put("authorization", "Bearer " + key);
    Map<String,Object> body = new LinkedHashMap<>();
    body.put("model", model); body.put("messages", List.of(msg("system", system), msg("user", user)));
    Map<String,Object> data = http(base + "/chat/completions", body, h);
    Map<String,Object> choice = (Map<String,Object>) ((List<Object>) data.get("choices")).get(0);
    return (String) ((Map<String,Object>) choice.get("message")).get("content");
  }
  private Map<String,Object> msg(String role, String content) {
    Map<String,Object> m = new LinkedHashMap<>(); m.put("role", role); m.put("content", content); return m;
  }
  private Map<String,Object> http(String url, Map<String,Object> body, Map<String,String> headers) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setRequestMethod("POST"); c.setDoOutput(true);
    c.setRequestProperty("content-type", "application/json");
    headers.forEach(c::setRequestProperty);
    try (OutputStream os = c.getOutputStream()) { os.write(Json.write(body).getBytes("UTF-8")); }
    InputStream is = c.getResponseCode() >= 400 ? c.getErrorStream() : c.getInputStream();
    String resp = new String(is.readAllBytes(), "UTF-8");
    return (Map<String,Object>) Json.parse(resp);
  }

  Map<String,Object> structured(String system, String user) throws Exception {
    String instr = system + "\\n\\nRespond ONLY with JSON: {\\"thought\\":\\"...\\",\\"action\\":{\\"type\\":\\"grounding|learning|respond|finish\\"}}";
    for (int n = 0; n < 3; n++) {
      String text = complete(instr, user);
      int a = text.indexOf('{'), b = text.lastIndexOf('}');
      if (a >= 0 && b > a) {
        try {
          Map<String,Object> obj = (Map<String,Object>) Json.parse(text.substring(a, b + 1));
          Object act = obj.get("action");
          if (act instanceof Map && ((Map<String,Object>) act).get("type") != null) {
            obj.putIfAbsent("thought", "");
            return obj;
          }
        } catch (Exception ignored) {}
      }
    }
    throw new RuntimeException("LLM did not return valid action JSON");
  }

  Map<String,Object> module(String id) {
    for (Object mo : (List<Object>) bp.get("memoryModules")) {
      Map<String,Object> m = (Map<String,Object>) mo;
      if (id.equals(m.get("id"))) return m;
    }
    return null;
  }

  List<Object> retrieve(String query) {
    List<Object> out = new ArrayList<>();
    for (Object ao : (List<Object>) bp.get("accessPolicy")) {
      Map<String,Object> a = (Map<String,Object>) ao;
      Map<String,Object> ret = (Map<String,Object>) a.get("retrieval");
      if (!Boolean.TRUE.equals(ret.get("enabled"))) continue;
      Map<String,Object> m = module((String) a.get("memoryModuleId"));
      if (m == null || !stores.containsKey(m.get("id"))) continue;
      Map<String,Object> rc = (Map<String,Object>) m.getOrDefault("retrievalConfig", new LinkedHashMap<>());
      String method = ret.get("method") != null ? (String) ret.get("method")
          : (rc.get("method") != null ? (String) rc.get("method") : "relevance");
      int k = rc.get("k") != null ? ((Double) rc.get("k")).intValue() : 5;
      Map<String,Object> item = new LinkedHashMap<>();
      item.put("moduleId", m.get("id")); item.put("moduleName", m.get("name")); item.put("method", method);
      item.put("records", stores.get(m.get("id")).retrieve(query, method, k));
      out.add(item);
    }
    return out;
  }

  Object[] targets() {
    List<Map<String,Object>> tools = new ArrayList<>();
    boolean dialogue = false;
    for (Object go : (List<Object>) bp.get("groundingInterfaces")) {
      Map<String,Object> g = (Map<String,Object>) go;
      if ("digital".equals(g.get("type")))
        for (Object t : (List<Object>) g.getOrDefault("digitalTools", new ArrayList<>())) tools.add((Map<String,Object>) t);
      if ("dialogue".equals(g.get("type"))) dialogue = true;
    }
    List<Map<String,Object>> writable = new ArrayList<>();
    for (Object ao : (List<Object>) bp.get("accessPolicy")) {
      Map<String,Object> a = (Map<String,Object>) ao;
      if (Boolean.TRUE.equals(((Map<String,Object>) a.get("learning")).get("add"))) {
        Map<String,Object> m = module((String) a.get("memoryModuleId"));
        if (m != null) writable.add(m);
      }
    }
    return new Object[]{tools, writable, dialogue};
  }

  String[] prompt(List<Map<String,Object>> tools, List<Map<String,Object>> writable, boolean dialogue) {
    StringBuilder tl = new StringBuilder(); for (Map<String,Object> t : tools) tl.append("\\n  - ").append(t.get("name")).append(": ").append(t.getOrDefault("description", ""));
    StringBuilder wl = new StringBuilder(); for (Map<String,Object> m : writable) wl.append("\\n  - id=\\"").append(m.get("id")).append("\\" (").append(m.get("kind")).append(") ").append(m.get("name"));
    String system = "You are the decision procedure of a CoALA agent named \\"" + bp.get("name") + "\\"."
      + "\\nEach cycle: reason over working memory, then choose ONE next action."
      + "\\nAction types: grounding(tool,args) | learning(memoryModuleId,record) | respond(message) | finish(result)."
      + "\\nAvailable tools:" + (tl.length() == 0 ? "\\n  (none)" : tl)
      + "\\nWritable memory modules:" + (wl.length() == 0 ? "\\n  (none)" : wl)
      + "\\n" + (dialogue ? "This agent can talk to the user; use respond to answer." : "Use finish to end.")
      + "\\nDo not invent tools or module ids.";
    String user = "Working memory:\\n" + Json.write(working) + "\\n\\nChoose the next action.";
    return new String[]{system, user};
  }

  Object learn(String mid, Map<String,Object> record) {
    if (mid == null) return "No memoryModuleId provided.";
    Map<String,Object> grant = null;
    for (Object ao : (List<Object>) bp.get("accessPolicy")) {
      Map<String,Object> a = (Map<String,Object>) ao;
      if (mid.equals(a.get("memoryModuleId"))) grant = a;
    }
    if (grant == null || !Boolean.TRUE.equals(((Map<String,Object>) grant.get("learning")).get("add")))
      return "Module \\"" + mid + "\\" is not writable (no learning grant).";
    if (!stores.containsKey(mid)) return "Module \\"" + mid + "\\" has no store.";
    stores.get(mid).add(record);
    Map<String,Object> w = new LinkedHashMap<>();
    w.put("moduleId", mid); w.put("moduleName", module(mid).get("name")); w.put("record", record);
    return w;
  }

  public Map<String,Object> runTurn(String message, int maxSteps) throws Exception {
    working.put("input", message);
    Object[] tg = targets();
    List<Map<String,Object>> tools = (List<Map<String,Object>>) tg[0], writable = (List<Map<String,Object>>) tg[1];
    boolean dialogue = (Boolean) tg[2];
    List<Object> steps = new ArrayList<>();
    Object reply = null;
    for (int i = 1; i <= maxSteps; i++) {
      List<Object> retrieved = retrieve(message);
      working.put("retrieved", retrieved);
      String[] pr = prompt(tools, writable, dialogue);
      Map<String,Object> proposal = structured(pr[0], pr[1]);
      Map<String,Object> action = (Map<String,Object>) proposal.get("action");
      String t = (String) action.get("type");
      Map<String,Object> step = new LinkedHashMap<>();
      step.put("step", i); step.put("retrieved", retrieved); step.put("thought", proposal.get("thought"));
      step.put("action", action); step.put("terminal", false);
      if ("respond".equals(t)) { reply = action.getOrDefault("message", ""); step.put("terminal", true); }
      else if ("finish".equals(t)) { if (reply == null) reply = action.get("result"); step.put("terminal", true); }
      else if ("grounding".equals(t)) {
        BiFunction<Map<String,Object>, Map<String,Object>, Object> fn = tools().get(action.get("tool"));
        Object obs;
        if (fn != null) obs = fn.apply((Map<String,Object>) action.getOrDefault("args", new LinkedHashMap<>()), working);
        else { Map<String,Object> u = new LinkedHashMap<>(); u.put("unhandled", true); u.put("tool", action.get("tool")); obs = u; }
        step.put("observation", obs); working.put("lastObservation", obs);
      } else if ("learning".equals(t)) {
        Object w = learn((String) action.get("memoryModuleId"), (Map<String,Object>) action.getOrDefault("record", new LinkedHashMap<>()));
        if (w instanceof String) step.put("blocked", w); else step.put("memoryWrite", w);
      }
      steps.add(step);
      if (Boolean.TRUE.equals(step.get("terminal"))) break;
    }
    Map<String,Object> res = new LinkedHashMap<>();
    res.put("reply", reply); res.put("steps", steps);
    return res;
  }

  Map<String, BiFunction<Map<String,Object>, Map<String,Object>, Object>> tools() { return tools; }

  public static Map<String,Object> loadBlueprint(String path) throws Exception {
    return (Map<String,Object>) Json.parse(new String(Files.readAllBytes(Paths.get(path)), "UTF-8"));
  }
}
`;

function toolsJava(agent: Agent): string {
  const tools = digitalTools(agent);
  const puts = tools
    .map(
      (t) => `    // ${(t.description || t.name).replace(/\n/g, " ")}
    m.put("${t.name}", (args, ctx) -> {
      // TODO: implement against your app and return an observation.
      throw new RuntimeException("Implement the '${t.name}' tool");
    });`,
    )
    .join("\n");
  return `// Your agent's grounding tools (external actions). Implement each handler.
import java.util.*;
import java.util.function.BiFunction;

public class Tools {
  public static Map<String, BiFunction<Map<String,Object>, Map<String,Object>, Object>> registry() {
    Map<String, BiFunction<Map<String,Object>, Map<String,Object>, Object>> m = new HashMap<>();
${puts || "    // (no digital tools)"}
    return m;
  }
}
`;
}

const MAIN_JAVA = `import java.util.*;

public class Main {
  public static void main(String[] args) throws Exception {
    String message = args.length > 0 ? String.join(" ", args) : "Hello";
    CoalaAgent agent = new CoalaAgent(CoalaAgent.loadBlueprint("blueprint.json"), Tools.registry(), null);
    System.out.println(Json.write(agent.runTurn(message, 6)));
  }
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
  return `# ${agent.name} — CoALA agent (Java)

Self-contained, runnable CoALA agent. Java 11+, zero deps (embedded JSON parser).

## Run
\`\`\`bash
cp .env.example .env && export $(cat .env | xargs)
javac *.java && java Main "your message here"
\`\`\`

- \`CoalaAgent.java\` — embedded runtime · \`blueprint.json\` — your agent · \`Tools.java\` — **implement your tools**.
Swap the in-memory \`Store\` for your DB/vector store (same add/retrieve API).
`;
}

export const javaEmitter: LanguageEmitter = {
  id: "java",
  label: "Java",
  verified: true,
  files(agent: Agent): GeneratedFile[] {
    return [
      { path: "CoalaAgent.java", content: JAVA_RUNTIME, language: "java" },
      { path: "blueprint.json", content: blueprintJson(agent), language: "json" },
      { path: "Tools.java", content: toolsJava(agent), language: "java" },
      { path: "Main.java", content: MAIN_JAVA, language: "java" },
      { path: ".env.example", content: envExample(agent), language: "text" },
      { path: "README.md", content: readme(agent), language: "markdown" },
    ];
  },
};
