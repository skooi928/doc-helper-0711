#!/usr/bin/env node
import { driftNode, checkNode } from './utils/doch-cli';

async function main() {
  const [ , , cmd, ...args ] = process.argv;
  const root = process.cwd(); // getting the repo root

  switch (cmd) {
    case 'drift':
      await driftNode(args, root);
      break;
    case 'check':
      await checkNode(args, root);
      break;
    // …other sub-commands…
    default:
      console.error(`Unknown subcommand: ${cmd}`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});