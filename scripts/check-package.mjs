import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "convex-plunk-consumer-"));
try {
  const output = execFileSync(
    "npm",
    ["pack", "--json", "--pack-destination", temp],
    { cwd: join(root, "packages/convex-plunk"), encoding: "utf8" },
  );
  const [pack] = JSON.parse(output);
  const names = pack.files.map((file) => file.path);
  for (const required of [
    "dist/client/index.js",
    "dist/client/index.d.ts",
    "dist/component/convex.config.js",
    "dist/component/_generated/component.d.ts",
    "src/test.ts",
    "LICENSE",
    "README.md",
  ])
    if (!names.includes(required)) throw new Error(`Missing ${required}`);
  for (const name of names)
    if (
      name.includes(".env") ||
      name.includes("node_modules/") ||
      name.endsWith(".test.ts")
    )
      throw new Error(`Unexpected packed file ${name}`);
  writeFileSync(
    join(temp, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(temp, pack.filename),
      "convex@1.49.0",
      "typescript@7.0.2",
      "convex-test@0.0.66",
      "vitest@5.0.5",
      "vite@8.3.5",
    ],
    { cwd: temp, stdio: "pipe" },
  );
  writeFileSync(
    join(temp, "check.mjs"),
    `import {Plunk} from '@clipin/convex-plunk';\nimport config from '@clipin/convex-plunk/convex.config.js';\nif(typeof Plunk!=='function'||!config) throw new Error('Invalid exports');\n`,
  );
  execFileSync("node", ["check.mjs"], { cwd: temp, stdio: "inherit" });
  writeFileSync(
    join(temp, "consumer.ts"),
    `import {Plunk} from '@clipin/convex-plunk';\nimport type {ComponentApi} from '@clipin/convex-plunk/_generated/component.js';\nimport {defineApp} from 'convex/server';\nimport config from '@clipin/convex-plunk/convex.config.js';\ndeclare const component:ComponentApi;\nconst plunk=new Plunk(component);\nexport const worker=plunk.worker();\nconst app=defineApp();app.use(config);\n`,
  );
  execFileSync(
    join(temp, "node_modules/.bin/tsc"),
    [
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--moduleResolution",
      "bundler",
      "--module",
      "esnext",
      "--target",
      "es2022",
      "consumer.ts",
    ],
    { cwd: temp, stdio: "inherit" },
  );
  writeFileSync(
    join(temp, "vitest.config.ts"),
    `import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'node',server:{deps:{inline:['@clipin/convex-plunk']}}}});
`,
  );
  writeFileSync(
    join(temp, "package.test.ts"),
    `import {expect,it} from 'vitest';
import {convexTest} from 'convex-test';
import {componentsGeneric,defineSchema} from 'convex/server';
import {register} from '@clipin/convex-plunk/test';
it('loads the packed component through its public test helper',async()=>{
 const t=convexTest(defineSchema({}),{'./_generated/server.ts':async()=>({})});
 register(t);
 const result=await t.query(componentsGeneric().plunk.lib.list,{paginationOpts:{numItems:1,cursor:null}});
 expect(result.page).toEqual([]);
 expect(result.isDone).toBe(true);
});
`,
  );
  execFileSync(join(temp, "node_modules/.bin/vitest"), ["run"], {
    cwd: temp,
    stdio: "inherit",
  });
  console.log(
    `Package smoke passed: ${names.length} files, fresh consumer imports, TypeScript compile, and test helper execution.`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
