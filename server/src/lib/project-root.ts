import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * 解析"被观测 CCB 项目根"（projectRoot），与 su-oriel 自身源码根（sourceRoot）解耦。
 *
 * 优先级：显式 CCB_PROJECT_ROOT → 从 startPath 向上发现含 `.ccb/` 的目录。
 * 不依赖固定目录深度，因此 console 从 su-oriel/server 启动时仍能爬到真正的项目根，
 * 不会因 multi-repo 拆分后路径变浅而 overshoot。
 */
export function resolveCcbProjectRoot(startPath = process.env.CCB_PROJECT_ROOT ?? process.cwd()): string {
  let current = resolve(startPath);
  while (true) {
    if (existsSync(join(current, ".ccb"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(startPath);
    }
    current = parent;
  }
}
