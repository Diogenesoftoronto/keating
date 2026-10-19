import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import { compileWebGLShader, linkWebGLProgram } from "../lib/webgl";

describe("shared WebGL setup", () => {
  test("compilation returns only compiled shaders and deletes only failed allocations", () => {
    fc.assert(fc.property(
      fc.boolean(), fc.boolean(), fc.integer(), fc.string(),
      (allocated, compiled, type, source) => {
        const shader = {} as WebGLShader;
        let shaderType: number | undefined;
        let compiledSource: string | undefined;
        let shaderCompiled = false;
        const deleted: WebGLShader[] = [];
        const gl = {
          COMPILE_STATUS: 35713,
          createShader: (kind: number) => {
            shaderType = kind;
            return allocated ? shader : null;
          },
          shaderSource: (value: WebGLShader, text: string) => {
            expect(value).toBe(shader);
            compiledSource = text;
          },
          compileShader: (value: WebGLShader) => {
            expect(value).toBe(shader);
            shaderCompiled = true;
          },
          getShaderParameter: (value: WebGLShader, parameter: number) =>
            value === shader && parameter === 35713 && shaderCompiled && compiled,
          deleteShader: (value: WebGLShader) => deleted.push(value),
        } as unknown as WebGLRenderingContext;

        expect(compileWebGLShader(gl, type, source)).toBe(allocated && compiled ? shader : null);
        expect(shaderType).toBe(type);
        expect(shaderCompiled).toBe(allocated);
        expect(compiledSource).toBe(allocated ? source : undefined);
        expect(deleted).toEqual(allocated && !compiled ? [shader] : []);
      },
    ));
  });

  test("linking deletes failed programs and always leaves shader ownership with callers", () => {
    fc.assert(fc.property(fc.boolean(), fc.boolean(), (allocated, linked) => {
      const program = {} as WebGLProgram;
      const vertex = { kind: "vertex" } as unknown as WebGLShader;
      const fragment = { kind: "fragment" } as unknown as WebGLShader;
      const attached = new Set<WebGLShader>();
      const deletedPrograms: WebGLProgram[] = [];
      const deletedShaders: WebGLShader[] = [];
      let programLinked = false;
      const gl = {
        LINK_STATUS: 35714,
        createProgram: () => allocated ? program : null,
        attachShader: (value: WebGLProgram, shader: WebGLShader) => {
          expect(value).toBe(program);
          attached.add(shader);
        },
        linkProgram: (value: WebGLProgram) => {
          expect(value).toBe(program);
          programLinked = attached.has(vertex) && attached.has(fragment);
        },
        getProgramParameter: (value: WebGLProgram, parameter: number) =>
          value === program && parameter === 35714 && programLinked && linked,
        deleteProgram: (value: WebGLProgram) => deletedPrograms.push(value),
        deleteShader: (value: WebGLShader) => deletedShaders.push(value),
      } as unknown as WebGLRenderingContext;

      expect(linkWebGLProgram(gl, vertex, fragment)).toBe(allocated && linked ? program : null);
      expect(programLinked).toBe(allocated);
      expect(attached).toEqual(new Set(allocated ? [vertex, fragment] : []));
      expect(deletedPrograms).toEqual(allocated && !linked ? [program] : []);
      expect(deletedShaders).toEqual([]);
    }));
  });
});
