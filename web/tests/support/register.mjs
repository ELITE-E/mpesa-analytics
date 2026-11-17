// Entry point for `node --import ./tests/support/register.mjs --test …`.
import { register } from "node:module";

register("./loader-hooks.mjs", import.meta.url);
