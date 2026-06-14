import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";

export default {
  input: "out/extension.js",
  output: {
    file: "out/extension.js",
    format: "cjs",
    sourcemap: true,
  },
  external: ["vscode"],
  plugins: [nodeResolve(), commonjs(), terser()],
};
