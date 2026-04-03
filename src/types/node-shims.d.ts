declare module "node:fs/promises" {
  export const readFile: (...args: any[]) => Promise<any>;
  export const writeFile: (...args: any[]) => Promise<any>;
  export const mkdir: (...args: any[]) => Promise<any>;
  export const readdir: (...args: any[]) => Promise<any>;
  export const stat: (...args: any[]) => Promise<any>;
  export const mkdtemp: (...args: any[]) => Promise<any>;
  export const access: (...args: any[]) => Promise<any>;
  export const rm: (...args: any[]) => Promise<any>;
}

declare module "node:fs" {
  export const existsSync: (...args: any[]) => boolean;
  export const readFileSync: (...args: any[]) => any;
}

declare module "node:path" {
  export const join: (...args: any[]) => string;
  export const resolve: (...args: any[]) => string;
  export const dirname: (...args: any[]) => string;
  export const relative: (...args: any[]) => string;
  export const delimiter: string;
}

declare module "node:child_process" {
  export const spawn: (...args: any[]) => any;
  export const spawnSync: (...args: any[]) => any;
}

declare module "node:os" {
  export const homedir: () => string;
  export const tmpdir: () => string;
}

declare module "node:crypto" {
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: string): string };
  };
}

declare module "node:test" {
  const test: any;
  export default test;
}

declare module "node:assert/strict" {
  const assert: any;
  export default assert;
}

declare const process: any;
declare const console: any;
