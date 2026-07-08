/**
 * Mint an API key for an owner (bootstrap / provisioning). Requires DATABASE_URL.
 *
 *   pnpm create-api-key --owner acme --name "server key"
 *
 * Prints the plaintext key ONCE — store it securely.
 */
import { ApiKeyService } from "../src/services/api-key-service";
import { store } from "../src/storage/factory";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const owner = arg("--owner");
  const name = arg("--name") ?? "default";
  if (!owner) {
    console.error('Usage: pnpm create-api-key --owner <ownerId> [--name "label"]');
    process.exit(1);
  }
  const issued = await new ApiKeyService(store).issue(owner, name);
  console.log(`\nAPI key for owner "${owner}" (${issued.prefix}…):\n`);
  console.log(`  ${issued.key}\n`);
  console.log("Store it now — it will not be shown again.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
