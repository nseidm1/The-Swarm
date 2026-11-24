// engine-knows.mjs - DOES AN ENGINE BUILD KNOW A MODEL'S ARCHITECTURE? A model of a new architecture (Inkling 2's looped
// transformer, `inkling2_loop`) loads only in a llama.cpp build that has it: asked of another, the server stops with "unknown
// model architecture". A catalog entry that needs one says so (`architecture`), and the engine is chosen to match.
//   knows(bin, arch)            -> true where the build names that architecture: in the program itself, or in the libllama
//                                  beside it or in ../lib (a build with shared libraries keeps its architectures there)
//   engineFor(archs, candidates) -> the first candidate that knows every one, or '' where none does
//   OTHER_BUILDS                -> where another build may be, beside the ones the swarm already looks for: Unsloth's
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const OTHER_BUILDS = [path.join(os.homedir(), '.unsloth', 'llama.cpp', 'build', 'bin', 'llama-server')];
const holds = (file, text) => {
  try {
    return fs.readFileSync(file).includes(Buffer.from(text));
  } catch {
    return false;
  }
};
export function knows(bin, arch) {
  if (!bin || !arch) return !!bin;
  let real = bin;
  try {
    real = fs.realpathSync(bin);
  } catch {
    return false;
  }
  const dirs = [path.dirname(real), path.join(path.dirname(real), '..', 'lib')];
  const libs = dirs.flatMap((d) => {
    try {
      return fs
        .readdirSync(d)
        .filter((f) => /^libllama(\.[\d.]+)?\.(dylib|so)(\.[\d.]+)?$/.test(f) || f === 'llama.dll')
        .map((f) => path.join(d, f));
    } catch {
      return [];
    }
  });
  return [real, ...libs].some((f) => holds(f, arch));
}
export const engineFor = (archs, candidates) =>
  (candidates || []).filter(Boolean).find((c) => (archs || []).every((a) => knows(c, a))) || '';
