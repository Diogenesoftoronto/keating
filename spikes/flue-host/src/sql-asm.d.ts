declare module "sql.js/dist/sql-asm.js" {
  interface Statement {
    bind(values: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }
  interface Database {
    prepare(sql: string): Statement;
    run(sql: string): void;
    export(): Uint8Array;
    close(): void;
  }
  export default function init(): Promise<{ Database: new (bytes?: Uint8Array) => Database }>;
}
