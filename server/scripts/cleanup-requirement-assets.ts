import { prisma } from "../src/db/prisma.js";
import { cleanupTmpRequirementAssets } from "../src/modules/requirement/requirement-assets.service.js";

interface Args {
  projectId?: string;
  projectRoot?: string;
  olderThanHours: number;
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { olderThanHours: 48, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--project") {
      args.projectId = argv[++i];
    } else if (arg === "--project-root") {
      args.projectRoot = argv[++i];
    } else if (arg === "--older-than-hours") {
      args.olderThanHours = Number(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  pnpm --filter ccb-console-server cleanup:requirement-assets -- --project <projectId> [--apply]
  pnpm --filter ccb-console-server cleanup:requirement-assets -- --project-root <path> [--apply]

Options:
  --older-than-hours <n>   删除超过 n 小时的 tmp-* 目录，默认 48
  --apply                  真正删除；不加时只 dry-run
`);
}

async function resolveProjectRoot(args: Args): Promise<string> {
  if (args.projectRoot) return args.projectRoot;
  if (!args.projectId) {
    throw new Error("必须提供 --project <projectId> 或 --project-root <path>");
  }
  const project = await prisma.project.findUnique({
    where: { id: args.projectId },
    select: { localPath: true }
  });
  if (!project) {
    throw new Error(`项目不存在: ${args.projectId}`);
  }
  return project.localPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(args.olderThanHours) || args.olderThanHours <= 0) {
    throw new Error("--older-than-hours 必须是正数");
  }
  const projectRoot = await resolveProjectRoot(args);
  const result = await cleanupTmpRequirementAssets(projectRoot, {
    olderThanMs: args.olderThanHours * 60 * 60 * 1000,
    apply: args.apply
  });
  console.log(JSON.stringify({ projectRoot, ...result }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
