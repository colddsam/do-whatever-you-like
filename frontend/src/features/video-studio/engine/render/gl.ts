/** Small WebGL2 helpers: programs with cached uniform locations, render targets, textures. */

export type Program = {
  prog: WebGLProgram;
  u: (name: string) => WebGLUniformLocation | null;
};

function shader(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return s;
}

export function program(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const prog = gl.createProgram()!;
  const v = shader(gl, gl.VERTEX_SHADER, vs);
  const f = shader(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.bindAttribLocation(prog, 0, "aPos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`Program link failed: ${gl.getProgramInfoLog(prog)}`);
  gl.deleteShader(v);
  gl.deleteShader(f);
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    prog,
    u: (name) => {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(prog, name));
      return cache.get(name)!;
    },
  };
}

export type Target = { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number };

export function texture(gl: WebGL2RenderingContext) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function target(gl: WebGL2RenderingContext, w: number, h: number): Target {
  const tex = texture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, w, h };
}

export function freeTarget(gl: WebGL2RenderingContext, t: Target | null | undefined) {
  if (!t) return;
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

/** A unit quad (0..1) as a triangle strip at attribute 0. */
export function quad(gl: WebGL2RenderingContext) {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, buf };
}
