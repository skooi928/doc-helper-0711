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
    case '--help':
      console.log(`Usage: doch <command> [args]
        Commands:
          drift <file1> <file2> ...   Update documentation status for source files
          check <file1> <file2> ...   Check documentation status for markdown files
          --help                        Show this help message
        `);
      break;
    // …other sub-commands…
    default:
      console.error(`Unknown subcommand: ${cmd}\nTry 'doch --help'.`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});