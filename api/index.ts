// Vercel serverless function. All routes are rewritten here (see vercel.json).
//
// The app is pre-bundled by the `vercel-build` script (esbuild) into
// ./_app.mjs — a single self-contained ESM file. This is required because the
// source uses extensionless relative imports (moduleResolution: "Bundler"),
// which native Node ESM on Vercel cannot resolve at runtime. Bundling inlines
// all of src/ and keeps node_modules external, so the only module boundary
// crossed here is this one explicit-extension import (`./_app.mjs`).
export { default, runtime } from "./_app.mjs";
