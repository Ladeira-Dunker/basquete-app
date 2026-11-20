const fs = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const outputDirectory = path.join(root, "dist");
const staticFiles = [
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "community.js",
  "supabase-config.js",
  path.join("icons", "icon.svg"),
  path.join("icons", "icon-192.png"),
  path.join("icons", "icon-512.png")
];

async function build() {
  await fs.mkdir(path.join(outputDirectory, "icons"), { recursive: true });
  await Promise.all(staticFiles.map((file) =>
    fs.copyFile(path.join(root, file), path.join(outputDirectory, file))
  ));
}

build().catch((error) => {
  console.error("Static Vercel build failed:", error.message);
  process.exitCode = 1;
});
