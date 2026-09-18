import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(dashboardRoot, "..");
let buildDirectory = "";

const expectedShellEntries = new Set([
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
]);
const versionedAssetPattern = /^assets\/[^/?#]+-[A-Za-z0-9_-]{8,}\.(?:css|js)$/;
const revisionPattern = /^[a-f0-9]{32}$/;
const navigationRoutePattern = /^new\s+([A-Za-z_$][\w$]*)\.NavigationRoute\(\1\.createHandlerBoundToURL\("index\.html"\)\)$/;
const onFetchAssignmentCases = [
  "onfetch",
  "self.onfetch",
  "globalThis.onfetch",
  "window.onfetch",
  'self["onfetch"]',
  "globalThis['onfetch']",
  "window['onfetch']",
].flatMap((target) => ["=", "||=", "&&=", "??="].map((operator) => ({ operator, target })));

interface PrecacheEntry {
  url: unknown;
  revision: unknown;
}

function callArguments(source: string, functionName: string): string[] {
  const calls: string[] = [];
  const pattern = new RegExp(`\\b${functionName}\\s*\\(`, "g");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const open = source.indexOf("(", match.index);
    let depth = 0;
    let quote = "";
    let escaped = false;

    for (let index = open; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === quote) {
          quote = "";
        }
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
        if (depth === 0) {
          calls.push(source.slice(open + 1, index).trim());
          pattern.lastIndex = index + 1;
          break;
        }
      }
    }
  }

  return calls;
}

function leadingArray(source: string): string | undefined {
  const start = source.search(/\S/);
  if (start < 0 || source[start] !== "[") return undefined;

  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return undefined;
}

function parsePrecacheEntries(workerSource: string): PrecacheEntry[] | undefined {
  const precacheCalls = callArguments(workerSource, "precacheAndRoute");
  if (precacheCalls.length !== 1) return undefined;
  const serializedEntries = leadingArray(precacheCalls[0]);
  if (!serializedEntries) return undefined;

  try {
    const json = serializedEntries
      .replace(/([{,])\s*url\s*:/g, '$1"url":')
      .replace(/,\s*revision\s*:/g, ',"revision":');
    const entries = JSON.parse(json) as unknown;
    return Array.isArray(entries) ? entries as PrecacheEntry[] : undefined;
  } catch {
    return undefined;
  }
}

function hasDirectOnFetchAssignment(workerSource: string): boolean {
  // Parse syntax only: templates retain executable children, escapes are decoded,
  // and regex/string/comment text stays inert. Never evaluate dynamic properties.
  const source = ts.createSourceFile("sw.js", workerSource, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const assignmentOperators = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.EqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
  ]);
  function unwrapParentheses(node: ts.Expression): ts.Expression {
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    return node;
  }

  const isGlobalTarget = (expression: ts.Expression) => {
    const node = unwrapParentheses(expression);
    return ts.isIdentifier(node) && ["self", "globalThis", "window"].includes(node.text);
  };
  const isStaticOnFetchProperty = (expression: ts.Expression) => {
    const node = unwrapParentheses(expression);
    return ts.isStringLiteralLike(node) && node.text === "onfetch";
  };

  function visit(node: ts.Node, globalVarScope = true): true | undefined {
    // In a classic worker, initialized global var declarations write the global
    // property, including var declarations inside blocks (but not local scopes).
    if (
      globalVarScope && ts.isVariableDeclarationList(node) && !(node.flags & ts.NodeFlags.BlockScoped) &&
      node.declarations.some((declaration) => declaration.initializer !== undefined &&
        ts.isIdentifier(declaration.name) && declaration.name.text === "onfetch")
    ) {
      return true;
    }
    if (ts.isBinaryExpression(node) && assignmentOperators.has(node.operatorToken.kind)) {
      const target = unwrapParentheses(node.left);
      if (
        (ts.isIdentifier(target) && target.text === "onfetch") ||
        (ts.isPropertyAccessExpression(target) && isGlobalTarget(target.expression) &&
          target.name.text === "onfetch") ||
        (ts.isElementAccessExpression(target) && isGlobalTarget(target.expression) &&
          isStaticOnFetchProperty(target.argumentExpression))
      ) {
        return true;
      }
    }
    const childrenHaveGlobalVars = globalVarScope && !ts.isFunctionLike(node) && !ts.isClassStaticBlockDeclaration(node);
    return ts.forEachChild(node, (child) => visit(child, childrenHaveGlobalVars));
  }

  return visit(source) === true;
}

function serviceWorkerSafetyIssues(workerSource: string): string[] {
  const issues: string[] = [];
  const entries = parsePrecacheEntries(workerSource);

  if (!entries) {
    issues.push("worker must contain one parseable precache manifest");
  } else {
    const urls = new Set<string>();
    for (const entry of entries) {
      if (
        typeof entry !== "object" || entry === null ||
        Object.keys(entry).some((key) => key !== "url" && key !== "revision") ||
        typeof entry.url !== "string"
      ) {
        issues.push("worker contains an invalid precache entry");
        continue;
      }

      const url = entry.url;
      urls.add(url);
      if (expectedShellEntries.has(url)) {
        if (typeof entry.revision !== "string" || !revisionPattern.test(entry.revision)) {
          issues.push(`shell entry is not revisioned: ${url}`);
        }
      } else if (versionedAssetPattern.test(url)) {
        if (entry.revision !== null) {
          issues.push(`versioned asset has an unexpected revision: ${url}`);
        }
      } else {
        issues.push(`unexpected precache entry: ${url}`);
      }
    }

    for (const expected of expectedShellEntries) {
      if (!urls.has(expected)) issues.push(`missing shell entry: ${expected}`);
    }
    if (![...urls].some((url) => versionedAssetPattern.test(url) && url.endsWith(".js"))) {
      issues.push("missing versioned JavaScript asset");
    }
    if (![...urls].some((url) => versionedAssetPattern.test(url) && url.endsWith(".css"))) {
      issues.push("missing versioned stylesheet asset");
    }
  }

  const runtimeRoutes = callArguments(workerSource, "registerRoute");
  if (
    runtimeRoutes.length !== 1 ||
    !navigationRoutePattern.test(runtimeRoutes[0]) ||
    /addEventListener\(\s*["']fetch["']/i.test(workerSource) ||
    hasDirectOnFetchAssignment(workerSource)
  ) {
    issues.push("worker contains disallowed runtime caching behavior");
  }

  return issues;
}

function emittedServiceWorker(): string {
  const workerFiles = readdirSync(buildDirectory).filter((name) => name.endsWith(".js"));
  const workerSource = workerFiles
    .map((name) => readFileSync(join(buildDirectory, name), "utf8"))
    .find((source) => source.includes("precacheAndRoute"));
  expect(workerSource, "expected an emitted Workbox service worker").toBeDefined();
  return workerSource!;
}

beforeAll(() => {
  buildDirectory = mkdtempSync(join(tmpdir(), "zpay-dashboard-"));
  execFileSync(
    process.execPath,
    [join(dashboardRoot, "node_modules/vite/bin/vite.js"), "build", "--outDir", buildDirectory, "--emptyOutDir"],
    { cwd: dashboardRoot, env: { ...process.env, NODE_ENV: "production" }, stdio: "pipe" },
  );
});

afterAll(() => {
  if (buildDirectory) {
    rmSync(buildDirectory, { recursive: true, force: true });
  }
});

describe("production PWA artifact", () => {
  it.each([
    ["icon-192.png", 192], ["icon-512.png", 512], ["icon-maskable-512.png", 512],
  ])("emits actual %s PNG dimensions, not merely manifest labels", (name, size) => {
    const png = readFileSync(join(buildDirectory, "icons", name as string));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.toString("ascii", 12, 16)).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
    if (name === "icon-maskable-512.png") {
      // This asset uses true-color RGB without alpha. A tRNS chunk could still add transparency.
      expect(png[25]).toBe(2);
      const chunks: string[] = [];
      for (let offset = 8; offset < png.length; offset += png.readUInt32BE(offset) + 12) {
        chunks.push(png.toString("ascii", offset + 4, offset + 8));
      }
      expect(chunks).not.toContain("tRNS");
      expect(chunks).toContain("IEND");
    }
  });

  it("emits the ZPay install manifest with every required icon purpose", () => {
    const manifest = JSON.parse(readFileSync(join(buildDirectory, "manifest.webmanifest"), "utf8")) as {
      name?: string;
      display?: string;
      icons?: Array<{ sizes?: string; purpose?: string }>;
    };

    expect(manifest.name).toBe("ZPay Merchant Dashboard");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192" }),
      expect.objectContaining({ sizes: "512x512" }),
      expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
    ]));
  });

  it("precaches only revisioned shell files and versioned frontend assets", () => {
    expect(serviceWorkerSafetyIssues(emittedServiceWorker())).toEqual([]);
  });

  it("rejects a catch-all runtime CacheFirst route even without financial keywords", () => {
    const broadRuntimeRoute = `${emittedServiceWorker()}
    registerRoute(
      () => true,
      new CacheFirst({ cacheName: "all-requests" }),
    );`;

    expect(serviceWorkerSafetyIssues(broadRuntimeRoute)).toContain(
      "worker contains disallowed runtime caching behavior",
    );
  });

  it("rejects a catch-all cache installed through self.onfetch", () => {
    const directFetchHandler = `${emittedServiceWorker()}
    self.onfetch = (event) => {
      event.respondWith(
        caches.open("all-responses").then((cache) =>
          cache.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
            cache.put(event.request, response.clone());
            return response;
          })),
        ),
      );
    };`;

    expect(serviceWorkerSafetyIssues(directFetchHandler)).toContain(
      "worker contains disallowed runtime caching behavior",
    );
    expect(serviceWorkerSafetyIssues(directFetchHandler.replace("self.onfetch", "onfetch"))).toContain(
      "worker contains disallowed runtime caching behavior",
    );
  });

  it.each(onFetchAssignmentCases)(
    "rejects a direct fetch handler installed through $target $operator",
    ({ operator, target }) => {
      const directFetchHandler = `${emittedServiceWorker()}
      ${target} ${operator} (event) => {
        event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
      };`;

      expect(serviceWorkerSafetyIssues(directFetchHandler)).toContain(
        "worker contains disallowed runtime caching behavior",
      );
    },
  );

  it("allows harmless onfetch text in worker strings and comments", () => {
    const harmlessText = `${emittedServiceWorker()}
    const explanation = "self.onfetch = is not installed";
    // onfetch = is documentation only
    /* self.onfetch = is documentation only */`;

    expect(serviceWorkerSafetyIssues(harmlessText)).toEqual([]);
  });

  it.each(onFetchAssignmentCases)(
    "rejects $target $operator inside an executable template expression",
    ({ operator, target }) => {
      const source = emittedServiceWorker() + '\nconst label = `handler: ${' +
        `${target} ${operator} (event) => event.respondWith(caches.match(event.request))` + '}`;';

      expect(serviceWorkerSafetyIssues(source)).toContain(
        "worker contains disallowed runtime caching behavior",
      );
    },
  );

  it.each([
    'var onfetch = handler;',
    'var other = null, onfetch = handler;',
    'if (enabled) { var onfetch = handler; }',
    String.raw`var on\u0066etch = handler;`,
  ])("rejects a classic-worker global var handler: %s", (snippet) => {
    expect(serviceWorkerSafetyIssues(`${emittedServiceWorker()}\n${snippet}`)).toContain(
      "worker contains disallowed runtime caching behavior",
    );
  });

  it.each([
    'var onfetch;',
    'let onfetch = handler;',
    'function localHandler() { var onfetch = handler; }',
    'const localHandler = () => { var onfetch = handler; };',
    'class LocalHandler { static { var onfetch = handler; } }',
  ])("allows declarations that do not install a global handler: %s", (snippet) => {
    expect(serviceWorkerSafetyIssues(`${emittedServiceWorker()}\n${snippet}`)).toEqual([]);
  });

  it.each([
    '(onfetch)',
    '(self.onfetch)',
    '(self).onfetch',
    'self[("onfetch")]',
    '((window))[(("onfetch"))]',
    '((globalThis.onfetch))',
  ].flatMap((target) => ["=", "||=", "&&=", "??="].map((operator) => ({ operator, target }))))(
    "rejects parenthesized static target $target $operator",
    ({ operator, target }) => {
      expect(serviceWorkerSafetyIssues(`${emittedServiceWorker()}\n${target} ${operator} handler;`)).toContain(
        "worker contains disallowed runtime caching behavior",
      );
    },
  );

  it.each([
    'const label = `outer ${`inner ${self.onfetch = handler}`}`;',
    'const label = `outer ${(() => { const nested = { text: "}" }; self.onfetch = handler; })()}`;',
    'const label = `first ${"safe"} second ${self.onfetch = handler}`;',
    'const label = `literal \\${safe} real ${self.onfetch = handler}`;',
  ])("rejects handlers in nested or repeated template expressions: %s", (snippet) => {
    expect(serviceWorkerSafetyIssues(`${emittedServiceWorker()}\n${snippet}`)).toContain(
      "worker contains disallowed runtime caching behavior",
    );
  });

  it.each([
    String.raw`on\u0066etch`,
    String.raw`self.on\u0066etch`,
    String.raw`globalThis.on\u{66}etch`,
    String.raw`window.on\u0066etch`,
    String.raw`s\u0065lf.onfetch`,
    String.raw`self['on\u0066etch']`,
    String.raw`globalThis["on\u{66}etch"]`,
    String.raw`window['on\x66etch']`,
    "self[`on\\u0066etch`]",
  ].flatMap((target) => ["=", "||=", "&&=", "??="].map((operator) => ({ operator, target }))))(
    "rejects escaped static target $target $operator",
    ({ operator, target }) => {
      expect(serviceWorkerSafetyIssues(`${emittedServiceWorker()}\n${target} ${operator} handler;`)).toContain(
        "worker contains disallowed runtime caching behavior",
      );
    },
  );

  it.each([
    'const pattern = /self.onfetch=/;',
    'const pattern = /window.onfetch\\|\\|=/g;',
    'const pattern = /[self.onfetch=]/;',
    'const pattern = /slash\\/self.onfetch=/;',
    'function pattern() { return /self.onfetch=/; }',
    'if (enabled) /self.onfetch=/.test(text);',
    'const label = `literal self.onfetch = ${"window.onfetch ="}`;',
    'const label = `escaped \\${self.onfetch = handler}`;',
    'const label = `regex ${/self.onfetch=/}`;',
  ])("allows inert regular-expression or template text: %s", (snippet) => {
    expect(serviceWorkerSafetyIssues(`${emittedServiceWorker()}\n${snippet}`)).toEqual([]);
  });

  it.each([
    'const value = total / (self.onfetch = handler);',
    'const value = total / (onfetch = handler) / count;',
    'const pattern = /self.onfetch=/; window.onfetch = handler;',
  ])("still rejects executable assignments adjacent to slash syntax: %s", (snippet) => {
    expect(serviceWorkerSafetyIssues(`${emittedServiceWorker()}\n${snippet}`)).toContain(
      "worker contains disallowed runtime caching behavior",
    );
  });

  it("publishes the dashboard SPA without an API proxy", () => {
    const configPath = join(repositoryRoot, "vercel.json");
    expect(existsSync(configPath), "expected a root Vercel configuration").toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf8"));

    expect(config).toEqual({
      installCommand: "cd dashboard && npm ci",
      buildCommand: "cd dashboard && npm run build",
      outputDirectory: "dashboard/dist",
      rewrites: [{ source: "/((?!assets/).*)", destination: "/index.html" }],
    });
    expect(JSON.stringify(config)).not.toMatch(/localhost|127\.0\.0\.1|\/api\//i);
  });
});
