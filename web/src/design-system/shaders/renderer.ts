import { compileWebGLShader, linkWebGLProgram } from "../../lib/webgl";
import { fragments, vertex, type Effect } from "./programs";
import type { Uniforms } from "./logic";

export type Texture = "paper" | "marble" | "doodles";
function compile(gl: WebGLRenderingContext, vs: WebGLShader, source: string) {
  const fs = compileWebGLShader(gl, gl.FRAGMENT_SHADER, source);
  if (!fs) return null;
  const program = linkWebGLProgram(gl, vs, fs);
  gl.deleteShader(fs);
  if (!program) return null;
  const loc = (name: string) => gl.getUniformLocation(program, name);
  return { program, position: gl.getAttribLocation(program, "p"), size: loc("uR"), time: loc("uT"),
    pointer: loc("uM"), seed: loc("uS"), a: loc("uA"), b: loc("uB"), sampler: loc("uX") };
}

export function createRenderer(gl: WebGLRenderingContext, backing: HTMLCanvasElement, invalidate: (name: Texture) => void) {
  const vs = compileWebGLShader(gl, gl.VERTEX_SHADER, vertex);
  if (!vs) return null;
  const programs = new Map<Effect, NonNullable<ReturnType<typeof compile>>>();
  for (const effect of Object.keys(fragments) as Effect[]) {
    const program = compile(gl, vs, fragments[effect]);
    if (!program) {
      gl.deleteShader(vs);
      for (const compiled of programs.values()) gl.deleteProgram(compiled.program);
      return null;
    }
    programs.set(effect, program);
  }
  gl.deleteShader(vs);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const textures = new Map<Texture, WebGLTexture | null>();
  const blank = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,255,255]));
  let disposed = false;

  function texture(name?: Texture) {
    if (!name) return null;
    if (!textures.has(name)) {
      textures.set(name, null);
      const scan = new Image();
      scan.onload = () => {
        if (disposed || gl.isContextLost()) return;
        const handle = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, handle);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scan);
        textures.set(name, handle);
        invalidate(name);
      };
      scan.src = "/textures/keating-" + name + ".webp";
    }
    return textures.get(name) ?? null;
  }

  function draw(ctx: CanvasRenderingContext2D, effect: Effect, uniforms: Uniforms, time: number, seed: number, scan: WebGLTexture | null) {
    const { width, height } = ctx.canvas;
    if (backing.width < width) backing.width = width;
    if (backing.height < height) backing.height = height;
    const p = programs.get(effect)!;
    gl.useProgram(p.program);
    gl.enableVertexAttribArray(p.position);
    gl.vertexAttribPointer(p.position, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, width, height);
    gl.uniform2f(p.size, width, height);
    gl.uniform1f(p.time, time);
    gl.uniform1f(p.seed, seed);
    gl.uniform2f(p.pointer, ...(uniforms.pointer ?? [.5,.5] as const));
    gl.uniform4f(p.a, ...uniforms.a);
    gl.uniform4f(p.b, ...uniforms.b);
    gl.bindTexture(gl.TEXTURE_2D, scan ?? blank);
    gl.uniform1i(p.sampler, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(backing, 0, backing.height - height, width, height, 0, 0, width, height);
  }

  return { texture, draw, dispose() {
    disposed = true;
    for (const { program } of programs.values()) gl.deleteProgram(program);
    for (const t of textures.values()) gl.deleteTexture(t);
    gl.deleteTexture(blank);
    gl.deleteBuffer(buffer);
  } };
}
