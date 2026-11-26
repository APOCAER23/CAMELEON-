#!/usr/bin/env node
import { Command } from 'commander';
import { EngineError, APP_VERSION } from '@cameleon/shared';
import { redactString } from '@cameleon/kit';
import { banner, sym } from './ui.js';
import { printStatus } from './commands/status.js';
import { runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import { engineLogs, engineStart, engineStatus, engineStop } from './commands/engine.js';
import { configureProvider, listCredentials, listProviders, removeProvider, testProviders, toggleProvider } from './commands/provider.js';
import { launchAgent } from './commands/launch.js';
import { listAgents } from './commands/agents.js';
import { createProfile, deleteProfile, listProfiles, showProfile, switchProfile } from './commands/profile.js';
import { addModel, listModels, removeModel, showModel, syncModels } from './commands/models.js';

const program = new Command('cameleon')
  .description(banner())
  .version(APP_VERSION, '-v, --version')
  .enablePositionalOptions() // a subcommand's own options (e.g. `models add --tools yes`) must not be swallowed by its parent
  .showHelpAfterError('(run with --help for usage)');

program.command('init').description('Prepare directories, start the engine and show next steps').action(runInit);
program.command('status').description('Show engine, vault and configuration status').option('--json', 'machine-readable output').action((o) => printStatus(o.json));
program.command('doctor').description('Diagnose configuration and security problems').action(async () => { process.exitCode = await runDoctor(); });

const engine = program.command('engine').description('Manage the background engine');
engine.command('start').description('Start the engine in the background').action(engineStart);
engine.command('stop').description('Stop the engine').action(engineStop);
engine.command('status').description('Is the engine running?').action(engineStatus);
engine.command('logs').description('Show recent engine logs').option('-n, --lines <n>', 'number of lines', '50').action((o) => engineLogs(Number(o.lines)));

const provider = program.command('provider').description('Manage AI providers and API keys');
provider.command('list').description('List the provider catalog').option('--category <c>', 'direct | aggregator | local | custom').option('--configured', 'only configured providers').option('--json').action(listProviders);
provider.command('credentials [id]').description('List saved credentials (masked)').option('--json').action((id, o) => listCredentials(id, o.json));
provider.command('configure [id]').description('Add or update a provider credential (interactive)')
  .option('-l, --label <label>', 'credential profile name (default: "default")')
  .option('--set <key=value...>', 'non-secret field value, repeatable (e.g. baseUrl=https://…)', (v, acc: string[] = []) => [...acc, v])
  .option('--key-stdin', 'read the API key from stdin (never from arguments)')
  .option('-y, --yes', 'do not ask for confirmation')
  .option('--no-test', 'skip the connection test before saving')
  .option('--force', 'save even if the connection test fails')
  .option('--no-sync', 'do not discover models after saving')
  .action(configureProvider);
provider.command('test [id]').description('Test the connection of stored credentials').option('-l, --label <label>').action(testProviders);
provider.command('remove [id]').description('Delete stored credentials').option('-l, --label <label>').option('-y, --yes').action(removeProvider);
provider.command('disable [id]').description('Disable a provider\'s credentials').option('-l, --label <label>').action((id, o) => toggleProvider(id, false, o));
provider.command('enable [id]').description('Re-enable a provider\'s credentials').option('-l, --label <label>').action((id, o) => toggleProvider(id, true, o));

const models = program.command('models').description('Browse and manage the model registry')
  .argument('[search]', 'filter by id / name / description')
  .option('-p, --provider <id>', 'only this provider')
  .option('--tools', 'tool calling supported').option('--vision', 'vision supported').option('--reasoning', 'reasoning supported')
  .option('--structured', 'structured output supported').option('--streaming', 'streaming supported')
  .option('--all', 'include embedding / image / audio / moderation models')
  .option('-n, --limit <n>', 'rows to show', '50').option('--json')
  .action(listModels);
models.command('sync [provider]').description('Discover models from your connected providers').action(syncModels);
models.command('show <provider> <model>').description('Details and capabilities of one model').action(showModel);
models.command('add <provider> <model>').description('Register a model manually')
  .option('--name <name>').option('--protocol <p>').option('--context <tokens>').option('--max-output <tokens>')
  .option('--tools <yes|no>').option('--vision <yes|no>').option('--reasoning <yes|no>').option('--structured <yes|no>').option('--streaming <yes|no>')
  .action(addModel);
models.command('remove <provider> <model>').description('Remove a manually registered model').action(removeModel);

const launchOpts = (c: ReturnType<typeof program.command>) => c
  .option('-p, --provider <id>', 'provider id').option('-m, --model <id>', 'model id').option('-l, --label <label>', 'credential profile to use')
  .option('--profile <name>', 'use a saved profile').option('--cwd <dir>', 'working directory for the agent')
  .option('--dry-run', 'show the exact plan (secrets masked) without starting anything').option('--force', 'launch even if the model is reported incompatible');

launchOpts(program.command('launch [agent] [args...]')
  .description('Launch a coding agent with a configured provider and model  (agent options go after --)'))
  .action((agent: string | undefined, args: string[], o) => {
    // `cameleon launch --profile X -- --flag`: everything after `--` belongs to the agent, never to us.
    if (agent?.startsWith('-')) return launchAgent(undefined, [agent, ...args], o);
    return launchAgent(agent, args, o);
  });

const agent = program.command('agent').description('Detect and launch external coding agents');
agent.command('list').alias('detect').description('List supported agents and whether they are installed').option('--refresh', 'ignore the detection cache').option('--json').action(listAgents);
launchOpts(agent.command('launch <agent> [args...]').description('Same as `cameleon launch`')).action((a: string, args: string[], o) => launchAgent(a, args, o));
agent.command('inspect <agent>').description('Show the launch plan (secrets masked) without starting the agent')
  .option('-p, --provider <id>').option('-m, --model <id>').option('-l, --label <label>').option('--profile <name>')
  .action((a: string, o) => launchAgent(a, [], { ...o, dryRun: true }));

const profile = program.command('profile').description('Saved agent + provider + model combinations');
profile.command('list').description('List profiles').option('--json').action(listProfiles);
profile.command('show <name>').action(showProfile);
profile.command('create [name]').description('Create a profile (interactive when options are omitted)')
  .option('--agent <id>').option('-p, --provider <id>').option('-m, --model <id>').option('-l, --label <label>')
  .option('--args <string>', 'extra launch arguments, e.g. "--verbose"').option('--project <path>', 'associate a project folder')
  .action(createProfile);
profile.command('switch [name]').description('Make a profile active').option('--none', 'deactivate the current profile').action(switchProfile);
profile.command('delete <name>').option('-y, --yes').action(deleteProfile);

try {
  await program.parseAsync(process.argv);
} catch (err) {
  const e = err as Error;
  if (e.name === 'ExitPromptError') process.exit(130); // Ctrl+C in a prompt
  const msg = e instanceof EngineError ? e.message : redactString(e.message);
  console.error(`${sym.fail} ${msg}`);
  if (e instanceof EngineError && e.code === 'engine_unreachable') console.error('   Run `cameleon doctor` to diagnose.');
  process.exit(1);
}
